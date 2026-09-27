<script lang="ts">
import type { Device, DeviceStatus } from '@homehub/core';
import { goto } from '$app/navigation';
import CompactReadingLine from '$lib/components/devices/compact-reading-line.svelte';
import DeviceBatteryStatus from '$lib/components/devices/device-battery-status.svelte';
import DeviceThresholdsFields from '$lib/components/devices/device-thresholds-fields.svelte';
import ReadingStateDots from '$lib/components/sensors/reading-state-dots.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import {
  REPORTING_INTERVAL_PRESETS_MINUTES,
  reportingMinutesFromConfiguration,
  reportingSecondsFromMinutes,
} from '$lib/devices/device-power-settings';
import { buildConfiguration, type DeviceThresholds } from '$lib/devices/device-thresholds';
import {
  formatDeviceType,
  formatOperatingStatus,
  formatThresholdSummary,
  formatWhen,
  inputMinimal,
  isDeviceOn,
  normalizeDeviceType,
  operatingStatusAriaLabel,
  parseThresholds,
  statusColorClass,
} from '$lib/devices/devices';
import { updateDevice } from '$lib/services/rest-api';

interface Props {
  device: Device;
  selected: boolean;
  deleting?: boolean;
  unavailable?: boolean;
  layout?: 'table' | 'card';
  onToggleSelect: () => void;
  onDelete: () => void;
  onUpdated: (device: Device) => void;
}

let {
  device,
  selected,
  deleting = false,
  unavailable = false,
  layout = 'table',
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
let location = $state('');
let thresholds = $state<DeviceThresholds>({});
let reportingMinutes = $state(5);
let maintenanceMode = $state(false);

const isPhysicalEnvironmental = $derived(
  device.runtimeKind === 'physical' && normalizeDeviceType(device.type) === 'environmental-sensor'
);

const recentReadings = $derived(
  device.recentReadings?.length
    ? device.recentReadings
    : device.lastReading
      ? [device.lastReading]
      : []
);
const lastReading = $derived(device.lastReading ?? recentReadings[0] ?? null);
const showReadingDots = $derived(normalizeDeviceType(device.type) === 'environmental-sensor');

const isOn = $derived(isDeviceOn(device.status));
const rowTone = $derived([selected && 'bg-muted/30', unavailable && 'opacity-45']);

const detailGridClass = 'grid w-full grid-cols-[4%_4%_22%_22%_24%_8%_16%]';
const detailCellClass = 'px-4 py-4 align-top';
const iconButton = 'rounded-sm border-border';
const checkboxClass = 'device-checkbox';
const tdClass = 'px-4 py-5 text-left align-middle';

function fieldId(suffix: string) {
  return `${device.deviceId}-${layout}-${suffix}`;
}

function syncForm(next: Device) {
  name = next.name;
  location = next.location ?? '';
  thresholds = parseThresholds(next.configuration, next.type);
  reportingMinutes = reportingMinutesFromConfiguration(next.configuration);
  maintenanceMode = Boolean(next.configuration?.maintenanceMode);
}

function clampReportingMinutesInput() {
  reportingMinutes = Math.min(60, Math.max(1, Math.round(reportingMinutes)));
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
  if (isPhysicalEnvironmental) {
    clampReportingMinutesInput();
  }
  try {
    const updated = await updateDevice(device.deviceId, {
      name: name.trim(),
      location: location.trim(),
      configuration: buildConfiguration(device.type, thresholds, device.configuration, {
        reportingIntervalSeconds: isPhysicalEnvironmental
          ? reportingSecondsFromMinutes(reportingMinutes)
          : device.configuration?.reportingIntervalSeconds,
        maintenanceMode: isPhysicalEnvironmental
          ? maintenanceMode
          : device.configuration?.maintenanceMode,
        powerMode: device.configuration?.powerMode,
      }),
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

{#snippet expandControl()}
  <button
    type="button"
    class="inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
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
{/snippet}

{#snippet selectControl()}
  <label class="inline-flex size-9 shrink-0 items-center justify-center">
    <input
      type="checkbox"
      class={checkboxClass}
      checked={selected}
      aria-label="Select {device.name}"
      onchange={onToggleSelect}
    />
  </label>
{/snippet}

{#snippet nameLink()}
  <button
    type="button"
    class="block w-full text-left font-medium text-sm break-words hover:underline"
    onclick={() => goto(`/devices/${device.deviceId}`)}
  >
    {device.name}
  </button>
{/snippet}

{#snippet readingBlock()}
  {#if unavailable}
    <p class="text-sm text-foreground">No power</p>
  {:else}
    <CompactReadingLine
      deviceType={device.type}
      reading={lastReading}
      configuration={device.configuration}
    />
  {/if}
  {#if showReadingDots}
    <div class="mt-2">
      <ReadingStateDots
        readings={recentReadings}
        deviceType={device.type}
        configuration={device.configuration}
      />
    </div>
  {/if}
  <p class="mt-1 text-[0.65rem] text-muted-foreground">
    {formatWhen(lastReading?.recordedAt ?? device.lastSeenAt)}
  </p>
{/snippet}

{#snippet powerBlock()}
  <div class="flex flex-col items-start gap-2">
    <div class="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        class="device-status-switch"
        aria-checked={isOn}
        aria-label={operatingStatusAriaLabel(isOn, device.name)}
        disabled={statusToggling || deleting}
        onclick={toggleStatus}
      ></button>
      <span class="text-sm font-medium {statusColorClass(device.status)}">
        {formatOperatingStatus(device.status)}
      </span>
    </div>
    <DeviceBatteryStatus reading={lastReading} deviceType={device.type} muted />
  </div>
{/snippet}

{#snippet actionButtons()}
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
{/snippet}

{#snippet editActions()}
  {#if editing}
    <div class="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="rounded-sm border-border"
        aria-label="Save changes"
        disabled={saving || !name.trim() || !location.trim()}
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
{/snippet}

{#snippet nameField()}
  <div class="flex flex-col gap-2">
    <Label for={fieldId('name')} class="text-muted-foreground text-xs font-normal">Name</Label>
    {#if editing}
      <Input id={fieldId('name')} bind:value={name} required class={inputMinimal} />
    {:else}
      <p class="text-sm text-foreground">{device.name}</p>
    {/if}
  </div>
{/snippet}

{#snippet typeField()}
  <div class="flex flex-col gap-2">
    <Label for={fieldId('type')} class="text-muted-foreground text-xs font-normal">Type</Label>
    <p class="text-sm text-foreground">{formatDeviceType(device.type)}</p>
  </div>
{/snippet}

{#snippet locationField()}
  <div class="flex flex-col gap-2">
    <Label for={fieldId('location')} class="text-muted-foreground text-xs font-normal">Location</Label>
    {#if editing}
      <Input id={fieldId('location')} bind:value={location} required class={inputMinimal} />
    {:else}
      <p class="text-sm text-foreground">{device.location || '—'}</p>
    {/if}
  </div>
{/snippet}

{#snippet thresholdsField()}
  <div class="flex flex-col gap-2">
    <Label class="text-muted-foreground text-xs font-normal">Alert thresholds</Label>
    {#if editing}
      <DeviceThresholdsFields
        deviceType={device.type}
        idPrefix="{device.deviceId}-{layout}-"
        {thresholds}
        onchange={(next) => {
          thresholds = next;
        }}
      />
    {:else}
      <p class="text-sm text-foreground">
        {formatThresholdSummary(device.configuration, device.type)}
      </p>
    {/if}
  </div>
{/snippet}

{#snippet reportingField()}
  {#if isPhysicalEnvironmental}
    <div class="flex flex-col gap-2">
      <Label for={fieldId('reporting-minutes')} class="text-muted-foreground text-xs font-normal">
        Reporting interval (minutes)
      </Label>
      {#if editing}
        <div class="flex flex-wrap gap-2">
          {#each REPORTING_INTERVAL_PRESETS_MINUTES as preset (preset)}
            <Button
              type="button"
              variant={reportingMinutes === preset ? 'default' : 'outline'}
              size="sm"
              class="rounded-sm"
              onclick={() => {
                reportingMinutes = preset;
              }}
            >
              {preset}m
            </Button>
          {/each}
        </div>
        <Input
          id={fieldId('reporting-minutes')}
          type="number"
          min={1}
          max={60}
          step={1}
          bind:value={reportingMinutes}
          class={inputMinimal}
        />
        <p class="text-[0.7rem] text-muted-foreground leading-relaxed">
          Changes apply when the device next connects. If it is sleeping on a longer interval, the
          update can take up to that long.
        </p>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class={checkboxClass} bind:checked={maintenanceMode} />
          Maintenance mode (stay awake for HTTP/OTA on next wake)
        </label>
      {:else}
        <p class="text-sm text-foreground">
          Every {reportingMinutes} min
          {#if maintenanceMode}
            · Maintenance mode requested
          {/if}
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#if layout === 'card'}
  <article class={['border-border border-b py-3', ...rowTone]}>
    <div class="flex items-start gap-1">
      {@render selectControl()}
      <div class="min-w-0 flex-1 pt-1">
        {@render nameLink()}
        <p class="mt-0.5 text-[0.7rem] text-muted-foreground leading-relaxed">
          {formatDeviceType(device.type)} · {device.location || '—'}
        </p>
        {#if device.lifecycleStatus === 'FAILED' && device.failureReason}
          <p class="mt-1 text-[0.65rem] text-destructive leading-relaxed">
            {device.failureReason}
          </p>
        {/if}
      </div>
      {@render expandControl()}
    </div>

    <div class="mt-3 space-y-3 pl-9">
      <div>{@render readingBlock()}</div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        {@render powerBlock()}
        {@render actionButtons()}
      </div>
    </div>

    {#if expanded}
      <div class="mt-3 space-y-4 border-border border-t pt-3 pl-9">
        {#if actionError}
          <p class="text-[0.75rem] text-destructive">{actionError}</p>
        {/if}
        {@render nameField()}
        {@render typeField()}
        {@render locationField()}
        {@render thresholdsField()}
        {@render reportingField()}
        {@render editActions()}
      </div>
    {/if}
  </article>
{:else}
  <tr class={rowTone}>
    <td class="{tdClass} w-10 px-2">
      {@render expandControl()}
    </td>
    <td class="{tdClass} px-3">
      {@render selectControl()}
    </td>
    <td class={tdClass}>
      {@render nameLink()}
      <p class="mt-1 text-[0.7rem] text-muted-foreground">
        {formatDeviceType(device.type)}
      </p>
      {#if device.lifecycleStatus === 'FAILED' && device.failureReason}
        <p class="mt-1 text-[0.65rem] text-destructive leading-relaxed">
          {device.failureReason}
        </p>
      {/if}
    </td>
    <td class="{tdClass} text-[0.75rem] text-muted-foreground md:text-sm">
      <span class="block whitespace-normal" title={device.location || undefined}>
        {device.location || '—'}
      </span>
    </td>
    <td class={tdClass}>
      {@render readingBlock()}
    </td>
    <td class={tdClass}>
      {@render powerBlock()}
    </td>
    <td class="{tdClass} text-right">
      {@render actionButtons()}
    </td>
  </tr>

  {#if expanded}
    <tr class={rowTone}>
      <td colspan="7" class="border-border border-b p-0">
        {#if actionError}
          <p class="px-4 pt-4 text-[0.75rem] text-destructive">{actionError}</p>
        {/if}

        <div class={detailGridClass}>
          <div class="px-2 py-4"></div>
          <div class="px-3 py-4"></div>
          <div class="{detailCellClass} space-y-4">
            {@render nameField()}
            {@render typeField()}
          </div>
          <div class={detailCellClass}>
            {@render locationField()}
          </div>
          <div class="{detailCellClass} col-span-2 space-y-4">
            {@render thresholdsField()}
            {@render reportingField()}
          </div>
          <div class={detailCellClass}>
            {@render editActions()}
          </div>
        </div>
      </td>
    </tr>
  {/if}
{/if}
