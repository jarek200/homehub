<script lang="ts">
import type {
  Device,
  DraftRoom,
  FloorPlan,
  FloorPlanPoint,
  FloorPlanSelection,
  FloorPlanSensor,
  HubHouseholdState,
} from '@homehub/core';
import {
  doorGeometry,
  FLOOR_PLAN_GRID,
  handlePoints,
  isClimateSensorKind,
  normalizeSelections,
  openingHandlePoints,
  planContentViewBox,
  planGridCellRect,
  planGridOverlay,
  planRoomAt,
  planScaleMark,
  planSensorScale,
  planShowsSensorLabels,
  planTraces,
  polygonPointsAttr,
  roomLabelAngle,
  roomLabelPoint,
  roomPolygon,
  sensorMarkSize,
  windowHandlePoints,
  windowLines,
} from '@homehub/core';
import type { MouseEventHandler, PointerEventHandler } from 'svelte/elements';
import FloorPlanSensorMark from '$lib/components/floor-plan/floor-plan-sensor-mark.svelte';
import {
  sensorIsActive,
  sensorIsUnavailable,
  sensorReadingLines,
  sensorStatus,
} from '$lib/floor-plan/sensor-status';

interface Props {
  plan: FloorPlan;
  household: HubHouseholdState;
  variant?: 'console';
  showGrid?: boolean;
  showAddresses?: boolean;
  draftRoom?: DraftRoom | null;
  marquee?: DraftRoom | null;
  selected?: FloorPlanSelection | FloorPlanSelection[] | null;
  editingRoomId?: string | null;
  editingSensorId?: string | null;
  focusRoomName?: string | null;
  browse?: boolean;
  draftPoint?: FloorPlanPoint | null;
  devices?: Device[];
  onpointerdown?: PointerEventHandler<SVGSVGElement>;
  onpointermove?: PointerEventHandler<SVGSVGElement>;
  onpointerup?: PointerEventHandler<SVGSVGElement>;
  onpointerleave?: PointerEventHandler<SVGSVGElement>;
  ondblclick?: MouseEventHandler<SVGSVGElement>;
  onRoomClick?: (roomName: string) => void;
  onCameraClick?: (sensor: FloorPlanSensor) => void;
  onHistoryClick?: (sensor: FloorPlanSensor) => void;
}

let {
  plan,
  household,
  variant = 'console',
  showGrid = false,
  showAddresses = false,
  draftRoom = null,
  marquee = null,
  selected = null,
  editingRoomId = null,
  editingSensorId = null,
  focusRoomName = null,
  browse = false,
  draftPoint = null,
  devices = [],
  onpointerdown,
  onpointermove,
  onpointerup,
  onpointerleave,
  ondblclick,
  onRoomClick,
  onCameraClick,
  onHistoryClick,
}: Props = $props();

const deviceById = $derived(new Map(devices.map((device) => [device.deviceId, device] as const)));

const wallWidth = 3;
const doorWidth = 2;
const iconScale = $derived(planSensorScale(plan) / 100);
const markSize = $derived(sensorMarkSize(plan));
const showNames = $derived(planShowsSensorLabels(plan));
const selectedItems = $derived(normalizeSelections(selected));
const selectedRoom = $derived.by(() => {
  const rooms = selectedItems.filter((item) => item.kind === 'room');
  if (rooms.length !== 1) return null;
  return plan.rooms.find((room) => room.id === rooms[0]?.id) ?? null;
});
const selectedWindow = $derived.by(() => {
  const windows = selectedItems.filter((item) => item.kind === 'window');
  if (windows.length !== 1) return null;
  return plan.windows.find((window) => window.id === windows[0]?.id) ?? null;
});
const selectedDoor = $derived.by(() => {
  const doors = selectedItems.filter((item) => item.kind === 'door');
  if (doors.length !== 1) return null;
  return plan.doors.find((door) => door.id === doors[0]?.id) ?? null;
});
const selectedTrace = $derived.by(() => {
  const traces = selectedItems.filter((item) => item.kind === 'trace');
  if (traces.length !== 1) return null;
  return planTraces(plan).find((trace) => trace.id === traces[0]?.id) ?? null;
});
const traces = $derived(planTraces(plan));
const showLocator = $derived(showGrid || showAddresses);
const view = $derived(
  showGrid || showAddresses
    ? { x: 0, y: 0, width: plan.width, height: plan.height }
    : planContentViewBox(plan, {
        drafts: [draftRoom, marquee],
        points: [draftPoint],
        padding: 36,
      })
);
const overlay = $derived(showLocator ? planGridOverlay(view, plan) : null);
const scaleMark = $derived(showLocator ? planScaleMark(view) : null);
let hoverPoint = $state<{ x: number; y: number } | null>(null);
const hoverCell = $derived.by(() => {
  if (!showLocator || !hoverPoint) return null;
  if (
    hoverPoint.x < 0 ||
    hoverPoint.y < 0 ||
    hoverPoint.x > plan.width ||
    hoverPoint.y > plan.height
  ) {
    return null;
  }
  return planGridCellRect(hoverPoint.x, hoverPoint.y);
});
const tallPlan = $derived(view.height > view.width * 1.15);
const draftLine = $derived.by(() => {
  const last = selectedTrace?.points.at(-1);
  if (!last || !draftPoint) return null;
  return { x1: last.x, y1: last.y, x2: draftPoint.x, y2: draftPoint.y };
});

function isSelected(kind: FloorPlanSelection['kind'], id: string): boolean {
  return selectedItems.some((item) => item.kind === kind && item.id === id);
}
const gridDots = $derived.by(() => {
  if (!showGrid) return [];
  const dots: { x: number; y: number }[] = [];
  for (let x = FLOOR_PLAN_GRID; x < plan.width; x += FLOOR_PLAN_GRID * 2) {
    for (let y = FLOOR_PLAN_GRID; y < plan.height; y += FLOOR_PLAN_GRID * 2) {
      dots.push({ x, y });
    }
  }
  return dots;
});

function svgLocalPoint(event: PointerEvent): { x: number; y: number } {
  const svg = event.currentTarget as SVGSVGElement;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function handlePointerMove(event: PointerEvent & { currentTarget: EventTarget & SVGSVGElement }) {
  if (showLocator) hoverPoint = svgLocalPoint(event);
  onpointermove?.(event);
}

function handlePointerLeave(event: PointerEvent & { currentTarget: EventTarget & SVGSVGElement }) {
  hoverPoint = null;
  onpointerleave?.(event);
}
</script>

<svg
  class="floor-plan floor-plan-{variant}"
  class:floor-plan-interactive={showGrid && !browse}
  class:floor-plan-browse={browse}
  class:floor-plan-tall={tallPlan}
  viewBox="{view.x} {view.y} {view.width} {view.height}"
  role="img"
  aria-label={plan.name}
  {onpointerdown}
  onpointermove={handlePointerMove}
  {onpointerup}
  onpointerleave={handlePointerLeave}
  {ondblclick}
>
  {#if showGrid}
    {#each gridDots as dot (`${dot.x}-${dot.y}`)}
      <circle cx={dot.x} cy={dot.y} r="1.1" class="floor-plan-grid" />
    {/each}
  {/if}

  {#each plan.rooms as room (room.id)}
    {@const points = roomPolygon(room)}
    <polygon
      points={polygonPointsAttr(points)}
      class="floor-plan-room-fill"
      class:floor-plan-selected={isSelected('room', room.id)}
      class:floor-plan-focus={!!focusRoomName && room.name === focusRoomName}
    />
    {#if browse}
      <polygon
        points={polygonPointsAttr(points)}
        class="floor-plan-room-hit"
        role="button"
        tabindex="0"
        aria-label="Filter devices by {room.name}"
        aria-pressed={room.name === focusRoomName}
        onclick={() => onRoomClick?.(room.name)}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onRoomClick?.(room.name);
          }
        }}
      />
    {/if}
  {/each}

  {#if overlay}
    {#each overlay.vLines as line (`v-${line.x}`)}
      <line
        x1={line.x}
        y1={view.y}
        x2={line.x}
        y2={view.y + view.height}
        class="floor-plan-grid-line"
        class:floor-plan-grid-major={line.major}
      />
    {/each}
    {#each overlay.hLines as line (`h-${line.y}`)}
      <line
        x1={view.x}
        y1={line.y}
        x2={view.x + view.width}
        y2={line.y}
        class="floor-plan-grid-line"
        class:floor-plan-grid-major={line.major}
      />
    {/each}
    {#each overlay.cols as col (`col-${col.label}`)}
      <text
        x={col.x}
        y={col.y}
        text-anchor="middle"
        dominant-baseline="middle"
        class="floor-plan-grid-label"
        font-size={overlay.fontSize}
      >
        {col.label}
      </text>
    {/each}
    {#each overlay.rows as row (`row-${row.label}`)}
      <text
        x={row.x}
        y={row.y}
        text-anchor="middle"
        dominant-baseline="middle"
        class="floor-plan-grid-label"
        font-size={overlay.fontSize}
      >
        {row.label}
      </text>
    {/each}
    {#if hoverCell}
      <rect
        x={hoverCell.x}
        y={hoverCell.y}
        width={hoverCell.w}
        height={hoverCell.h}
        class="floor-plan-grid-hover"
      />
    {/if}
    {#if scaleMark}
      <g class="floor-plan-scale" aria-label="One square is 1 metre">
        <line
          x1={scaleMark.x1}
          y1={scaleMark.y - scaleMark.tick}
          x2={scaleMark.x1}
          y2={scaleMark.y + scaleMark.tick}
        />
        <line x1={scaleMark.x1} y1={scaleMark.y} x2={scaleMark.x2} y2={scaleMark.y} />
        <line
          x1={scaleMark.x2}
          y1={scaleMark.y - scaleMark.tick}
          x2={scaleMark.x2}
          y2={scaleMark.y + scaleMark.tick}
        />
        <text
          x={scaleMark.labelX}
          y={scaleMark.labelY}
          text-anchor="middle"
          font-size={scaleMark.fontSize}
        >
          {scaleMark.label}
        </text>
      </g>
    {/if}
  {/if}

  {#each plan.rooms as room (room.id)}
    {@const label = roomLabelPoint(room)}
    {#if editingRoomId !== room.id}
      <text
        x={label.x}
        y={label.y}
        text-anchor="middle"
        dominant-baseline="middle"
        transform="rotate({roomLabelAngle(room)} {label.x} {label.y})"
        class="floor-plan-room"
      >
        {room.name}
      </text>
    {/if}
  {/each}

  {#each traces as trace (trace.id)}
    {#if trace.points.length >= 2}
      <polyline
        points={polygonPointsAttr(trace.points)}
        class="floor-plan-trace"
        class:floor-plan-selected={isSelected('trace', trace.id)}
      />
    {/if}
    {#each trace.points as point, index (`${trace.id}-${index}`)}
      <circle
        cx={point.x}
        cy={point.y}
        r={index === 0 && trace.points.length >= 3 ? 6 : 3.5}
        class="floor-plan-trace-point"
        class:floor-plan-trace-start={index === 0}
        class:floor-plan-selected={isSelected('trace', trace.id)}
      />
    {/each}
  {/each}

  {#if draftLine}
    <line
      x1={draftLine.x1}
      y1={draftLine.y1}
      x2={draftLine.x2}
      y2={draftLine.y2}
      class="floor-plan-trace-draft"
    />
  {/if}

  {#each plan.walls as wall, index (`${wall.x1}-${wall.y1}-${index}`)}
    <line
      x1={wall.x1}
      y1={wall.y1}
      x2={wall.x2}
      y2={wall.y2}
      class="floor-plan-wall"
      stroke-width={wallWidth}
    />
  {/each}

  {#each plan.doors as door (door.id)}
    {@const drawn = doorGeometry(door)}
    <g class:floor-plan-selected={isSelected('door', door.id)}>
      <path
        d={drawn.swing}
        class="floor-plan-door-swing"
        fill="none"
        stroke-dasharray="2 2"
        stroke-width={doorWidth}
      />
      <line
        x1={drawn.leaf.x1}
        y1={drawn.leaf.y1}
        x2={drawn.leaf.x2}
        y2={drawn.leaf.y2}
        class="floor-plan-door-leaf"
        stroke-width={doorWidth}
      />
    </g>
  {/each}

  {#each plan.windows as window (window.id)}
    {#each windowLines(window) as line (`${window.id}-${line.x1}-${line.y1}`)}
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        class="floor-plan-window"
        class:floor-plan-selected={isSelected('window', window.id)}
        stroke-width={doorWidth}
      />
    {/each}
  {/each}

  {#if draftRoom && draftRoom.w > 4 && draftRoom.h > 4}
    <rect
      x={draftRoom.x}
      y={draftRoom.y}
      width={draftRoom.w}
      height={draftRoom.h}
      class="floor-plan-draft"
    />
  {/if}

  {#if marquee && marquee.w > 4 && marquee.h > 4}
    <rect
      x={marquee.x}
      y={marquee.y}
      width={marquee.w}
      height={marquee.h}
      class="floor-plan-marquee"
    />
  {/if}

  {#if selectedRoom}
    {#each Object.entries(handlePoints(selectedRoom)) as [handle, point] (handle)}
      <rect
        x={point.x - 6}
        y={point.y - 6}
        width="12"
        height="12"
        class="floor-plan-handle"
        data-handle={handle}
      />
    {/each}
  {/if}

  {#if selectedWindow}
    {#each Object.entries(windowHandlePoints(selectedWindow)) as [handle, point] (handle)}
      <rect
        x={point.x - 6}
        y={point.y - 6}
        width="12"
        height="12"
        class="floor-plan-handle"
        data-handle={handle}
      />
    {/each}
  {/if}

  {#if selectedDoor}
    {#each Object.entries(openingHandlePoints(selectedDoor)) as [handle, point] (handle)}
      <rect
        x={point.x - 6}
        y={point.y - 6}
        width="12"
        height="12"
        class="floor-plan-handle"
        data-handle={handle}
      />
    {/each}
  {/if}

  {#each plan.sensors as sensor (sensor.id)}
    {@const room = planRoomAt(plan, sensor.x, sensor.y)}
    {@const linked = sensor.deviceId ? (deviceById.get(sensor.deviceId) ?? null) : null}
    {@const status = sensorStatus(sensor, household, room?.name, linked)}
    {@const readingLines = isClimateSensorKind(sensor.kind)
      ? sensorReadingLines(sensor, household, room?.name)
      : []}
    {@const unavailable = sensorIsUnavailable(sensor, household, room?.name, linked)}
    {@const alert = !unavailable && sensorIsActive(status)}
    <g
      transform="translate({sensor.x} {sensor.y})"
      class="floor-plan-sensor-wrap"
      class:floor-plan-alert={alert}
      class:floor-plan-sensor-unavailable={unavailable}
      class:floor-plan-selected={isSelected('sensor', sensor.id)}
    >
      {#if isSelected('sensor', sensor.id)}
        <circle r={15 * iconScale} class="floor-plan-sensor-ring" />
      {/if}
      {#if isClimateSensorKind(sensor.kind)}
        {#if editingSensorId !== sensor.id}
          <g transform="scale({iconScale})">
            <text
              text-anchor="middle"
              dominant-baseline="middle"
              class="floor-plan-climate"
              font-size="16"
            >
              {#each readingLines as line, index (`${sensor.id}-${index}`)}
                <tspan x="0" dy={index === 0 ? `${-((readingLines.length - 1) * 10)}` : 20}>{line}</tspan>
              {/each}
            </text>
          </g>
        {/if}
      {:else}
        <g transform="translate({-markSize / 2} {-markSize / 2})">
          <FloorPlanSensorMark
            kind={sensor.kind}
            active={sensorIsActive(status)}
            size={markSize}
          />
        </g>
        {#if browse && sensor.deviceId && (sensor.kind === 'camera' || sensor.kind === 'contact' || sensor.kind === 'motion' || sensor.kind === 'leak')}
          <circle
            r={Math.max(14, markSize / 2 + 6)}
            class="floor-plan-sensor-hit"
            role="button"
            tabindex="0"
            aria-label="{sensor.label || sensor.kind} {status}"
            onclick={(event) => {
              event.stopPropagation();
              if (sensor.kind === 'camera') onCameraClick?.(sensor);
              else onHistoryClick?.(sensor);
            }}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                if (sensor.kind === 'camera') onCameraClick?.(sensor);
                else onHistoryClick?.(sensor);
              }
            }}
          />
        {/if}
      {/if}
      {#if showNames && sensor.label.trim() && editingSensorId !== sensor.id}
        <text
          y={isClimateSensorKind(sensor.kind)
            ? (12 + readingLines.length * 12) * iconScale
            : markSize / 2 + 10}
          text-anchor="middle"
          class="floor-plan-sensor"
          font-size={10 * iconScale}
        >
          {sensor.label}
        </text>
      {/if}
    </g>
  {/each}
</svg>

<style>
  .floor-plan {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
  }

  .floor-plan-browse {
    touch-action: pan-y;
  }

  .floor-plan-console {
    width: 100%;
    max-width: 100%;
    height: auto;
    margin-inline: auto;
  }

  .floor-plan-console.floor-plan-interactive {
    width: auto;
    height: min(68vh, 720px);
  }

  .floor-plan-interactive {
    cursor: crosshair;
  }

  .floor-plan-wall,
  .floor-plan-door-leaf,
  .floor-plan-door-swing,
  .floor-plan-window,
  .floor-plan-trace,
  .floor-plan-trace-draft,
  .floor-plan-mark {
    fill: none;
    stroke: currentColor;
    stroke-linecap: square;
    stroke-linejoin: miter;
  }

  .floor-plan-door-leaf,
  .floor-plan-window {
    stroke-dasharray: none;
  }

  .floor-plan-door-swing {
    fill: none;
    stroke-dasharray: 2 2;
  }

  .floor-plan-room-fill {
    fill: currentColor;
    opacity: 0.06;
    pointer-events: none;
  }

  .floor-plan-room-hit {
    fill: transparent;
    cursor: pointer;
  }

  .floor-plan-sensor-hit {
    fill: transparent;
    cursor: pointer;
  }

  .floor-plan-room-fill.floor-plan-selected,
  .floor-plan-room-fill.floor-plan-focus {
    opacity: 0.14;
  }

  .floor-plan-browse {
    cursor: pointer;
  }

  .floor-plan-browse .floor-plan-room {
    cursor: pointer;
    pointer-events: none;
  }

  .floor-plan-grid {
    fill: currentColor;
    opacity: 0.18;
    pointer-events: none;
  }

  .floor-plan-grid-line {
    fill: none;
    stroke: currentColor;
    stroke-width: 0.6;
    opacity: 0.14;
    pointer-events: none;
  }

  .floor-plan-grid-line.floor-plan-grid-major {
    opacity: 0.28;
    stroke-width: 0.9;
  }

  .floor-plan-grid-label {
    fill: currentColor;
    font-family: Syne, system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: 0.04em;
    opacity: 0.55;
    pointer-events: none;
  }

  .floor-plan-grid-hover {
    fill: currentColor;
    fill-opacity: 0.08;
    stroke: currentColor;
    stroke-width: 1;
    opacity: 0.7;
    pointer-events: none;
  }

  .floor-plan-scale {
    pointer-events: none;
  }

  .floor-plan-scale line {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    opacity: 0.7;
  }

  .floor-plan-scale text {
    fill: currentColor;
    font-family: Syne, system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: 0.04em;
    opacity: 0.7;
  }

  .floor-plan-draft,
  .floor-plan-marquee {
    fill: currentColor;
    fill-opacity: 0.08;
    stroke: currentColor;
    stroke-dasharray: 8 6;
    stroke-width: 2;
    pointer-events: none;
  }

  .floor-plan-marquee {
    fill-opacity: 0.12;
    stroke-dasharray: 4 3;
  }

  .floor-plan-trace,
  .floor-plan-trace-draft {
    fill: none;
    stroke-dasharray: 6 4;
    stroke-width: 2;
    pointer-events: none;
  }

  .floor-plan-trace.floor-plan-selected {
    stroke-dasharray: none;
    stroke-width: 3;
  }

  .floor-plan-trace-point {
    fill: currentColor;
    pointer-events: none;
  }

  .floor-plan-trace-start {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }

  .floor-plan-handle {
    fill: currentColor;
    stroke: #111;
    stroke-width: 1;
  }

  .floor-plan-selected .floor-plan-door-leaf,
  .floor-plan-selected .floor-plan-door-swing,
  .floor-plan-window.floor-plan-selected {
    stroke-width: 4;
  }

  .floor-plan-room {
    fill: currentColor;
    font-size: 22px;
    font-family: Syne, system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: -0.03em;
    opacity: 0.38;
    pointer-events: auto;
    cursor: grab;
  }

  .floor-plan-sensor,
  .floor-plan-climate {
    fill: currentColor;
    font-family: Syne, system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: -0.03em;
    pointer-events: none;
  }

  .floor-plan-sensor-ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    opacity: 0.7;
    pointer-events: none;
  }

  .floor-plan-sensor-unavailable {
    opacity: 0.45;
  }

  .floor-plan-console {
    color: #f5f5f5;
  }
</style>
