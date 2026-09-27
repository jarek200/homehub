<svelte:head>
  <title>Device — HomeHub</title>
  <meta name="description" content="Device details and readings." />
</svelte:head>

<script lang="ts">
import type { Device, Reading, SensorHistoryEvent } from '@homehub/core';
import { onDestroy, onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import DeviceBatteryStatus from '$lib/components/devices/device-battery-status.svelte';
import DeviceCameraPanel from '$lib/components/devices/device-camera-panel.svelte';
import DeviceReadingsPanel from '$lib/components/devices/device-readings-panel.svelte';
import ConsoleShell from '$lib/components/layout/console-shell.svelte';
import SensorEventCalendar from '$lib/components/sensors/sensor-event-calendar.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import {
  durableSensorKind,
  formatConfigurationSummary,
  formatDeviceType,
  formatOperatingStatus,
  formatWhen,
  isCamera,
  statusColorClass,
  supportsReadings,
} from '$lib/devices/devices';
import { getDevice, getHouseholdState, listDeviceReadings } from '$lib/services/rest-api';

const deviceId = $derived($page.params.id ?? '');

let device = $state<Device | null>(null);
let readings = $state<Reading[]>([]);
let hubEvents = $state.raw<SensorHistoryEvent[]>([]);
let loading = $state(true);
let error = $state('');

const deviceType = $derived(device?.type ?? '');
const showReadings = $derived(supportsReadings(deviceType));
const showCamera = $derived(isCamera(deviceType));
const configSummary = $derived(
  device ? formatConfigurationSummary(device.configuration, device.type) : ''
);
const showConfigSummary = $derived(
  configSummary !== '' && configSummary !== '—' && configSummary !== 'Configured'
);
const eventKind = $derived(device ? durableSensorKind(device.type) : null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const isProvisioning = $derived(device?.lifecycleStatus === 'PROVISIONING');

onMount(() => {
  void loadDevice();
  pollTimer = setInterval(() => {
    if (device?.lifecycleStatus === 'PROVISIONING' || device?.status === 'ONLINE') {
      void refreshDevice();
    }
  }, 10_000);
});

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function refreshDevice() {
  if (!deviceId) return;
  try {
    const [deviceResult, readingResult] = await Promise.all([
      getDevice(deviceId),
      listDeviceReadings(deviceId),
    ]);
    if (deviceResult) {
      device = deviceResult;
    }
    readings = readingResult;
  } catch (err) {
    console.error(err);
  }
}

async function loadDevice() {
  if (!deviceId) return;
  loading = true;
  error = '';
  try {
    const [deviceResult, readingResult] = await Promise.all([
      getDevice(deviceId),
      listDeviceReadings(deviceId),
    ]);

    device = deviceResult;
    readings = readingResult;
    if (deviceResult && durableSensorKind(deviceResult.type)) {
      try {
        const state = await getHouseholdState();
        hubEvents = state.sensorHistory?.[deviceId]?.events ?? [];
      } catch {
        hubEvents = [];
      }
    } else {
      hubEvents = [];
    }

    if (!deviceResult) {
      error = 'Device not found';
    }
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to get device';
  } finally {
    loading = false;
  }
}
</script>

<ConsoleShell dense>
  {#snippet actions()}
    <nav aria-label="Breadcrumb" class="min-w-0 text-[0.7rem] text-muted-foreground">
      <ol class="flex min-w-0 items-center gap-2">
        <li>
          <a href="/devices" class="hover:text-foreground">Devices</a>
        </li>
        <li aria-hidden="true">/</li>
        <li class="min-w-0 truncate text-foreground">
          {#if loading}
            …
          {:else}
            {device?.name ?? 'Device'}
          {/if}
        </li>
      </ol>
    </nav>
  {/snippet}

  {#if loading}
    <div class="space-y-4">
      <Skeleton class="h-8 w-48 rounded-sm bg-muted" />
      <Skeleton class="h-24 w-full rounded-sm bg-muted" />
      <Skeleton class="h-40 w-full rounded-sm bg-muted" />
    </div>
  {:else if error || !device}
    <p class="text-[0.75rem] text-destructive">{error || 'Device not found'}</p>
    <Button type="button" class="mt-6 rounded-sm" onclick={() => goto('/devices')}>
      Back to devices
    </Button>
  {:else}
    <section class="border-border border-b pb-4">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 space-y-1.5">
          <p class="text-[0.75rem] text-muted-foreground">
            {formatDeviceType(device.type)}
            {#if device.location}
              · {device.location}
            {/if}
            ·
            <span class={statusColorClass(device.status)}>{formatOperatingStatus(device.status)}</span>
            · Last seen {formatWhen(device.lastSeenAt)}
          </p>

          {#if device.lifecycleStatus === 'FAILED' && device.failureReason}
            <p class="text-[0.75rem] text-destructive">Provisioning failed: {device.failureReason}</p>
          {/if}

          {#if isProvisioning}
            <p class="text-[0.75rem] text-muted-foreground">
              Provisioning IoT resources… this page refreshes automatically.
            </p>
          {/if}

          {#if showConfigSummary}
            <p class="text-[0.7rem] text-muted-foreground">{configSummary}</p>
          {/if}
        </div>
        <DeviceBatteryStatus reading={readings[0] ?? null} {deviceType} muted />
      </div>
    </section>

    {#if eventKind}
      <section class="border-border border-b py-6">
        <SensorEventCalendar deviceId={device.deviceId} kind={eventKind} {hubEvents} />
      </section>
    {/if}

    {#if showCamera && device}
      <section class="border-border border-b py-6">
        <DeviceCameraPanel
          {device}
          onUpdated={(updated) => {
            device = updated;
          }}
        />
      </section>
    {/if}

    {#if showReadings}
      <section class="border-border border-b py-6">
        <DeviceReadingsPanel
          deviceType={deviceType}
          configuration={device.configuration}
          {readings}
        />
      </section>
    {/if}
  {/if}
</ConsoleShell>
