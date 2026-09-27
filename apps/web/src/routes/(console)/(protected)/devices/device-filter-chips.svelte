<script lang="ts">
import type { FloorPlanLibrary } from '@homehub/core';

let {
  library,
  planFilter = $bindable('all'),
  powerFilter = $bindable(false),
  envFilter = $bindable(false),
  securityFilter = $bindable(false),
  leakFilter = $bindable(false),
}: {
  library: FloorPlanLibrary | null;
  planFilter?: string;
  powerFilter?: boolean;
  envFilter?: boolean;
  securityFilter?: boolean;
  leakFilter?: boolean;
} = $props();

const plans = $derived(
  library ? [...library.plans].sort((left, right) => left.name.localeCompare(right.name)) : []
);
</script>

{#if plans.length}
  <div class="mb-5 flex flex-col gap-2 md:mb-6 md:flex-row md:flex-wrap md:items-center">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="filter-chip"
        class:filter-chip-on={planFilter === 'all'}
        onclick={() => {
          planFilter = 'all';
        }}
      >
        All plans
      </button>
      {#each plans as plan (plan.id)}
        <button
          type="button"
          class="filter-chip"
          class:filter-chip-on={planFilter === plan.id}
          onclick={() => {
            planFilter = plan.id;
          }}
        >
          {plan.name}
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-2 md:ml-auto">
      <button
        type="button"
        class="filter-chip"
        class:filter-chip-on={powerFilter}
        onclick={() => (powerFilter = !powerFilter)}
      >
        Power
      </button>
      <button
        type="button"
        class="filter-chip"
        class:filter-chip-on={envFilter}
        onclick={() => (envFilter = !envFilter)}
      >
        Env
      </button>
      <button
        type="button"
        class="filter-chip"
        class:filter-chip-on={securityFilter}
        onclick={() => (securityFilter = !securityFilter)}
      >
        Security
      </button>
      <button
        type="button"
        class="filter-chip"
        class:filter-chip-on={leakFilter}
        onclick={() => (leakFilter = !leakFilter)}
      >
        Leak
      </button>
    </div>
  </div>
{/if}

<style>
  .filter-chip {
    display: inline-flex;
    height: 2.25rem;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border: 1px solid var(--border);
    background: transparent;
    padding: 0 0.6rem;
    color: var(--muted-foreground);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .filter-chip-on {
    border-color: currentColor;
    color: var(--foreground);
  }
</style>
