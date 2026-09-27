<script lang="ts">
import type { FloorPlanSensorKind } from '@homehub/core';

interface Props {
  kind: FloorPlanSensorKind;
  active?: boolean;
  faded?: boolean;
  size?: number;
  embedded?: boolean;
}

let { kind, active = false, faded = false, size = 22, embedded = false }: Props = $props();
</script>

{#snippet glyph()}
  {#if kind === 'light'}
    <circle cx="0" cy="-1" r="6" class:filled={active} />
    <path d="M-2.5 6h5v2.5h-5z" class:filled={active} />
  {:else if kind === 'plug'}
    <rect x="-4.5" y="-1" width="9" height="8" rx="1.4" class:filled={active} />
    <path d="M-2 -1v-4.5M2 -1v-4.5" />
    <path d="M-1.4 7v2.2h2.8V7" class:filled={active} />
  {:else if kind === 'leak'}
    <path d="M0 -8 C4 -2 6 2 6 5 A6 6 0 1 1 -6 5 C-6 2 -4 -2 0 -8z" class:filled={active} />
  {:else if kind === 'contact' || kind === 'lock'}
    {#if active}
      <path d="M-3.5 -2.5v-2a3.5 3.5 0 0 1 7 0" />
    {:else}
      <path d="M-3.5 -2.5v-2a3.5 3.5 0 0 1 7 0v2" />
    {/if}
    <rect x="-5.5" y="-2.5" width="11" height="10" rx="1.5" class:filled={!active} />
    {#if kind === 'lock'}
      <circle cx="0" cy="2" r="1.1" class="keyhole" />
      <path d="M0 3v3" class="keyhole" />
    {/if}
  {:else if kind === 'motion'}
    <circle cx="0" cy="1" r="3.2" class:filled={active} />
    <path d="M-6 -2a8 8 0 0 1 12 0" />
    <path d="M-8.5 -5a12 12 0 0 1 17 0" />
  {:else if kind === 'camera'}
    <rect x="-8" y="-4.5" width="16" height="11" rx="1.6" class:filled={active} />
    <circle cx="0" cy="1" r="3.1" class="lens" />
    <path d="M3.5 -6.8h4v2.2h-4z" class:filled={active} />
  {:else if kind === 'co2'}
    <text x="0" y="3" text-anchor="middle" font-size="7.5" class="glyph-text">CO₂</text>
  {:else if kind === 'pm25'}
    <text x="0" y="2.5" text-anchor="middle" font-size="5.5" class="glyph-text">PM2.5</text>
  {:else if kind === 'air-quality'}
    <path d="M-8 -4.5h11a2.6 2.6 0 1 0 -2.6 -2.6" />
    <path d="M-8 -0.5h7" />
    <path d="M-8 3.5h11a2.6 2.6 0 1 1 -2.6 2.6" />
  {:else}
    <rect x="-6.2" y="-8" width="3.4" height="10" rx="1.7" />
    <circle cx="-4.5" cy="5.4" r="3.4" class="filled" />
    <path d="M-5.2 -5h1.4M-5.2 -2.4h1.4M-5.2 0.2h1.4" />
    <path d="M4.2 -7 C6.4 -3 7.4 -0.6 7.4 2.2 A3.4 3.4 0 1 1 0.6 2.2 C0.6 -0.6 1.8 -3 4.2 -7z" />
  {/if}
{/snippet}

{#if embedded}
  <g class="sensor-mark" class:sensor-mark-active={active} class:sensor-mark-faded={faded} aria-hidden="true">
    {@render glyph()}
  </g>
{:else}
  <svg
    viewBox="-12 -12 24 24"
    width={size}
    height={size}
    class="sensor-mark"
    class:sensor-mark-active={active}
    class:sensor-mark-faded={faded}
    aria-hidden="true"
  >
    {@render glyph()}
  </svg>
{/if}

<style>
  .sensor-mark {
    display: block;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sensor-mark-faded {
    opacity: 0.4;
  }

  .filled {
    fill: currentColor;
  }

  .glyph-text {
    fill: currentColor;
    stroke: none;
    font-weight: 700;
    letter-spacing: 0;
  }

  .keyhole {
    stroke: currentColor;
  }

  .filled + .keyhole,
  rect.filled ~ .keyhole {
    stroke: #111;
  }

  .lens {
    fill: none;
    stroke: currentColor;
  }

  .filled + .lens,
  rect.filled ~ .lens {
    stroke: #111;
  }
</style>
