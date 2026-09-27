<svelte:head>
  <title>Floor plan — HomeHub</title>
  <meta name="description" content="Draw rooms, doors, and windows for your home plan." />
</svelte:head>

<script lang="ts">
import {
  addNamedPlan,
  applyDeviceUpdatedEvent,
  applyHubCommand,
  applyHubDevice,
  createCores3HouseholdState,
  type Device,
  type FloorPlanLibrary,
  type HubCommand,
  householdDevicePlace,
  libraryActivePlan,
  type SensorHistoryKind,
  switchActivePlan,
  upsertLibraryPlan,
} from '@homehub/core';
import { onMount } from 'svelte';
import DeviceCameraPanel from '$lib/components/devices/device-camera-panel.svelte';
import FloorPlanEditor from '$lib/components/floor-plan/floor-plan-editor.svelte';
import FloorPlanHousehold from '$lib/components/floor-plan/floor-plan-household.svelte';
import ConsoleShell from '$lib/components/layout/console-shell.svelte';
import SensorHistorySheet from '$lib/components/sensors/sensor-history-sheet.svelte';
import {
  initialEditorLibrary,
  saveStoredFloorPlanLibrary,
  syncEditorLibrary,
} from '$lib/floor-plan/storage';
import { type LiveConnectionState, subscribeHouseholdLive } from '$lib/household/live-state';
import { listDevices, postHouseholdCommand, postHouseholdDevice } from '$lib/services/rest-api';

let household = $state(createCores3HouseholdState());
const initialLibrary = initialEditorLibrary();
let library = $state<FloorPlanLibrary>(initialLibrary);
let plan = $state(libraryActivePlan(initialLibrary));
let devices = $state<Device[]>([]);
let editPlan = $state(false);
let roomFilter = $state<string | null>(null);
let roomFilterReady = $state(false);
let liveConnection = $state<LiveConnectionState>('connecting');
let inspectDeviceId = $state<string | null>(null);
let historyId = $state<string | null>(null);
let historyKind = $state<SensorHistoryKind | null>(null);
let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
const ROOM_FILTER_STORAGE_KEY = 'homehub.plan.room-filter.v1';
const FALLBACK_POLL_MS = 10_000;
const inspectDevice = $derived(
  devices.find((device) => device.deviceId === inspectDeviceId) ?? null
);
const historyPlace = $derived(historyId ? householdDevicePlace(plan, historyId) : '');
const historyHubEvents = $derived(
  historyId ? (household.sensorHistory?.[historyId]?.events ?? []) : []
);

function openSensorHistory(id: string, kind: SensorHistoryKind) {
  historyId = id;
  historyKind = kind;
}

function savedRoomFilters(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ROOM_FILTER_STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savedRoomFilterForCurrentPlan(): string | null {
  const saved = savedRoomFilters()[plan.id];
  return saved && plan.rooms.some((room) => room.name === saved) ? saved : null;
}

function saveRoomFilter(planId: string, selectedRoom: string | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    const saved = savedRoomFilters();
    if (!selectedRoom) {
      delete saved[planId];
    } else {
      saved[planId] = selectedRoom;
    }
    localStorage.setItem(ROOM_FILTER_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // The filter still works for this session when storage is unavailable.
  }
}

$effect(() => {
  const ids = plan.sensors.map((sensor) => sensor.deviceId ?? '').join('|');
  if (!ids) return;
  void refreshDevices();
});

$effect(() => {
  const planId = plan.id;
  const selectedRoom = roomFilter;
  if (roomFilterReady) saveRoomFilter(planId, selectedRoom);
});

function stopFallbackPoll() {
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

function startFallbackPoll() {
  if (fallbackPollTimer) return;
  fallbackPollTimer = setInterval(() => {
    void refreshDevices();
  }, FALLBACK_POLL_MS);
}

onMount(() => {
  void refreshDevices();
  void reconcileHubPlan().then(() => {
    roomFilter = savedRoomFilterForCurrentPlan();
    roomFilterReady = true;
  });
  const stopLive = subscribeHouseholdLive({
    onState: (state) => {
      household = state;
    },
    onDeviceUpdate: (event) => {
      devices = devices.map((device) => applyDeviceUpdatedEvent(device, event));
    },
    onConnection: (state) => {
      liveConnection = state;
      if (state === 'connected') {
        stopFallbackPoll();
        void refreshDevices();
        return;
      }
      if (state === 'disconnected') startFallbackPoll();
    },
  });
  return () => {
    stopFallbackPoll();
    stopLive();
  };
});

async function reconcileHubPlan() {
  try {
    library = await syncEditorLibrary(upsertLibraryPlan(library, plan));
    plan = libraryActivePlan(library);
  } catch {
    // Local drawing stays if the hub plan cannot be read.
  }
}

function applyLibrary(next: FloorPlanLibrary) {
  library = next;
  plan = libraryActivePlan(next);
  roomFilter = savedRoomFilterForCurrentPlan();
  saveStoredFloorPlanLibrary(next);
}

function selectPlan(planId: string) {
  if (planId === library.activePlanId) return;
  applyLibrary(switchActivePlan(upsertLibraryPlan(library, plan), planId));
}

function addPlan(name: string) {
  applyLibrary(addNamedPlan(upsertLibraryPlan(library, plan), name));
}

async function setScene(
  command: Extract<HubCommand, 'home' | 'away' | 'all-lights-off' | 'all-plugs-off'>
) {
  household = applyHubCommand(household, command);
  try {
    household = await postHouseholdCommand(command);
  } catch {
    // Keep the tapped mode until the live hub state arrives.
  }
}

async function setDevice(
  kind: 'light' | 'plug',
  id: string,
  patch: { on?: boolean; brightness?: number }
) {
  household = applyHubDevice(household, kind, id, patch);
  try {
    household = await postHouseholdDevice({ kind, id, ...patch });
  } catch {
    // Keep the tapped control until the live hub state arrives.
  }
}

async function refreshDevices() {
  try {
    devices = await listDevices();
  } catch {
    devices = [];
  }
}
</script>

<ConsoleShell dense>
  <div class="mx-auto max-w-5xl">
    <h1 class="sr-only">{plan.name || 'Floor plan'}</h1>
    {#key plan.id}
      <FloorPlanEditor
        bind:plan
        bind:editable={editPlan}
        {household}
        {devices}
        {library}
        {liveConnection}
        bind:roomFilter
        onSelectPlan={selectPlan}
        onAddPlan={addPlan}
        onScene={setScene}
        onCameraInspect={(deviceId) => {
          inspectDeviceId = deviceId;
        }}
        onSensorHistory={openSensorHistory}
      />
    {/key}

    {#if !editPlan}
      <FloorPlanHousehold
        {plan}
        {household}
        {devices}
        {roomFilter}
        onLight={(id, patch) => setDevice('light', id, patch)}
        onPlug={(id, on) => setDevice('plug', id, { on })}
        onCameraInspect={(deviceId) => {
          inspectDeviceId = deviceId;
        }}
        onSensorHistory={openSensorHistory}
      />
    {/if}

    <SensorHistorySheet
      open={Boolean(historyId && historyKind)}
      deviceId={historyId}
      kind={historyKind}
      place={historyPlace}
      hubEvents={historyHubEvents}
      onClose={() => {
        historyId = null;
        historyKind = null;
      }}
    />

    {#if inspectDevice}
      <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
        <div
          class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-sm border border-border bg-background p-5 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-label="{inspectDevice.name} camera"
        >
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <p class="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Camera</p>
              <h2 class="text-lg font-medium">{inspectDevice.name}</h2>
            </div>
            <button
              type="button"
              class="rounded-sm border border-border px-3 py-1.5 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              onclick={() => {
                inspectDeviceId = null;
              }}
            >
              Close
            </button>
          </div>
          <DeviceCameraPanel
            device={inspectDevice}
            onUpdated={(updated) => {
              devices = devices.map((item) =>
                item.deviceId === updated.deviceId ? updated : item
              );
            }}
          />
        </div>
      </div>
    {/if}
  </div>
</ConsoleShell>
