<script lang="ts">
import type { Reading } from '@sst-monorepo/core';
import { readingDotsAriaLabel, readingDotTones } from '$lib/telemetry';

interface Props {
  readings: Reading[];
  deviceType: string;
  configuration?: import('@sst-monorepo/core').DeviceConfiguration | null;
}

let { readings, deviceType, configuration = null }: Props = $props();

const tones = $derived(readingDotTones(readings, deviceType, configuration));
const ariaLabel = $derived(readingDotsAriaLabel(tones));
</script>

{#if tones.length > 0}
  <div class="flex items-center gap-1.5" role="img" aria-label={ariaLabel}>
    {#each tones as tone, index (index)}
      <span
        class="size-2 shrink-0 rounded-full {tone === 'normal'
          ? 'bg-emerald-500'
          : 'bg-red-500'}"
      ></span>
    {/each}
  </div>
{:else}
  <span class="text-[0.65rem] text-muted-foreground">—</span>
{/if}
