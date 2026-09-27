<script lang="ts">
import type { HubCommand, HubHouseholdState } from '@homehub/core';

interface Props {
  household: HubHouseholdState;
  onScene: (
    command: Extract<HubCommand, 'home' | 'away' | 'all-lights-off' | 'all-plugs-off'>
  ) => void;
}

let { household, onScene }: Props = $props();

const isHome = $derived(household.scene !== 'away');
const lightsOn = $derived(household.lights.some((light) => light.on));
const plugsOn = $derived(household.plugs.some((plug) => plug.on));
</script>

<span class="chips">
  <span class="chip-group" role="radiogroup" aria-label="Home or Away">
    <button
      type="button"
      class="chip"
      class:on={isHome}
      role="radio"
      aria-checked={isHome}
      aria-label="Home"
      title="Home"
      onclick={() => onScene('home')}
    >
      H
    </button>
    <button
      type="button"
      class="chip"
      class:on={!isHome}
      role="radio"
      aria-checked={!isHome}
      aria-label="Away"
      title="Away"
      onclick={() => onScene('away')}
    >
      A
    </button>
  </span>
  <span class="chip-group" role="group" aria-label="Switch off lights and plugs">
    <button
      type="button"
      class="chip"
      class:on={lightsOn}
      aria-pressed={lightsOn}
      title="Lights off"
      aria-label="Lights off"
      onclick={() => onScene('all-lights-off')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle class:filled={lightsOn} cx="12" cy="10" r="5.5" />
        <path class:filled={lightsOn} d="M10 16.4h4v2.8h-4z" />
        {#if !lightsOn}
          <path d="M5 5l14 14" />
        {/if}
      </svg>
    </button>
    <button
      type="button"
      class="chip"
      class:on={plugsOn}
      aria-pressed={plugsOn}
      title="Plugs off"
      aria-label="Plugs off"
      onclick={() => onScene('all-plugs-off')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect class:filled={plugsOn} x="7.2" y="10" width="9.6" height="7.2" rx="1.4" />
        <path d="M10.2 10V5.4M13.8 10V5.4" />
        <path class:filled={plugsOn} d="M11 17.2v2.6h2v-2.6" />
        {#if !plugsOn}
          <path d="M5 5l14 14" />
        {/if}
      </svg>
    </button>
  </span>
</span>

<style>
  .chips,
  .chip-group {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .chips {
    flex-shrink: 0;
    gap: 0.35rem;
    margin-left: 0.15rem;
  }

  .chip {
    display: inline-flex;
    width: 1.45rem;
    height: 1.45rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: transparent;
    padding: 0;
    color: var(--muted-foreground);
    font-size: 0.68rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
  }

  .chip.on {
    border-color: var(--foreground);
    background: var(--foreground);
    color: var(--background);
  }

  .chip svg {
    display: block;
    width: 0.85rem;
    height: 0.85rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .filled {
    fill: currentColor;
  }

  @media (max-width: 420px) {
    .chip {
      width: 1.3rem;
      height: 1.3rem;
    }
  }
</style>
