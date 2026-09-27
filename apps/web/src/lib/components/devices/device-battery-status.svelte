<script lang="ts">
import type { Reading } from '@homehub/core';
import { readingMetrics } from '$lib/devices/telemetry';

interface Props {
  reading: Reading | null;
  deviceType: string;
  muted?: boolean;
}

let { reading, deviceType, muted = false }: Props = $props();

const SEGMENTS = 10;

const metrics = $derived(reading ? readingMetrics(reading, deviceType) : {});
const percent = $derived(
  typeof metrics.batteryPercent === 'number' ? Math.round(metrics.batteryPercent) : null
);
const voltage = $derived(
  typeof metrics.batteryVoltage === 'number' ? metrics.batteryVoltage.toFixed(1) : null
);
const filled = $derived(
  percent == null ? 0 : Math.min(SEGMENTS, Math.max(0, Math.round(percent / 10)))
);
const visible = $derived(percent != null || voltage != null);
</script>

{#if visible}
  <div
    class="flex shrink-0 items-center gap-1.5 {muted
      ? 'text-muted-foreground text-xs'
      : 'text-[0.7rem] text-foreground'}"
    aria-label="Battery {percent != null ? `${percent}%` : ''}{voltage ? ` ${voltage} V` : ''}"
  >
    {#if percent != null}
      <span class="tabular-nums">{percent}%</span>
    {/if}
    {#if voltage}
      <span class="tabular-nums {muted ? '' : 'text-muted-foreground'}">{voltage} V</span>
    {/if}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 36 14"
      class={muted ? 'h-3 w-7' : 'h-3.5 w-9'}
      aria-hidden="true"
    >
      <rect
        x="0.75"
        y="1.25"
        width="31.5"
        height="11.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
      />
      <rect x="32.5" y="4.25" width="2.5" height="5.5" rx="0.6" fill="currentColor" />
      {#each Array.from({ length: SEGMENTS }, (_, i) => i) as i (i)}
        <rect
          x={2.4 + i * 2.95}
          y="3.35"
          width="2.15"
          height="7.3"
          rx="0.35"
          class={i < filled ? (muted ? 'fill-current' : 'fill-foreground') : 'fill-current opacity-25'}
        />
      {/each}
    </svg>
  </div>
{/if}
