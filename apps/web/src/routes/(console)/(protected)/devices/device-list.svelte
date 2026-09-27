<script lang="ts">
import type { Device, HubHouseholdState } from '@homehub/core';
import DeviceAccordionRow from '$lib/components/devices/device-accordion-row.svelte';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import { deviceListUnavailable } from '$lib/household/household-overlay';

let {
  devices,
  household,
  loading,
  query,
  listFiltersActive,
  allFilteredSelected,
  someFilteredSelected,
  deletingId,
  isSelected,
  toggleSelected,
  toggleSelectAll,
  requestDelete,
  onUpdated,
}: {
  devices: Device[];
  household: HubHouseholdState | null;
  loading: boolean;
  query: string;
  listFiltersActive: boolean;
  allFilteredSelected: boolean;
  someFilteredSelected: boolean;
  deletingId: string | null;
  isSelected: (deviceId: string) => boolean;
  toggleSelected: (deviceId: string) => void;
  toggleSelectAll: () => void;
  requestDelete: (device: Device) => void;
  onUpdated: (device: Device) => void;
} = $props();

const checkboxClass = 'device-checkbox';
const thClass =
  'px-4 py-3 text-left align-middle text-[0.7rem] font-normal text-muted-foreground uppercase tracking-wide';

let selectAllDesktop = $state<HTMLInputElement | null>(null);
let selectAllMobile = $state<HTMLInputElement | null>(null);

$effect(() => {
  if (selectAllDesktop) {
    selectAllDesktop.indeterminate = someFilteredSelected;
  }
  if (selectAllMobile) {
    selectAllMobile.indeterminate = someFilteredSelected;
  }
});
</script>

{#if loading}
  <div class="space-y-4">
    <Skeleton class="h-16 w-full rounded-sm bg-muted" />
    <Skeleton class="h-16 w-full rounded-sm bg-muted" />
    <Skeleton class="h-16 w-full rounded-sm bg-muted" />
  </div>
{:else if devices.length === 0}
  <p class="text-[0.75rem] text-muted-foreground">
    {#if query.trim() || listFiltersActive}
      No devices match these filters.
    {:else}
      No devices yet. Use + to register your first device.
    {/if}
  </p>
{:else}
  <div class="md:hidden">
    <div class="flex items-center gap-2 border-border border-y px-1 py-2">
      <label class="inline-flex size-9 items-center justify-center">
        <input
          bind:this={selectAllMobile}
          type="checkbox"
          class={checkboxClass}
          checked={allFilteredSelected}
          aria-label="Select all devices"
          onchange={toggleSelectAll}
        />
      </label>
      <span class="text-[0.7rem] font-normal text-muted-foreground uppercase tracking-wide">
        Select all
      </span>
    </div>
    {#each devices as device (device.deviceId)}
      <DeviceAccordionRow
        layout="card"
        {device}
        selected={isSelected(device.deviceId)}
        deleting={deletingId === device.deviceId}
        unavailable={deviceListUnavailable(device, household)}
        onToggleSelect={() => toggleSelected(device.deviceId)}
        onDelete={() => requestDelete(device)}
        {onUpdated}
      />
    {/each}
  </div>
  <div class="hidden overflow-x-auto border-border border-y md:block">
    <table class="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col class="w-[4%]" />
        <col class="w-[4%]" />
        <col class="w-[22%]" />
        <col class="w-[22%]" />
        <col class="w-[24%]" />
        <col class="w-[8%]" />
        <col class="w-[16%]" />
      </colgroup>
      <thead>
        <tr class="border-border border-b">
          <th class="{thClass} w-10 px-2" aria-label="Expand"></th>
          <th class="{thClass} w-10 px-3">
            <input
              bind:this={selectAllDesktop}
              type="checkbox"
              class={checkboxClass}
              checked={allFilteredSelected}
              aria-label="Select all devices"
              onchange={toggleSelectAll}
            />
          </th>
          <th class={thClass}>Device</th>
          <th class={thClass}>Location</th>
          <th class={thClass} title="Current reading, then warn threshold">Reading</th>
          <th class={thClass}>Power</th>
          <th class="{thClass} text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border">
        {#each devices as device (device.deviceId)}
          <DeviceAccordionRow
            {device}
            selected={isSelected(device.deviceId)}
            deleting={deletingId === device.deviceId}
            unavailable={deviceListUnavailable(device, household)}
            onToggleSelect={() => toggleSelected(device.deviceId)}
            onDelete={() => requestDelete(device)}
            {onUpdated}
          />
        {/each}
      </tbody>
    </table>
  </div>
{/if}
