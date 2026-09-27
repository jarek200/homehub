<script lang="ts">
import { filledHoursForToday, type SensorHistoryEvent } from '@homehub/core';

interface Props {
  events?: SensorHistoryEvent[];
  liveValue?: string | null;
}

let { events = [], liveValue = null }: Props = $props();

const filled = $derived(filledHoursForToday(events, liveValue));
</script>

<span class="hour-dots" aria-hidden="true">
  {#each filled as on, hour (hour)}
    {#if hour && hour % 6 === 0}
      <span class="hour-gap"></span>
    {/if}
    <i class:on></i>
  {/each}
</span>

<style>
  .hour-dots {
    position: absolute;
    right: 0.1rem;
    bottom: 0.12rem;
    left: 0.1rem;
    display: flex;
    align-items: center;
    gap: 1px;
    pointer-events: none;
  }

  .hour-gap {
    flex: 0 0 4px;
    width: 4px;
    height: 3px;
  }

  .hour-dots i {
    display: block;
    width: 3px;
    height: 3px;
    flex: 0 0 3px;
    background: color-mix(in srgb, currentcolor 22%, transparent);
  }

  .hour-dots i.on {
    background: currentcolor;
  }
</style>
