<svelte:head>
  <title>Device — HomeHub</title>
  <meta name="description" content="Device details, status, readings, and commands." />
</svelte:head>

<script lang="ts">
import type { Command, Device, DeviceStatus, HomeIssue, Reading } from '@sst-monorepo/graphql';
import { onMount, tick } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import ConsoleShell from '$lib/components/console-shell.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import { Textarea } from '$lib/components/ui/textarea/index.js';
import {
  COMMAND_OPTIONS,
  DEVICE_STATUSES,
  formatDeviceType,
  formatStatus,
  formatWhen,
  getDummyDevice,
  isDummyDevice,
} from '$lib/devices';
import {
  formatReadingSummary,
  humidityIssueTitle,
  issueMatchesDevice,
  shouldSuggestHumidityIssue,
} from '$lib/issues';
import {
  createDeviceReading,
  createIssue,
  deleteDevice,
  getDevice,
  listDeviceCommands,
  listDeviceReadings,
  listMyIssues,
  sendCommand,
  updateDevice,
} from '$lib/services/graphql';

const deviceId = $derived($page.params.id ?? '');
const isPreview = $derived(isDummyDevice(deviceId));

let device = $state<Device | null>(null);
let readings = $state<Reading[]>([]);
let commands = $state<Command[]>([]);
let issues = $state<HomeIssue[]>([]);
let loading = $state(true);
let error = $state('');
let actionError = $state('');
let saving = $state(false);
let deleting = $state(false);
let recording = $state(false);
let sending = $state(false);

let status = $state<DeviceStatus>('UNKNOWN');
let configuration = $state('');

let temperature = $state('');
let humidity = $state('');
let command = $state(COMMAND_OPTIONS[0].value);

onMount(() => {
  loadDevice().then(async () => {
    if ($page.url.searchParams.get('mode') === 'update') {
      await tick();
      document.getElementById('update')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

function syncForm(nextDevice: Device) {
  status = nextDevice.status;
  configuration = nextDevice.configuration ?? '';
}

async function loadDevice() {
  if (!deviceId) return;
  loading = true;
  error = '';
  try {
    if (isPreview) {
      const dummy = getDummyDevice(deviceId);
      device = dummy;
      if (!dummy) {
        error = 'Device not found';
      } else {
        syncForm(dummy);
      }
      return;
    }

    const [deviceResult, readingResult, commandResult, issueResult] = await Promise.all([
      getDevice(deviceId),
      listDeviceReadings(deviceId),
      listDeviceCommands(deviceId),
      listMyIssues(),
    ]);

    device = deviceResult;
    readings = readingResult.items ?? [];
    commands = commandResult.items ?? [];
    issues = (issueResult.items ?? []).filter((issue) => issueMatchesDevice(issue, deviceId));

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
  if (!deviceId || !device || isPreview) return;
  saving = true;
  actionError = '';
  try {
    const updated = await updateDevice(deviceId, {
      status,
      configuration: configuration.trim() || undefined,
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

async function handleDelete() {
  if (!deviceId || isPreview) return;
  if (!confirm('Delete this device? This cannot be undone.')) return;
  deleting = true;
  actionError = '';
  try {
    await deleteDevice(deviceId);
    goto('/devices');
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to delete device';
    deleting = false;
  }
}

async function handleRecordReading() {
  if (!deviceId || isPreview) return;
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

  if (parsedTemperature == null && parsedHumidity == null) {
    actionError = 'Enter at least temperature or humidity';
    recording = false;
    return;
  }

  try {
    const reading = await createDeviceReading(deviceId, {
      temperature: parsedTemperature,
      humidity: parsedHumidity,
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
  } catch (err) {
    console.error(err);
    actionError = err instanceof Error ? err.message : 'Failed to record reading';
  } finally {
    recording = false;
  }
}

async function handleSendCommand() {
  if (!deviceId || isPreview || !command.trim()) return;
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
    {#if isPreview}
      <p class="mb-6 text-[0.75rem] text-muted-foreground">
        Sample device for preview. Register a real device to record readings, send commands, or
        update it.
      </p>
    {/if}

    {#if actionError}
      <p class="mb-6 text-[0.75rem] text-destructive">{actionError}</p>
    {/if}

    <section class="space-y-4 border-border border-b pb-10">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-display font-semibold text-lg tracking-tight">{device.name}</h2>
          <p class="mt-1 text-[0.75rem] text-muted-foreground">
            {formatDeviceType(device.type)}
            {#if device.location}
              · {device.location}
            {/if}
          </p>
        </div>
        <Badge variant="outline" class="rounded-sm font-normal">
          {formatStatus(device.status)}
        </Badge>
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

    <section class="space-y-6 border-border border-b py-10">
      <div>
        <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Sensor readings
        </h2>
        <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
          Monitor temperature and humidity. Readings above 70% humidity can raise a home issue
          automatically.
        </p>
      </div>

      <form
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleRecordReading();
        }}
      >
        <div class="flex flex-col gap-2">
          <Label for="temperature" class="text-muted-foreground text-xs font-normal">
            Temperature (°C)
          </Label>
          <Input
            id="temperature"
            type="number"
            step="0.1"
            bind:value={temperature}
            disabled={isPreview}
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
            disabled={isPreview}
            placeholder="55"
            class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <div class="flex items-end">
          <Button type="submit" class="rounded-sm" disabled={recording || isPreview}>
            {recording ? 'Recording…' : 'Record reading'}
          </Button>
        </div>
      </form>

      {#if readings.length > 0}
        <ul class="divide-y divide-border border-border border-y">
          {#each readings.slice(0, 8) as reading (reading.readingId)}
            <li class="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
              <p class="text-sm">{formatReadingSummary(reading)}</p>
              <p class="text-[0.7rem] text-muted-foreground">{formatWhen(reading.recordedAt)}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-[0.75rem] text-muted-foreground">No readings yet.</p>
      {/if}
    </section>

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
            disabled={isPreview}
            class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground disabled:opacity-50"
          >
            {#each COMMAND_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <Button type="submit" class="rounded-sm" disabled={sending || isPreview}>
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
          Update status and configuration
        </h2>
        <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
          Turn a light on or off, adjust a thermostat, or change how the device reports.
        </p>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="status" class="text-muted-foreground text-xs font-normal">Status</Label>
          <select
            id="status"
            bind:value={status}
            disabled={isPreview}
            class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground disabled:opacity-50"
          >
            {#each DEVICE_STATUSES as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="configuration" class="text-muted-foreground text-xs font-normal">
          Configuration
        </Label>
        <Textarea
          id="configuration"
          bind:value={configuration}
          disabled={isPreview}
          rows={6}
          placeholder={'{"power":"on","brightness":72}'}
          class="rounded-sm border border-border bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none disabled:opacity-50"
        />
      </div>

      <div class="flex flex-wrap gap-3">
        <Button
          type="button"
          class="rounded-sm"
          disabled={saving || isPreview}
          onclick={handleUpdate}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="outline"
          class="rounded-sm border-destructive text-destructive"
          disabled={deleting || isPreview}
          onclick={handleDelete}
        >
          {deleting ? 'Deleting…' : 'Delete device'}
        </Button>
      </div>
    </section>
  {/if}
</ConsoleShell>
