<script lang="ts">
import {
  FLOOR_PLAN_SENSOR_KINDS,
  FLOOR_PLAN_SENSOR_META,
  type FloorPlanLibrary,
  type FloorPlanSensorKind,
  type FloorPlanTool,
  MAX_SENSOR_SCALE,
  MIN_SENSOR_SCALE,
  SENSOR_SCALE_STEP,
} from '@homehub/core';
import type { Snippet } from 'svelte';
import FloorPlanIcon from '$lib/components/floor-plan/floor-plan-icon.svelte';
import FloorPlanSensorMark from '$lib/components/floor-plan/floor-plan-sensor-mark.svelte';
import FloorPlanSwitcher from '$lib/components/floor-plan/floor-plan-switcher.svelte';
import { Button } from '$lib/components/ui/button/index.js';

export type FloorPlanActionId =
  | 'close'
  | 'flip'
  | 'flip-name'
  | 'rotate'
  | 'delete'
  | 'undo'
  | 'sample-a'
  | 'sample-b'
  | 'clear';

let {
  tool = $bindable('select' as FloorPlanTool),
  tools,
  actions,
  actionDisabled,
  runAction,
  onPalettePointerDown,
  onPaletteDragStart,
  onPaletteDragEnd,
  library = null,
  onSelectPlan,
  onAddPlan,
  liveStatus,
  iconScale,
  showNames,
  onScale,
  onNudgeScale,
  onToggleNames,
  onStopEdit,
}: {
  tool?: FloorPlanTool;
  tools: { id: FloorPlanTool; label: string }[];
  actions: { id: FloorPlanActionId; label: string }[];
  actionDisabled: (id: FloorPlanActionId) => boolean;
  runAction: (id: FloorPlanActionId) => void;
  onPalettePointerDown: (kind: FloorPlanSensorKind, event: PointerEvent) => void;
  onPaletteDragStart: (kind: FloorPlanSensorKind, event: DragEvent) => void;
  onPaletteDragEnd: () => void;
  library?: FloorPlanLibrary | null;
  onSelectPlan?: (planId: string) => void;
  onAddPlan?: (name: string) => void;
  liveStatus?: Snippet;
  iconScale: number;
  showNames: boolean;
  onScale: (value: number) => void;
  onNudgeScale: (delta: number) => void;
  onToggleNames: () => void;
  onStopEdit: () => void;
} = $props();
</script>

<div class="flex items-center gap-2">
  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
    <div class="flex items-center gap-1">
      {#each tools as item (item.id)}
        <Button
          type="button"
          variant={tool === item.id ? 'default' : 'outline'}
          size="icon"
          class="rounded-sm {tool === item.id ? '' : 'border-border'}"
          title={item.label}
          aria-label={item.label}
          aria-pressed={tool === item.id}
          onclick={() => (tool = item.id)}
        >
          <FloorPlanIcon name={item.id} />
        </Button>
      {/each}
    </div>
    <div class="mx-1 h-6 w-px bg-border" aria-hidden="true"></div>
    <div class="flex items-center gap-1">
      {#each actions as item (item.id)}
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="rounded-sm border-border"
          title={item.label}
          aria-label={item.label}
          disabled={actionDisabled(item.id)}
          onclick={() => runAction(item.id)}
        >
          <FloorPlanIcon name={item.id} />
        </Button>
      {/each}
    </div>
    <div class="sensor-palette" aria-label="Sensors">
      {#each FLOOR_PLAN_SENSOR_KINDS as kind (kind)}
        <button
          type="button"
          class="sensor-chip rounded-sm"
          draggable="true"
          title={FLOOR_PLAN_SENSOR_META[kind].label}
          aria-label="Drag {FLOOR_PLAN_SENSOR_META[kind].label} onto a room"
          onpointerdown={(event) => onPalettePointerDown(kind, event)}
          ondragstart={(event) => onPaletteDragStart(kind, event)}
          ondragend={onPaletteDragEnd}
        >
          <FloorPlanSensorMark {kind} active={kind === 'light' || kind === 'plug'} size={16} />
        </button>
      {/each}
    </div>
  </div>
  {#if library}
    <FloorPlanSwitcher {library} onSelect={(id) => onSelectPlan?.(id)} onAdd={(name) => onAddPlan?.(name)}>
      {#snippet afterActive()}
        {#if liveStatus}
          {@render liveStatus()}
        {/if}
      {/snippet}
    </FloorPlanSwitcher>
  {/if}
  <div class="ml-auto flex shrink-0 justify-end">
    <Button
      type="button"
      variant="default"
      size="icon"
      class="rounded-sm"
      title="Turn off edit plan"
      aria-label="Turn off edit plan"
      aria-pressed={true}
      onclick={onStopEdit}
    >
      <FloorPlanIcon name="edit" />
    </Button>
  </div>
</div>
<div class="sensor-scale">
  <span class="sensor-scale-label">Icon size</span>
  <button
    type="button"
    class="sensor-scale-nudge"
    aria-label="Smaller icons"
    disabled={iconScale <= MIN_SENSOR_SCALE}
    onclick={() => onNudgeScale(-SENSOR_SCALE_STEP)}
  >
    −
  </button>
  <input
    class="sensor-scale-range"
    type="range"
    min={MIN_SENSOR_SCALE}
    max={MAX_SENSOR_SCALE}
    step={SENSOR_SCALE_STEP}
    value={iconScale}
    aria-label="Sensor icon size"
    oninput={(event) => onScale(Number(event.currentTarget.value))}
  />
  <span class="sensor-scale-value">{iconScale}%</span>
  <button
    type="button"
    class="sensor-scale-nudge"
    aria-label="Larger icons"
    disabled={iconScale >= MAX_SENSOR_SCALE}
    onclick={() => onNudgeScale(SENSOR_SCALE_STEP)}
  >
    +
  </button>
  <button
    type="button"
    class="sensor-names-toggle"
    class:sensor-names-on={showNames}
    aria-pressed={showNames}
    aria-label={showNames ? 'Hide sensor names on the plan' : 'Show sensor names on the plan'}
    onclick={onToggleNames}
  >
    Names {showNames ? 'on' : 'off'}
  </button>
</div>

<style>
  .sensor-palette {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }

  .sensor-chip {
    display: flex;
    width: 2.25rem;
    height: 2.25rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: grab;
  }

  .sensor-chip:active {
    cursor: grabbing;
  }

  .sensor-scale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.6rem;
    color: var(--muted-foreground);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sensor-scale-range {
    width: 8.5rem;
    accent-color: #f5f5f5;
  }

  .sensor-scale-value {
    min-width: 2.6rem;
    color: inherit;
    font-variant-numeric: tabular-nums;
  }

  .sensor-scale-nudge {
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    line-height: 1;
  }

  .sensor-scale-nudge:disabled {
    opacity: 0.35;
  }

  .sensor-names-toggle {
    margin-left: 0.35rem;
    border: 1px solid var(--border);
    background: transparent;
    padding: 0.2rem 0.5rem;
    color: inherit;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sensor-names-toggle.sensor-names-on {
    border-color: #f5f5f5;
    color: #f5f5f5;
  }
</style>
