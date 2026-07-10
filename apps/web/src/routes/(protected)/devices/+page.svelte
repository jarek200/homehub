<svelte:head>
  <title>Devices — HomeHub</title>
  <meta name="description" content="Manage your HomeHub IoT devices." />
</svelte:head>

<script lang="ts">
import type { Device } from '@sst-monorepo/graphql';
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import ConsoleShell from '$lib/components/console-shell.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import {
  DEVICE_TYPES,
  DUMMY_DEVICES,
  formatConfigurationSummary,
  formatDeviceType,
  formatStatus,
  formatWhen,
  inputMinimal,
  isDummyDevice,
} from '$lib/devices';
import { createDevice, deleteDevice, listMyDevices } from '$lib/services/graphql';

let devices = $state<Device[]>([]);
let loading = $state(true);
let error = $state('');
let showCreate = $state(false);
let creating = $state(false);
let deletingId = $state<string | null>(null);

const displayDevices = $derived(devices.length > 0 ? devices : DUMMY_DEVICES);
const isPreview = $derived(!loading && devices.length === 0);

let name = $state('');
let type = $state('security-camera');
let location = $state('');

onMount(() => {
  loadDevices();
});

async function loadDevices() {
  loading = true;
  error = '';
  try {
    const result = await listMyDevices();
    devices = result.items ?? [];
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to list devices';
  } finally {
    loading = false;
  }
}

async function handleCreate() {
  creating = true;
  error = '';
  try {
    const device = await createDevice({
      name: name.trim(),
      type,
      location: location.trim() || null,
      configuration: JSON.stringify(getDefaultConfiguration(type)),
    });
    name = '';
    location = '';
    type = 'security-camera';
    showCreate = false;
    goto(`/devices/${device.deviceId}`);
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to register device';
  } finally {
    creating = false;
  }
}

function getDefaultConfiguration(deviceType: string) {
  if (deviceType === 'smart-light') {
    return { power: 'off', brightness: 50 };
  }
  if (deviceType === 'thermostat') {
    return { targetTemperature: 21, mode: 'auto' };
  }
  if (deviceType === 'security-camera') {
    return {
      motionDetection: true,
      captureEnabled: true,
      captureIntervalSeconds: 30,
    };
  }
  return { reportingIntervalSeconds: 60 };
}

function openDevice(device: Device) {
  goto(`/devices/${device.deviceId}`);
}

function openDeviceUpdate(device: Device) {
  goto(`/devices/${device.deviceId}?mode=update`);
}

async function handleDelete(device: Device) {
  if (isDummyDevice(device.deviceId)) return;
  if (!confirm(`Delete ${device.name}? This cannot be undone.`)) return;

  deletingId = device.deviceId;
  error = '';
  try {
    await deleteDevice(device.deviceId);
    await loadDevices();
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to delete device';
  } finally {
    deletingId = null;
  }
}

const rowGrid =
  'grid w-full gap-3 px-4 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1fr)_auto] md:items-center md:gap-4';
const iconButton = 'rounded-sm border-border';
</script>

<ConsoleShell>
  {#snippet actions()}
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="rounded-sm border-border"
      aria-label={showCreate ? 'Cancel' : 'Register device'}
      onclick={() => {
        showCreate = !showCreate;
        error = '';
      }}
    >
      {#if showCreate}
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
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      {:else}
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
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      {/if}
    </Button>
  {/snippet}

  {#if error}
    <p class="mb-6 text-[0.75rem] text-destructive">{error}</p>
  {/if}

  {#if showCreate}
    <form
      class="mb-10 space-y-6 border-border border-b pb-10"
      onsubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
    >
      <div>
        <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Register device
        </h2>
        <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
          Create a new IoT device in your home. The API returns a unique device ID you can use to
          read, update, or delete it later.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="name" class="text-muted-foreground text-xs font-normal">Name</Label>
        <Input
          id="name"
          bind:value={name}
          placeholder="Living Room Camera"
          required
          class={inputMinimal}
        />
      </div>

      <div class="flex flex-col gap-2">
        <Label for="type" class="text-muted-foreground text-xs font-normal">Type</Label>
        <select
          id="type"
          bind:value={type}
          class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
        >
          {#each DEVICE_TYPES as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="location" class="text-muted-foreground text-xs font-normal">Location</Label>
        <Input
          id="location"
          bind:value={location}
          placeholder="Living Room"
          class={inputMinimal}
        />
      </div>

      <Button type="submit" class="rounded-sm" disabled={creating || !name.trim()}>
        {creating ? 'Registering…' : 'Register'}
      </Button>
    </form>
  {/if}

  {#if loading}
    <div class="space-y-4">
      <Skeleton class="h-16 w-full rounded-sm bg-muted" />
      <Skeleton class="h-16 w-full rounded-sm bg-muted" />
      <Skeleton class="h-16 w-full rounded-sm bg-muted" />
    </div>
  {:else}
    {#if isPreview}
      <p class="mb-6 text-[0.75rem] text-muted-foreground">
        Sample devices for preview. Use + to register a real device and replace this list.
      </p>
    {/if}

    <div class="border-border border-y">
      <div
        class="hidden gap-4 border-border border-b px-4 py-3 text-[0.7rem] text-muted-foreground uppercase tracking-widest md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1fr)_auto] md:items-center"
      >
        <span>Device</span>
        <span>Type</span>
        <span>Location</span>
        <span>Status</span>
        <span>Last seen</span>
        <span class="text-right">Actions</span>
      </div>

      <ul class="divide-y divide-border">
        {#each displayDevices as device (device.deviceId)}
          <li class={rowGrid}>
            <div class="min-w-0">
              <p class="truncate font-medium text-sm">{device.name}</p>
              <p class="mt-1 truncate text-[0.7rem] text-muted-foreground md:hidden">
                {device.deviceId}
              </p>
              <p class="mt-1 text-[0.7rem] text-muted-foreground">
                {formatConfigurationSummary(device.configuration)}
              </p>
            </div>

            <p class="text-[0.75rem] text-muted-foreground md:text-sm">
              <span class="md:hidden font-medium text-foreground">Type </span>
              {formatDeviceType(device.type)}
            </p>

            <p class="text-[0.75rem] text-muted-foreground md:text-sm">
              <span class="md:hidden font-medium text-foreground">Location </span>
              {device.location || '—'}
            </p>

            <div>
              <Badge variant="outline" class="rounded-sm font-normal">
                {formatStatus(device.status)}
              </Badge>
            </div>

            <p class="text-[0.75rem] text-muted-foreground md:text-sm">
              <span class="md:hidden font-medium text-foreground">Last seen </span>
              {formatWhen(device.lastSeenAt)}
            </p>

            <div class="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                class={iconButton}
                aria-label="View {device.name}"
                onclick={() => openDevice(device)}
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
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="icon"
                class={iconButton}
                aria-label="Update {device.name}"
                onclick={() => openDeviceUpdate(device)}
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
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="icon"
                class="{iconButton} text-destructive hover:text-destructive"
                aria-label="Delete {device.name}"
                disabled={isDummyDevice(device.deviceId) || deletingId === device.deviceId}
                onclick={() => handleDelete(device)}
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
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</ConsoleShell>
