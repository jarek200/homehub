<script lang="ts">
import type { ChartPoint } from '$lib/readings-chart';
import { chartDomain, chartPath } from '$lib/readings-chart';

interface Props {
  title: string;
  unit?: string;
  color?: string;
  points: ChartPoint[];
  booleanScale?: boolean;
  /** Show a marker on every point (fine for recent; noisy for dense Athena series). */
  showMarkers?: boolean;
}

let {
  title,
  unit = '',
  color = '#3b82f6',
  points,
  booleanScale = false,
  showMarkers = true,
}: Props = $props();

const width = 640;
const height = 180;
const padding = 20;

const path = $derived(chartPath(points, width, height, padding));
const domain = $derived(chartDomain(points));
const drawMarkers = $derived(showMarkers && points.length <= 48);

const yLabels = $derived.by(() => {
  if (booleanScale) return ['Off', 'On'];
  if (points.length === 0) return [];
  return [domain.max, domain.min].map((value) =>
    Number.isInteger(value) ? String(value) : value.toFixed(1)
  );
});

const xLabels = $derived.by(() => {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  return [first?.label ?? '', last?.label ?? ''];
});

function pointXY(point: ChartPoint) {
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const valueRange = domain.max - domain.min || 1;
  const times = points.map((item) => item.time);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;
  const x =
    points.length === 1
      ? padding + innerWidth / 2
      : padding + ((point.time - minTime) / timeRange) * innerWidth;
  const y = padding + innerHeight - ((point.value - domain.min) / valueRange) * innerHeight;
  return { x, y };
}
</script>

<div class="rounded-sm border border-border bg-card/40 p-4">
  <div class="mb-3 flex items-baseline justify-between gap-3">
    <h3 class="font-medium text-sm">{title}</h3>
    {#if unit}
      <span class="text-[0.7rem] text-muted-foreground">{unit}</span>
    {/if}
  </div>

  {#if points.length < 2}
    <p class="py-10 text-center text-[0.75rem] text-muted-foreground">
      Not enough readings yet for a chart.
    </p>
  {:else}
    <div class="relative">
      <svg
        viewBox="0 0 {width} {height}"
        class="block h-auto w-full text-muted-foreground"
        style="aspect-ratio: {width} / {height}"
        role="img"
        aria-label="{title} chart"
      >
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="currentColor"
          stroke-opacity="0.2"
        />
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          stroke="currentColor"
          stroke-opacity="0.2"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {#if drawMarkers}
          {#each points as point (point.time)}
            {@const pos = pointXY(point)}
            <circle cx={pos.x} cy={pos.y} r="3" fill={color} />
          {/each}
        {/if}
      </svg>
      <div class="mt-1 flex justify-between text-[0.65rem] text-muted-foreground">
        <span>{xLabels[0]}</span>
        <span>{xLabels[1]}</span>
      </div>
      {#if yLabels.length > 0}
        <div
          class="pointer-events-none absolute top-4 bottom-8 left-0 flex w-10 flex-col justify-between text-[0.65rem] text-muted-foreground"
        >
          <span>{yLabels[0]}{booleanScale ? '' : unit}</span>
          <span>{yLabels[1]}{booleanScale ? '' : unit}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
