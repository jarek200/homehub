<svelte:head>
  <title>Device — HomeHub</title>
  <meta name="description" content="Device details, status, readings, and commands." />
</svelte:head>

<script lang="ts">
import type { Command, Device, DeviceStatus, HomeIssue, Reading } from '@sst-monorepo/core';
import { onMount, tick } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import ConsoleShell from '$lib/components/console-shell.svelte';
import DeviceModelLink from '$lib/components/device-model-link.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import {
  applyModelToConfiguration,
  COMMAND_OPTIONS,
  DEVICE_STATUSES,
  DEVICE_TYPES,
  formatDeviceType,
  formatStatus,
  formatWhen,
  getDefaultConfiguration,
  getDefaultModelForType,
  getDeviceModelsForType,
  inputMinimal,
  isCarbonMonoxideAlarm,
  isEnvironmentalSensor,
  isHeatAlarm,
  isSmokeAlarm,
  parseModelFromConfiguration,
  statusColorClass,
  supportsReadings,
} from '$lib/devices';
import { formatReadingSummary, humidityIssueTitle, shouldSuggestHumidityIssue } from '$lib/issues';
import {
  createDeviceReading,
  createIssue,
  deleteDevice,
  getDevice,
  listDeviceCommands,
  listDeviceIssues,
  listDeviceReadings,
  sendCommand,
  updateDevice,
} from '$lib/services/devices';

const deviceId = $derived($page.params.id ?? '');

let device = $state<Device | null>(null);
let readings = $state<Reading[]>([]);
let commands = $state<Command[]>([]);
let issues = $state<HomeIssue[]>([]);
let loading = $state(true);
let error = $state('');
let actionError = $state('');
let saving = $state(false);
let deleting = $state(false);
let deleteDialogOpen = $state(false);
let recording = $state(false);
let sending = $state(false);

let name = $state('');
let type = $state('');
let model = $state('');
let location = $state('');
let status = $state<DeviceStatus>('UNKNOWN');
let configuration = $state('');

let temperature = $state('');
let humidity = $state('');
let motionDetected = $state(false);
let deviceOnline = $state(true);
let command = $state(COMMAND_OPTIONS[0].value);

const deviceType = $derived(device?.type ?? type);
const showReadings = $derived(supportsReadings(deviceType));
const availableModels = $derived(getDeviceModelsForType(type));

onMount(() => {
  loadDevice().then(async () => {
    if ($page.url.searchParams.get('mode') === 'update') {
      await tick();
      document.getElementById('update')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

function syncForm(nextDevice: Device) {
  name = nextDevice.name;
  type = nextDevice.type;
  model = parseModelFromConfiguration(nextDevice.configuration, nextDevice.type);
  location = nextDevice.location ?? '';
  status = nextDevice.status;
  configuration = nextDevice.configuration ?? '';
}

function handleTypeChange() {
  model = getDefaultModelForType(type);
  configuration = JSON.stringify(getDefaultConfiguration(type, model));
}

function handleModelChange() {
  configuration = applyModelToConfiguration(configuration, type, model);
}

async function loadDevice() {
  if (!deviceId) return;
  loading = true;
  error = '';
  try {
    const [deviceResult, readingResult, commandResult, issueResult] = await Promise.all([
      getDevice(deviceId),
      listDeviceReadings(deviceId),
      listDeviceCommands(deviceId),
      listDeviceIssues(deviceId),
    ]);

    device = deviceResult;
    readings = readingResult;
    commands = commandResult;
    issues = issueResult;

    if (!deviceResult) {
      error = 'Device not found';
    } else {
      syncForm(deviceResult);
    }
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to get device';
  } finally {
    loading = false;
  }
}

async function handleUpdate() {
  if (!deviceId || !device) return;
  saving = true;
  actionError = '';
  try {
    const updated = await updateDevice(deviceId, {
      name: name.trim(),
      type,
      location: location.trim() || null,
      status,
      configuration: applyModelToConfiguration(configuration, type, model),
    });
    device = updated;
    syncForm(updated);
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to update device';
  } finally {
    saving = false;
  }
}

function requestDelete() {
  if (!deviceId || !device) return;
  deleteDialogOpen = true;
  actionError = '';
}

async function confirmDelete() {
  if (!deviceId) return;
  deleting = true;
  actionError = '';
  try {
    await deleteDevice(deviceId);
    deleteDialogOpen = false;
    goto('/devices');
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to delete device';
    deleting = false;
  }
}

async function handleRecordReading() {
  if (!deviceId || !device) return;
  recording = true;
  actionError = '';

  const parsedTemperature = temperature.trim() ? Number(temperature) : undefined;
  const parsedHumidity = humidity.trim() ? Number(humidity) : undefined;

  if (parsedTemperature != null && Number.isNaN(parsedTemperature)) {
    actionError = 'Temperature must be a number';
    recording = false;
    return;
  }

  if (parsedHumidity != null && Number.isNaN(parsedHumidity)) {
    actionError = 'Humidity must be a number';
    recording = false;
    return;
  }

  if (isEnvironmentalSensor(deviceType) && parsedTemperature == null && parsedHumidity == null) {
    actionError = 'Enter at least temperature or humidity';
    recording = false;
    return;
  }

  if (isHeatAlarm(deviceType) && parsedTemperature == null) {
    actionError = 'Enter a heat reading';
    recording = false;
    return;
  }

  if (isCarbonMonoxideAlarm(deviceType) && parsedTemperature == null) {
    actionError = 'Enter a CO level in ppm';
    recording = false;
    return;
  }

  try {
    const reading = await createDeviceReading(deviceId, {
      temperature:
        isEnvironmentalSensor(deviceType) ||
        isHeatAlarm(deviceType) ||
        isCarbonMonoxideAlarm(deviceType)
          ? parsedTemperature
          : undefined,
      humidity: isEnvironmentalSensor(deviceType) ? parsedHumidity : undefined,
      motionDetected: isSmokeAlarm(deviceType) ? motionDetected : undefined,
      cameraOnline: isSmokeAlarm(deviceType) ? deviceOnline : undefined,
    });
    readings = [reading, ...readings];
    temperature = '';
    humidity = '';

    if (shouldSuggestHumidityIssue(parsedHumidity)) {
      const hasOpenIssue = issues.some((issue) => issue.status === 'OPEN');
      if (!hasOpenIssue) {
        const issue = await createIssue({
          title: humidityIssueTitle(parsedHumidity as number),
          deviceId,
          severity: 'HIGH',
          status: 'OPEN',
          notes: 'Raised automatically from a high humidity sensor reading.',
        });
        issues = [issue, ...issues];
      }
    }

    const refreshed = await getDevice(deviceId);
    if (refreshed) {
      device = refreshed;
    }
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to record reading';
  } finally {
    recording = false;
  }
}

async function handleSendCommand() {
  if (!deviceId || !command.trim()) return;
  sending = true;
  actionError = '';
  try {
    const nextCommand = await sendCommand(deviceId, { command });
    commands = [nextCommand, ...commands];
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to send command';
  } finally {
    sending = false;
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
    {#if actionError}
      <p class="mb-6 text-[0.75rem] text-destructive">{actionError}</p>
    {/if}

    <section class="space-y-4 border-border border-b pb-10">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-display font-semibold text-lg tracking-tight">{device.name}</h2>
          <p class="mt-1 text-[0.75rem] text-muted-foreground">
            {formatDeviceType(device.type, device.configuration)}
            {#if device.location}
              · {device.location}
            {/if}
          </p>
        </div>
        <span class="text-sm font-medium {statusColorClass(device.status)}">
          {formatStatus(device.status)}
        </span>
      </div>

      <dl class="grid gap-3 text-[0.75rem] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt class="uppercase tracking-widest">Device ID</dt>
          <dd class="mt-1 break-all text-foreground">{device.deviceId}</dd>
        </div>
        <div>
          <dt class="uppercase tracking-widest">Last seen</dt>
          <dd class="mt-1 text-foreground">{formatWhen(device.lastSeenAt)}</dd>
        </div>
        <div>
          <dt class="uppercase tracking-widest">Created</dt>
          <dd class="mt-1 text-foreground">{formatWhen(device.createdAt)}</dd>
        </div>
        <div>
          <dt class="uppercase tracking-widest">Updated</dt>
          <dd class="mt-1 text-foreground">{formatWhen(device.updatedAt)}</dd>
        </div>
      </dl>
    </section>

    {#if showReadings}
      <section class="space-y-6 border-border border-b py-10">
        <div>
          <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
            Sensor readings
          </h2>
          <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
            {#if isEnvironmentalSensor(deviceType)}
              Record temperature and humidity from this Ei1020-style environmental sensor.
              Readings above 70% humidity can raise a home issue automatically (damp & mould risk).
            {:else if isSmokeAlarm(deviceType)}
              Record smoke detection and device connectivity status from this alarm head.
            {:else if isHeatAlarm(deviceType)}
              Record ambient heat level readings from this heat alarm.
            {:else if isCarbonMonoxideAlarm(deviceType)}
              Record CO level readings. HomeLINK reports Low, Medium, and High CO events via the Gateway.
            {/if}
          </p>
        </div>

        <form
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onsubmit={(e) => {
            e.preventDefault();
            handleRecordReading();
          }}
        >
          {#if isEnvironmentalSensor(deviceType)}
            <div class="flex flex-col gap-2">
              <Label for="temperature" class="text-muted-foreground text-xs font-normal">
                Temperature (°C)
              </Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                bind:value={temperature}
                placeholder="21.5"
                class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="humidity" class="text-muted-foreground text-xs font-normal">
                Humidity (%)
              </Label>
              <Input
                id="humidity"
                type="number"
                step="0.1"
                bind:value={humidity}
                placeholder="55"
                class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
              />
            </div>
          {:else if isHeatAlarm(deviceType)}
            <div class="flex flex-col gap-2">
              <Label for="temperature" class="text-muted-foreground text-xs font-normal">
                Heat level (°C)
              </Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                bind:value={temperature}
                placeholder="24.5"
                class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
              />
            </div>
          {:else if isCarbonMonoxideAlarm(deviceType)}
            <div class="flex flex-col gap-2">
              <Label for="temperature" class="text-muted-foreground text-xs font-normal">
                CO level (ppm)
              </Label>
              <Input
                id="temperature"
                type="number"
                step="1"
                bind:value={temperature}
                placeholder="12"
                class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
              />
            </div>
          {:else if isSmokeAlarm(deviceType)}
            <div class="flex items-center gap-2">
              <input
                id="motionDetected"
                type="checkbox"
                bind:checked={motionDetected}
                class="size-4 rounded-sm border border-border"
              />
              <Label for="motionDetected" class="text-muted-foreground text-xs font-normal">
                Smoke detected
              </Label>
            </div>
            <div class="flex items-center gap-2">
              <input
                id="deviceOnline"
                type="checkbox"
                bind:checked={deviceOnline}
                class="size-4 rounded-sm border border-border"
              />
              <Label for="deviceOnline" class="text-muted-foreground text-xs font-normal">
                Device online
              </Label>
            </div>
          {/if}
          <div class="flex items-end">
            <Button type="submit" class="rounded-sm" disabled={recording}>
              {recording ? 'Recording…' : 'Record reading'}
            </Button>
          </div>
        </form>

        {#if readings.length > 0}
          <ul class="divide-y divide-border border-border border-y">
            {#each readings.slice(0, 8) as reading (reading.readingId)}
              <li class="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
                <p class="text-sm">{formatReadingSummary(reading, deviceType)}</p>
                <p class="text-[0.7rem] text-muted-foreground">{formatWhen(reading.recordedAt)}</p>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-[0.75rem] text-muted-foreground">No readings yet.</p>
        {/if}
      </section>
    {/if}

    <section class="space-y-6 border-border border-b py-10">
      <div>
        <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Remote commands
        </h2>
        <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
          Send control commands to the device. Status starts as pending until acknowledged.
        </p>
      </div>

      <form
        class="flex flex-wrap items-end gap-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleSendCommand();
        }}
      >
        <div class="flex min-w-[12rem] flex-col gap-2">
          <Label for="command" class="text-muted-foreground text-xs font-normal">Command</Label>
          <select
            id="command"
            bind:value={command}
            class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
          >
            {#each COMMAND_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <Button type="submit" class="rounded-sm" disabled={sending}>
          {sending ? 'Sending…' : 'Send command'}
        </Button>
      </form>

      {#if commands.length > 0}
        <ul class="divide-y divide-border border-border border-y">
          {#each commands.slice(0, 8) as item (item.commandId)}
            <li class="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
              <div>
                <p class="text-sm">{item.command}</p>
                <p class="mt-1 text-[0.7rem] text-muted-foreground">{formatStatus(item.status)}</p>
              </div>
              <p class="text-[0.7rem] text-muted-foreground">{formatWhen(item.createdAt)}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-[0.75rem] text-muted-foreground">No commands sent yet.</p>
      {/if}
    </section>

    {#if issues.length > 0}
      <section class="space-y-4 border-border border-b py-10">
        <div>
          <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
            Linked issues
          </h2>
          <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
            Home issues raised from this device’s sensor data.
          </p>
        </div>
        <ul class="divide-y divide-border border-border border-y">
          {#each issues as issue (issue.issueId)}
            <li class="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
              <div>
                <p class="text-sm">{issue.title}</p>
                <p class="mt-1 text-[0.7rem] text-muted-foreground">
                  {issue.status} · {issue.severity}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                class="rounded-sm border-border"
                onclick={() => goto('/issues')}
              >
                View issues
              </Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section id="update" class="space-y-6 py-10">
      <div>
        <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Update device
        </h2>
        <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
          Change name, type, model, location, or status.
        </p>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="name" class="text-muted-foreground text-xs font-normal">Name</Label>
          <Input id="name" bind:value={name} required class={inputMinimal} />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="type" class="text-muted-foreground text-xs font-normal">Type</Label>
          <select
            id="type"
            bind:value={type}
            onchange={handleTypeChange}
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
              onchange={handleModelChange}
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
          <Input id="location" bind:value={location} class={inputMinimal} />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="status" class="text-muted-foreground text-xs font-normal">Status</Label>
          <select
            id="status"
            bind:value={status}
            class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
          >
            {#each DEVICE_STATUSES as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex flex-wrap gap-3">
        <Button type="button" class="rounded-sm" disabled={saving || !name.trim()} onclick={handleUpdate}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="outline"
          class="rounded-sm border-destructive text-destructive"
          disabled={deleting}
          onclick={requestDelete}
        >
          {deleting ? 'Deleting…' : 'Delete device'}
        </Button>
      </div>
    </section>
  {/if}
</ConsoleShell>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title="Delete device?"
  description={device
    ? `Are you sure you want to delete “${device.name}”? This cannot be undone.`
    : 'Are you sure you want to delete this device? This cannot be undone.'}
  confirmLabel="Delete"
  confirming={deleting}
  onConfirm={confirmDelete}
/>
