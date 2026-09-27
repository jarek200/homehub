import {
  isHouseholdSubscribeAllowed,
  parseHouseholdStateEvent,
  sanitizeHouseholdState,
} from '@homehub/core';
import { describe, expect, it } from 'vitest';

const live = Boolean(process.env.HOMEHUB_INT_EVENTS_TEST);
const eventsUrl = process.env.HOMEHUB_EVENTS_HTTP_URL ?? process.env.VITE_EVENTS_HTTP_URL ?? '';
const restUrl = (process.env.REST_API_URL ?? process.env.VITE_REST_API_URL ?? '').replace(
  /\/$/,
  ''
);
const accessToken = process.env.HOMEHUB_ACCESS_TOKEN ?? process.env.HOMEHUB_ID_TOKEN ?? '';

type AppSyncMessage = {
  id?: string;
  type?: string;
  event?: string | Record<string, unknown>;
  errors?: Array<{ errorType?: string; message?: string }>;
};

function jwtSub(token: string): string {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Cognito token has no payload');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof decoded.sub !== 'string' || !decoded.sub) throw new Error('Cognito token has no sub');
  return decoded.sub;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: AppSyncMessage) => boolean,
  timeoutMs = 10_000
): Promise<AppSyncMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`Timed out waiting for AppSync message after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as AppSyncMessage;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      resolve(message);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function connectEvents(token: string): Promise<{
  socket: WebSocket;
  authorization: { Authorization: string; host: string };
}> {
  const endpoint = new URL(eventsUrl);
  const authorization = { Authorization: token, host: endpoint.host };
  const encodedHeader = Buffer.from(JSON.stringify(authorization)).toString('base64url');
  const realtime = new URL(eventsUrl);
  realtime.protocol = 'wss:';
  realtime.hostname = realtime.hostname.replace('appsync-api', 'appsync-realtime-api');
  realtime.pathname = `${realtime.pathname.replace(/\/$/, '')}/realtime`;
  const socket = new WebSocket(realtime, ['aws-appsync-event-ws', `header-${encodedHeader}`]);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('AppSync socket failed to open')), {
      once: true,
    });
  });
  const ack = waitForMessage(socket, (message) => message.type === 'connection_ack');
  socket.send(JSON.stringify({ type: 'connection_init' }));
  await ack;
  return { socket, authorization };
}

async function subscribe(
  socket: WebSocket,
  authorization: { Authorization: string; host: string },
  id: string,
  channel: string
): Promise<AppSyncMessage> {
  const response = waitForMessage(
    socket,
    (message) =>
      message.id === id &&
      (message.type === 'subscribe_success' || message.type === 'subscribe_error')
  );
  socket.send(
    JSON.stringify({
      id,
      type: 'subscribe',
      channel,
      authorization,
      payload: {
        channel,
        extensions: { authorization },
      },
    })
  );
  return response;
}

async function rest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${restUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

describe('AppSync Events isolation contract', () => {
  it('rejects another user channel before a socket is opened', () => {
    expect(isHouseholdSubscribeAllowed('/household/other-user', ['hh_user-abc'])).toBe(false);
    expect(isHouseholdSubscribeAllowed('/household/user-abc', ['hh_user-abc'])).toBe(true);
  });

  it('keeps credentials and camera URLs out of the live envelope', () => {
    const event = parseHouseholdStateEvent({
      type: 'household.state.v1',
      eventId: 'evt-int',
      stateVersion: 1,
      updatedAt: '2026-09-17T12:00:00Z',
      state: sanitizeHouseholdState({
        lock: null,
        lights: [],
        plugs: [],
        contacts: [],
        motions: [{ id: 'matter-4', name: 'Hall', state: 'DETECTED' }],
        leaks: [],
        buttons: [],
        scene: 'away',
        updatedAt: '2026-09-17T12:00:00Z',
        stateVersion: 1,
        cameraUrl: 'https://cam.example/live',
        token: 'secret',
      } as never),
    });
    expect(event?.state.motions[0]?.state).toBe('DETECTED');
    expect(event?.state).not.toHaveProperty('cameraUrl');
    expect(event?.state).not.toHaveProperty('token');
  });
});

describe.skipIf(!live)('int household events', () => {
  it('delivers own-channel state changes and rejects another tenant channel', async () => {
    expect(eventsUrl).toBeTruthy();
    expect(restUrl).toBeTruthy();
    expect(accessToken).toBeTruthy();
    const sub = jwtSub(accessToken);
    let { socket, authorization } = await connectEvents(accessToken);

    try {
      const denied = await subscribe(
        socket,
        authorization,
        crypto.randomUUID(),
        `household/not-${sub}`
      );
      expect(denied.type).toBe('subscribe_error');
      expect(denied.errors?.[0]?.errorType).toMatch(/Unauthorized/i);

      const subscriptionId = crypto.randomUUID();
      const accepted = await subscribe(socket, authorization, subscriptionId, `household/${sub}`);
      expect(accepted.type).toBe('subscribe_success');

      const snapshot = await rest<{ state: { scene?: string } }>('/household/state', accessToken);
      const originalScene = snapshot.state.scene === 'away' ? 'away' : 'home';
      const latencies: number[] = [];

      for (let index = 0; index < 4; index += 1) {
        const scene =
          index % 2 === 0 ? (originalScene === 'home' ? 'away' : 'home') : originalScene;
        const eventPromise = waitForMessage(
          socket,
          (message) => {
            if (message.id !== subscriptionId || message.type !== 'data' || !message.event) {
              return false;
            }
            const raw =
              typeof message.event === 'string' ? JSON.parse(message.event) : message.event;
            const event = parseHouseholdStateEvent(raw);
            return event?.state.scene === scene;
          },
          15_000
        );
        const started = performance.now();
        await rest('/household/commands', accessToken, {
          method: 'POST',
          body: JSON.stringify({ command: scene }),
        });
        await eventPromise;
        latencies.push(performance.now() - started);
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
      console.info(`AppSync command-to-browser p95: ${Math.round(p95)}ms`);
      expect(p95).toBeLessThan(2_000);

      const closed = new Promise<void>((resolve) => {
        socket.addEventListener('close', () => resolve(), { once: true });
      });
      socket.close();
      await closed;
      ({ socket, authorization } = await connectEvents(accessToken));

      const recoveredId = crypto.randomUUID();
      expect((await subscribe(socket, authorization, recoveredId, `household/${sub}`)).type).toBe(
        'subscribe_success'
      );
      const recoveryScene = originalScene === 'home' ? 'away' : 'home';
      const recoveredEvent = waitForMessage(socket, (message) => {
        if (message.id !== recoveredId || message.type !== 'data' || !message.event) return false;
        const raw = typeof message.event === 'string' ? JSON.parse(message.event) : message.event;
        return parseHouseholdStateEvent(raw)?.state.scene === recoveryScene;
      });
      await rest('/household/commands', accessToken, {
        method: 'POST',
        body: JSON.stringify({ command: recoveryScene }),
      });
      await recoveredEvent;
      await rest('/household/commands', accessToken, {
        method: 'POST',
        body: JSON.stringify({ command: originalScene }),
      });
    } finally {
      socket.close();
    }
  }, 90_000);
});
