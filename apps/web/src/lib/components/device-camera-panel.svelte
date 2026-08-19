<script lang="ts">
import type { Device, DeviceConfiguration } from '@sst-monorepo/core';
import { onDestroy, onMount } from 'svelte';
import DeviceCameraSettingsPanel from '$lib/components/device-camera-settings-panel.svelte';
import { Label } from '$lib/components/ui/label/index.js';
import { configurationForType, formatWhen } from '$lib/devices';
import { RestApiError } from '$lib/services/rest';
import {
  getDeviceSnapshot,
  listDeviceSnapshots,
  updateDevice,
  type DeviceSnapshot,
} from '$lib/services/rest-api';

const ANGLE_MIN = 0;
const ANGLE_MAX = 180;
const ARROW_STEP = 5;
const SAVE_DEBOUNCE_MS = 200;
const MOVE_POLL_MS = 1500;
const MOVE_POLL_FOR_MS = 12000;

type SnapshotRange = '1h' | '6h' | 'today' | '7d';

const RANGE_OPTIONS: { id: SnapshotRange; label: string }[] = [
  { id: '1h', label: 'Last hour' },
  { id: '6h', label: 'Last 6 hours' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
];

const toggleClass =
  'rounded-sm px-3 py-1.5 text-[0.7rem] uppercase tracking-widest transition-colors';

let {
  device,
  onUpdated,
}: {
  device: Device;
  onUpdated?: (device: Device) => void;
} = $props();

const defaults = $derived(configurationForType(device.configuration, device.type));
const supportsPanTilt = $derived(device.runtimeKind !== 'physical');
let pan = $state(90);
let tilt = $state(90);
let range = $state<SnapshotRange>('1h');
let gallery = $state<DeviceSnapshot[]>([]);
let galleryTotal = $state(0);
let gallerySampled = $state(false);
let galleryLoading = $state(false);
let galleryError = $state('');
let selectedAt = $state<string | null>(null);
let followLatest = $state(true);
let snapshotError = $state('');
let saving = $state(false);
let saveError = $state('');
let loadedFrom = $state('');

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let movePollTimer: ReturnType<typeof setInterval> | null = null;
let galleryRequest = 0;

const selected = $derived(
  gallery.find((item) => item.recordedAt && item.recordedAt === selectedAt) ?? gallery[0] ?? null
);
const latestAt = $derived(gallery[0]?.recordedAt ?? null);

$effect(() => {
  pan = typeof defaults.pan === 'number' ? defaults.pan : 90;
  tilt = typeof defaults.tilt === 'number' ? defaults.tilt : 90;
});

$effect(() => {
  const deviceId = device.deviceId;
  const nextRange = range;
  void loadGallery(deviceId, nextRange);
  if (snapshotTimer) clearInterval(snapshotTimer);
  const intervalMs = Math.max(5, Number(defaults.reportingIntervalSeconds) || 30) * 1000;
  snapshotTimer = setInterval(() => {
    void loadLatest(deviceId);
  }, intervalMs);
  return () => {
    if (snapshotTimer) clearInterval(snapshotTimer);
  };
});

function rangeWindow(nextRange: SnapshotRange): { from: string; to: string } {
  const to = new Date();
  let from: Date;
  if (nextRange === '1h') {
    from = new Date(to.getTime() - 60 * 60 * 1000);
  } else if (nextRange === '6h') {
    from = new Date(to.getTime() - 6 * 60 * 60 * 1000);
  } else if (nextRange === 'today') {
    from = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  } else {
    from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function snapshotKey(snapshot: DeviceSnapshot): string {
  return snapshot.recordedAt ?? snapshot.url;
}

function selectSnapshot(snapshot: DeviceSnapshot) {
  selectedAt = snapshot.recordedAt;
  followLatest = snapshot.recordedAt === latestAt;
}

function mergeLatest(snapshot: DeviceSnapshot) {
  if (!snapshot.recordedAt) {
    return;
  }
  const alreadyListed = gallery.some((item) => item.recordedAt === snapshot.recordedAt);
  const inRange = !loadedFrom || snapshot.recordedAt >= loadedFrom;
  if (!alreadyListed && inRange) {
    gallery = [snapshot, ...gallery];
    galleryTotal += 1;
  } else if (alreadyListed) {
    gallery = gallery.map((item) =>
      item.recordedAt === snapshot.recordedAt ? snapshot : item
    );
  }
  if (followLatest || !selectedAt) {
    selectedAt = snapshot.recordedAt;
    followLatest = true;
  }
}

async function loadGallery(deviceId: string, nextRange: SnapshotRange) {
  const requestId = ++galleryRequest;
  galleryLoading = true;
  galleryError = '';
  followLatest = true;
  const window = rangeWindow(nextRange);
  loadedFrom = window.from;
  try {
    const result = await listDeviceSnapshots(deviceId, window.from, window.to);
    if (requestId !== galleryRequest) return;
    gallery = result.items;
    galleryTotal = result.total;
    gallerySampled = result.sampled;
    selectedAt = result.items[0]?.recordedAt ?? null;
    snapshotError = result.items.length ? '' : 'Waiting for the first snapshot from the camera.';
  } catch (err) {
    if (requestId !== galleryRequest) return;
    gallery = [];
    galleryTotal = 0;
    gallerySampled = false;
    selectedAt = null;
    if (err instanceof RestApiError && err.status === 404) {
      galleryError = '';
      snapshotError = 'Waiting for the first snapshot from the camera.';
    } else {
      galleryError = err instanceof Error ? err.message : 'Failed to load snapshots';
    }
  } finally {
    if (requestId === galleryRequest) {
      galleryLoading = false;
    }
  }
  if (requestId === galleryRequest) {
    void loadLatest(deviceId);
  }
}

async function loadLatest(deviceId: string) {
  try {
    const snapshot = await getDeviceSnapshot(deviceId);
    snapshotError = '';
    mergeLatest(snapshot);
  } catch (err) {
    if (err instanceof RestApiError && err.status === 404) {
      if (!gallery.length) {
        snapshotError = 'Waiting for the first snapshot from the camera.';
      }
      return;
    }
    if (!gallery.length) {
      snapshotError = err instanceof Error ? err.message : 'Failed to load snapshot';
    }
  }
}

function clampAngle(value: number): number {
  return Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, value));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && target.getAttribute('type') !== 'range';
}

function handleArrowKeys(event: KeyboardEvent) {
  if (!supportsPanTilt) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  if (event.key === 'ArrowLeft') {
    pan = clampAngle(pan - ARROW_STEP);
  } else if (event.key === 'ArrowRight') {
    pan = clampAngle(pan + ARROW_STEP);
  } else if (event.key === 'ArrowUp') {
    tilt = clampAngle(tilt + ARROW_STEP);
  } else if (event.key === 'ArrowDown') {
    tilt = clampAngle(tilt - ARROW_STEP);
  } else {
    return;
  }

  event.preventDefault();
  queueSave();
}

onMount(() => {
  window.addEventListener('keydown', handleArrowKeys);
  return () => {
    window.removeEventListener('keydown', handleArrowKeys);
  };
});

function stopMovePoll() {
  if (movePollTimer) {
    clearInterval(movePollTimer);
    movePollTimer = null;
  }
}

onDestroy(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
  stopMovePoll();
});

function queueSave() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void saveAngles();
  }, SAVE_DEBOUNCE_MS);
}

function pollSnapshotAfterMove(previousSnapshotAt: string | null) {
  const deviceId = device.deviceId;
  const deadline = Date.now() + MOVE_POLL_FOR_MS;
  followLatest = true;
  stopMovePoll();
  void loadLatest(deviceId);
  movePollTimer = setInterval(() => {
    void loadLatest(deviceId).then(() => {
      if ((latestAt && latestAt !== previousSnapshotAt) || Date.now() >= deadline) {
        stopMovePoll();
      }
    });
  }, MOVE_POLL_MS);
}

async function saveAngles() {
  saving = true;
  saveError = '';
  const previousSnapshotAt = latestAt;
  try {
    const configuration: DeviceConfiguration = {
      ...configurationForType(device.configuration, device.type),
      pan,
      tilt,
    };
    const updated = await updateDevice(device.deviceId, { configuration });
    onUpdated?.(updated);
    pollSnapshotAfterMove(previousSnapshotAt);
  } catch (err) {
    saveError = err instanceof Error ? err.message : 'Failed to update pan/tilt';
  } finally {
    saving = false;
  }
}
</script>

<section class="space-y-6">
  <div>
    <h3 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Snapshots</h3>
    <p class="mt-1 text-[0.7rem] text-muted-foreground leading-relaxed">
      JPEG stills from {device.runtimeKind === 'physical' ? 'the ESP32-S3 camera' : 'Camera Module 3'}.
      Pick a time range to browse earlier frames.
      {#if supportsPanTilt}
        Use ← → to pan and ↑ ↓ to tilt (5° steps), or drag the sliders. The head moves immediately;
        a new still is taken after you stop.
      {/if}
    </p>
  </div>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="inline-flex rounded-sm border border-border p-0.5">
      {#each RANGE_OPTIONS as option (option.id)}
        <button
          type="button"
          class="{toggleClass} {range === option.id
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => {
            range = option.id;
          }}
        >
          {option.label}
        </button>
      {/each}
    </div>
    <p class="text-[0.7rem] text-muted-foreground">
      {#if galleryLoading}
        Loading stills…
      {:else if galleryTotal > 0}
        {#if gallerySampled}
          Showing {gallery.length} of {galleryTotal} stills
        {:else}
          {galleryTotal} {galleryTotal === 1 ? 'still' : 'stills'}
        {/if}
      {/if}
    </p>
  </div>

  <div class="overflow-hidden rounded-sm border border-border bg-muted/20">
    {#if selected}
      <img
        src={selected.url}
        alt="Camera snapshot"
        class="max-h-[480px] w-full bg-black object-contain"
      />
    {:else}
      <div class="flex min-h-48 items-center justify-center px-4 py-10">
        <p class="text-center text-[0.75rem] text-muted-foreground">
          {galleryError || snapshotError || 'No snapshot yet.'}
        </p>
      </div>
    {/if}
  </div>
  {#if selected?.recordedAt}
    <p class="text-[0.7rem] text-muted-foreground">Captured {formatWhen(selected.recordedAt)}</p>
  {/if}

  {#if gallery.length > 1}
    <div class="flex gap-2 overflow-x-auto pb-1">
      {#each gallery as snapshot (snapshotKey(snapshot))}
        {@const isSelected = selectedAt === snapshot.recordedAt}
        <button
          type="button"
          class="shrink-0 overflow-hidden rounded-sm border {isSelected
            ? 'border-foreground'
            : 'border-border'} bg-black"
          aria-label="Show snapshot from {formatWhen(snapshot.recordedAt)}"
          aria-pressed={isSelected}
          onclick={() => selectSnapshot(snapshot)}
        >
          <img
            src={snapshot.url}
            alt=""
            loading="lazy"
            class="h-16 w-24 object-cover"
          />
        </button>
      {/each}
    </div>
  {/if}

  {#if supportsPanTilt}
    <div class="grid gap-6 sm:grid-cols-2">
      <div class="flex flex-col gap-2">
        <Label for="camera-pan" class="text-muted-foreground text-xs font-normal">Pan {pan}°</Label>
        <input
          id="camera-pan"
          type="range"
          min={ANGLE_MIN}
          max={ANGLE_MAX}
          step="1"
          bind:value={pan}
          class="w-full accent-foreground"
          oninput={queueSave}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="camera-tilt" class="text-muted-foreground text-xs font-normal">Tilt {tilt}°</Label>
        <input
          id="camera-tilt"
          type="range"
          min={ANGLE_MIN}
          max={ANGLE_MAX}
          step="1"
          bind:value={tilt}
          class="w-full accent-foreground"
          oninput={queueSave}
        />
      </div>
    </div>
  {/if}
  {#if saving}
    <p class="text-[0.7rem] text-muted-foreground">Updating camera…</p>
  {/if}
  {#if saveError}
    <p class="text-[0.75rem] text-destructive">{saveError}</p>
  {/if}

  <DeviceCameraSettingsPanel {device} {onUpdated} />
</section>
