<script lang="ts">
import type { Reading } from '@sst-monorepo/core';
import { lastReadingCompactParts } from '$lib/telemetry';

interface Props {
  deviceType: string;
  reading: Reading | null;
  configuration?: string | null;
}

let { deviceType, reading, configuration = null }: Props = $props();

const parts = $derived(lastReadingCompactParts(deviceType, reading, configuration));
</script>

{#if parts}
  <p class="flex flex-nowrap items-baseline gap-x-2 text-sm leading-snug">
    {#each parts as part, index (part.shortLabel)}
      {#if index > 0}
        <span class="shrink-0 text-muted-foreground" aria-hidden="true">·</span>
      {/if}
      <span class="inline-flex shrink-0 flex-nowrap items-baseline gap-x-1 whitespace-nowrap">
        <span class="font-medium text-foreground">{part.value}</span>
        {#if part.thresholdValue}
          <span
            class="text-[0.7rem] text-muted-foreground"
            title="Alert threshold"
          >
            <span class="uppercase tracking-wide">{part.thresholdLabel}</span>
            {part.thresholdValue}
          </span>
        {/if}
      </span>
    {/each}
  </p>
{:else}
  <p class="text-sm text-foreground">—</p>
{/if}
