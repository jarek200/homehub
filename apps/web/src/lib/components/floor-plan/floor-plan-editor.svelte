<script lang="ts">
import {
  type Device,
  FLOOR_PLAN_SENSOR_KINDS,
  type FloorPlan,
  type FloorPlanLibrary,
  type FloorPlanSensorKind,
  type FloorPlanTool,
  type HubCommand,
  type HubHouseholdState,
  planGridRef,
  roomLabelAngle,
  roomLabelPoint,
  viewBoxPercent,
} from '@homehub/core';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import FloorPlanIcon from '$lib/components/floor-plan/floor-plan-icon.svelte';
import FloorPlanSensorMark from '$lib/components/floor-plan/floor-plan-sensor-mark.svelte';
import FloorPlanSvg from '$lib/components/floor-plan/floor-plan-svg.svelte';
import FloorPlanSwitcher from '$lib/components/floor-plan/floor-plan-switcher.svelte';
import FloorPlanToolbar, {
  type FloorPlanActionId,
} from '$lib/components/floor-plan/floor-plan-toolbar.svelte';
import PlanSceneChips from '$lib/components/floor-plan/plan-scene-chips.svelte';
import { FloorPlanEditorState } from '$lib/floor-plan/editor-state.svelte';
import type { LiveConnectionState } from '$lib/household/live-state';
import { updateDevice } from '$lib/services/rest-api';

interface Props {
  plan: FloorPlan;
  household: HubHouseholdState;
  devices?: Device[];
  library?: FloorPlanLibrary | null;
  editable?: boolean;
  roomFilter?: string | null;
  onSelectPlan?: (planId: string) => void;
  onAddPlan?: (name: string) => void;
  onScene?: (
    command: Extract<HubCommand, 'home' | 'away' | 'all-lights-off' | 'all-plugs-off'>
  ) => void;
  onCameraInspect?: (deviceId: string) => void;
  onSensorHistory?: (id: string, kind: 'contact' | 'motion' | 'leak') => void;
  liveConnection?: LiveConnectionState;
}

let {
  plan = $bindable(),
  household,
  devices = [],
  library = null,
  editable = $bindable(true),
  roomFilter = $bindable(null),
  onSelectPlan,
  onAddPlan,
  onScene,
  onCameraInspect,
  onSensorHistory,
  liveConnection = 'connecting',
}: Props = $props();

const editor = new FloorPlanEditorState(
  () => plan,
  (next) => {
    plan = next;
  },
  () => editable,
  () => household,
  () => devices,
  (deviceId, patch) => updateDevice(deviceId, patch)
);

const liveLabel = $derived(
  liveConnection === 'connected'
    ? 'Live'
    : liveConnection === 'connecting'
      ? 'Connecting'
      : 'REST fallback'
);

let clearOpen = $state(false);
let sampleAOpen = $state(false);
let sampleBOpen = $state(false);
let canvasEl = $state<HTMLDivElement | undefined>();

const tools: { id: FloorPlanTool; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'room', label: 'Room square' },
  { id: 'pen', label: 'Pen' },
  { id: 'door', label: 'Door' },
  { id: 'window', label: 'Window' },
];
const actions: { id: FloorPlanActionId; label: string }[] = [
  { id: 'close', label: 'Close room' },
  { id: 'flip', label: 'Flip door' },
  { id: 'flip-name', label: 'Flip name 90°' },
  { id: 'rotate', label: 'Rotate 90° left' },
  { id: 'delete', label: 'Delete' },
  { id: 'undo', label: 'Undo' },
  { id: 'sample-a', label: 'Load Home A' },
  { id: 'sample-b', label: 'Load Home B' },
  { id: 'clear', label: 'Clear' },
];

function setEditable(next: boolean) {
  editable = next;
  if (!next) editor.leaveEditMode();
}

function svgPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const svg = event.currentTarget as SVGSVGElement;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const point = svgPoint(event);
  if (!editable) return;
  try {
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  } catch {
    // Some browsers reject capture for untrusted or already-released pointers.
  }
  editor.pointerDown(point, event.shiftKey, event.detail);
}

function handlePointerMove(event: PointerEvent) {
  editor.pointerMove(svgPoint(event), event.shiftKey);
}

function handlePointerUp() {
  editor.pointerUp();
}

function handleDoubleClick(event: MouseEvent) {
  editor.doubleClick(svgPoint(event));
}

function autofocusSelect(node: HTMLInputElement) {
  node.focus();
  node.select();
}

function clientToPlan(clientX: number, clientY: number) {
  const svg = canvasEl?.querySelector('svg');
  if (!svg) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function dropIsOnCanvas(clientX: number, clientY: number): boolean {
  if (!canvasEl) return false;
  const rect = canvasEl.getBoundingClientRect();
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  );
}

function placeSensorAt(kind: FloorPlanSensorKind, clientX: number, clientY: number) {
  if (!dropIsOnCanvas(clientX, clientY)) return;
  const point = clientToPlan(clientX, clientY);
  if (!point) return;
  editor.placeSensor(kind, point);
}

function handleSensorDragStart(kind: FloorPlanSensorKind, event: DragEvent) {
  event.dataTransfer?.setData('text/plain', kind);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

function handleCanvasDragOver(event: DragEvent) {
  if (!editable) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleCanvasDrop(event: DragEvent) {
  if (!editable) return;
  event.preventDefault();
  const kind = event.dataTransfer?.getData('text/plain') as FloorPlanSensorKind | undefined;
  editor.sensorDrag = null;
  if (!kind || !FLOOR_PLAN_SENSOR_KINDS.includes(kind)) return;
  placeSensorAt(kind, event.clientX, event.clientY);
}

function endSensorPaletteDrag(event: PointerEvent) {
  const kind = editor.takePaletteDrag();
  if (!kind) return;
  placeSensorAt(kind, event.clientX, event.clientY);
}

function runAction(id: FloorPlanActionId) {
  if (id === 'close') editor.closeSelectedTrace();
  else if (id === 'flip') editor.flipSelectedDoors();
  else if (id === 'flip-name') editor.flipSelectedNames();
  else if (id === 'rotate') editor.rotatePlan();
  else if (id === 'delete') editor.removeSelected();
  else if (id === 'undo') editor.undo();
  else if (id === 'sample-a') sampleAOpen = true;
  else if (id === 'sample-b') sampleBOpen = true;
  else clearOpen = true;
}

function clearPlan() {
  editor.clearDrawing();
  clearOpen = false;
}

function loadSample(kind: 'a' | 'b') {
  editor.loadSample(kind);
  sampleAOpen = false;
  sampleBOpen = false;
}
</script>

<svelte:window
  onkeydown={(event) => editor.keydown(event)}
  onpointermove={editor.sensorDrag ? (event) => editor.movePaletteDrag(event) : undefined}
  onpointerup={editor.sensorDrag ? endSensorPaletteDrag : undefined}
/>

{#snippet liveDot()}
  <span
    class={[
      'inline-block size-1.5 shrink-0 rounded-full',
      liveConnection === 'connected' ? 'bg-emerald-500' : 'bg-red-500',
    ]}
    aria-label={liveLabel}
    title={liveConnection === 'disconnected'
      ? 'AppSync is disconnected; REST snapshot polling is active'
      : liveLabel}
  ></span>
{/snippet}

<div class="space-y-3">
  {#if editable}
    <FloorPlanToolbar
      bind:tool={editor.tool}
      {tools}
      {actions}
      actionDisabled={(id) => editor.actionDisabled(id)}
      {runAction}
      onPalettePointerDown={(kind, event) => editor.beginPaletteDrag(kind, event)}
      onPaletteDragStart={handleSensorDragStart}
      onPaletteDragEnd={() => (editor.sensorDrag = null)}
      {library}
      {onSelectPlan}
      {onAddPlan}
      iconScale={editor.iconScale}
      showNames={editor.showNames}
      onScale={(value) => editor.applySensorScale(value)}
      onNudgeScale={(delta) => editor.nudgeSensorScale(delta)}
      onToggleNames={() => editor.toggleSensorLabels()}
      onStopEdit={() => setEditable(false)}
    >
      {#snippet liveStatus()}
        {@render liveDot()}
      {/snippet}
    </FloorPlanToolbar>
  {/if}
  {#if editor.dropHint}
    <p class="text-muted-foreground text-sm">{editor.dropHint}</p>
  {/if}

  <div class={editable ? 'border border-border p-3 md:p-6' : 'plan-view'}>
    {#if !editable}
      <div class="plan-view-bar">
        {#if library}
          <FloorPlanSwitcher
            {library}
            onSelect={(id) => onSelectPlan?.(id)}
            onAdd={(name) => onAddPlan?.(name)}
          >
            {#snippet afterActive()}
              {@render liveDot()}
              {#if onScene}
                <PlanSceneChips {household} {onScene} />
              {/if}
            {/snippet}
          </FloorPlanSwitcher>
        {/if}
        <div class="plan-view-edit">
          <button
            type="button"
            class="plan-view-edit-btn"
            title="Turn on edit plan"
            aria-label="Turn on edit plan"
            aria-pressed={false}
            onclick={() => setEditable(true)}
          >
            <FloorPlanIcon name="edit" />
          </button>
        </div>
      </div>
    {/if}
    <div class="plan-row">
      <div
        class="floor-plan-canvas"
        bind:this={canvasEl}
        role="application"
        aria-label="Floor plan canvas"
        ondragover={handleCanvasDragOver}
        ondrop={handleCanvasDrop}
      >
        <FloorPlanSvg
          {plan}
          {household}
          {devices}
          draftRoom={editor.draftRoom}
          draftPoint={editor.draftPoint}
          marquee={editor.marquee}
          selected={editable ? editor.selected : null}
          editingRoomId={editor.editingRoomId}
          editingSensorId={editor.editingSensorId}
          focusRoomName={roomFilter}
          variant="console"
          showGrid={editable}
          showAddresses={true}
          browse={!editable}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerUp}
          onpointerleave={() => {
            editor.draftPoint = null;
            handlePointerUp();
          }}
          ondblclick={handleDoubleClick}
          onRoomClick={(roomName) => {
            roomFilter = roomFilter === roomName ? null : roomName;
          }}
          onCameraClick={(sensor) => {
            if (sensor.deviceId) onCameraInspect?.(sensor.deviceId);
          }}
          onHistoryClick={(sensor) => {
            if (
              sensor.deviceId &&
              (sensor.kind === 'contact' || sensor.kind === 'motion' || sensor.kind === 'leak')
            ) {
              onSensorHistory?.(sensor.deviceId, sensor.kind);
            }
          }}
        />
        {#if editor.editingRoom}
          <input
            class="room-name-input"
            style="left: {viewBoxPercent(editor.view, roomLabelPoint(editor.editingRoom).x, roomLabelPoint(editor.editingRoom).y).left}%; top: {viewBoxPercent(editor.view, roomLabelPoint(editor.editingRoom).x, roomLabelPoint(editor.editingRoom).y).top}%; width: {Math.max(10, (editor.editingRoom.w / editor.view.width) * 100 - 2)}%; transform: translate(-50%, -50%) rotate({roomLabelAngle(editor.editingRoom)}deg);"
            value={editor.editingName}
            aria-label="Room name"
            use:autofocusSelect
            oninput={(event) => (editor.editingName = event.currentTarget.value)}
            onblur={() => editor.finishRename()}
            onkeydown={(event) => editor.renameKeydown(event)}
          />
        {/if}
        {#if editor.editingSensor}
          <div
            class="sensor-name-dialog"
            style="left: {viewBoxPercent(editor.view, editor.editingSensor.x, editor.editingSensor.y).left}%; top: {viewBoxPercent(editor.view, editor.editingSensor.x, editor.editingSensor.y).top}%;"
            role="dialog"
            tabindex="-1"
            aria-label="Name this sensor"
            onpointerdown={(event) => event.stopPropagation()}
          >
            <p class="sensor-name-status">
              Cell {planGridRef(editor.editingSensor.x, editor.editingSensor.y)}
            </p>
            <label class="sensor-name-label" for="sensor-name-input">Name</label>
            <input
              id="sensor-name-input"
              class="sensor-name-input"
              value={editor.editingSensorName}
              aria-label="Sensor name"
              disabled={editor.linkingSensor}
              use:autofocusSelect
              oninput={(event) => (editor.editingSensorName = event.currentTarget.value)}
              onblur={(event) => {
                const next = event.relatedTarget as Node | null;
                if (next && event.currentTarget.closest('.sensor-name-dialog')?.contains(next)) return;
                void editor.finishSensorRename();
              }}
              onkeydown={(event) => editor.sensorRenameKeydown(event)}
            />
            {#if editor.liveDevicesFor(editor.editingSensor.kind).length}
              <label class="sensor-name-label" for="sensor-device-input">Live device</label>
              <select
                id="sensor-device-input"
                class="sensor-name-input"
                value={editor.editingSensorDeviceId}
                aria-label="Live device"
                disabled={editor.linkingSensor}
                onchange={(event) => {
                  editor.editingSensorDeviceId = event.currentTarget.value;
                  void editor.finishSensorRename();
                }}
              >
                <option value="">Unlinked</option>
                {#each editor.liveDevicesFor(editor.editingSensor.kind) as device (device.id)}
                  <option value={device.id}>{device.name}</option>
                {/each}
              </select>
            {/if}
            {#if editor.linkingSensor}
              <p class="sensor-name-status">Saving to devices…</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if editor.sensorDrag}
  <div class="sensor-ghost" style="left: {editor.sensorDrag.x}px; top: {editor.sensorDrag.y}px">
    <FloorPlanSensorMark
      kind={editor.sensorDrag.kind}
      active={editor.sensorDrag.kind === 'light' || editor.sensorDrag.kind === 'plug'}
      size={16}
    />
  </div>
{/if}

<ConfirmDialog
  bind:open={clearOpen}
  title="Clear this plan?"
  description="Rooms, doors, windows, and sensors will be removed from this browser."
  confirmLabel="Clear"
  onConfirm={clearPlan}
/>

<ConfirmDialog
  bind:open={sampleAOpen}
  title="Load Home A?"
  description="This replaces the current drawing with a fictional two-bedroom sample. It does not change your other saved homes until you save."
  confirmLabel="Load Home A"
  onConfirm={() => loadSample('a')}
/>

<ConfirmDialog
  bind:open={sampleBOpen}
  title="Load Home B?"
  description="This replaces the current drawing with a fictional three-bedroom sample. It does not change your other saved homes until you save."
  confirmLabel="Load Home B"
  onConfirm={() => loadSample('b')}
/>

<style>
  .plan-view {
    position: relative;
    padding-top: 2.4rem;
  }

  .plan-view-bar {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    z-index: 3;
    display: flex;
    min-height: 1.75rem;
    align-items: center;
    justify-content: flex-start;
    padding: 0 2rem 0 0;
    pointer-events: none;
  }

  .plan-view-bar > :global(*) {
    pointer-events: auto;
  }

  .plan-view-edit {
    position: absolute;
    top: 0;
    right: 0;
  }

  .plan-view-edit-btn {
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

  .plan-view-edit-btn:hover {
    color: var(--foreground);
  }

  .plan-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .floor-plan-canvas {
    position: relative;
    min-width: 0;
  }

  .room-name-input {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 2;
    box-sizing: border-box;
    border: 1px solid #666;
    background: #111;
    padding: 0.2rem 0.4rem;
    color: #f5f5f5;
    font-family: Syne, system-ui, sans-serif;
    font-weight: 600;
    font-size: 16px;
    text-align: center;
  }

  .room-name-input:focus {
    outline: 1px solid #f5f5f5;
  }

  .sensor-name-dialog {
    position: absolute;
    z-index: 3;
    display: grid;
    width: 13.5rem;
    transform: translate(18px, -50%);
    gap: 0.3rem;
    border: 1px solid #666;
    background: #111;
    padding: 0.55rem 0.65rem;
    color: #f5f5f5;
  }

  .sensor-name-label,
  .sensor-name-status {
    color: #bbb;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sensor-name-input {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #555;
    background: #1a1a1a;
    padding: 0.25rem 0.4rem;
    color: #f5f5f5;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 14px;
  }

  .sensor-name-input:focus {
    outline: 1px solid #f5f5f5;
  }

  .sensor-ghost {
    position: fixed;
    z-index: 40;
    pointer-events: none;
    transform: translate(-50%, -50%);
    color: #f5f5f5;
  }
</style>
