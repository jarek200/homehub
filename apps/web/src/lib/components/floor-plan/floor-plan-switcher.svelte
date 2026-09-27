<script lang="ts">
import type { FloorPlanLibrary } from '@homehub/core';
import type { Snippet } from 'svelte';

interface Props {
  library: FloorPlanLibrary;
  onSelect: (planId: string) => void;
  onAdd: (name: string) => void;
  afterActive?: Snippet;
}

let { library, onSelect, onAdd, afterActive }: Props = $props();

const plans = $derived(
  [...library.plans].sort((left, right) => left.name.localeCompare(right.name))
);

let naming = $state(false);
let draftName = $state('');

function autofocus(node: HTMLInputElement) {
  node.focus();
}

function cancelName() {
  naming = false;
  draftName = '';
}

function commitName() {
  const name = draftName.trim();
  naming = false;
  draftName = '';
  if (name) onAdd(name);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitName();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelName();
  }
}
</script>

<div class="plan-switcher" role="tablist" aria-label="Floor plans">
  {#each plans as plan, index (plan.id)}
    {#if index > 0}
      <span class="plan-switcher-sep" aria-hidden="true">/</span>
    {/if}
    <button
      type="button"
      class="plan-switcher-name"
      class:plan-switcher-on={plan.id === library.activePlanId}
      role="tab"
      aria-selected={plan.id === library.activePlanId}
      onclick={() => onSelect(plan.id)}
    >
      {plan.name}
    </button>
    {#if plan.id === library.activePlanId && afterActive}
      {@render afterActive()}
    {/if}
  {/each}
  {#if naming}
    <input
      class="plan-switcher-input"
      value={draftName}
      placeholder="Name"
      aria-label="New plan name"
      use:autofocus
      oninput={(event) => (draftName = event.currentTarget.value)}
      onblur={commitName}
      onkeydown={handleKeydown}
    />
  {:else}
    <button
      type="button"
      class="plan-switcher-add"
      title="Add new plan"
      aria-label="Add new plan"
      onclick={() => {
        naming = true;
        draftName = '';
      }}
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
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .plan-switcher {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4rem;
    max-width: 100%;
    min-width: 0;
  }

  .plan-switcher-name,
  .plan-switcher-sep {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .plan-switcher-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--muted-foreground);
    cursor: pointer;
  }

  .plan-switcher-name:hover,
  .plan-switcher-on {
    color: var(--foreground);
  }

  .plan-switcher-sep {
    flex-shrink: 0;
    color: var(--muted-foreground);
  }

  .plan-switcher-add {
    display: inline-flex;
    height: 1.75rem;
    width: 1.75rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted-foreground);
  }

  .plan-switcher-add:hover {
    color: var(--foreground);
  }

  .plan-switcher-input {
    width: 7.5rem;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    padding: 0.1rem 0;
    color: var(--foreground);
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    outline: none;
  }

  .plan-switcher-input:focus {
    border-bottom-color: var(--foreground);
  }
</style>
