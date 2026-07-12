<svelte:head>
  <title>Devices — HomeHub</title>
  <meta name="description" content="Manage your HomeHub IoT devices." />
</svelte:head>

<script lang="ts">
import type { Device, Reading } from '@sst-monorepo/core';
import { onMount } from 'svelte';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import ConsoleShell from '$lib/components/console-shell.svelte';
import DeviceAccordionRow from '$lib/components/device-accordion-row.svelte';
import DeviceModelLink from '$lib/components/device-model-link.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import {
  DEVICE_TYPES,
  formatDeviceType,
  formatLifecycleStatus,
  formatStatus,
  getDefaultConfiguration,
  getDefaultModelForType,
  getDeviceModelsForType,
  inputMinimal,
} from '$lib/devices';
import { formatLastReadingPrimary } from '$lib/issues';
import {
  createDevice,
  deleteDevice,
  listDeviceReadings,
  listDevices,
} from '$lib/services/rest-api';

let devices = $state<Device[]>([]);
let lastReadings = $state<Record<string, Reading | null>>({});
let loading = $state(true);
let error = $state('');
let showCreate = $state(false);
let creating = $state(false);
let deletingId = $state<string | null>(null);
let query = $state('');
let deleteDialogOpen = $state(false);
let pendingDeleteIds = $state<string[]>([]);
let selectedIds = $state<string[]>([]);
let bulkDeleting = $state(false);

let name = $state('');
let type = $state('smoke-alarm');
let model = $state(getDefaultModelForType('smoke-alarm'));
let location = $state('');

const availableModels = $derived(getDeviceModelsForType(type));

const filteredDevices = $derived.by(() => {
  const q = query.trim().toLowerCase();
  if (!q) return devices;

  return devices.filter((device) => {
    const reading = lastReadings[device.deviceId];
    const haystack = [
      device.name,
      device.location ?? '',
      device.status,
      formatStatus(device.status),
      device.lifecycleStatus,
      formatLifecycleStatus(device.lifecycleStatus),
      device.type,
      formatDeviceType(device.type, device.configuration),
      device.deviceId,
      formatLastReadingPrimary(device.type, reading),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });
});

const filteredIds = $derived(filteredDevices.map((device) => device.deviceId));
const selectedCount = $derived(filteredIds.filter((id) => selectedIds.includes(id)).length);
const allFilteredSelected = $derived(
  filteredIds.length > 0 && selectedCount === filteredIds.length
);
const someFilteredSelected = $derived(selectedCount > 0 && selectedCount < filteredIds.length);

function isSelected(deviceId: string): boolean {
  return selectedIds.includes(deviceId);
}

function toggleSelected(deviceId: string) {
  if (selectedIds.includes(deviceId)) {
    selectedIds = selectedIds.filter((id) => id !== deviceId);
  } else {
    selectedIds = [...selectedIds, deviceId];
  }
}

function toggleSelectAll() {
  if (allFilteredSelected) {
    selectedIds = selectedIds.filter((id) => !filteredIds.includes(id));
  } else {
    const merged = new Set([...selectedIds, ...filteredIds]);
    selectedIds = [...merged];
  }
}

$effect(() => {
  const models = getDeviceModelsForType(type);
  if (!models.some((item) => item.value === model)) {
    model = getDefaultModelForType(type);
  }
});

onMount(() => {
  loadDevices();
});

async function loadDevices() {
  loading = true;
  error = '';
  try {
    const nextDevices = await listDevices();
    devices = nextDevices;

    const readingEntries = await Promise.all(
      nextDevices.map(async (device) => {
        const readings = await listDeviceReadings(device.deviceId);
        return [device.deviceId, readings[0] ?? null] as const;
      })
    );
    lastReadings = Object.fromEntries(readingEntries);
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
    const created = await createDevice({
      name: name.trim(),
      type,
      location: location.trim() || null,
      configuration: JSON.stringify(getDefaultConfiguration(type, model)),
    });
    name = '';
    location = '';
    type = 'smoke-alarm';
    model = getDefaultModelForType('smoke-alarm');
    showCreate = false;
    devices = [created, ...devices];
    lastReadings = { ...lastReadings, [created.deviceId]: null };
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to register device';
  } finally {
    creating = false;
  }
}

function handleDeviceUpdated(updated: Device) {
  devices = devices.map((item) => (item.deviceId === updated.deviceId ? updated : item));
}

const deleteDialogDescription = $derived.by(() => {
  if (pendingDeleteIds.length === 0) {
    return 'Are you sure you want to delete this device? This cannot be undone.';
  }

  if (pendingDeleteIds.length === 1) {
    const device = devices.find((item) => item.deviceId === pendingDeleteIds[0]);
    const label = device?.name ?? 'this device';
    return `Are you sure you want to delete “${label}”? This cannot be undone.`;
  }

  return `Are you sure you want to delete ${pendingDeleteIds.length} devices? This cannot be undone.`;
});

function requestDelete(device: Device) {
  pendingDeleteIds = [device.deviceId];
  deleteDialogOpen = true;
  error = '';
}

function requestBulkDelete() {
  const ids = selectedIds.filter((id) => filteredIds.includes(id));
  if (ids.length === 0) return;
  pendingDeleteIds = ids;
  deleteDialogOpen = true;
  error = '';
}

async function confirmDelete() {
  if (pendingDeleteIds.length === 0) return;

  bulkDeleting = true;
  deletingId = pendingDeleteIds[0] ?? null;
  error = '';
  try {
    for (const id of pendingDeleteIds) {
      deletingId = id;
      await deleteDevice(id);
    }
    const deleted = new Set(pendingDeleteIds);
    selectedIds = selectedIds.filter((id) => !deleted.has(id));
    pendingDeleteIds = [];
    deleteDialogOpen = false;
    await loadDevices();
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to delete device';
  } finally {
    deletingId = null;
    bulkDeleting = false;
  }
}

const checkboxClass = 'device-checkbox';
const thClass =
  'px-4 py-3 text-left align-middle text-[0.7rem] font-normal text-muted-foreground uppercase tracking-wide';

let selectAllCheckbox = $state<HTMLInputElement | null>(null);

$effect(() => {
  if (selectAllCheckbox) {
    selectAllCheckbox.indeterminate = someFilteredSelected;
  }
});
</script>

<ConsoleShell>
  {#snippet actions()}
    <div class="flex w-full min-w-0 items-center gap-3">
      <div class="relative min-w-0 flex-1">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <Input
          id="device-search"
          type="search"
          bind:value={query}
          placeholder="Filter by name, location, status, model…"
          aria-label="Filter devices"
          class="rounded-none border-x-0 border-t-0 border-b border-border bg-transparent py-2 pr-0 pl-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground"
        />
      </div>
      {#if selectedCount > 0}
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="shrink-0 rounded-sm border-border text-destructive hover:text-destructive"
          aria-label="Delete {selectedCount} selected device{selectedCount === 1 ? '' : 's'}"
          disabled={bulkDeleting}
          onclick={requestBulkDelete}
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
      {/if}
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="shrink-0 rounded-sm border-border"
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
    </div>
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
          Add a smoke alarm, heat alarm, CO alarm, or environmental sensor to your home (Aico HomeLINK).
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="name" class="text-muted-foreground text-xs font-normal">Name</Label>
        <Input
          id="name"
          bind:value={name}
          placeholder="Hallway Smoke Alarm"
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
        <Label for="model" class="text-muted-foreground text-xs font-normal">Model</Label>
        <div class="flex items-center gap-2">
          <select
            id="model"
            bind:value={model}
            class="h-9 min-w-0 flex-1 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
          >
            {#each availableModels as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          <DeviceModelLink {model} />
        </div>
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
  {:else if filteredDevices.length === 0}
    <p class="text-[0.75rem] text-muted-foreground">
      {#if query.trim()}
        No devices match “{query.trim()}”.
      {:else}
        No devices yet. Use + to register your first device.
      {/if}
    </p>
  {:else}
    <div class="overflow-x-auto border-border border-y">
      <table class="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col class="w-[4%]" />
          <col class="w-[4%]" />
          <col class="w-[22%]" />
          <col class="w-[12%]" />
          <col class="w-[12%]" />
          <col class="w-[22%]" />
          <col class="w-[8%]" />
          <col class="w-[16%]" />
        </colgroup>
        <thead>
          <tr class="border-border border-b">
            <th class="{thClass} w-10 px-2" aria-label="Expand"></th>
            <th class="{thClass} w-10 px-3">
              <input
                bind:this={selectAllCheckbox}
                type="checkbox"
                class={checkboxClass}
                checked={allFilteredSelected}
                aria-label="Select all devices"
                onchange={toggleSelectAll}
              />
            </th>
            <th class={thClass}>Device</th>
            <th class={thClass}>Location</th>
            <th class={thClass}>Lifecycle</th>
            <th class={thClass}>Last reading</th>
            <th class={thClass}>Status</th>
            <th class="{thClass} text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {#each filteredDevices as device (device.deviceId)}
            <DeviceAccordionRow
              {device}
              selected={isSelected(device.deviceId)}
              lastReading={lastReadings[device.deviceId] ?? null}
              deleting={deletingId === device.deviceId}
              onToggleSelect={() => toggleSelected(device.deviceId)}
              onDelete={() => requestDelete(device)}
              onUpdated={handleDeviceUpdated}
            />
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</ConsoleShell>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={pendingDeleteIds.length > 1 ? 'Delete devices?' : 'Delete device?'}
  description={deleteDialogDescription}
  confirmLabel="Delete"
  confirming={bulkDeleting}
  onConfirm={confirmDelete}
/>
