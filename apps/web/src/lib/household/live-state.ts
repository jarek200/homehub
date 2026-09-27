import {
  type CameraSnapshotEventV1,
  createCores3HouseholdState,
  type DeviceUpdatedEventV1,
  emptyHouseholdState,
  type FloorPlan,
  type HubHouseholdState,
  hasHouseholdSequenceGap,
  householdChannelForId,
  isLegacyDummyHouseholdState,
  isNewerHouseholdEvent,
  parseCameraSnapshotEvent,
  parseDeviceUpdatedEvent,
  parseFloorPlan,
  parseHouseholdStateEvent,
  reconnectDelayMs,
} from '@homehub/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { type EventsChannel, events } from 'aws-amplify/data';
import { ensureAmplifyConfigured } from '$lib/amplify';
import { getHouseholdPlan, getHouseholdState, getMyProfile } from '$lib/services/rest-api';

export type LiveConnectionState = 'connecting' | 'connected' | 'disconnected';

function normalizeHousehold(state: HubHouseholdState): HubHouseholdState {
  if (isLegacyDummyHouseholdState(state)) {
    return createCores3HouseholdState();
  }
  const empty = emptyHouseholdState();
  return {
    ...empty,
    ...state,
    lock: state.lock ?? null,
    lights: state.lights ?? [],
    plugs: state.plugs ?? [],
    contacts: state.contacts ?? [],
    motions: state.motions ?? [],
    climates: state.climates ?? [],
    leaks: state.leaks ?? [],
    buttons: state.buttons ?? [],
    sensorHistory: state.sensorHistory ?? {},
  };
}

function applyPlan(
  raw: unknown,
  onPlan: ((plan: FloorPlan) => void) | undefined,
  stopped: () => boolean
) {
  const next = parseFloorPlan(raw);
  if (!stopped() && next?.rooms.length) onPlan?.(next);
}

async function currentHouseholdId(): Promise<string | null> {
  try {
    const profile = await getMyProfile();
    if (profile?.householdId) return profile.householdId;
  } catch {
    // Fall back to the Cognito sub, which matches owner household ids.
  }
  try {
    const session = await fetchAuthSession();
    const sub = session.tokens?.idToken?.payload?.sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

function eventsConfigured(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as Window & { ENV?: Record<string, string> };
  const url = win.ENV?.VITE_EVENTS_HTTP_URL ?? import.meta.env.VITE_EVENTS_HTTP_URL;
  return Boolean(url);
}

export function subscribeHouseholdLive(handlers: {
  onState?: (state: HubHouseholdState) => void;
  onPlan?: (plan: FloorPlan) => void;
  onSnapshot?: (event: CameraSnapshotEventV1) => void;
  onDeviceUpdate?: (event: DeviceUpdatedEventV1) => void;
  onTick?: () => void;
  onConnection?: (state: LiveConnectionState) => void;
}): () => void {
  let stopped = false;
  let stateRequest: Promise<void> | undefined;
  let planRequest: Promise<void> | undefined;
  let latestState: { stateVersion?: number; updatedAt?: string } = {};
  let connected = false;
  let reconnectTimer: number | undefined;
  let pollTimer: number | undefined;
  let reconnectAttempt = 0;
  let channel: EventsChannel | undefined;
  let subscription: { unsubscribe: () => void } | undefined;
  const isStopped = () => stopped;

  const tick = () => {
    if (!stopped) handlers.onTick?.();
  };

  const setConnection = (state: LiveConnectionState) => {
    if (stopped) return;
    handlers.onConnection?.(state);
  };

  const emitState = (state: HubHouseholdState) => {
    if (stopped || !state) return;
    if (
      (latestState.stateVersion !== undefined || latestState.updatedAt) &&
      !isNewerHouseholdEvent(state, latestState)
    ) {
      return;
    }
    latestState = {
      stateVersion: state.stateVersion,
      updatedAt: state.updatedAt,
    };
    handlers.onState?.(normalizeHousehold(state));
  };

  const refreshState = () => {
    if (!handlers.onState || stateRequest) return;
    stateRequest = getHouseholdState()
      .then((state) => {
        if (state) emitState(state);
      })
      .catch(() => {
        // Keep the last snapshot when the API is unreachable.
      })
      .finally(() => {
        stateRequest = undefined;
      });
  };

  const refreshPlan = () => {
    if (!handlers.onPlan || planRequest) return;
    planRequest = getHouseholdPlan()
      .then((plan) => {
        applyPlan(plan, handlers.onPlan, isStopped);
      })
      .catch(() => {
        // SSR / last cache stays until the next snapshot.
      })
      .finally(() => {
        planRequest = undefined;
      });
  };

  const refresh = () => {
    refreshState();
    refreshPlan();
  };

  const stopPoll = () => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const startPoll = () => {
    if (stopped || pollTimer !== undefined) return;
    pollTimer = window.setInterval(refresh, 4000);
  };

  const applyEvent = (raw: unknown) => {
    const snapshot = parseCameraSnapshotEvent(raw);
    if (snapshot) {
      handlers.onSnapshot?.(snapshot);
      tick();
      return;
    }
    const deviceUpdate = parseDeviceUpdatedEvent(raw);
    if (deviceUpdate) {
      handlers.onDeviceUpdate?.(deviceUpdate);
      tick();
      return;
    }
    const event = parseHouseholdStateEvent(raw);
    if (!event) {
      refreshState();
      return;
    }
    if (hasHouseholdSequenceGap(event.stateVersion, latestState.stateVersion)) {
      emitState(event.state);
      refresh();
      tick();
      return;
    }
    emitState(event.state);
    tick();
  };

  const disconnectChannel = () => {
    subscription?.unsubscribe();
    subscription = undefined;
    channel?.close();
    channel = undefined;
  };

  const connectEvents = async () => {
    if (stopped) return;
    if (!eventsConfigured()) {
      connected = false;
      setConnection('disconnected');
      startPoll();
      return;
    }
    setConnection('connecting');
    try {
      await ensureAmplifyConfigured();
      const householdId = await currentHouseholdId();
      if (!householdId || stopped) {
        connected = false;
        setConnection('disconnected');
        startPoll();
        return;
      }
      disconnectChannel();
      channel = await events.connect(householdChannelForId(householdId), { authMode: 'userPool' });
      if (stopped) {
        disconnectChannel();
        return;
      }
      subscription = channel.subscribe({
        next: (data) => {
          connected = true;
          reconnectAttempt = 0;
          stopPoll();
          setConnection('connected');
          applyEvent(data);
        },
        error: () => {
          connected = false;
          setConnection('disconnected');
          startPoll();
          scheduleReconnect();
        },
      });
      connected = true;
      reconnectAttempt = 0;
      stopPoll();
      setConnection('connected');
      refresh();
    } catch {
      connected = false;
      setConnection('disconnected');
      startPoll();
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    const delay = reconnectDelayMs(reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void connectEvents();
    }, delay);
  };

  refresh();
  void connectEvents();

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    refresh();
    if (!connected) {
      reconnectAttempt = 0;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      void connectEvents();
    }
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onVisible);
  window.addEventListener('pageshow', onVisible);

  return () => {
    stopped = true;
    stopPoll();
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onVisible);
    window.removeEventListener('pageshow', onVisible);
    disconnectChannel();
  };
}
