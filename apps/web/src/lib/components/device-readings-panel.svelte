<script lang="ts">
import type { Reading } from '@sst-monorepo/core';
import ReadingsLineChart from '$lib/components/readings-line-chart.svelte';
import { formatWhen } from '$lib/devices';
import { buildReadingSeries } from '$lib/readings-chart';
import {
  chartMetricKeys,
  effectiveReadingState,
  formatLastReadingPrimary,
  formatMetricValue,
  isBooleanMetric,
  metricLabel,
  readingMetrics,
  readingStateClass,
  readingStateLabel,
  summaryMetricKeys,
} from '$lib/telemetry';

interface Props {
  deviceType: string;
  readings: Reading[];
  configuration?: string | null;
}

let { deviceType, readings, configuration = null }: Props = $props();

const series = $derived(buildReadingSeries(deviceType, readings));
const latest = $derived(readings[0] ?? null);
const totalReadings = $derived(readings.length);
const statKeys = $derived(summaryMetricKeys(deviceType, latest));
const historyKeys = $derived(chartMetricKeys(deviceType, readings));
const historyReadings = $derived(readings);
const historyLimit = 50;

const thClass =
  'px-4 py-3 text-left align-middle text-[0.7rem] font-normal text-muted-foreground uppercase tracking-wide';
const tdClass = 'px-4 py-3 text-left align-middle text-sm';

function readingState(reading: Reading) {
  return effectiveReadingState(reading, deviceType, configuration);
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
      <dt class="text-[0.65rem] text-muted-foreground uppercase tracking-widest">Latest</dt>
      <dd class="mt-2 text-sm font-medium">{formatLastReadingPrimary(deviceType, latest)}</dd>
      <dd class="mt-1 text-[0.7rem] text-muted-foreground">{formatWhen(latest?.recordedAt)}</dd>
    </div>
    <div class="rounded-sm border border-border px-4 py-3">
      <dt class="text-[0.65rem] text-muted-foreground uppercase tracking-widest">Readings stored</dt>
      <dd class="mt-2 text-sm font-medium">{totalReadings}</dd>
      <dd class="mt-1 text-[0.7rem] text-muted-foreground">
        {#if totalReadings >= historyLimit}
          Latest {historyLimit} from DynamoDB
        {:else}
          Stored in DynamoDB
        {/if}
      </dd>
    </div>
    {#if latest}
      <div class="rounded-sm border border-border px-4 py-3">
        <dt class="text-[0.65rem] text-muted-foreground uppercase tracking-widest">State</dt>
        <dd class="mt-2 text-sm font-medium {readingStateClass(readingState(latest))}">
          {readingStateLabel(readingState(latest))}
        </dd>
      </div>
    {/if}
    {#each statKeys as key (key)}
      <div class="rounded-sm border border-border px-4 py-3">
        <dt class="text-[0.65rem] text-muted-foreground uppercase tracking-widest">
          {metricLabel(key)}
        </dt>
        <dd class="mt-2 text-sm font-medium">
          {formatMetricValue(key, readingMetrics(latest!)[key]!)}
        </dd>
      </div>
    {/each}
  </dl>

  {#if series.length > 0}
    <div class="grid gap-4 {series.length > 1 ? 'lg:grid-cols-2' : ''}">
      {#each series as item (item.key)}
        <ReadingsLineChart
          title={item.label}
          unit={item.unit}
          color={item.color}
          points={item.points}
          booleanScale={isBooleanMetric(item.key)}
        />
      {/each}
    </div>
  {:else}
    <p class="rounded-sm border border-dashed border-border px-4 py-8 text-center text-[0.75rem] text-muted-foreground">
      No chartable readings yet. Waiting for telemetry from the device.
    </p>
  {/if}

  {#if historyReadings.length > 0}
    <div>
      <h3 class="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-widest">
        Reading history
        <span class="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
          ({historyReadings.length}{historyReadings.length >= historyLimit ? ` of ${historyLimit}` : ''})
        </span>
      </h3>
      <div class="max-h-[28rem] overflow-x-auto overflow-y-auto rounded-sm border border-border">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-border border-b bg-muted/20">
              <th class={thClass}>Recorded</th>
              {#each historyKeys as key (key)}
                <th class={thClass}>{metricLabel(key)}</th>
              {/each}
              <th class={thClass}>State</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {#each historyReadings as reading (reading.readingId)}
              {@const state = readingState(reading)}
              <tr class="hover:bg-muted/20">
                <td class="{tdClass} whitespace-nowrap text-[0.8rem] text-muted-foreground">
                  {formatWhen(reading.recordedAt)}
                </td>
                {#each historyKeys as key (key)}
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
