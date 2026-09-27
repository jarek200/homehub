<script lang="ts">
import type { DeviceConfiguration, Reading } from '@homehub/core';
import CompactReadingLine from '$lib/components/devices/compact-reading-line.svelte';
import ReadingsLineChart from '$lib/components/devices/readings-line-chart.svelte';
import ReadingStateDots from '$lib/components/sensors/reading-state-dots.svelte';
import { buildReadingSeries } from '$lib/devices/readings-chart';
import { isBooleanMetric } from '$lib/devices/telemetry';

interface Props {
  deviceType: string;
  readings: Reading[];
  configuration?: DeviceConfiguration | null;
}

let { deviceType, readings, configuration = null }: Props = $props();

const latest = $derived(readings[0] ?? null);
const series = $derived(buildReadingSeries(deviceType, readings, { maxPoints: 16 }));
const empty = $derived(!latest && series.length === 0);
</script>

<section class="space-y-4">
  {#if empty}
    <p class="text-[0.75rem] text-muted-foreground">No readings yet.</p>
  {:else}
    <div>
      <CompactReadingLine {deviceType} reading={latest} {configuration} />
      <div class="mt-2">
        <ReadingStateDots {readings} {deviceType} {configuration} />
      </div>
    </div>

    {#if series.length > 0}
      <div class={['grid gap-4', series.length > 1 && 'lg:grid-cols-2']}>
        {#each series as item (item.key)}
          <ReadingsLineChart
            title={item.label}
            unit={item.unit}
            color={item.color}
            points={item.points}
            booleanScale={isBooleanMetric(item.key)}
            compact
          />
        {/each}
      </div>
    {/if}
  {/if}
</section>
