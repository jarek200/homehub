<script lang="ts">
import type { Reading } from '@sst-monorepo/core';
import ReadingsLineChart from '$lib/components/readings-line-chart.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { formatMetricThreshold, formatWhen, isMetricWarning } from '$lib/devices';
import { buildReadingSeries } from '$lib/readings-chart';
import { listDeviceReadingHistory } from '$lib/services/rest-api';
import {
  chartMetricKeys,
  effectiveReadingState,
  formatLastReadingPrimary,
  formatMetricValue,
  isBooleanMetric,
  metricLabel,
  primaryMetricKey,
  readingMetrics,
  readingStateClass,
  readingStateLabel,
  tileMetricKeys,
} from '$lib/telemetry';

type ChartRange = 'recent' | 'athena3h';

interface Props {
  deviceId: string;
  deviceType: string;
  readings: Reading[];
  configuration?: import('@sst-monorepo/core').DeviceConfiguration | null;
}

let { deviceId, deviceType, readings, configuration = null }: Props = $props();

let chartRange = $state<ChartRange>('recent');
let historyReadings = $state<Reading[]>([]);
let historyLoading = $state(false);
let historyError = $state('');
let historyLoadedFor = $state<string | null>(null);

const chartReadings = $derived(chartRange === 'recent' ? readings : historyReadings);
const series = $derived(
  buildReadingSeries(deviceType, chartReadings, {
    maxPoints: chartRange === 'athena3h' ? 48 : undefined,
  })
);
const latest = $derived(readings[0] ?? null);
const totalReadings = $derived(readings.length);
const latestMetrics = $derived(latest ? readingMetrics(latest, deviceType) : {});
const primaryKey = $derived(primaryMetricKey(deviceType, latest) ?? 'temperature');
const statKeys = $derived(tileMetricKeys(deviceType, latest));
const tableKeys = $derived(chartMetricKeys(deviceType, readings));
const historyLimit = 50;

const thClass =
  'px-4 py-3 text-left align-middle text-[0.7rem] font-normal text-muted-foreground uppercase tracking-wide';
const tdClass = 'px-4 py-3 text-left align-middle text-sm';
const toggleClass =
  'rounded-sm px-3 py-1.5 text-[0.7rem] uppercase tracking-widest transition-colors';

function readingState(reading: Reading) {
  return effectiveReadingState(reading, deviceType, configuration);
}

function metricValueClass(key: string, value: number | boolean | undefined) {
  if (!formatMetricThreshold(configuration, deviceType, key)) {
    return 'text-foreground';
  }
  return readingStateClass({
    alarm: false,
    state: isMetricWarning(key, value, configuration, deviceType) ? 'warning' : 'normal',
  });
}

function metricWarningHint(key: string) {
  return formatMetricThreshold(configuration, deviceType, key);
}

async function loadAthenaHistory(force = false) {
  if (!deviceId) return;
  if (!force && historyLoadedFor === deviceId && historyReadings.length > 0) {
    return;
  }
  historyLoading = true;
  historyError = '';
  try {
    historyReadings = await listDeviceReadingHistory(deviceId, 3);
    historyLoadedFor = deviceId;
  } catch (err) {
    console.error(err);
    historyError = err instanceof Error ? err.message : 'Failed to load 3h history';
    historyReadings = [];
  } finally {
    historyLoading = false;
  }
}

async function selectRange(range: ChartRange) {
  chartRange = range;
  if (range === 'athena3h') {
    await loadAthenaHistory();
  }
}
</script>

<section class="space-y-6">
  <div>
    <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
      Live telemetry
    </h2>
  </div>

  <dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <div class="rounded-sm border border-border px-4 py-3">
      <dt
        class="flex items-center justify-between gap-2 text-[0.65rem] text-muted-foreground uppercase tracking-widest"
      >
        <span>{metricLabel(primaryKey)}</span>
        {#if metricWarningHint(primaryKey)}
          <span class="normal-case tracking-normal">{metricWarningHint(primaryKey)}</span>
        {/if}
      </dt>
      <dd class="mt-2 text-sm font-medium {metricValueClass(primaryKey, latestMetrics[primaryKey])}">
        {formatLastReadingPrimary(deviceType, latest)}
      </dd>
      <dd class="mt-1 text-[0.7rem] text-muted-foreground">{formatWhen(latest?.recordedAt)}</dd>
    </div>
    {#each statKeys as key (key)}
      <div class="rounded-sm border border-border px-4 py-3">
        <dt
          class="flex items-center justify-between gap-2 text-[0.65rem] text-muted-foreground uppercase tracking-widest"
        >
          <span>{metricLabel(key)}</span>
          {#if metricWarningHint(key)}
            <span class="normal-case tracking-normal">{metricWarningHint(key)}</span>
          {/if}
        </dt>
        <dd class="mt-2 text-sm font-medium {metricValueClass(key, latestMetrics[key])}">
          {formatMetricValue(key, latestMetrics[key]!)}
        </dd>
      </div>
    {/each}
  </dl>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="inline-flex rounded-sm border border-border p-0.5">
      <button
        type="button"
        class="{toggleClass} {chartRange === 'recent'
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => void selectRange('recent')}
      >
        Recent
      </button>
      <button
        type="button"
        class="{toggleClass} {chartRange === 'athena3h'
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => void selectRange('athena3h')}
      >
        Last 3h
      </button>
    </div>
    <div class="flex items-center gap-3">
      <p class="text-[0.7rem] text-muted-foreground">
        {#if chartRange === 'recent'}
          Recent (DynamoDB)
        {:else}
          Last 3 hours (Athena) · averaged into ~4 min buckets
        {/if}
      </p>
      {#if chartRange === 'athena3h'}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="rounded-sm border-border"
          disabled={historyLoading}
          onclick={() => void loadAthenaHistory(true)}
        >
          {historyLoading ? 'Loading…' : 'Refresh'}
        </Button>
      {/if}
    </div>
  </div>

  {#if chartRange === 'athena3h' && historyLoading}
    <p class="rounded-sm border border-dashed border-border px-4 py-8 text-center text-[0.75rem] text-muted-foreground">
      Querying Athena for the last 3 hours…
    </p>
  {:else if chartRange === 'athena3h' && historyError}
    <p class="rounded-sm border border-dashed border-destructive/40 px-4 py-8 text-center text-[0.75rem] text-destructive">
      {historyError}
    </p>
  {:else if series.length > 0}
    <div class="grid gap-4 {series.length > 1 ? 'lg:grid-cols-2' : ''}">
      {#each series as item (item.key)}
        <ReadingsLineChart
          title={item.label}
          unit={item.unit}
          color={item.color}
          points={item.points}
          booleanScale={isBooleanMetric(item.key)}
          showMarkers={chartRange === 'recent'}
        />
      {/each}
    </div>
  {:else}
    <p class="rounded-sm border border-dashed border-border px-4 py-8 text-center text-[0.75rem] text-muted-foreground">
      {#if chartRange === 'athena3h'}
        No Parquet readings in the last 3 hours yet. Firehose may still be buffering (~60s).
      {:else}
        No chartable readings yet. Waiting for telemetry from the device.
      {/if}
    </p>
  {/if}

  {#if readings.length > 0}
    <div>
      <h3 class="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-widest">
        Reading history
        <span class="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
          ({readings.length}{readings.length >= historyLimit ? ` of ${historyLimit}` : ''} · DynamoDB)
        </span>
      </h3>
      <div class="max-h-[28rem] overflow-x-auto overflow-y-auto rounded-sm border border-border">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-border border-b bg-muted/20">
              <th class={thClass}>Recorded</th>
              {#each tableKeys as key (key)}
                <th class={thClass}>{metricLabel(key)}</th>
              {/each}
              <th class={thClass}>State</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {#each readings as reading (reading.readingId)}
              {@const state = readingState(reading)}
              <tr class="hover:bg-muted/20">
                <td class="{tdClass} whitespace-nowrap text-[0.8rem] text-muted-foreground">
                  {formatWhen(reading.recordedAt)}
                </td>
                {#each tableKeys as key (key)}
                  <td class="{tdClass} font-medium tabular-nums text-foreground">
                    {#if readingMetrics(reading)[key] != null}
                      {formatMetricValue(key, readingMetrics(reading)[key]!)}
                    {:else}
                      <span class="text-muted-foreground">—</span>
                    {/if}
                  </td>
                {/each}
                <td class={tdClass}>
                  <span class="font-medium {readingStateClass(state)}">
                    {readingStateLabel(state)}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</section>
