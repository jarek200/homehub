<svelte:head>
  <title>Devices — HomeHub</title>
  <meta name="description" content="Manage your HomeHub IoT devices." />
</svelte:head>

<script lang="ts">
import {
  type Cores3Product,
  type Device,
  deviceIdsInLibrary,
  deviceListLocation,
  type FloorPlanLibrary,
  type HubHouseholdState,
  libraryDeviceLocation,
  nextProductName,
} from '@homehub/core';
import { onDestroy, onMount } from 'svelte';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import ConsoleShell from '$lib/components/layout/console-shell.svelte';
import { deviceMatchesListFilters } from '$lib/devices/device-list-filters';
import type { DeviceType } from '$lib/devices/device-type';
import {
  formatDeviceType,
  formatLifecycleStatus,
  formatStatus,
  getDefaultConfiguration,
} from '$lib/devices/devices';
import { formatLastReadingCompact, formatLastReadingPrimary } from '$lib/devices/telemetry';
import { initialEditorLibrary, syncEditorLibrary } from '$lib/floor-plan/storage';
import {
  deviceListUnavailable,
  overlayDeviceWithHousehold,
} from '$lib/household/household-overlay';
import { subscribeHouseholdLive } from '$lib/household/live-state';
import {
  createDevice,
  deleteDevice,
  getMatterCommission,
  listDevices,
  listMatterProducts,
  startMatterCommission,
  updateDevice,
} from '$lib/services/rest-api';
import DeviceFilterChips from './device-filter-chips.svelte';
import DeviceList from './device-list.svelte';
import DeviceListToolbar from './device-list-toolbar.svelte';
import MatterPairForm from './matter-pair-form.svelte';
import RegisterDeviceForm from './register-device-form.svelte';

let devices = $state<Device[]>([]);
let household = $state<HubHouseholdState | null>(null);
let library = $state<FloorPlanLibrary | null>(null);
let planFilter = $state<string | 'all'>('all');
let powerFilter = $state(false);
let envFilter = $state(false);
let securityFilter = $state(false);
let leakFilter = $state(false);
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
let type = $state<DeviceType>('camera');
let location = $state('');
let products = $state<Cores3Product[]>([]);
let productId = $state('kajplats');
let matterName = $state('');
let matterLocation = $state('Home');
let matterCode = $state('');
let addingMatter = $state(false);
let createdMatterHint = $state('');

const selectedProduct = $derived(
  products.find((product) => product.productId === productId) ?? null
);
const suggestedMatterName = $derived(
  selectedProduct
    ? nextProductName(
        selectedProduct.name,
        devices.map((device) => device.name)
      )
    : ''
);

const planDeviceIds = $derived(library ? deviceIdsInLibrary(library, planFilter) : null);
const PLAN_LOCATION_SKIP_TYPES = new Set(['camera', 'matter-gateway']);

const locatedDevices = $derived(
  devices.map((device) => {
    const location = deviceListLocation(library, device, planFilter);
    const located = location === (device.location ?? '') ? device : { ...device, location };
    return overlayDeviceWithHousehold(located, household);
  })
);

const listFiltersActive = $derived(
  planFilter !== 'all' || powerFilter || envFilter || securityFilter || leakFilter
);

const filteredDevices = $derived.by(() => {
  const q = query.trim().toLowerCase();
  return locatedDevices.filter((device) => {
    if (planDeviceIds && !planDeviceIds.has(device.deviceId)) return false;
    if (
      !deviceMatchesListFilters(device, {
        power: powerFilter,
        env: envFilter,
        security: securityFilter,
        leak: leakFilter,
      })
    ) {
      return false;
    }
    if (!q) return true;

    const reading = device.lastReading ?? device.recentReadings?.[0] ?? null;
    const haystack = [
      device.name,
      device.location ?? '',
      device.status,
      formatStatus(device.status),
      device.lifecycleStatus,
      formatLifecycleStatus(device.lifecycleStatus),
      device.type,
      formatDeviceType(device.type),
      device.deviceId,
      formatLastReadingPrimary(device.type, reading),
      formatLastReadingCompact(device.type, reading, device.configuration),
      deviceListUnavailable(device, household) ? 'No power' : '',
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

let pollTimer: ReturnType<typeof setInterval> | null = null;
let stopLive: (() => void) | null = null;
const READINGS_POLL_MS = 10_000;

onMount(() => {
  void loadDevices();
  void loadLibrary();
  void loadProducts();
  stopLive = subscribeHouseholdLive({
    onState: (state) => {
      household = state;
    },
  });
  pollTimer = setInterval(() => {
    if (
      devices.some((device) => device.lifecycleStatus === 'PROVISIONING') ||
      devices.some((device) => device.status === 'ONLINE')
    ) {
      void refreshDevices().catch(console.error);
    }
  }, READINGS_POLL_MS);
});

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer);
  stopLive?.();
});

let locationSync: Promise<void> | null = null;

async function syncPlanLocations() {
  if (locationSync) return locationSync;
  if (!library || devices.length === 0) return;

  locationSync = (async () => {
    const currentLibrary = library;
    if (!currentLibrary) return;
    const updates = (
      await Promise.all(
        devices.map(async (device) => {
          if (PLAN_LOCATION_SKIP_TYPES.has(device.type)) return null;
          const location = libraryDeviceLocation(currentLibrary, device.deviceId);
          if (!location || location === device.location) return null;
          try {
            return await updateDevice(device.deviceId, { location });
          } catch {
            return null;
          }
        })
      )
    ).filter((item): item is Device => item != null);
    if (updates.length === 0) return;
    const byId = new Map(updates.map((item) => [item.deviceId, item] as const));
    devices = devices.map((item) => byId.get(item.deviceId) ?? item);
  })().finally(() => {
    locationSync = null;
  });

  return locationSync;
}

async function refreshDevices() {
  devices = await listDevices();
  await syncPlanLocations();
}

async function loadLibrary() {
  try {
    library = await syncEditorLibrary(initialEditorLibrary());
  } catch {
    library = initialEditorLibrary();
  }
  await syncPlanLocations();
}

async function loadProducts() {
  try {
    products = await listMatterProducts();
    if (!products.some((product) => product.productId === productId) && products[0]) {
      productId = products[0].productId;
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadDevices() {
  loading = true;
  error = '';
  try {
    await refreshDevices();
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to list devices';
  } finally {
    loading = false;
  }
}

async function handleAddMatter() {
  addingMatter = true;
  error = '';
  createdMatterHint = '';
  try {
    const job = await startMatterCommission({
      productId,
      setupPayload: matterCode.trim(),
      name: matterName.trim() || suggestedMatterName,
      location: matterLocation.trim() || 'Home',
    });
    createdMatterHint = 'Pairing… keep the device advertising next to the CoreS3.';
    let current = job;
    for (let attempt = 0; attempt < 90 && current.status === 'pairing'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      current = await getMatterCommission(job.commissionId);
    }
    if (current.status === 'succeeded') {
      matterCode = '';
      matterName = '';
      createdMatterHint = `${current.name ?? selectedProduct?.name ?? 'Device'} is on Devices as ${current.deviceId}.`;
      showCreate = false;
      await refreshDevices();
      return;
    }
    error = current.error || 'Pairing failed. Keep the device advertising and try again.';
    createdMatterHint = '';
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to pair Matter device';
    createdMatterHint = '';
  } finally {
    addingMatter = false;
  }
}

async function handleCreate() {
  creating = true;
  error = '';
  try {
    await createDevice({
      name: name.trim(),
      type,
      location: location.trim(),
      runtimeKind: 'physical',
      configuration: getDefaultConfiguration(type),
    });
    name = '';
    location = '';
    showCreate = false;
    await refreshDevices();
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
</script>

<ConsoleShell>
  {#snippet actions()}
    <DeviceListToolbar
      bind:query
      {selectedCount}
      {bulkDeleting}
      {showCreate}
      onBulkDelete={requestBulkDelete}
      onToggleCreate={() => {
        showCreate = !showCreate;
        error = '';
      }}
    />
  {/snippet}

  {#if error}
    <p class="mb-6 text-[0.75rem] text-destructive">{error}</p>
  {/if}

  <DeviceFilterChips
    {library}
    bind:planFilter
    bind:powerFilter
    bind:envFilter
    bind:securityFilter
    bind:leakFilter
  />

  {#if showCreate}
    <MatterPairForm
      {products}
      bind:productId
      bind:matterName
      bind:matterLocation
      bind:matterCode
      {suggestedMatterName}
      {createdMatterHint}
      {addingMatter}
      onSubmit={() => void handleAddMatter()}
    />
    <RegisterDeviceForm
      bind:type
      bind:name
      bind:location
      {creating}
      onSubmit={handleCreate}
    />
  {/if}

  <DeviceList
    devices={filteredDevices}
    {household}
    {loading}
    {query}
    {listFiltersActive}
    {allFilteredSelected}
    {someFilteredSelected}
    {deletingId}
    {isSelected}
    {toggleSelected}
    {toggleSelectAll}
    {requestDelete}
    onUpdated={handleDeviceUpdated}
  />
</ConsoleShell>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={pendingDeleteIds.length > 1 ? 'Delete devices?' : 'Delete device?'}
  description={deleteDialogDescription}
  confirmLabel="Delete"
  confirming={bulkDeleting}
  onConfirm={confirmDelete}
/>
