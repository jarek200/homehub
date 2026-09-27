export const FLOOR_PLAN_SENSOR_KINDS = [
  'light',
  'plug',
  'leak',
  'contact',
  'lock',
  'climate',
  'co2',
  'pm25',
  'air-quality',
  'motion',
  'camera',
] as const;
export type FloorPlanSensorKind = (typeof FLOOR_PLAN_SENSOR_KINDS)[number];

/** Kinds that read from the household climate feed (ALPSTUGA pattern). */
export const FLOOR_PLAN_CLIMATE_KINDS: readonly FloorPlanSensorKind[] = [
  'climate',
  'co2',
  'pm25',
  'air-quality',
];

export function isClimateSensorKind(kind: FloorPlanSensorKind): boolean {
  return (FLOOR_PLAN_CLIMATE_KINDS as readonly string[]).includes(kind);
}

export const FLOOR_PLAN_SENSOR_META: Record<
  FloorPlanSensorKind,
  { label: string; deviceType: string }
> = {
  light: { label: 'Bulb', deviceType: 'light' },
  plug: { label: 'Plug', deviceType: 'plug' },
  leak: { label: 'Leak', deviceType: 'leak-sensor' },
  contact: { label: 'Door / window', deviceType: 'contact-sensor' },
  lock: { label: 'Lock', deviceType: 'lock' },
  climate: { label: 'Temp / humidity', deviceType: 'environmental-sensor' },
  co2: { label: 'CO₂', deviceType: 'environmental-sensor' },
  pm25: { label: 'PM2.5', deviceType: 'environmental-sensor' },
  'air-quality': { label: 'Air quality', deviceType: 'environmental-sensor' },
  motion: { label: 'Motion', deviceType: 'motion-sensor' },
  camera: { label: 'Camera', deviceType: 'camera' },
};

export type WallSide = 'n' | 's' | 'e' | 'w';

export interface FloorPlanPoint {
  x: number;
  y: number;
}

export const ROOM_LABEL_ANGLES = [0, 90, 180, 270] as const;
export type RoomLabelAngle = (typeof ROOM_LABEL_ANGLES)[number];

export interface FloorPlanRoom {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: FloorPlanPoint[];
  label?: FloorPlanPoint;
  /** Text rotation in degrees. 0 is horizontal. */
  labelAngle?: RoomLabelAngle;
}

export interface FloorPlanTrace {
  id: string;
  points: FloorPlanPoint[];
}

export interface FloorPlanWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type DoorHinge = 'start' | 'end';
export type DoorSwing = 'in' | 'out';

export interface FloorPlanDoor {
  id: string;
  name: string;
  x: number;
  y: number;
  wall: WallSide;
  length: number;
  hinge?: DoorHinge;
  swing?: DoorSwing;
  exterior?: boolean;
}

export interface FloorPlanWindow {
  id: string;
  name: string;
  x: number;
  y: number;
  wall: WallSide;
  length: number;
}

export interface FloorPlanSensor {
  id: string;
  kind: FloorPlanSensorKind;
  label: string;
  x: number;
  y: number;
  deviceId?: string;
}

export interface FloorPlan {
  id: string;
  name: string;
  beds: number;
  baths: number;
  width: number;
  height: number;
  rooms: FloorPlanRoom[];
  walls: FloorPlanWall[];
  doors: FloorPlanDoor[];
  windows: FloorPlanWindow[];
  sensors: FloorPlanSensor[];
  traces?: FloorPlanTrace[];
  /** Shared icon size for every sensor on the plan. 100 is the default. */
  sensorScale?: number;
  /** When false, only icons are drawn on the plan. Default is true. */
  showSensorLabels?: boolean;
  /** Last edit time. Used to reconcile the browser cache with the hub copy. */
  updatedAt?: string;
}

export const FLOOR_PLAN_GRID = 10;
/** SVG units per metre. Sample drawings are built at this scale. */
export const FLOOR_PLAN_UNITS_PER_METRE = 50;
/** One labelled square is 1 metre. */
export const FLOOR_PLAN_CELL = FLOOR_PLAN_UNITS_PER_METRE;
export const STRAIGHT_LINE_SNAP = FLOOR_PLAN_GRID * 2;
export const MIN_ROOM_SIZE = 60;
export const DEFAULT_DOOR_LENGTH = FLOOR_PLAN_GRID * 2;
export const DEFAULT_WINDOW_LENGTH = FLOOR_PLAN_GRID * 2;
export const EDGE_HIT_DISTANCE = 18;
export const DEFAULT_SENSOR_SCALE = 100;
export const MIN_SENSOR_SCALE = 50;
export const MAX_SENSOR_SCALE = 200;
export const SENSOR_SCALE_STEP = 10;

export type FloorPlanTool = 'select' | 'room' | 'pen' | 'door' | 'window';
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
export type OpeningHandle = 'start' | 'end';

export type FloorPlanSelection =
  | { kind: 'room'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'window'; id: string }
  | { kind: 'trace'; id: string }
  | { kind: 'sensor'; id: string };

export type FloorPlanHit =
  | FloorPlanSelection
  | { kind: 'handle'; roomId: string; handle: ResizeHandle }
  | { kind: 'window-handle'; windowId: string; handle: OpeningHandle }
  | { kind: 'door-handle'; doorId: string; handle: OpeningHandle }
  | { kind: 'room-label'; roomId: string };

export interface RoomEdge {
  roomId: string;
  wall: WallSide;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DraftRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Opening = Pick<FloorPlanDoor, 'x' | 'y' | 'wall' | 'length'>;

export interface FloorPlanViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function includePoint(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number
) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

/** Crop the drawing to the rooms and marks, so empty canvas does not stay huge. */
export function planContentViewBox(
  plan: FloorPlan,
  options?: {
    drafts?: Array<DraftRoom | null | undefined>;
    points?: Array<FloorPlanPoint | null | undefined>;
    padding?: number;
  }
): FloorPlanViewBox {
  const padding = options?.padding ?? 40;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (const room of plan.rooms) {
    for (const point of roomPolygon(room)) includePoint(bounds, point.x, point.y);
    const labelBox = roomLabelHitBox(room);
    includePoint(bounds, labelBox.x, labelBox.y);
    includePoint(bounds, labelBox.x + labelBox.w, labelBox.y + labelBox.h);
  }
  for (const door of plan.doors) {
    const geo = doorGeometry(door);
    includePoint(bounds, geo.leaf.x1, geo.leaf.y1);
    includePoint(bounds, geo.leaf.x2, geo.leaf.y2);
    includePoint(bounds, geo.closed.x, geo.closed.y);
  }
  for (const window of plan.windows) {
    for (const line of windowLines(window)) {
      includePoint(bounds, line.x1, line.y1);
      includePoint(bounds, line.x2, line.y2);
    }
  }
  const reach = Math.max(24, sensorMarkSize(plan) + 18);
  for (const sensor of plan.sensors) {
    includePoint(bounds, sensor.x - reach, sensor.y - reach);
    includePoint(bounds, sensor.x + reach, sensor.y + reach);
  }
  for (const trace of planTraces(plan)) {
    for (const point of trace.points) includePoint(bounds, point.x, point.y);
  }
  for (const draft of options?.drafts ?? []) {
    if (!draft) continue;
    includePoint(bounds, draft.x, draft.y);
    includePoint(bounds, draft.x + draft.w, draft.y + draft.h);
  }
  for (const point of options?.points ?? []) {
    if (!point) continue;
    includePoint(bounds, point.x, point.y);
  }

  if (!Number.isFinite(bounds.minX)) {
    return { x: 0, y: 0, width: plan.width, height: plan.height };
  }

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: Math.max(MIN_ROOM_SIZE, bounds.maxX - bounds.minX + padding * 2),
    height: Math.max(MIN_ROOM_SIZE, bounds.maxY - bounds.minY + padding * 2),
  };
}

export function viewBoxPercent(
  view: FloorPlanViewBox,
  x: number,
  y: number
): { left: number; top: number } {
  return {
    left: ((x - view.x) / view.width) * 100,
    top: ((y - view.y) / view.height) * 100,
  };
}

export function createEmptyFloorPlan(name = 'My plan'): FloorPlan {
  return {
    id: 'user-plan',
    name,
    beds: 0,
    baths: 0,
    width: 1000,
    height: 740,
    rooms: [],
    walls: [],
    doors: [],
    windows: [],
    sensors: [],
    traces: [],
  };
}

export function createPlanItemId(prefix: string): string {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${unique}`;
}

export function snapToGrid(value: number, grid = FLOOR_PLAN_GRID): number {
  return Math.round(value / grid) * grid;
}

/** Excel-style column: 0 → A, 25 → Z, 26 → AA. */
export function planColumnLabel(index: number): string {
  if (!Number.isFinite(index) || index < 0) return '';
  let n = Math.floor(index);
  let label = '';
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export function planGridCell(
  x: number,
  y: number,
  cell = FLOOR_PLAN_CELL
): { col: number; row: number; ref: string } {
  const col = Math.max(0, Math.floor(x / cell));
  const row = Math.max(0, Math.floor(y / cell));
  return { col, row, ref: `${planColumnLabel(col)}${row + 1}` };
}

export function planGridRef(x: number, y: number, cell = FLOOR_PLAN_CELL): string {
  return planGridCell(x, y, cell).ref;
}

export function planGridCellRect(
  x: number,
  y: number,
  cell = FLOOR_PLAN_CELL
): { ref: string; x: number; y: number; w: number; h: number } {
  const { col, row, ref } = planGridCell(x, y, cell);
  return { ref, x: col * cell, y: row * cell, w: cell, h: cell };
}

/** Room plus cell, e.g. "Kitchen / Living C7". Cell only when there is no room. */
export function planDeviceLocation(
  roomName: string | null | undefined,
  x: number,
  y: number
): string {
  const ref = planGridRef(x, y);
  const room = roomName?.trim();
  return room ? `${room} ${ref}` : ref;
}

/** Room name for the devices list. Grid cell only when the mark is outside a room. */
export function planDeviceRoomLocation(
  roomName: string | null | undefined,
  x: number,
  y: number
): string {
  return roomName?.trim() || planGridRef(x, y);
}

/** Cell plus room, matching the local hub list, e.g. "B3-Kitchen / Living". */
export function planDevicePlace(roomName: string | null | undefined, x: number, y: number): string {
  const ref = planGridRef(x, y);
  const room = roomName?.trim();
  return room ? `${ref}-${room}` : ref;
}

/** Local-style place for a live fabric device linked on this drawing. */
export function householdDevicePlace(
  plan: Pick<FloorPlan, 'rooms' | 'sensors'>,
  deviceId: string
): string {
  const sensor = plan.sensors.find((item) => item.deviceId === deviceId);
  if (!sensor) return '';
  const room = planRoomAt(plan as FloorPlan, sensor.x, sensor.y);
  return planDevicePlace(room?.name, sensor.x, sensor.y);
}

export function planGridOverlay(
  view: FloorPlanViewBox,
  bounds: Pick<FloorPlan, 'width' | 'height'>,
  cell = FLOOR_PLAN_CELL
): {
  vLines: { x: number; major: boolean }[];
  hLines: { y: number; major: boolean }[];
  cols: { label: string; x: number; y: number }[];
  rows: { label: string; x: number; y: number }[];
  fontSize: number;
} {
  const startCol = Math.max(0, Math.floor(view.x / cell));
  const endCol = Math.max(startCol, Math.ceil((view.x + view.width) / cell));
  const startRow = Math.max(0, Math.floor(view.y / cell));
  const endRow = Math.max(startRow, Math.ceil((view.y + view.height) / cell));
  const maxCol = Math.ceil(bounds.width / cell);
  const maxRow = Math.ceil(bounds.height / cell);
  const fontSize = Math.min(14, Math.max(10, cell * 0.32));
  const labelY = view.y + Math.min(cell * 0.28, Math.max(fontSize, view.height * 0.03));
  const labelX = view.x + Math.min(cell * 0.22, Math.max(fontSize * 0.7, view.width * 0.018));

  const vLines: { x: number; major: boolean }[] = [];
  const hLines: { y: number; major: boolean }[] = [];
  const cols: { label: string; x: number; y: number }[] = [];
  const rows: { label: string; x: number; y: number }[] = [];

  for (let col = startCol; col <= endCol && col <= maxCol; col += 1) {
    const x = col * cell;
    if (x >= view.x - cell && x <= view.x + view.width + cell) {
      vLines.push({ x, major: col % 5 === 0 });
    }
    if (col < endCol && col < maxCol) {
      cols.push({ label: planColumnLabel(col), x: x + cell / 2, y: labelY });
    }
  }
  for (let row = startRow; row <= endRow && row <= maxRow; row += 1) {
    const y = row * cell;
    if (y >= view.y - cell && y <= view.y + view.height + cell) {
      hLines.push({ y, major: row % 5 === 0 });
    }
    if (row < endRow && row < maxRow) {
      rows.push({ label: String(row + 1), x: labelX, y: y + cell / 2 });
    }
  }

  return { vLines, hLines, cols, rows, fontSize };
}

export function planScaleMark(
  view: FloorPlanViewBox,
  unitsPerMetre = FLOOR_PLAN_UNITS_PER_METRE
): {
  x1: number;
  x2: number;
  y: number;
  tick: number;
  label: string;
  labelX: number;
  labelY: number;
  fontSize: number;
} {
  const length = unitsPerMetre;
  const tick = 5;
  const fontSize = 11;
  const pad = 16;
  const x2 = view.x + view.width - pad;
  const x1 = x2 - length;
  const y = view.y + view.height - pad;
  return {
    x1,
    x2,
    y,
    tick,
    label: '1 m',
    labelX: (x1 + x2) / 2,
    labelY: y - tick - 3,
    fontSize,
  };
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): DraftRoom {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function cloneFloorPlan(plan: FloorPlan): FloorPlan {
  return JSON.parse(JSON.stringify(plan)) as FloorPlan;
}

export function planTraces(plan: FloorPlan): FloorPlanTrace[] {
  return plan.traces ?? [];
}

export function roomPolygon(room: FloorPlanRoom): FloorPlanPoint[] {
  if (room.points && room.points.length >= 3) return room.points;
  return [
    { x: room.x, y: room.y },
    { x: room.x + room.w, y: room.y },
    { x: room.x + room.w, y: room.y + room.h },
    { x: room.x, y: room.y + room.h },
  ];
}

export function roomCentroid(room: FloorPlanRoom): FloorPlanPoint {
  const points = roomPolygon(room);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function roomLabelPoint(room: FloorPlanRoom): FloorPlanPoint {
  return room.label ?? roomCentroid(room);
}

export function roomLabelAngle(room: Pick<FloorPlanRoom, 'labelAngle'>): RoomLabelAngle {
  return room.labelAngle === 90 || room.labelAngle === 180 || room.labelAngle === 270
    ? room.labelAngle
    : 0;
}

export function roomLabelHitBox(room: FloorPlanRoom): DraftRoom {
  const label = roomLabelPoint(room);
  const along = Math.max(48, room.name.length * 8);
  const across = 28;
  const vertical = roomLabelAngle(room) === 90 || roomLabelAngle(room) === 270;
  const w = vertical ? across : along;
  const h = vertical ? along : across;
  return { x: label.x - w / 2, y: label.y - h / 2, w, h };
}

export function rotateRoomLabel(plan: FloorPlan, roomId: string): FloorPlan {
  const room = plan.rooms.find((item) => item.id === roomId);
  if (!room) return plan;
  const next = ((roomLabelAngle(room) + 90) % 360) as RoomLabelAngle;
  return {
    ...plan,
    rooms: plan.rooms.map((item) =>
      item.id === roomId ? { ...item, labelAngle: next || undefined } : item
    ),
  };
}

export function rotateRoomLabels(plan: FloorPlan, roomIds: string[]): FloorPlan {
  return roomIds.reduce((next, id) => rotateRoomLabel(next, id), plan);
}

const WALL_AFTER_CCW: Record<WallSide, WallSide> = { n: 'w', w: 's', s: 'e', e: 'n' };

function rotatePointCCW(point: FloorPlanPoint, width: number): FloorPlanPoint {
  return { x: snapToGrid(point.y), y: snapToGrid(width - point.x) };
}

function rotateOpeningCCW<T extends Opening>(opening: T, width: number): T {
  const horizontal = opening.wall === 'n' || opening.wall === 's';
  const wall = WALL_AFTER_CCW[opening.wall];
  if (horizontal) {
    return {
      ...opening,
      x: snapToGrid(opening.y),
      y: snapToGrid(width - opening.x - opening.length),
      wall,
    };
  }
  return {
    ...opening,
    x: snapToGrid(opening.y),
    y: snapToGrid(width - opening.x),
    wall,
  };
}

/** Rotate the whole drawing 90° counterclockwise and swap the canvas size. */
export function rotateFloorPlanCounterClockwise(plan: FloorPlan): FloorPlan {
  const width = plan.width;
  const rooms = plan.rooms.map((room) => ({
    ...room,
    x: snapToGrid(room.y),
    y: snapToGrid(width - room.x - room.w),
    w: room.h,
    h: room.w,
    points: room.points?.map((point) => rotatePointCCW(point, width)),
    label: room.label ? rotatePointCCW(room.label, width) : room.label,
  }));
  return rebuildPlanWalls({
    ...plan,
    width: plan.height,
    height: plan.width,
    rooms,
    doors: plan.doors.map((door) => {
      const next = rotateOpeningCCW(door, width);
      if (door.wall !== 'n' && door.wall !== 's') return next;
      return { ...next, hinge: doorHingeOf(door) === 'end' ? 'start' : 'end' };
    }),
    windows: plan.windows.map((window) => rotateOpeningCCW(window, width)),
    sensors: plan.sensors.map((sensor) => ({
      ...sensor,
      ...rotatePointCCW({ x: sensor.x, y: sensor.y }, width),
    })),
    traces: planTraces(plan).map((trace) => ({
      ...trace,
      points: trace.points.map((point) => rotatePointCCW(point, width)),
    })),
  });
}

const WALL_AFTER_MIRROR_H: Record<WallSide, WallSide> = { n: 'n', s: 's', e: 'w', w: 'e' };

function mirrorX(x: number, width: number): number {
  return snapToGrid(width - x);
}

function mirrorOpeningHorizontal<T extends Opening>(opening: T, width: number): T {
  const wall = WALL_AFTER_MIRROR_H[opening.wall];
  if (opening.wall === 'n' || opening.wall === 's') {
    return {
      ...opening,
      x: snapToGrid(width - opening.x - opening.length),
      wall,
    };
  }
  return {
    ...opening,
    x: snapToGrid(width - opening.x),
    wall,
  };
}

/** Flip the drawing left-to-right, keeping the canvas size. */
export function mirrorFloorPlanHorizontal(plan: FloorPlan): FloorPlan {
  const width = plan.width;
  const rooms = plan.rooms.map((room) => ({
    ...room,
    x: snapToGrid(width - room.x - room.w),
    points: room.points?.map((point) => ({ x: mirrorX(point.x, width), y: point.y })),
    label: room.label ? { x: mirrorX(room.label.x, width), y: room.label.y } : room.label,
  }));
  return rebuildPlanWalls({
    ...plan,
    rooms,
    doors: plan.doors.map((door) => {
      const next = mirrorOpeningHorizontal(door, width);
      if (door.wall !== 'n' && door.wall !== 's') return next;
      return { ...next, hinge: doorHingeOf(door) === 'end' ? 'start' : 'end' };
    }),
    windows: plan.windows.map((window) => mirrorOpeningHorizontal(window, width)),
    sensors: plan.sensors.map((sensor) => ({
      ...sensor,
      x: mirrorX(sensor.x, width),
    })),
    traces: planTraces(plan).map((trace) => ({
      ...trace,
      points: trace.points.map((point) => ({ x: mirrorX(point.x, width), y: point.y })),
    })),
  });
}

/** Portrait canvases drawn at 820×860 rotate once to landscape. */
export function migratePortraitCanvas(plan: FloorPlan): FloorPlan {
  if (plan.width !== 820 || plan.height !== 860) return plan;
  return rotateFloorPlanCounterClockwise(plan);
}

/** Early side-by-side sample, distinct from the later stacked plan. */
export function isLegacySideBySideLayout(plan: {
  rooms?: Array<{ id?: string; w?: number; h?: number; x?: number; y?: number }>;
}): boolean {
  // Exact side-by-side signature (landscape living room is also 230 × 280,
  // so the x positions disambiguate).
  if (isPublishedSideBySideLayout(plan)) return true;
  // Simplified stacked draft: sideways bathroom, no store cupboards yet.
  const living = plan.rooms?.find((room) => room.id === 'living');
  const bath = plan.rooms?.find((room) => room.id === 'bath');
  const store = plan.rooms?.find((room) => room.id === 'store');
  // Hand-drawn 680×400 draft: kitchen on the right, two store cupboards.
  const store1 = plan.rooms?.find((room) => room.id === 'store-1');
  if (living?.x === 410 && living?.w === 230 && living?.h === 280 && store1 != null) {
    return true;
  }
  return (
    living?.w === 280 &&
    living?.h === 230 &&
    bath?.w === 120 &&
    bath?.h === 80 &&
    store === undefined
  );
}

/** @deprecated Use isLegacySideBySideLayout. */
export function isPublishedSideBySideLayout(plan: {
  rooms?: Array<{ id?: string; x?: number; w?: number; h?: number }>;
}): boolean {
  const living = plan.rooms?.find((room) => room.id === 'living');
  const bed1 = plan.rooms?.find((room) => room.id === 'bed-1');
  return living?.x === 40 && living?.w === 230 && bed1?.x === 420 && bed1?.w === 180;
}

/** Portrait stacked sample (400 × 700): rotate it to the landscape drawing. */
export function isPortraitStackedPlan(plan: {
  width?: number;
  height?: number;
  rooms?: Array<{ id?: string }>;
}): boolean {
  if (plan.width !== 400 || plan.height !== 700) return false;
  const ids = new Set(plan.rooms?.map((room) => room.id));
  return ids.has('living') && ids.has('hall') && ids.has('bed-1');
}

export function migratePortraitStackedPlan(plan: FloorPlan): FloorPlan {
  if (isPortraitStackedPlan(plan)) {
    const rotated = rotateFloorPlanCounterClockwise(plan);
    return {
      ...rotated,
      rooms: rotated.rooms.map((room) =>
        room.id === 'bath' ? { ...room, labelAngle: undefined } : room
      ),
    };
  }
  return plan;
}

export function snapPenPoint(
  point: FloorPlanPoint,
  from?: FloorPlanPoint | null,
  options?: { forceStraight?: boolean; guides?: FloorPlanPoint[] }
): FloorPlanPoint {
  let next = { x: snapToGrid(point.x), y: snapToGrid(point.y) };
  const guides = options?.guides ?? [];
  let bestX = STRAIGHT_LINE_SNAP + 1;
  let bestY = STRAIGHT_LINE_SNAP + 1;
  let snappedX = next.x;
  let snappedY = next.y;
  for (const guide of guides) {
    const dx = Math.abs(guide.x - next.x);
    const dy = Math.abs(guide.y - next.y);
    if (dx < bestX) {
      bestX = dx;
      snappedX = guide.x;
    }
    if (dy < bestY) {
      bestY = dy;
      snappedY = guide.y;
    }
  }
  if (bestX <= STRAIGHT_LINE_SNAP) next = { ...next, x: snapToGrid(snappedX) };
  if (bestY <= STRAIGHT_LINE_SNAP) next = { ...next, y: snapToGrid(snappedY) };
  if (!from) return next;

  const dx = Math.abs(next.x - from.x);
  const dy = Math.abs(next.y - from.y);
  if (options?.forceStraight) {
    return dx >= dy ? { x: next.x, y: from.y } : { x: from.x, y: next.y };
  }
  if (dx <= STRAIGHT_LINE_SNAP && dx < dy) return { x: from.x, y: next.y };
  if (dy <= STRAIGHT_LINE_SNAP && dy < dx) return { x: next.x, y: from.y };
  return next;
}

export function planGuidePoints(plan: FloorPlan): FloorPlanPoint[] {
  const points: FloorPlanPoint[] = [];
  for (const room of plan.rooms) {
    points.push(...roomPolygon(room));
  }
  for (const trace of planTraces(plan)) {
    points.push(...trace.points);
  }
  return points;
}

export function polygonPointsAttr(points: FloorPlanPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

export function boundsFromPoints(points: FloorPlanPoint[]): DraftRoom {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function roomEdges(room: FloorPlanRoom): RoomEdge[] {
  const points = roomPolygon(room);
  if (points.length < 3) {
    return [
      { roomId: room.id, wall: 'n', x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y },
      {
        roomId: room.id,
        wall: 'e',
        x1: room.x + room.w,
        y1: room.y,
        x2: room.x + room.w,
        y2: room.y + room.h,
      },
      {
        roomId: room.id,
        wall: 's',
        x1: room.x,
        y1: room.y + room.h,
        x2: room.x + room.w,
        y2: room.y + room.h,
      },
      { roomId: room.id, wall: 'w', x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.h },
    ];
  }

  const center = roomCentroid(room);
  const edges: RoomEdge[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!start || !end) continue;
    edges.push({
      roomId: room.id,
      wall: classifyEdge(start, end, center),
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
    });
  }
  return edges;
}

export function rebuildPlanWalls(plan: FloorPlan): FloorPlan {
  return { ...plan, walls: wallsFromRooms(plan.rooms, [...plan.doors, ...plan.windows]) };
}

export function wallsFromRooms(rooms: FloorPlanRoom[], openings: Opening[]): FloorPlanWall[] {
  const walls: FloorPlanWall[] = [];
  const seen = new Set<string>();

  for (const room of rooms) {
    for (const edge of roomEdges(room)) {
      for (const segment of splitEdgeByOpenings(edge, openings)) {
        const key = wallKey(segment);
        if (seen.has(key)) continue;
        seen.add(key);
        walls.push(segment);
      }
    }
  }

  return walls;
}

function wallKey(wall: FloorPlanWall): string {
  const left = wall.x1 < wall.x2 || (wall.x1 === wall.x2 && wall.y1 <= wall.y2);
  const a = left ? `${wall.x1},${wall.y1}` : `${wall.x2},${wall.y2}`;
  const b = left ? `${wall.x2},${wall.y2}` : `${wall.x1},${wall.y1}`;
  return `${a}>${b}`;
}

function openingSegment(opening: Opening): { x1: number; y1: number; x2: number; y2: number } {
  if (opening.wall === 'n' || opening.wall === 's') {
    return { x1: opening.x, y1: opening.y, x2: opening.x + opening.length, y2: opening.y };
  }
  return { x1: opening.x, y1: opening.y, x2: opening.x, y2: opening.y + opening.length };
}

function splitEdgeByOpenings(edge: RoomEdge, openings: Opening[]): FloorPlanWall[] {
  const horizontal = edge.wall === 'n' || edge.wall === 's';
  const start = horizontal ? Math.min(edge.x1, edge.x2) : Math.min(edge.y1, edge.y2);
  const end = horizontal ? Math.max(edge.x1, edge.x2) : Math.max(edge.y1, edge.y2);
  const axis = horizontal ? edge.y1 : edge.x1;

  const cuts = openings
    .map((opening) => openingSegment(opening))
    .filter((segment) => {
      if (horizontal) {
        return nearly(segment.y1, axis) && nearly(segment.y2, axis);
      }
      return nearly(segment.x1, axis) && nearly(segment.x2, axis);
    })
    .map((segment) => ({
      a: horizontal ? Math.min(segment.x1, segment.x2) : Math.min(segment.y1, segment.y2),
      b: horizontal ? Math.max(segment.x1, segment.x2) : Math.max(segment.y1, segment.y2),
    }))
    .filter((cut) => cut.b > start && cut.a < end)
    .sort((left, right) => left.a - right.a);

  const merged: { a: number; b: number }[] = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (last && cut.a <= last.b + 1) {
      last.b = Math.max(last.b, cut.b);
    } else {
      merged.push({ ...cut });
    }
  }

  const segments: FloorPlanWall[] = [];
  let cursor = start;
  for (const cut of merged) {
    const gapStart = Math.max(start, cut.a);
    if (gapStart > cursor + 1) {
      segments.push(edgeSegment(horizontal, axis, cursor, gapStart));
    }
    cursor = Math.max(cursor, Math.min(end, cut.b));
  }
  if (end > cursor + 1) {
    segments.push(edgeSegment(horizontal, axis, cursor, end));
  }
  return segments;
}

function edgeSegment(horizontal: boolean, axis: number, from: number, to: number): FloorPlanWall {
  if (horizontal) {
    return { x1: from, y1: axis, x2: to, y2: axis };
  }
  return { x1: axis, y1: from, x2: axis, y2: to };
}

function nearly(a: number, b: number, tolerance = 2): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function nearestRoomEdge(
  rooms: FloorPlanRoom[],
  x: number,
  y: number,
  maxDistance = EDGE_HIT_DISTANCE
): { edge: RoomEdge; distance: number; along: number } | null {
  let best: { edge: RoomEdge; distance: number; along: number } | null = null;

  for (const room of rooms) {
    for (const edge of roomEdges(room)) {
      const hit = projectOnEdge(edge, x, y);
      if (hit.distance > maxDistance) continue;
      if (!best || hit.distance < best.distance) {
        best = { edge, distance: hit.distance, along: hit.along };
      }
    }
  }

  return best;
}

function projectOnEdge(edge: RoomEdge, x: number, y: number): { distance: number; along: number } {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const length = dx * dx + dy * dy;
  if (length === 0) {
    return { distance: Math.hypot(x - edge.x1, y - edge.y1), along: edge.x1 };
  }
  const t = clamp(((x - edge.x1) * dx + (y - edge.y1) * dy) / length, 0, 1);
  const px = edge.x1 + t * dx;
  const py = edge.y1 + t * dy;
  const along = edge.wall === 'n' || edge.wall === 's' ? px : py;
  return { distance: Math.hypot(px - x, py - y), along };
}

function classifyEdge(
  start: FloorPlanPoint,
  end: FloorPlanPoint,
  center: FloorPlanPoint
): WallSide {
  if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
    return center.y > (start.y + end.y) / 2 ? 'n' : 's';
  }
  return center.x > (start.x + end.x) / 2 ? 'w' : 'e';
}

export function openingOnEdge(
  edge: RoomEdge,
  along: number,
  length: number
): { x: number; y: number; wall: WallSide; length: number } | null {
  const horizontal = edge.wall === 'n' || edge.wall === 's';
  const start = horizontal ? Math.min(edge.x1, edge.x2) : Math.min(edge.y1, edge.y2);
  const end = horizontal ? Math.max(edge.x1, edge.x2) : Math.max(edge.y1, edge.y2);
  const fit = Math.min(length, Math.max(0, end - start - FLOOR_PLAN_GRID));
  if (fit < FLOOR_PLAN_GRID) return null;

  const origin = clamp(along - fit / 2, start, end - fit);
  if (horizontal) {
    return { x: origin, y: edge.y1, wall: edge.wall, length: fit };
  }
  return { x: edge.x1, y: origin, wall: edge.wall, length: fit };
}

export function addRoom(plan: FloorPlan, draft: DraftRoom, name?: string): FloorPlan {
  const rect = snappedRoomRect(draft, plan);
  if (!rect) return plan;

  const rooms = [
    ...plan.rooms,
    {
      id: createPlanItemId('room'),
      name: name ?? nextRoomName(plan.rooms),
      ...rect,
    },
  ];

  return rebuildPlanWalls({ ...plan, rooms, ...countBedsBaths(rooms) });
}

export function addRoomFromPoints(
  plan: FloorPlan,
  points: FloorPlanPoint[],
  name?: string
): FloorPlan {
  if (points.length < 3) return plan;
  const bounds = boundsFromPoints(points);
  if (bounds.w < FLOOR_PLAN_GRID || bounds.h < FLOOR_PLAN_GRID) return plan;
  const rooms = [
    ...plan.rooms,
    {
      id: createPlanItemId('room'),
      name: name ?? nextRoomName(plan.rooms),
      ...bounds,
      points,
    },
  ];
  return rebuildPlanWalls({ ...plan, rooms, ...countBedsBaths(rooms) });
}

export function addTracePoint(
  plan: FloorPlan,
  traceId: string | null,
  x: number,
  y: number,
  options?: { forceStraight?: boolean }
): { plan: FloorPlan; traceId: string; closed: boolean; roomId?: string } {
  const traces = planTraces(plan);
  const current = traceId ? traces.find((trace) => trace.id === traceId) : undefined;
  const last = current?.points[current.points.length - 1];
  const raw = {
    x: clamp(x, 20, plan.width - 20),
    y: clamp(y, 20, plan.height - 20),
  };
  if (current && current.points.length >= 3) {
    const first = current.points[0];
    if (first && Math.hypot(first.x - raw.x, first.y - raw.y) <= 16) {
      const closed = closeTrace(plan, current.id);
      const created =
        closed.rooms.length > plan.rooms.length ? closed.rooms[closed.rooms.length - 1] : undefined;
      return { plan: closed, traceId: current.id, closed: !!created, roomId: created?.id };
    }
  }
  const point = snapPenPoint(raw, last, {
    forceStraight: options?.forceStraight,
    guides: planGuidePoints(plan),
  });

  if (!current) {
    const id = createPlanItemId('trace');
    return {
      plan: { ...plan, traces: [...traces, { id, points: [point] }] },
      traceId: id,
      closed: false,
    };
  }

  if (last && last.x === point.x && last.y === point.y) {
    return { plan, traceId: current.id, closed: false };
  }

  return {
    plan: {
      ...plan,
      traces: traces.map((trace) =>
        trace.id === current.id ? { ...trace, points: [...trace.points, point] } : trace
      ),
    },
    traceId: current.id,
    closed: false,
  };
}

export function closeTrace(plan: FloorPlan, traceId: string): FloorPlan {
  const current = planTraces(plan).find((trace) => trace.id === traceId);
  if (!current || current.points.length < 3) return plan;
  return addRoomFromPoints(
    { ...plan, traces: planTraces(plan).filter((trace) => trace.id !== traceId) },
    current.points
  );
}

export function canCloseTrace(plan: FloorPlan, traceId: string | null): boolean {
  if (!traceId) return false;
  const current = planTraces(plan).find((trace) => trace.id === traceId);
  return !!current && current.points.length >= 3;
}

export function addOpening(
  plan: FloorPlan,
  kind: 'door' | 'window',
  x: number,
  y: number
): FloorPlan {
  const hit = nearestRoomEdge(plan.rooms, x, y);
  if (!hit) return plan;

  const length = kind === 'door' ? DEFAULT_DOOR_LENGTH : DEFAULT_WINDOW_LENGTH;
  const placed = openingOnEdge(hit.edge, hit.along, length);
  if (!placed) return plan;

  const id = createPlanItemId(kind);
  if (kind === 'door') {
    const doors = [
      ...plan.doors,
      {
        id,
        name: nextOpeningName(plan.doors, 'Door'),
        ...placed,
        hinge: 'start' as const,
        swing: 'in' as const,
        exterior: isExteriorEdge(plan.rooms, hit.edge),
      },
    ];
    return rebuildPlanWalls({ ...plan, doors });
  }

  const windows = [
    ...plan.windows,
    { id, name: nextOpeningName(plan.windows, 'Window'), ...placed },
  ];
  return rebuildPlanWalls({ ...plan, windows });
}

export function planRoomAt(plan: FloorPlan, x: number, y: number): FloorPlanRoom | null {
  const rooms = plan.rooms
    .filter((room) => pointInRoom(x, y, room))
    .sort((left, right) => left.w * left.h - right.w * right.h);
  return rooms[0] ?? null;
}

export function addSensor(
  plan: FloorPlan,
  kind: FloorPlanSensorKind,
  x: number,
  y: number,
  label?: string
): FloorPlan {
  const point = snappedSensorPoint(plan, x, y);
  if (!point) return plan;
  const sensors = [
    ...plan.sensors,
    {
      id: createPlanItemId('sensor'),
      kind,
      label: label ?? nextSensorLabel(plan.sensors, kind),
      x: point.x,
      y: point.y,
    },
  ];
  return { ...plan, sensors };
}

export function planSensorScale(plan: Pick<FloorPlan, 'sensorScale'>): number {
  const raw = plan.sensorScale;
  if (typeof raw !== 'number' || Number.isNaN(raw)) return DEFAULT_SENSOR_SCALE;
  return clamp(
    Math.round(raw / SENSOR_SCALE_STEP) * SENSOR_SCALE_STEP,
    MIN_SENSOR_SCALE,
    MAX_SENSOR_SCALE
  );
}

export function setSensorScale(plan: FloorPlan, scale: number): FloorPlan {
  const next = planSensorScale({ sensorScale: scale });
  if (planSensorScale(plan) === next && plan.sensorScale === next) return plan;
  return { ...plan, sensorScale: next };
}

export function sensorMarkSize(plan: Pick<FloorPlan, 'sensorScale'>, base = 22): number {
  return Math.max(8, Math.round((base * planSensorScale(plan)) / 100));
}

export function sensorHitReach(
  plan: Pick<FloorPlan, 'sensorScale'>,
  kind: FloorPlanSensorKind
): number {
  const base = isClimateSensorKind(kind) ? 24 : 16;
  return Math.max(10, Math.round((base * planSensorScale(plan)) / 100));
}

export function planShowsSensorLabels(plan: Pick<FloorPlan, 'showSensorLabels'>): boolean {
  return plan.showSensorLabels !== false;
}

export function setShowSensorLabels(plan: FloorPlan, show: boolean): FloorPlan {
  if (planShowsSensorLabels(plan) === show && plan.showSensorLabels === show) return plan;
  return { ...plan, showSensorLabels: show };
}

export function moveSensor(plan: FloorPlan, sensorId: string, x: number, y: number): FloorPlan {
  const current = plan.sensors.find((sensor) => sensor.id === sensorId);
  if (!current) return plan;
  const point = snappedSensorPoint(plan, x, y) ?? { x: current.x, y: current.y };
  if (point.x === current.x && point.y === current.y) return plan;
  return {
    ...plan,
    sensors: plan.sensors.map((sensor) =>
      sensor.id === sensorId ? { ...sensor, ...point } : sensor
    ),
  };
}

export function setSensorDeviceId(plan: FloorPlan, sensorId: string, deviceId: string): FloorPlan {
  return {
    ...plan,
    sensors: plan.sensors.map((sensor) =>
      sensor.id === sensorId ? { ...sensor, deviceId } : sensor
    ),
  };
}

export function moveRoom(plan: FloorPlan, roomId: string, dx: number, dy: number): FloorPlan {
  return moveRooms(plan, [roomId], dx, dy);
}

export function moveRooms(plan: FloorPlan, roomIds: string[], dx: number, dy: number): FloorPlan {
  const unique = [...new Set(roomIds)];
  const moving = plan.rooms.filter((room) => unique.includes(room.id));
  if (moving.length === 0) return plan;

  let shiftX = dx;
  let shiftY = dy;
  for (const room of moving) {
    shiftX = clamp(room.x + shiftX, 20, plan.width - room.w - 20) - room.x;
    shiftY = clamp(room.y + shiftY, 20, plan.height - room.h - 20) - room.y;
  }
  shiftX = snapToGrid(shiftX);
  shiftY = snapToGrid(shiftY);
  if (shiftX === 0 && shiftY === 0) return plan;

  const movingIds = new Set(moving.map((room) => room.id));
  const rooms = plan.rooms.map((room) =>
    movingIds.has(room.id)
      ? {
          ...room,
          x: room.x + shiftX,
          y: room.y + shiftY,
          points: room.points?.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY })),
          label: room.label ? { x: room.label.x + shiftX, y: room.label.y + shiftY } : room.label,
        }
      : room
  );
  const doors = plan.doors.map((door) =>
    moving.some((room) => openingOnRoom(door, room))
      ? { ...door, x: door.x + shiftX, y: door.y + shiftY }
      : door
  );
  const windows = plan.windows.map((window) =>
    moving.some((room) => openingOnRoom(window, room))
      ? { ...window, x: window.x + shiftX, y: window.y + shiftY }
      : window
  );
  const sensors = plan.sensors.map((sensor) =>
    moving.some((room) => pointInRoom(sensor.x, sensor.y, room))
      ? { ...sensor, x: sensor.x + shiftX, y: sensor.y + shiftY }
      : sensor
  );

  return rebuildPlanWalls({ ...plan, rooms, doors, windows, sensors });
}

export function resizeRoom(plan: FloorPlan, roomId: string, nextRect: DraftRoom): FloorPlan {
  const room = plan.rooms.find((item) => item.id === roomId);
  if (!room) return plan;

  const rect = snappedRoomRect(nextRect, plan);
  if (!rect) return plan;

  const resized = {
    ...room,
    ...rect,
    points: room.points?.length ? scalePolygon(room.points, room, rect) : room.points,
    label: room.label ? scalePolygon([room.label], room, rect)[0] : room.label,
  };
  const rooms = plan.rooms.map((item) => (item.id === roomId ? resized : item));
  return rebuildPlanWalls({
    ...plan,
    rooms,
    doors: remapOpenings(plan.doors, room, resized),
    windows: remapOpenings(plan.windows, room, resized),
    sensors: plan.sensors.map((sensor) => {
      if (!pointInRoom(sensor.x, sensor.y, room)) return sensor;
      const next = scalePolygon([{ x: sensor.x, y: sensor.y }], room, rect)[0];
      return next ? { ...sensor, x: next.x, y: next.y } : sensor;
    }),
    ...countBedsBaths(rooms),
  });
}

export function deletePlanItems(plan: FloorPlan, selections: FloorPlanSelection[]): FloorPlan {
  let next = plan;
  for (const selection of selections.filter((item) => item.kind === 'room')) {
    next = deletePlanItem(next, selection);
  }
  for (const selection of selections.filter((item) => item.kind !== 'room')) {
    next = deletePlanItem(next, selection);
  }
  return next;
}

export function deletePlanItem(plan: FloorPlan, selection: FloorPlanSelection): FloorPlan {
  if (selection.kind === 'room') {
    const room = plan.rooms.find((item) => item.id === selection.id);
    if (!room) return plan;
    const rooms = plan.rooms.filter((item) => item.id !== selection.id);
    return rebuildPlanWalls({
      ...plan,
      rooms,
      doors: plan.doors.filter((door) => !openingOnRoom(door, room)),
      windows: plan.windows.filter((window) => !openingOnRoom(window, room)),
      sensors: plan.sensors.filter((sensor) => !pointInRoom(sensor.x, sensor.y, room)),
      ...countBedsBaths(rooms),
    });
  }
  if (selection.kind === 'trace') {
    return { ...plan, traces: planTraces(plan).filter((trace) => trace.id !== selection.id) };
  }
  if (selection.kind === 'door') {
    return rebuildPlanWalls({
      ...plan,
      doors: plan.doors.filter((door) => door.id !== selection.id),
    });
  }
  if (selection.kind === 'sensor') {
    return { ...plan, sensors: plan.sensors.filter((sensor) => sensor.id !== selection.id) };
  }
  return rebuildPlanWalls({
    ...plan,
    windows: plan.windows.filter((window) => window.id !== selection.id),
  });
}

export function renamePlanItem(
  plan: FloorPlan,
  selection: FloorPlanSelection,
  name: string
): FloorPlan {
  if (selection.kind === 'trace') return plan;
  if (selection.kind === 'sensor') {
    return {
      ...plan,
      sensors: plan.sensors.map((sensor) =>
        sensor.id === selection.id ? { ...sensor, label: name.trim() } : sensor
      ),
    };
  }
  const trimmed =
    name.trim() ||
    (selection.kind === 'room' ? 'Room' : selection.kind === 'door' ? 'Door' : 'Window');
  if (selection.kind === 'room') {
    const rooms = plan.rooms.map((room) =>
      room.id === selection.id ? { ...room, name: trimmed } : room
    );
    return { ...plan, rooms, ...countBedsBaths(rooms) };
  }
  if (selection.kind === 'door') {
    return {
      ...plan,
      doors: plan.doors.map((door) =>
        door.id === selection.id ? { ...door, name: trimmed } : door
      ),
    };
  }
  return {
    ...plan,
    windows: plan.windows.map((window) =>
      window.id === selection.id ? { ...window, name: trimmed } : window
    ),
  };
}

export function doorHingeOf(door: FloorPlanDoor): DoorHinge {
  return door.hinge === 'end' ? 'end' : 'start';
}

export function doorSwingOf(door: FloorPlanDoor): DoorSwing {
  return door.swing === 'out' ? 'out' : 'in';
}

export function flipDoor(plan: FloorPlan, doorId: string): FloorPlan {
  return {
    ...plan,
    doors: plan.doors.map((door) => {
      if (door.id !== doorId) return door;
      const hinge = doorHingeOf(door);
      const swing = doorSwingOf(door);
      if (hinge === 'start' && swing === 'in') return { ...door, hinge: 'end', swing: 'in' };
      if (hinge === 'end' && swing === 'in') return { ...door, hinge: 'start', swing: 'out' };
      if (hinge === 'start' && swing === 'out') return { ...door, hinge: 'end', swing: 'out' };
      return { ...door, hinge: 'start', swing: 'in' };
    }),
  };
}

export function flipDoors(plan: FloorPlan, doorIds: string[]): FloorPlan {
  return doorIds.reduce((next, id) => flipDoor(next, id), plan);
}

export interface DoorGeometry {
  hinge: { x: number; y: number };
  leaf: { x1: number; y1: number; x2: number; y2: number };
  closed: { x: number; y: number };
  swing: string;
}

export function doorGeometry(door: FloorPlanDoor): DoorGeometry {
  const len = door.length;
  const along = wallAlong(door.wall);
  const inward = wallInward(door.wall);
  const normal = doorSwingOf(door) === 'out' ? { x: -inward.x, y: -inward.y } : inward;
  const start = { x: door.x, y: door.y };
  const end = { x: door.x + along.x * len, y: door.y + along.y * len };
  const hinge = doorHingeOf(door) === 'end' ? end : start;
  const closed = doorHingeOf(door) === 'end' ? start : end;
  const tip = { x: hinge.x + normal.x * len, y: hinge.y + normal.y * len };
  const cross = (closed.x - hinge.x) * (tip.y - hinge.y) - (closed.y - hinge.y) * (tip.x - hinge.x);
  const sweep = cross > 0 ? 1 : 0;

  return {
    hinge,
    leaf: { x1: hinge.x, y1: hinge.y, x2: tip.x, y2: tip.y },
    closed,
    swing: `M ${closed.x} ${closed.y} A ${len} ${len} 0 0 ${sweep} ${tip.x} ${tip.y}`,
  };
}

export function windowLines(
  window: FloorPlanWindow
): { x1: number; y1: number; x2: number; y2: number }[] {
  const gap = 3;
  const along = wallAlong(window.wall);
  const normal = wallInward(window.wall);
  const start = { x: window.x, y: window.y };
  const end = { x: window.x + along.x * window.length, y: window.y + along.y * window.length };
  return [
    {
      x1: start.x + normal.x * gap,
      y1: start.y + normal.y * gap,
      x2: end.x + normal.x * gap,
      y2: end.y + normal.y * gap,
    },
    {
      x1: start.x - normal.x * gap,
      y1: start.y - normal.y * gap,
      x2: end.x - normal.x * gap,
      y2: end.y - normal.y * gap,
    },
  ];
}

export function hitTestPlan(
  plan: FloorPlan,
  x: number,
  y: number,
  selected?: FloorPlanSelection | FloorPlanSelection[] | null
): FloorPlanHit | null {
  const items = normalizeSelections(selected);
  const windowSel = items.filter((item) => item.kind === 'window');
  if (windowSel.length === 1) {
    const window = plan.windows.find((item) => item.id === windowSel[0]?.id);
    if (window) {
      const handles = openingHandlePoints(window);
      if (Math.hypot(handles.start.x - x, handles.start.y - y) <= 12) {
        return { kind: 'window-handle', windowId: window.id, handle: 'start' };
      }
      if (Math.hypot(handles.end.x - x, handles.end.y - y) <= 12) {
        return { kind: 'window-handle', windowId: window.id, handle: 'end' };
      }
    }
  }
  const doorSel = items.filter((item) => item.kind === 'door');
  if (doorSel.length === 1) {
    const door = plan.doors.find((item) => item.id === doorSel[0]?.id);
    if (door) {
      const handles = openingHandlePoints(door);
      if (Math.hypot(handles.start.x - x, handles.start.y - y) <= 12) {
        return { kind: 'door-handle', doorId: door.id, handle: 'start' };
      }
      if (Math.hypot(handles.end.x - x, handles.end.y - y) <= 12) {
        return { kind: 'door-handle', doorId: door.id, handle: 'end' };
      }
    }
  }
  const roomSel = items.filter((item) => item.kind === 'room');
  if (roomSel.length === 1) {
    const room = plan.rooms.find((item) => item.id === roomSel[0]?.id);
    if (room) {
      const handle = hitResizeHandle(room, x, y);
      if (handle) return { kind: 'handle', roomId: room.id, handle };
    }
  }

  for (const sensor of [...plan.sensors].reverse()) {
    if (Math.hypot(sensor.x - x, sensor.y - y) <= sensorHitReach(plan, sensor.kind)) {
      return { kind: 'sensor', id: sensor.id };
    }
  }

  for (const room of [...plan.rooms].reverse()) {
    if (hitRoomLabel(room, x, y)) return { kind: 'room-label', roomId: room.id };
  }

  for (const door of [...plan.doors].reverse()) {
    if (distanceToDoor(door, x, y) <= 14) return { kind: 'door', id: door.id };
  }
  for (const window of [...plan.windows].reverse()) {
    if (distanceToOpening(window, x, y) <= 14) return { kind: 'window', id: window.id };
  }
  for (const trace of [...planTraces(plan)].reverse()) {
    if (distanceToTrace(trace, x, y) <= 12) return { kind: 'trace', id: trace.id };
  }

  const rooms = plan.rooms
    .filter((room) => pointInRoom(x, y, room))
    .sort((left, right) => left.w * left.h - right.w * right.h);
  const room = rooms[0];
  return room ? { kind: 'room', id: room.id } : null;
}

export function selectionsInRect(plan: FloorPlan, rect: DraftRoom): FloorPlanSelection[] {
  const area = normalizeRect(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  if (area.w < 8 || area.h < 8) return [];

  const hits: FloorPlanSelection[] = [];
  for (const room of plan.rooms) {
    if (rectsOverlap(area, room)) hits.push({ kind: 'room', id: room.id });
  }
  for (const door of plan.doors) {
    if (openingHitsRect(door, area)) hits.push({ kind: 'door', id: door.id });
  }
  for (const window of plan.windows) {
    if (openingHitsRect(window, area)) hits.push({ kind: 'window', id: window.id });
  }
  for (const trace of planTraces(plan)) {
    if (trace.points.some((point) => pointInRect(point.x, point.y, area))) {
      hits.push({ kind: 'trace', id: trace.id });
    }
  }
  for (const sensor of plan.sensors) {
    if (pointInRect(sensor.x, sensor.y, area)) hits.push({ kind: 'sensor', id: sensor.id });
  }
  return hits;
}

export function normalizeSelections(
  selected?: FloorPlanSelection | FloorPlanSelection[] | null
): FloorPlanSelection[] {
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export function resizeRectFromHandle(
  room: FloorPlanRoom,
  handle: ResizeHandle,
  x: number,
  y: number
): DraftRoom {
  const right = room.x + room.w;
  const bottom = room.y + room.h;
  if (handle === 'nw') return normalizeRect(x, y, right, bottom);
  if (handle === 'ne') return normalizeRect(room.x, y, x, bottom);
  if (handle === 'sw') return normalizeRect(x, room.y, right, y);
  return normalizeRect(room.x, room.y, x, y);
}

export function handlePoints(room: FloorPlanRoom): Record<ResizeHandle, { x: number; y: number }> {
  return {
    nw: { x: room.x, y: room.y },
    ne: { x: room.x + room.w, y: room.y },
    sw: { x: room.x, y: room.y + room.h },
    se: { x: room.x + room.w, y: room.y + room.h },
  };
}

export function parseFloorPlan(value: unknown): FloorPlan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<FloorPlan>;
  if (typeof raw.width !== 'number' || typeof raw.height !== 'number') return null;
  if (!Array.isArray(raw.rooms) || !Array.isArray(raw.doors) || !Array.isArray(raw.windows)) {
    return null;
  }

  const rooms = raw.rooms.filter(isRoom).map(stripLegacyRoomIcon);
  if (rooms.length !== raw.rooms.length) return null;

  return migratePortraitStackedPlan(
    migratePortraitCanvas(
      normalizeFloorPlan({
        id: typeof raw.id === 'string' ? raw.id : 'user-plan',
        name: typeof raw.name === 'string' ? raw.name : 'My plan',
        beds: typeof raw.beds === 'number' ? raw.beds : 0,
        baths: typeof raw.baths === 'number' ? raw.baths : 0,
        width: raw.width,
        height: raw.height,
        rooms,
        walls: Array.isArray(raw.walls) ? raw.walls.filter(isWall) : [],
        doors: raw.doors.filter(isDoor),
        windows: raw.windows.filter(isWindow),
        sensors: Array.isArray(raw.sensors) ? raw.sensors.filter(isSensor) : [],
        traces: Array.isArray(raw.traces) ? raw.traces.filter(isTrace) : [],
        sensorScale:
          typeof raw.sensorScale === 'number'
            ? planSensorScale({ sensorScale: raw.sensorScale })
            : undefined,
        showSensorLabels:
          typeof raw.showSensorLabels === 'boolean' ? raw.showSensorLabels : undefined,
        updatedAt:
          typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
            ? raw.updatedAt
            : undefined,
      })
    )
  );
}

export function stampFloorPlan(plan: FloorPlan, at = new Date().toISOString()): FloorPlan {
  return { ...plan, updatedAt: at };
}

export function floorPlanUpdatedAt(plan: FloorPlan | null | undefined): number {
  if (!plan?.updatedAt) return 0;
  const time = Date.parse(plan.updatedAt);
  return Number.isFinite(time) ? time : 0;
}

export function pickNewerFloorPlan(
  local: FloorPlan | null,
  remote: FloorPlan | null
): FloorPlan | null {
  const localOk = local?.rooms.length ? local : null;
  const remoteOk = remote?.rooms.length ? remote : null;
  if (!localOk) return remoteOk;
  if (!remoteOk) return localOk;
  const localAt = floorPlanUpdatedAt(localOk);
  const remoteAt = floorPlanUpdatedAt(remoteOk);
  if (localAt === 0 && remoteAt === 0) return localOk;
  return remoteAt > localAt ? remoteOk : localOk;
}

export function openingHandlePoints(opening: Opening): Record<OpeningHandle, FloorPlanPoint> {
  const segment = openingSegment(opening);
  return {
    start: { x: segment.x1, y: segment.y1 },
    end: { x: segment.x2, y: segment.y2 },
  };
}

export function windowHandlePoints(window: FloorPlanWindow): Record<OpeningHandle, FloorPlanPoint> {
  return openingHandlePoints(window);
}

function resizeOpening<T extends Opening & { id: string }>(
  current: T,
  handle: OpeningHandle,
  x: number,
  y: number,
  rooms: FloorPlanRoom[],
  minLength: number
): T {
  const horizontal = current.wall === 'n' || current.wall === 's';
  const along = snapToGrid(horizontal ? x : y);
  let start = horizontal ? current.x : current.y;
  let end = start + current.length;
  if (handle === 'start') start = along;
  else end = along;
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }

  const host = rooms.find((room) => openingOnRoom(current, room));
  const edge = host
    ? roomEdges(host).find((item) => item.wall === current.wall && openingLiesOnEdge(current, item))
    : undefined;
  if (edge) {
    const lo = horizontal ? Math.min(edge.x1, edge.x2) : Math.min(edge.y1, edge.y2);
    const hi = horizontal ? Math.max(edge.x1, edge.x2) : Math.max(edge.y1, edge.y2);
    start = clamp(start, lo, hi - minLength);
    end = clamp(end, start + minLength, hi);
  } else if (end - start < minLength) {
    end = start + minLength;
  }

  return horizontal
    ? { ...current, x: start, length: end - start }
    : { ...current, y: start, length: end - start };
}

export function resizeWindow(
  plan: FloorPlan,
  windowId: string,
  handle: OpeningHandle,
  x: number,
  y: number
): FloorPlan {
  const current = plan.windows.find((window) => window.id === windowId);
  if (!current) return plan;
  const next = resizeOpening(current, handle, x, y, plan.rooms, DEFAULT_WINDOW_LENGTH);
  if (next.x === current.x && next.y === current.y && next.length === current.length) return plan;
  return rebuildPlanWalls({
    ...plan,
    windows: plan.windows.map((window) => (window.id === windowId ? next : window)),
  });
}

export function resizeDoor(
  plan: FloorPlan,
  doorId: string,
  handle: OpeningHandle,
  x: number,
  y: number
): FloorPlan {
  const current = plan.doors.find((door) => door.id === doorId);
  if (!current) return plan;
  const next = resizeOpening(current, handle, x, y, plan.rooms, DEFAULT_DOOR_LENGTH);
  if (next.x === current.x && next.y === current.y && next.length === current.length) return plan;
  return rebuildPlanWalls({
    ...plan,
    doors: plan.doors.map((door) => (door.id === doorId ? next : door)),
  });
}

export function normalizeFloorPlan(plan: FloorPlan): FloorPlan {
  return rebuildPlanWalls({ ...plan, ...countBedsBaths(plan.rooms) });
}

function snappedRoomRect(draft: DraftRoom, plan: FloorPlan): DraftRoom | null {
  const x = snapToGrid(clamp(draft.x, 20, plan.width - 40));
  const y = snapToGrid(clamp(draft.y, 20, plan.height - 40));
  const w = snapToGrid(Math.min(draft.w, plan.width - x - 20));
  const h = snapToGrid(Math.min(draft.h, plan.height - y - 20));
  if (w < MIN_ROOM_SIZE || h < MIN_ROOM_SIZE) return null;
  return { x, y, w, h };
}

function nextRoomName(rooms: FloorPlanRoom[]): string {
  return `Room ${rooms.length + 1}`;
}

function nextSensorLabel(sensors: FloorPlanSensor[], kind: FloorPlanSensorKind): string {
  const base = FLOOR_PLAN_SENSOR_META[kind].label;
  const count = sensors.filter((sensor) => sensor.kind === kind).length + 1;
  return `${base} ${count}`;
}

function snappedSensorPoint(plan: FloorPlan, x: number, y: number): FloorPlanPoint | null {
  if (plan.rooms.length === 0) return null;
  const raw = {
    x: snapToGrid(clamp(x, 20, plan.width - 20)),
    y: snapToGrid(clamp(y, 20, plan.height - 20)),
  };
  const host = planRoomAt(plan, raw.x, raw.y) ?? nearestRoom(plan.rooms, raw.x, raw.y);
  if (!host) return null;
  return clampPointInRoom(host, raw.x, raw.y);
}

function nearestRoom(rooms: FloorPlanRoom[], x: number, y: number): FloorPlanRoom | null {
  let best: FloorPlanRoom | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const room of rooms) {
    const center = roomCentroid(room);
    const next = Math.hypot(center.x - x, center.y - y);
    if (next < distance) {
      best = room;
      distance = next;
    }
  }
  return best;
}

function nextOpeningName(items: { name: string }[], label: string): string {
  return `${label} ${items.length + 1}`;
}

function countBedsBaths(rooms: FloorPlanRoom[]): { beds: number; baths: number } {
  return {
    beds: rooms.filter((room) => /bed/i.test(room.name)).length,
    baths: rooms.filter((room) => /bath/i.test(room.name)).length,
  };
}

function isExteriorEdge(rooms: FloorPlanRoom[], edge: RoomEdge): boolean {
  return !rooms.some((room) => {
    if (room.id === edge.roomId) return false;
    return roomEdges(room).some(
      (other) =>
        other.wall !== edge.wall &&
        nearly(other.x1, edge.x1) &&
        nearly(other.y1, edge.y1) &&
        nearly(other.x2, edge.x2) &&
        nearly(other.y2, edge.y2)
    );
  });
}

function openingOnRoom(opening: Opening, room: FloorPlanRoom): boolean {
  return roomEdges(room).some((edge) => openingLiesOnEdge(opening, edge));
}

function openingLiesOnEdge(opening: Opening, edge: RoomEdge): boolean {
  const segment = openingSegment(opening);
  if (edge.wall === 'n' || edge.wall === 's') {
    return (
      nearly(segment.y1, edge.y1) &&
      segment.x1 >= Math.min(edge.x1, edge.x2) - 2 &&
      segment.x2 <= Math.max(edge.x1, edge.x2) + 2
    );
  }
  return (
    nearly(segment.x1, edge.x1) &&
    segment.y1 >= Math.min(edge.y1, edge.y2) - 2 &&
    segment.y2 <= Math.max(edge.y1, edge.y2) + 2
  );
}

function remapOpenings<T extends Opening>(
  openings: T[],
  oldRoom: FloorPlanRoom,
  next: FloorPlanRoom
): T[] {
  return openings.flatMap((opening) => {
    if (!openingOnRoom(opening, oldRoom)) return [opening];
    const remapped = openingOnEdge(
      roomEdges(next).find((edge) => edge.wall === opening.wall) ?? roomEdges(next)[0],
      openingAlong(opening),
      opening.length
    );
    return remapped ? [{ ...opening, ...remapped }] : [];
  });
}

function openingAlong(opening: Opening): number {
  if (opening.wall === 'n' || opening.wall === 's') {
    return opening.x + opening.length / 2;
  }
  return opening.y + opening.length / 2;
}

function pointInRoom(x: number, y: number, room: FloorPlanRoom): boolean {
  const points = roomPolygon(room);
  if (points.length < 3) {
    return x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h;
  }
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1
  ) {
    const current = points[index];
    const last = points[previous];
    if (!current || !last) continue;
    const crosses =
      current.y > y !== last.y > y &&
      x < ((last.x - current.x) * (y - current.y)) / (last.y - current.y || 1) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function scalePolygon(
  points: FloorPlanPoint[],
  from: Pick<FloorPlanRoom, 'x' | 'y' | 'w' | 'h'>,
  to: Pick<FloorPlanRoom, 'x' | 'y' | 'w' | 'h'>
): FloorPlanPoint[] {
  if (from.w === 0 || from.h === 0) return points;
  return points.map((point) => ({
    x: to.x + ((point.x - from.x) / from.w) * to.w,
    y: to.y + ((point.y - from.y) / from.h) * to.h,
  }));
}

function distanceToTrace(trace: FloorPlanTrace, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const point of trace.points) {
    best = Math.min(best, Math.hypot(point.x - x, point.y - y));
  }
  for (let index = 1; index < trace.points.length; index += 1) {
    const start = trace.points[index - 1];
    const end = trace.points[index];
    if (!start || !end) continue;
    best = Math.min(
      best,
      distanceToSegment({ x1: start.x, y1: start.y, x2: end.x, y2: end.y }, x, y)
    );
  }
  return best;
}

function pointInRect(x: number, y: number, rect: DraftRoom): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function rectsOverlap(
  a: Pick<DraftRoom, 'x' | 'y' | 'w' | 'h'>,
  b: Pick<DraftRoom, 'x' | 'y' | 'w' | 'h'>
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function openingHitsRect(opening: Opening, rect: DraftRoom): boolean {
  const segment = openingSegment(opening);
  const minX = Math.min(segment.x1, segment.x2);
  const maxX = Math.max(segment.x1, segment.x2);
  const minY = Math.min(segment.y1, segment.y2);
  const maxY = Math.max(segment.y1, segment.y2);
  return minX <= rect.x + rect.w && maxX >= rect.x && minY <= rect.y + rect.h && maxY >= rect.y;
}

function distanceToOpening(opening: Opening, x: number, y: number): number {
  return distanceToSegment(openingSegment(opening), x, y);
}

function distanceToDoor(door: FloorPlanDoor, x: number, y: number): number {
  return Math.min(distanceToOpening(door, x, y), distanceToSegment(doorGeometry(door).leaf, x, y));
}

function distanceToSegment(
  segment: { x1: number; y1: number; x2: number; y2: number },
  x: number,
  y: number
): number {
  const horizontal = nearly(segment.y1, segment.y2);
  if (horizontal) {
    const along = clamp(x, Math.min(segment.x1, segment.x2), Math.max(segment.x1, segment.x2));
    return Math.hypot(along - x, segment.y1 - y);
  }
  const vertical = nearly(segment.x1, segment.x2);
  if (vertical) {
    const along = clamp(y, Math.min(segment.y1, segment.y2), Math.max(segment.y1, segment.y2));
    return Math.hypot(segment.x1 - x, along - y);
  }
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const t = clamp(((x - segment.x1) * dx + (y - segment.y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(segment.x1 + t * dx - x, segment.y1 + t * dy - y);
}

function wallAlong(wall: WallSide): { x: number; y: number } {
  return wall === 'n' || wall === 's' ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

function wallInward(wall: WallSide): { x: number; y: number } {
  if (wall === 'n') return { x: 0, y: 1 };
  if (wall === 's') return { x: 0, y: -1 };
  if (wall === 'e') return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function hitResizeHandle(room: FloorPlanRoom, x: number, y: number): ResizeHandle | null {
  const hits = handlePoints(room);
  for (const [handle, point] of Object.entries(hits) as [
    ResizeHandle,
    { x: number; y: number },
  ][]) {
    if (Math.abs(point.x - x) <= 12 && Math.abs(point.y - y) <= 12) return handle;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function moveRoomLabel(plan: FloorPlan, roomId: string, x: number, y: number): FloorPlan {
  const room = plan.rooms.find((item) => item.id === roomId);
  if (!room) return plan;
  const next = clampPointInRoom(room, snapToGrid(x), snapToGrid(y));
  if (room.label?.x === next.x && room.label?.y === next.y) return plan;
  return {
    ...plan,
    rooms: plan.rooms.map((item) => (item.id === roomId ? { ...item, label: next } : item)),
  };
}

export function hitRoomLabel(room: FloorPlanRoom, x: number, y: number): boolean {
  const box = roomLabelHitBox(room);
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function clampPointInRoom(room: FloorPlanRoom, x: number, y: number): FloorPlanPoint {
  const center = roomCentroid(room);
  const target = pointInRoom(x, y, room) ? { x, y } : closestInsidePoint(room, center, x, y);
  const pad = 12;
  const probes = [
    { x: target.x + pad, y: target.y },
    { x: target.x - pad, y: target.y },
    { x: target.x, y: target.y + pad },
    { x: target.x, y: target.y - pad },
  ];
  if (probes.every((point) => pointInRoom(point.x, point.y, room))) return target;
  return closestInsidePoint(room, center, target.x, target.y, 0.88);
}

function closestInsidePoint(
  room: FloorPlanRoom,
  from: FloorPlanPoint,
  x: number,
  y: number,
  inset = 0.94
): FloorPlanPoint {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 14; step += 1) {
    const mid = (lo + hi) / 2;
    const px = from.x + (x - from.x) * mid;
    const py = from.y + (y - from.y) * mid;
    if (pointInRoom(px, py, room)) lo = mid;
    else hi = mid;
  }
  const t = lo * inset;
  return { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t };
}

function stripLegacyRoomIcon(room: FloorPlanRoom): FloorPlanRoom {
  if (!('icon' in room)) return room;
  const { icon: _icon, ...rest } = room as FloorPlanRoom & { icon?: unknown };
  return rest;
}

function isRoom(value: unknown): value is FloorPlanRoom {
  const room = value as FloorPlanRoom;
  return (
    !!room &&
    typeof room.id === 'string' &&
    typeof room.name === 'string' &&
    [room.x, room.y, room.w, room.h].every((n) => typeof n === 'number') &&
    (room.points === undefined ||
      (Array.isArray(room.points) &&
        room.points.every(
          (point) => typeof point?.x === 'number' && typeof point?.y === 'number'
        ))) &&
    (room.label === undefined ||
      (typeof room.label.x === 'number' && typeof room.label.y === 'number')) &&
    (room.labelAngle === undefined ||
      room.labelAngle === 0 ||
      room.labelAngle === 90 ||
      room.labelAngle === 180 ||
      room.labelAngle === 270)
  );
}

function isTrace(value: unknown): value is FloorPlanTrace {
  const trace = value as FloorPlanTrace;
  return (
    !!trace &&
    typeof trace.id === 'string' &&
    Array.isArray(trace.points) &&
    trace.points.every((point) => typeof point?.x === 'number' && typeof point?.y === 'number')
  );
}

function isWall(value: unknown): value is FloorPlanWall {
  const wall = value as FloorPlanWall;
  return !!wall && [wall.x1, wall.y1, wall.x2, wall.y2].every((n) => typeof n === 'number');
}

function isDoor(value: unknown): value is FloorPlanDoor {
  const door = value as FloorPlanDoor;
  return (
    !!door &&
    typeof door.id === 'string' &&
    typeof door.name === 'string' &&
    typeof door.x === 'number' &&
    typeof door.y === 'number' &&
    typeof door.length === 'number' &&
    isWallSide(door.wall) &&
    (door.hinge === undefined || door.hinge === 'start' || door.hinge === 'end') &&
    (door.swing === undefined || door.swing === 'in' || door.swing === 'out')
  );
}

function isWindow(value: unknown): value is FloorPlanWindow {
  return isDoor(value);
}

function isSensor(value: unknown): value is FloorPlanSensor {
  const sensor = value as FloorPlanSensor;
  return (
    !!sensor &&
    typeof sensor.id === 'string' &&
    typeof sensor.label === 'string' &&
    typeof sensor.x === 'number' &&
    typeof sensor.y === 'number' &&
    FLOOR_PLAN_SENSOR_KINDS.includes(sensor.kind) &&
    (sensor.deviceId === undefined || typeof sensor.deviceId === 'string')
  );
}

function isWallSide(value: unknown): value is WallSide {
  return value === 'n' || value === 's' || value === 'e' || value === 'w';
}

export function createPlanForName(name: string): FloorPlan {
  return createEmptyFloorPlan(name.trim() || 'My plan');
}

/** Fictional two-bed sample. Not a real address. */
export function createHomeAPlan(): FloorPlan {
  return normalizeFloorPlan({
    id: 'sample-home-a',
    name: 'Home A',
    beds: 2,
    baths: 1,
    width: 800,
    height: 520,
    rooms: [
      { id: 'living', name: 'Living', x: 40, y: 40, w: 360, h: 240 },
      { id: 'kitchen', name: 'Kitchen', x: 400, y: 40, w: 360, h: 240 },
      { id: 'hall', name: 'Hall', x: 40, y: 280, w: 360, h: 80 },
      { id: 'bed-1', name: 'Bedroom 1', x: 40, y: 360, w: 240, h: 120 },
      { id: 'bed-2', name: 'Bedroom 2', x: 280, y: 360, w: 240, h: 120 },
      { id: 'bath', name: 'Bathroom', x: 520, y: 280, w: 240, h: 200 },
    ],
    walls: [],
    doors: [
      {
        id: 'front-door',
        name: 'Front door',
        x: 40,
        y: 300,
        wall: 'w',
        length: 40,
        exterior: true,
      },
      { id: 'living-hall', name: 'Living', x: 160, y: 280, wall: 's', length: 40 },
      { id: 'kitchen-living', name: 'Kitchen', x: 400, y: 120, wall: 'w', length: 40 },
      { id: 'bed1-hall', name: 'Bedroom 1', x: 120, y: 360, wall: 'n', length: 40 },
      { id: 'bed2-hall', name: 'Bedroom 2', x: 360, y: 360, wall: 'n', length: 40 },
      { id: 'bath-hall', name: 'Bathroom', x: 520, y: 300, wall: 'w', length: 40 },
    ],
    windows: [
      { id: 'living-window', name: 'Living', x: 120, y: 40, wall: 'n', length: 80 },
      { id: 'kitchen-window', name: 'Kitchen', x: 520, y: 40, wall: 'n', length: 80 },
      { id: 'bed1-window', name: 'Bedroom 1', x: 40, y: 400, wall: 'w', length: 50 },
      { id: 'bed2-window', name: 'Bedroom 2', x: 360, y: 480, wall: 's', length: 50 },
    ],
    sensors: [],
    traces: [],
  });
}

/** Fictional three-bed sample. Not a real address. */
export function createHomeBPlan(): FloorPlan {
  return normalizeFloorPlan({
    id: 'sample-home-b',
    name: 'Home B',
    beds: 3,
    baths: 2,
    width: 900,
    height: 620,
    rooms: [
      { id: 'living', name: 'Living', x: 40, y: 40, w: 420, h: 240 },
      { id: 'kitchen', name: 'Kitchen', x: 460, y: 40, w: 400, h: 240 },
      { id: 'hall', name: 'Hall', x: 40, y: 280, w: 820, h: 80 },
      { id: 'bed-1', name: 'Bedroom 1', x: 40, y: 360, w: 260, h: 220 },
      { id: 'bath-1', name: 'Bathroom 1', x: 300, y: 360, w: 160, h: 220 },
      { id: 'bed-2', name: 'Bedroom 2', x: 460, y: 360, w: 200, h: 220 },
      { id: 'bath-2', name: 'Bathroom 2', x: 660, y: 360, w: 80, h: 220 },
      { id: 'bed-3', name: 'Bedroom 3', x: 740, y: 360, w: 120, h: 220 },
    ],
    walls: [],
    doors: [
      {
        id: 'front-door',
        name: 'Front door',
        x: 40,
        y: 300,
        wall: 'w',
        length: 40,
        exterior: true,
      },
      { id: 'living-hall', name: 'Living', x: 180, y: 280, wall: 's', length: 40 },
      { id: 'kitchen-hall', name: 'Kitchen', x: 600, y: 280, wall: 's', length: 40 },
      { id: 'bed1-hall', name: 'Bedroom 1', x: 120, y: 360, wall: 'n', length: 40 },
      { id: 'bath1-hall', name: 'Bathroom 1', x: 350, y: 360, wall: 'n', length: 40 },
      { id: 'bed2-hall', name: 'Bedroom 2', x: 530, y: 360, wall: 'n', length: 40 },
      { id: 'bath2-hall', name: 'Bathroom 2', x: 680, y: 360, wall: 'n', length: 40 },
      { id: 'bed3-hall', name: 'Bedroom 3', x: 780, y: 360, wall: 'n', length: 40 },
    ],
    windows: [
      { id: 'living-window', name: 'Living', x: 140, y: 40, wall: 'n', length: 80 },
      { id: 'kitchen-window', name: 'Kitchen', x: 600, y: 40, wall: 'n', length: 80 },
      { id: 'bed1-window', name: 'Bedroom 1', x: 40, y: 440, wall: 'w', length: 50 },
      { id: 'bed3-window', name: 'Bedroom 3', x: 860, y: 440, wall: 'e', length: 50 },
    ],
    sensors: [],
    traces: [],
  });
}
