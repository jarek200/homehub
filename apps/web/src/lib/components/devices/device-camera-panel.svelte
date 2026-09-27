<script lang="ts">
import type { Device, DeviceConfiguration } from '@homehub/core';
import { onDestroy, onMount } from 'svelte';
import DeviceBatteryStatus from '$lib/components/devices/device-battery-status.svelte';
import DeviceCameraSettingsPanel from '$lib/components/devices/device-camera-settings-panel.svelte';
import { configurationForType, formatWhen, statusColorClass } from '$lib/devices/devices';
import { readingMetrics } from '$lib/devices/telemetry';
import { cameraStatusFromDevice } from '$lib/floor-plan/sensor-status';
import { subscribeHouseholdLive } from '$lib/household/live-state';
import { RestApiError } from '$lib/services/rest';
import {
  type DeviceSnapshot,
  getDeviceSnapshot,
  listDeviceSnapshots,
  updateDevice,
} from '$lib/services/rest-api';

const CAPTURE_WAIT_MS = 12_000;
const FALLBACK_POLL_MS = 30_000;

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

const cameraStatus = $derived(cameraStatusFromDevice(device));
const lastMetrics = $derived(
  device.lastReading ? readingMetrics(device.lastReading, device.type) : {}
);
const motionDetected = $derived(lastMetrics.occupied === true);
const lastMotionAt = $derived.by(() => {
  if (device.lastReading?.metrics?.occupied === true) {
    return device.lastReading.recordedAt;
  }
  const prior = device.recentReadings?.find((reading) => reading.metrics?.occupied === true);
  return prior?.recordedAt ?? null;
});
let capturing = $state(false);
let captureError = $state('');
let range = $state<SnapshotRange>('1h');
let gallery = $state<DeviceSnapshot[]>([]);
let galleryTotal = $state(0);
let gallerySampled = $state(false);
let galleryLoading = $state(false);
let galleryError = $state('');
let selectedAt = $state<string | null>(null);
let followLatest = $state(true);
let snapshotError = $state('');
let loadedFrom = $state('');

let captureWaitTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
let stopLive: (() => void) | null = null;
let galleryRequest = 0;

const selected = $derived(
  gallery.find((item) => item.recordedAt && item.recordedAt === selectedAt) ?? gallery[0] ?? null
);
const latestAt = $derived(gallery[0]?.recordedAt ?? null);

$effect(() => {
  const deviceId = device.deviceId;
  const nextRange = range;
  void loadGallery(deviceId, nextRange);
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
    gallery = gallery.map((item) => (item.recordedAt === snapshot.recordedAt ? snapshot : item));
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

function stopCaptureWait() {
  if (captureWaitTimer) {
    clearTimeout(captureWaitTimer);
    captureWaitTimer = null;
  }
}

function startCaptureWait() {
  followLatest = true;
  stopCaptureWait();
  captureWaitTimer = setTimeout(() => {
    captureWaitTimer = null;
    void loadLatest(device.deviceId);
  }, CAPTURE_WAIT_MS);
}

function stopFallbackPoll() {
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

function startFallbackPoll() {
  stopFallbackPoll();
  fallbackPollTimer = setInterval(() => {
    void loadLatest(device.deviceId);
  }, FALLBACK_POLL_MS);
}

onMount(() => {
  stopLive = subscribeHouseholdLive({
    onSnapshot(event) {
      if (event.deviceId !== device.deviceId) return;
      followLatest = true;
      void loadLatest(event.deviceId);
      stopCaptureWait();
    },
    onConnection(state) {
      if (state === 'connected') {
        stopFallbackPoll();
        void loadLatest(device.deviceId);
        return;
      }
      if (state === 'disconnected') startFallbackPoll();
    },
  });
});

onDestroy(() => {
  stopCaptureWait();
  stopFallbackPoll();
  stopLive?.();
});

async function takeSnapshot() {
  capturing = true;
  captureError = '';
  try {
    const configuration: DeviceConfiguration = {
      ...configurationForType(device.configuration, device.type),
      captureNow: crypto.randomUUID(),
    };
    const updated = await updateDevice(device.deviceId, { configuration });
    onUpdated?.(updated);
    startCaptureWait();
  } catch (err) {
    captureError = err instanceof Error ? err.message : 'Failed to request snapshot';
  } finally {
    capturing = false;
  }
}
</script>

<section class="space-y-6">
  <div class="grid gap-3 sm:grid-cols-5">
    <div>
      <p class="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Camera</p>
      <p class={['mt-1 text-sm font-medium', statusColorClass(device.status)]}>{device.status}</p>
    </div>
    <div>
      <p class="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Motion</p>
      <p class="mt-1 text-sm font-medium">{motionDetected ? 'Detected' : 'Clear'}</p>
    </div>
    <div>
      <p class="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Last motion</p>
      <p class="mt-1 text-sm">{formatWhen(lastMotionAt)}</p>
    </div>
    <div>
      <p class="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Last snapshot</p>
      <p class="mt-1 text-sm">{formatWhen(device.lastSnapshotAt)}</p>
    </div>
    {#if lastMetrics.batteryPercent != null || lastMetrics.batteryVoltage != null}
      <div>
        <p class="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Battery</p>
        <div class="mt-1">
          <DeviceBatteryStatus
            reading={device.lastReading ?? device.recentReadings?.[0] ?? null}
            deviceType={device.type}
          />
        </div>
      </div>
    {/if}
  </div>
  <p class="text-[0.7rem] text-muted-foreground">
    Plan mark: {cameraStatus}
  </p>

  <div>
    <h3 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Snapshots</h3>
    <p class="mt-1 text-[0.7rem] text-muted-foreground leading-relaxed">
      JPEG stills from the Timer Camera F.
      Pick a time range to browse earlier frames.
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      class="rounded-sm border border-border px-3 py-1.5 text-[0.7rem] uppercase tracking-widest hover:bg-muted"
      disabled={capturing}
      onclick={() => void takeSnapshot()}
    >
      {capturing ? 'Requesting…' : 'Take Snapshot'}
    </button>
    {#if captureError}
      <p class="text-[0.75rem] text-destructive">{captureError}</p>
    {/if}
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

  <DeviceCameraSettingsPanel {device} {onUpdated} />
</section>
