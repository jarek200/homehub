<script lang="ts">
import type { Device, DeviceStatus, Reading } from '@sst-monorepo/core';
import DeviceModelLink from '$lib/components/device-model-link.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import {
  applyModelToConfiguration,
  DEVICE_TYPES,
  formatDeviceType,
  formatWhen,
  getDefaultConfiguration,
  getDefaultModelForType,
  getDeviceModelsForType,
  getDeviceModelUrl,
  inputMinimal,
  parseModelFromConfiguration,
  statusColorClass,
} from '$lib/devices';
import { formatLastReadingPrimary } from '$lib/issues';
import { updateDevice } from '$lib/services/devices';

interface Props {
  device: Device;
  selected: boolean;
  lastReading: Reading | null;
  deleting?: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onUpdated: (device: Device) => void;
}

let {
  device,
  selected,
  lastReading,
  deleting = false,
  onToggleSelect,
  onDelete,
  onUpdated,
}: Props = $props();

let expanded = $state(false);
let editing = $state(false);
let actionError = $state('');
let saving = $state(false);
let statusToggling = $state(false);

let name = $state('');
let type = $state('');
let model = $state('');
let location = $state('');
let configuration = $state('');

const availableModels = $derived(getDeviceModelsForType(type));
const displayModel = $derived(parseModelFromConfiguration(device.configuration, device.type));
const modelUrl = $derived(getDeviceModelUrl(displayModel));
const isOnline = $derived(device.status === 'ONLINE');

const iconButton = 'rounded-sm border-border';
const checkboxClass = 'device-checkbox';
const tdClass = 'px-4 py-5 text-left align-middle';

function fieldId(suffix: string) {
  return `${device.deviceId}-${suffix}`;
}

function syncForm(next: Device) {
  name = next.name;
  type = next.type;
  model = parseModelFromConfiguration(next.configuration, next.type);
  location = next.location ?? '';
  configuration = next.configuration ?? '';
}

function handleTypeChange() {
  model = getDefaultModelForType(type);
  configuration = JSON.stringify(getDefaultConfiguration(type, model));
}

function handleModelChange() {
  configuration = applyModelToConfiguration(configuration, type, model);
}

function toggleExpanded() {
  if (expanded) {
    expanded = false;
    editing = false;
    actionError = '';
    return;
  }
  expanded = true;
  syncForm(device);
}

function startEdit() {
  editing = true;
  expanded = true;
  syncForm(device);
  actionError = '';
}

function cancelEdit() {
  editing = false;
  syncForm(device);
  actionError = '';
}

async function toggleStatus() {
  if (statusToggling || deleting) return;
  statusToggling = true;
  actionError = '';
  const nextStatus: DeviceStatus = device.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
  try {
    const updated = await updateDevice(device.deviceId, { status: nextStatus });
    onUpdated(updated);
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to update status';
  } finally {
    statusToggling = false;
  }
}

async function handleUpdate() {
  saving = true;
  actionError = '';
  try {
    const updated = await updateDevice(device.deviceId, {
      name: name.trim(),
      type,
      location: location.trim() || null,
      configuration: applyModelToConfiguration(configuration, type, model),
    });
    syncForm(updated);
    editing = false;
    onUpdated(updated);
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to update device';
  } finally {
    saving = false;
  }
}

$effect(() => {
  if (expanded && !editing) {
    syncForm(device);
  }
});
</script>

<tr class={selected ? 'bg-muted/30' : ''}>
  <td class="{tdClass} w-10 px-2">
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      aria-expanded={expanded}
      aria-label="{expanded ? 'Collapse' : 'Expand'} {device.name}"
      onclick={toggleExpanded}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4 transition-transform {expanded ? 'rotate-90' : ''}"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  </td>
  <td class="{tdClass} px-3">
    <input
      type="checkbox"
      class={checkboxClass}
      checked={selected}
      aria-label="Select {device.name}"
      onchange={onToggleSelect}
    />
  </td>
  <td class={tdClass}>
    <button
      type="button"
      class="block w-full truncate text-left font-medium text-sm hover:underline"
      onclick={toggleExpanded}
    >
      {device.name}
    </button>
    {#if modelUrl}
      <a
        href={modelUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="mt-1 inline-block text-[0.7rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
        title="View product details on Aico"
      >
        {formatDeviceType(device.type, device.configuration)}
      </a>
    {:else}
      <p class="mt-1 text-[0.7rem] text-muted-foreground">
        {formatDeviceType(device.type, device.configuration)}
      </p>
    {/if}
  </td>
  <td class="{tdClass} text-[0.75rem] text-muted-foreground md:text-sm">
    {device.location || '—'}
  </td>
  <td class={tdClass}>
    <p class="text-sm text-foreground">
      {formatLastReadingPrimary(device.type, lastReading)}
    </p>
    <p class="mt-1 text-[0.65rem] text-muted-foreground">
      {formatWhen(lastReading?.recordedAt ?? device.lastSeenAt)}
    </p>
  </td>
  <td class={tdClass}>
    <div class="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        class="device-status-switch"
        aria-checked={isOnline}
        aria-label="{isOnline ? 'Turn off' : 'Turn on'} {device.name}"
        disabled={statusToggling || deleting}
        onclick={toggleStatus}
      ></button>
      <span class="text-sm font-medium {statusColorClass(device.status)}">
        {isOnline ? 'On' : 'Off'}
      </span>
    </div>
  </td>
  <td class="{tdClass} text-right">
    <div class="inline-flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        class={iconButton}
        aria-label="Edit {device.name}"
        aria-pressed={editing}
        onclick={startEdit}
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
        disabled={deleting}
        onclick={onDelete}
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
  </td>
</tr>

{#if expanded}
  <tr class={selected ? 'bg-muted/30' : ''}>
    <td colspan="7" class="border-border border-b px-4 pb-8 pt-0">
      <div class="ml-2 space-y-4 border-border border-l pl-6 sm:ml-4">
        {#if actionError}
          <p class="text-[0.75rem] text-destructive">{actionError}</p>
        {/if}

        {#if editing}
          <div class="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              class="rounded-sm border-border"
              aria-label="Save changes"
              disabled={saving || !name.trim()}
              onclick={handleUpdate}
            >
              {#if saving}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="size-4 animate-spin"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
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
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {/if}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              class="rounded-sm border-border"
              aria-label="Cancel"
              disabled={saving}
              onclick={cancelEdit}
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Button>
          </div>
        {/if}

        <div class="grid gap-6 lg:grid-cols-2">
          <div class="flex flex-col gap-2">
            <Label for={fieldId('name')} class="text-muted-foreground text-xs font-normal">Name</Label>
            {#if editing}
              <Input id={fieldId('name')} bind:value={name} required class={inputMinimal} />
            {:else}
              <p class="py-2 text-sm text-foreground">{device.name}</p>
            {/if}
          </div>

          <div class="flex flex-col gap-2">
            <Label for={fieldId('type')} class="text-muted-foreground text-xs font-normal">Type</Label>
            {#if editing}
              <select
                id={fieldId('type')}
                bind:value={type}
                onchange={handleTypeChange}
                class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
              >
                {#each DEVICE_TYPES as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            {:else}
              <p class="py-2 text-sm text-foreground">
                {DEVICE_TYPES.find((option) => option.value === device.type)?.label ?? device.type}
              </p>
            {/if}
          </div>

          <div class="flex flex-col gap-2">
            <Label for={fieldId('model')} class="text-muted-foreground text-xs font-normal">Model</Label>
            {#if editing}
              <div class="flex items-center gap-2">
                <select
                  id={fieldId('model')}
                  bind:value={model}
                  onchange={handleModelChange}
                  class="h-9 min-w-0 flex-1 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
                >
                  {#each availableModels as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <DeviceModelLink {model} />
              </div>
            {:else}
              <div class="flex items-center gap-2 py-2">
                <p class="text-sm text-foreground">
                  {formatDeviceType(device.type, device.configuration)}
                </p>
                <DeviceModelLink model={displayModel} />
              </div>
            {/if}
          </div>

          <div class="flex flex-col gap-2">
            <Label for={fieldId('location')} class="text-muted-foreground text-xs font-normal">Location</Label>
            {#if editing}
              <Input id={fieldId('location')} bind:value={location} class={inputMinimal} />
            {:else}
              <p class="py-2 text-sm text-foreground">{device.location || '—'}</p>
            {/if}
          </div>
        </div>
      </div>
    </td>
  </tr>
{/if}
