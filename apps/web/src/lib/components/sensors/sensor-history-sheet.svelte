<script lang="ts">
import { householdKindLabel, type SensorHistoryEvent, type SensorHistoryKind } from '@homehub/core';
import SensorEventCalendar from '$lib/components/sensors/sensor-event-calendar.svelte';

interface Props {
  open?: boolean;
  deviceId?: string | null;
  kind?: SensorHistoryKind | null;
  place?: string;
  hubEvents?: SensorHistoryEvent[];
  onClose?: () => void;
}

let {
  open = false,
  deviceId = null,
  kind = null,
  place = '',
  hubEvents = [],
  onClose,
}: Props = $props();

const title = $derived(kind ? householdKindLabel({ kind, name: '' }) : 'History');

function onWindowKeydown(event: KeyboardEvent) {
  if (open && event.key === 'Escape') onClose?.();
}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open && deviceId && kind}
  <div class="sheet-backdrop">
    <button type="button" class="sheet-scrim" aria-label="Close" onclick={() => onClose?.()}></button>
    <div class="sheet" role="dialog" tabindex="-1" aria-modal="true" aria-label="{title} history">
      <div class="sheet-head">
        <div>
          <strong>{title}</strong>
          {#if place}
            <p class="sheet-place">{place}</p>
          {/if}
        </div>
        <button type="button" class="close" onclick={() => onClose?.()}>Close</button>
      </div>
      <SensorEventCalendar {deviceId} {kind} {hubEvents} accordion />
    </div>
  </div>
{/if}

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 55%);
    padding: 1.1rem 0.75rem;
  }

  .sheet-scrim {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: default;
  }

  .sheet {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 42rem;
    max-height: 80vh;
    overflow: auto;
    border: 1px solid currentcolor;
    background: #000;
    color: #f5f5f5;
    padding: 0.9rem 1rem 1.15rem;
  }

  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .sheet-head strong {
    font-size: 1.125rem;
  }

  .sheet-place {
    margin: 0.2rem 0 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .close {
    border: 1px solid currentcolor;
    background: #000;
    color: inherit;
    font: inherit;
    padding: 0.25rem 0.65rem;
  }

  @media (min-width: 640px) {
    .sheet-backdrop {
      align-items: center;
    }
  }
</style>
