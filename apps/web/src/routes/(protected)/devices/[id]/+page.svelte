<svelte:head>
  <title>Device — HomeHub</title>
  <meta name="description" content="Device details and readings." />
</svelte:head>

<script lang="ts">
import type { Device, Reading } from '@sst-monorepo/core';
import { onDestroy, onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import ConsoleShell from '$lib/components/console-shell.svelte';
import DeviceCameraPanel from '$lib/components/device-camera-panel.svelte';
import DeviceReadingsPanel from '$lib/components/device-readings-panel.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import {
  formatConfigurationSummary,
  formatDeviceType,
  formatOperatingStatus,
  formatWhen,
  isCamera,
  statusColorClass,
  supportsReadings,
} from '$lib/devices';
import { getDevice, listDeviceReadings } from '$lib/services/rest-api';

const deviceId = $derived($page.params.id ?? '');

let device = $state<Device | null>(null);
let readings = $state<Reading[]>([]);
let loading = $state(true);
let error = $state('');

const deviceType = $derived(device?.type ?? '');
const showReadings = $derived(supportsReadings(deviceType));
const showCamera = $derived(isCamera(deviceType));

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

<ConsoleShell>
  {#snippet actions()}
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="rounded-sm border-border"
      aria-label="Back to devices"
      onclick={() => goto('/devices')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
        aria-hidden="true"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </Button>
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
    <section class="space-y-3 border-border border-b pb-8">
      <div>
        <h2 class="font-display font-semibold text-lg tracking-tight">{device.name}</h2>
        <p class="mt-1 text-[0.75rem] text-muted-foreground">
          {formatDeviceType(device.type)}
          {#if device.location}
            · {device.location}
          {/if}
          ·
          <span class={statusColorClass(device.status)}>{formatOperatingStatus(device.status)}</span>
          · Last seen {formatWhen(device.lastSeenAt)}
        </p>
      </div>

      {#if device.lifecycleStatus === 'FAILED' && device.failureReason}
        <p class="text-[0.75rem] text-destructive">Provisioning failed: {device.failureReason}</p>
      {/if}

      {#if isProvisioning}
        <p class="text-[0.75rem] text-muted-foreground">
          Provisioning IoT resources… this page refreshes automatically.
        </p>
      {/if}

      <p class="break-all text-[0.7rem] text-muted-foreground">
        {device.deviceId}
        {#if device.thingName}
          · {device.thingName}
        {/if}
        · Created {formatWhen(device.createdAt)}
        · {formatConfigurationSummary(device.configuration, device.type)}
      </p>
    </section>

    {#if showCamera && device}
      <section class="border-border border-b py-10">
        <DeviceCameraPanel
          {device}
          onUpdated={(updated) => {
            device = updated;
          }}
        />
      </section>
    {/if}

    {#if showReadings}
      <section class="border-border border-b py-10">
        <DeviceReadingsPanel
          deviceId={device.deviceId}
          deviceType={deviceType}
          configuration={device.configuration}
          {readings}
        />
      </section>
    {/if}
  {/if}
</ConsoleShell>
