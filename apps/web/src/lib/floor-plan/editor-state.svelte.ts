import {
  addOpening,
  addRoom,
  addSensor,
  addTracePoint,
  canCloseTrace,
  cloneFloorPlan,
  closeTrace,
  createEmptyFloorPlan,
  createHomeAPlan,
  createHomeBPlan,
  type Device,
  type DraftRoom,
  deletePlanItems,
  FLOOR_PLAN_SENSOR_META,
  type FloorPlan,
  type FloorPlanPoint,
  type FloorPlanSelection,
  type FloorPlanSensorKind,
  type FloorPlanTool,
  flipDoors,
  type HubHouseholdState,
  hitTestPlan,
  householdDevicesForKind,
  moveRoomLabel,
  moveRooms,
  moveSensor,
  normalizeRect,
  type OpeningHandle,
  planContentViewBox,
  planDeviceRoomLocation,
  planGuidePoints,
  planRoomAt,
  planSensorScale,
  planShowsSensorLabels,
  planTraces,
  type ResizeHandle,
  renamePlanItem,
  resizeDoor,
  resizeRectFromHandle,
  resizeRoom,
  resizeWindow,
  rotateFloorPlanCounterClockwise,
  rotateRoomLabels,
  selectionsInRect,
  setSensorDeviceId,
  setSensorScale,
  setShowSensorLabels,
  snapPenPoint,
  type UpdateDeviceInput,
} from '@homehub/core';
import { saveStoredFloorPlan } from '$lib/floor-plan/storage';

type Drag =
  | { kind: 'draw'; x: number; y: number }
  | { kind: 'marquee'; x: number; y: number; additive: boolean }
  | { kind: 'move'; ids: string[]; x: number; y: number; origin: FloorPlan }
  | { kind: 'resize'; id: string; handle: ResizeHandle; origin: FloorPlan }
  | { kind: 'window-resize'; id: string; handle: OpeningHandle; origin: FloorPlan }
  | { kind: 'door-resize'; id: string; handle: OpeningHandle; origin: FloorPlan }
  | { kind: 'label'; id: string; origin: FloorPlan }
  | { kind: 'sensor-move'; id: string; origin: FloorPlan };

export class FloorPlanEditorState {
  tool = $state<FloorPlanTool>('select');
  selected = $state<FloorPlanSelection[]>([]);
  draftRoom = $state<DraftRoom | null>(null);
  marquee = $state<DraftRoom | null>(null);
  history = $state<FloorPlan[]>([]);
  editingRoomId = $state<string | null>(null);
  editingName = $state('');
  activeTraceId = $state<string | null>(null);
  draftPoint = $state<FloorPlanPoint | null>(null);
  editingSensorId = $state<string | null>(null);
  editingSensorName = $state('');
  editingSensorDeviceId = $state('');
  sensorDrag = $state<{ kind: FloorPlanSensorKind; x: number; y: number } | null>(null);
  linkingSensor = $state(false);
  dropHint = $state('');

  private drag: Drag | null = null;

  constructor(
    private readonly readPlan: () => FloorPlan,
    private readonly writePlan: (next: FloorPlan) => void,
    private readonly editable: () => boolean,
    private readonly household: () => HubHouseholdState,
    private readonly devices: () => Device[],
    private readonly persistDevice: (deviceId: string, patch: UpdateDeviceInput) => Promise<unknown>
  ) {}

  get plan() {
    return this.readPlan();
  }

  editingRoom = $derived.by(() =>
    this.editingRoomId
      ? (this.plan.rooms.find((room) => room.id === this.editingRoomId) ?? null)
      : null
  );

  iconScale = $derived(planSensorScale(this.plan));
  showNames = $derived(planShowsSensorLabels(this.plan));

  editingSensor = $derived.by(() =>
    this.editingSensorId
      ? (this.plan.sensors.find((sensor) => sensor.id === this.editingSensorId) ?? null)
      : null
  );

  selectedTraceId = $derived.by(
    () => this.selected.find((item) => item.kind === 'trace')?.id ?? this.activeTraceId
  );

  closable = $derived(canCloseTrace(this.plan, this.selectedTraceId));

  view = $derived.by(() =>
    this.editable()
      ? { x: 0, y: 0, width: this.plan.width, height: this.plan.height }
      : planContentViewBox(this.plan, {
          drafts: [this.draftRoom, this.marquee],
          points: [this.draftPoint],
          padding: 36,
        })
  );

  selectedRoomIds(): string[] {
    return this.selected.filter((item) => item.kind === 'room').map((item) => item.id);
  }

  private hasSelection(item: FloorPlanSelection): boolean {
    return this.selected.some((current) => current.kind === item.kind && current.id === item.id);
  }

  private toggleSelected(item: FloorPlanSelection) {
    this.selected = this.hasSelection(item)
      ? this.selected.filter((current) => !(current.kind === item.kind && current.id === item.id))
      : [...this.selected, item];
  }

  private mergeSelected(items: FloorPlanSelection[]) {
    const next = [...this.selected];
    for (const item of items) {
      if (!next.some((current) => current.kind === item.kind && current.id === item.id)) {
        next.push(item);
      }
    }
    this.selected = next;
  }

  commit(next: FloorPlan) {
    const current = this.plan;
    if (next === current) return;
    this.history = [...this.history, cloneFloorPlan(current)].slice(-40);
    this.writePlan(next);
    saveStoredFloorPlan(next);
  }

  leaveEditMode() {
    this.tool = 'select';
    this.selected = [];
    this.draftRoom = null;
    this.marquee = null;
    this.drag = null;
    this.editingRoomId = null;
    this.editingSensorId = null;
    this.activeTraceId = null;
    this.draftPoint = null;
    this.sensorDrag = null;
    this.dropHint = '';
  }

  pointerDown(point: FloorPlanPoint, shiftKey: boolean, detail: number) {
    if (!this.editable()) return;
    const { x, y } = point;

    if (this.tool === 'pen') {
      const result = addTracePoint(this.plan, this.selectedTraceId, x, y, {
        forceStraight: shiftKey,
      });
      this.commit(result.plan);
      if (result.closed && result.roomId) {
        this.activeTraceId = null;
        this.draftPoint = null;
        this.selected = [{ kind: 'room', id: result.roomId }];
        this.tool = 'select';
        return;
      }
      this.activeTraceId = result.traceId;
      this.selected = [{ kind: 'trace', id: result.traceId }];
      return;
    }

    if (this.tool === 'room') {
      this.drag = { kind: 'draw', x, y };
      this.draftRoom = { x, y, w: 0, h: 0 };
      this.selected = [];
      return;
    }

    if (this.tool === 'door' || this.tool === 'window') {
      const handleHit = hitTestPlan(this.plan, x, y, this.selected);
      if (handleHit?.kind === 'window-handle') {
        this.drag = {
          kind: 'window-resize',
          id: handleHit.windowId,
          handle: handleHit.handle,
          origin: cloneFloorPlan(this.plan),
        };
        this.selected = [{ kind: 'window', id: handleHit.windowId }];
        return;
      }
      if (handleHit?.kind === 'door-handle') {
        this.drag = {
          kind: 'door-resize',
          id: handleHit.doorId,
          handle: handleHit.handle,
          origin: cloneFloorPlan(this.plan),
        };
        this.selected = [{ kind: 'door', id: handleHit.doorId }];
        return;
      }
      const next = addOpening(this.plan, this.tool, x, y);
      if (next !== this.plan) {
        const added =
          this.tool === 'door'
            ? next.doors[next.doors.length - 1]
            : next.windows[next.windows.length - 1];
        this.commit(next);
        this.selected = added ? [{ kind: this.tool, id: added.id }] : [];
      }
      return;
    }

    const hit = hitTestPlan(this.plan, x, y, this.selected);
    if (hit?.kind === 'window-handle') {
      this.drag = {
        kind: 'window-resize',
        id: hit.windowId,
        handle: hit.handle,
        origin: cloneFloorPlan(this.plan),
      };
      this.selected = [{ kind: 'window', id: hit.windowId }];
      return;
    }
    if (hit?.kind === 'door-handle') {
      this.drag = {
        kind: 'door-resize',
        id: hit.doorId,
        handle: hit.handle,
        origin: cloneFloorPlan(this.plan),
      };
      this.selected = [{ kind: 'door', id: hit.doorId }];
      return;
    }
    if (hit?.kind === 'room-label') {
      const item = { kind: 'room' as const, id: hit.roomId };
      if (detail >= 2) {
        this.selected = [item];
        this.drag = null;
        this.beginRename(hit.roomId);
        return;
      }
      this.selected = [item];
      this.drag = { kind: 'label', id: hit.roomId, origin: cloneFloorPlan(this.plan) };
      return;
    }
    if (hit?.kind === 'sensor') {
      if (detail >= 2) {
        this.selected = [hit];
        this.drag = null;
        this.beginSensorRename(hit.id);
        return;
      }
      this.selected = [hit];
      this.drag = { kind: 'sensor-move', id: hit.id, origin: cloneFloorPlan(this.plan) };
      return;
    }
    if (hit?.kind === 'handle') {
      this.drag = {
        kind: 'resize',
        id: hit.roomId,
        handle: hit.handle,
        origin: cloneFloorPlan(this.plan),
      };
      this.selected = [{ kind: 'room', id: hit.roomId }];
      return;
    }
    if (hit?.kind === 'room') {
      const item = { kind: 'room' as const, id: hit.id };
      if (detail >= 2) {
        this.selected = [item];
        this.drag = null;
        this.beginRename(hit.id);
        return;
      }
      if (shiftKey) {
        this.toggleSelected(item);
        return;
      }
      const roomIds = this.selectedRoomIds();
      const moving = this.hasSelection(item) && roomIds.length > 0 ? roomIds : [hit.id];
      if (!this.hasSelection(item)) this.selected = [item];
      this.drag = { kind: 'move', ids: moving, x, y, origin: cloneFloorPlan(this.plan) };
      return;
    }
    if (hit) {
      if (shiftKey) {
        this.toggleSelected(hit);
        return;
      }
      this.selected = [hit];
      const roomIds = this.selectedRoomIds();
      if (roomIds.length > 0) {
        this.drag = { kind: 'move', ids: roomIds, x, y, origin: cloneFloorPlan(this.plan) };
      }
      return;
    }
    this.drag = { kind: 'marquee', x, y, additive: shiftKey };
    this.marquee = { x, y, w: 0, h: 0 };
    if (!shiftKey) this.selected = [];
  }

  doubleClick(point: FloorPlanPoint) {
    if (!this.editable() || this.tool !== 'select') return;
    const { x, y } = point;
    const hit = hitTestPlan(this.plan, x, y, this.selected);
    if (hit?.kind === 'door') {
      this.selected = [hit];
      this.drag = null;
      this.commit(this.flipDoorOnce(hit.id));
      return;
    }
    if (hit?.kind === 'sensor') {
      this.selected = [hit];
      this.drag = null;
      this.beginSensorRename(hit.id);
      return;
    }
    if (hit?.kind === 'room-label') {
      this.selected = [{ kind: 'room', id: hit.roomId }];
      this.drag = null;
      this.beginRename(hit.roomId);
      return;
    }
    if (hit?.kind !== 'room') return;
    this.selected = [{ kind: 'room', id: hit.id }];
    this.drag = null;
    this.beginRename(hit.id);
  }

  private flipDoorOnce(doorId: string): FloorPlan {
    return flipDoors(this.plan, [doorId]);
  }

  flipSelectedDoors() {
    const ids = this.selected.filter((item) => item.kind === 'door').map((item) => item.id);
    if (ids.length === 0) return;
    this.commit(flipDoors(this.plan, ids));
  }

  pointerMove(point: FloorPlanPoint, shiftKey: boolean) {
    if (!this.editable()) return;
    const { x, y } = point;
    if (this.tool === 'pen' && this.selectedTraceId) {
      const trace = planTraces(this.plan).find((item) => item.id === this.selectedTraceId);
      const last = trace?.points.at(-1);
      this.draftPoint = snapPenPoint({ x, y }, last, {
        forceStraight: shiftKey,
        guides: planGuidePoints(this.plan),
      });
    }

    const current = this.drag;
    if (!current) return;

    if (current.kind === 'draw') {
      this.draftRoom = normalizeRect(current.x, current.y, x, y);
      return;
    }
    if (current.kind === 'marquee') {
      this.marquee = normalizeRect(current.x, current.y, x, y);
      return;
    }
    if (current.kind === 'move') {
      this.writePlan(moveRooms(current.origin, current.ids, x - current.x, y - current.y));
      return;
    }
    if (current.kind === 'window-resize') {
      this.writePlan(resizeWindow(current.origin, current.id, current.handle, x, y));
      return;
    }
    if (current.kind === 'door-resize') {
      this.writePlan(resizeDoor(current.origin, current.id, current.handle, x, y));
      return;
    }
    if (current.kind === 'label') {
      this.writePlan(moveRoomLabel(current.origin, current.id, x, y));
      return;
    }
    if (current.kind === 'sensor-move') {
      this.writePlan(moveSensor(current.origin, current.id, x, y));
      return;
    }
    const room = current.origin.rooms.find((item) => item.id === current.id);
    if (!room) return;
    this.writePlan(
      resizeRoom(current.origin, current.id, resizeRectFromHandle(room, current.handle, x, y))
    );
  }

  pointerUp() {
    if (!this.drag) return;

    if (this.drag.kind === 'draw' && this.draftRoom) {
      const next = addRoom(this.plan, this.draftRoom);
      if (next !== this.plan) {
        this.commit(next);
        const created = next.rooms[next.rooms.length - 1];
        this.selected = created ? [{ kind: 'room', id: created.id }] : [];
        this.tool = 'select';
      }
      this.draftRoom = null;
      this.drag = null;
      return;
    }

    if (this.drag.kind === 'marquee') {
      const hits = this.marquee ? selectionsInRect(this.plan, this.marquee) : [];
      if (hits.length) {
        if (this.drag.additive) this.mergeSelected(hits);
        else this.selected = hits;
      }
      this.marquee = null;
      this.drag = null;
      return;
    }

    if (
      (this.drag.kind === 'move' ||
        this.drag.kind === 'resize' ||
        this.drag.kind === 'window-resize' ||
        this.drag.kind === 'door-resize' ||
        this.drag.kind === 'label' ||
        this.drag.kind === 'sensor-move') &&
      this.plan !== this.drag.origin
    ) {
      this.history = [...this.history, cloneFloorPlan(this.drag.origin)].slice(-40);
      saveStoredFloorPlan(this.plan);
      if (this.drag.kind === 'sensor-move') {
        const movedId = this.drag.id;
        const sensor = this.plan.sensors.find((item) => item.id === movedId);
        if (sensor?.deviceId) {
          const room = planRoomAt(this.plan, sensor.x, sensor.y);
          void this.persistDevice(sensor.deviceId, {
            location: planDeviceRoomLocation(room?.name, sensor.x, sensor.y),
          }).catch(() => {
            // Plan position is already saved if the device list is unreachable.
          });
        }
      }
    }
    this.drag = null;
  }

  closeSelectedTrace() {
    if (!this.selectedTraceId || !canCloseTrace(this.plan, this.selectedTraceId)) return;
    const next = closeTrace(this.plan, this.selectedTraceId);
    if (next === this.plan) return;
    this.commit(next);
    const created = next.rooms[next.rooms.length - 1];
    this.selected = created ? [{ kind: 'room', id: created.id }] : [];
    this.activeTraceId = null;
    this.draftPoint = null;
    this.tool = 'select';
  }

  undo() {
    const previous = this.history.at(-1);
    if (!previous) return;
    this.history = this.history.slice(0, -1);
    this.writePlan(previous);
    this.selected = [];
    this.editingRoomId = null;
    this.editingSensorId = null;
    this.activeTraceId = null;
    this.draftPoint = null;
    saveStoredFloorPlan(this.plan);
  }

  removeSelected() {
    if (this.selected.length === 0) return;
    if (this.selected.some((item) => item.kind === 'trace' && item.id === this.activeTraceId)) {
      this.activeTraceId = null;
      this.draftPoint = null;
    }
    this.commit(deletePlanItems(this.plan, this.selected));
    this.selected = [];
  }

  beginRename(roomId: string) {
    const room = this.plan.rooms.find((item) => item.id === roomId);
    if (!room) return;
    this.editingRoomId = roomId;
    this.editingName = room.name;
  }

  finishRename() {
    const roomId = this.editingRoomId;
    if (!roomId) return;
    this.editingRoomId = null;
    const name = this.editingName.trim();
    const room = this.plan.rooms.find((item) => item.id === roomId);
    if (!room || !name || name === room.name) return;
    this.commit(renamePlanItem(this.plan, { kind: 'room', id: roomId }, name));
  }

  cancelRename() {
    this.editingRoomId = null;
  }

  renameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.finishRename();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelRename();
    }
  }

  liveDevicesFor(kind: FloorPlanSensorKind) {
    const fromHousehold = householdDevicesForKind(kind, this.household());
    const deviceType = FLOOR_PLAN_SENSOR_META[kind].deviceType;
    const merged = new Map<string, { id: string; name: string }>();
    for (const item of fromHousehold) {
      const device = this.devices().find((entry) => entry.deviceId === item.id);
      if (device && device.type !== deviceType) continue;
      merged.set(item.id, item);
    }
    for (const device of this.devices()) {
      if (device.type !== deviceType || merged.has(device.deviceId)) continue;
      merged.set(device.deviceId, { id: device.deviceId, name: device.name });
    }
    return [...merged.values()];
  }

  beginSensorRename(sensorId: string) {
    const sensor = this.plan.sensors.find((item) => item.id === sensorId);
    if (!sensor) return;
    this.editingSensorId = sensorId;
    this.editingSensorName = sensor.label;
    this.editingSensorDeviceId = this.liveDevicesFor(sensor.kind).some(
      (item) => item.id === sensor.deviceId
    )
      ? (sensor.deviceId ?? '')
      : '';
  }

  cancelSensorRename() {
    this.editingSensorId = null;
  }

  async finishSensorRename() {
    const sensorId = this.editingSensorId;
    if (!sensorId || this.linkingSensor) return;
    const sensor = this.plan.sensors.find((item) => item.id === sensorId);
    if (!sensor) {
      this.editingSensorId = null;
      return;
    }
    const name = this.editingSensorName.trim();

    let next =
      name === sensor.label
        ? this.plan
        : renamePlanItem(this.plan, { kind: 'sensor', id: sensorId }, name);
    if (next !== this.plan) this.commit(next);

    const room = planRoomAt(next, sensor.x, sensor.y);
    const location = planDeviceRoomLocation(room?.name, sensor.x, sensor.y);
    const liveId = this.editingSensorDeviceId.trim();
    this.linkingSensor = true;
    try {
      if (liveId) {
        if (liveId !== sensor.deviceId) {
          this.commit(setSensorDeviceId(next, sensorId, liveId));
        }
        await this.persistDevice(liveId, { location });
        return;
      }
      if (sensor.deviceId) {
        await this.persistDevice(sensor.deviceId, {
          ...(name && name !== sensor.label ? { name } : {}),
          location,
        });
      }
    } catch {
      // Plan keeps the sensor even if the device list is unreachable.
    } finally {
      this.linkingSensor = false;
      this.editingSensorId = null;
    }
  }

  sensorRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.finishSensorRename();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelSensorRename();
    }
  }

  placeSensor(kind: FloorPlanSensorKind, point: FloorPlanPoint) {
    const next = addSensor(this.plan, kind, point.x, point.y);
    if (next === this.plan) {
      this.dropHint =
        this.plan.rooms.length === 0 ? 'Draw a room first, then drop a sensor into it.' : '';
      return;
    }
    this.dropHint = '';
    this.tool = 'select';
    this.commit(next);
    const added = next.sensors[next.sensors.length - 1];
    this.selected = added ? [{ kind: 'sensor', id: added.id }] : [];
    if (added) this.beginSensorRename(added.id);
  }

  beginPaletteDrag(kind: FloorPlanSensorKind, event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button === 0) return;
    event.preventDefault();
    this.sensorDrag = { kind, x: event.clientX, y: event.clientY };
  }

  movePaletteDrag(event: PointerEvent) {
    if (!this.sensorDrag) return;
    this.sensorDrag = { ...this.sensorDrag, x: event.clientX, y: event.clientY };
  }

  takePaletteDrag(): FloorPlanSensorKind | null {
    if (!this.sensorDrag) return null;
    const kind = this.sensorDrag.kind;
    this.sensorDrag = null;
    return kind;
  }

  applySensorScale(value: number) {
    const next = setSensorScale(this.plan, value);
    if (next === this.plan) return;
    this.writePlan(next);
    saveStoredFloorPlan(next);
  }

  nudgeSensorScale(delta: number) {
    this.applySensorScale(this.iconScale + delta);
  }

  toggleSensorLabels() {
    const next = setShowSensorLabels(this.plan, !this.showNames);
    if (next === this.plan) return;
    this.writePlan(next);
    saveStoredFloorPlan(next);
  }

  clearDrawing() {
    this.commit({ ...createEmptyFloorPlan(this.plan.name), id: this.plan.id });
    this.selected = [];
    this.editingRoomId = null;
    this.editingSensorId = null;
    this.activeTraceId = null;
    this.draftPoint = null;
  }

  loadSample(kind: 'a' | 'b') {
    const sample = kind === 'a' ? createHomeAPlan() : createHomeBPlan();
    this.commit({ ...sample, id: this.plan.id, name: this.plan.name });
    this.selected = [];
    this.editingRoomId = null;
    this.editingSensorId = null;
    this.activeTraceId = null;
    this.draftPoint = null;
  }

  rotatePlan() {
    this.commit(rotateFloorPlanCounterClockwise(this.plan));
  }

  flipSelectedNames() {
    const ids = this.selectedRoomIds();
    if (ids.length === 0) return;
    this.commit(rotateRoomLabels(this.plan, ids));
  }

  keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (!this.editable()) return;

    if ((event.key === 'Enter' || event.key.toLowerCase() === 'c') && this.closable) {
      event.preventDefault();
      this.closeSelectedTrace();
      return;
    }
    if (event.key.toLowerCase() === 'f' && this.selected.some((item) => item.kind === 'door')) {
      event.preventDefault();
      this.flipSelectedDoors();
      return;
    }
    if (event.key.toLowerCase() === 't' && this.selected.some((item) => item.kind === 'room')) {
      event.preventDefault();
      this.flipSelectedNames();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selected.length) {
      event.preventDefault();
      this.removeSelected();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
      return;
    }
    if (event.key === 'Escape') {
      if (this.editingRoomId) {
        this.cancelRename();
        return;
      }
      if (this.editingSensorId) {
        this.cancelSensorRename();
        return;
      }
      this.selected = [];
      this.draftRoom = null;
      this.draftPoint = null;
      this.marquee = null;
      this.drag = null;
      this.tool = 'select';
      return;
    }
    const shortcut: Record<string, FloorPlanTool> = {
      v: 'select',
      s: 'select',
      r: 'room',
      p: 'pen',
      d: 'door',
      w: 'window',
    };
    const nextTool = shortcut[event.key.toLowerCase()];
    if (nextTool) this.tool = nextTool;
  }

  actionDisabled(
    id:
      | 'close'
      | 'flip'
      | 'flip-name'
      | 'rotate'
      | 'delete'
      | 'undo'
      | 'sample-a'
      | 'sample-b'
      | 'clear'
  ): boolean {
    if (id === 'close') return !this.closable;
    if (id === 'flip') return !this.selected.some((item) => item.kind === 'door');
    if (id === 'flip-name') return this.selectedRoomIds().length === 0;
    if (id === 'delete') return this.selected.length === 0;
    if (id === 'undo') return this.history.length === 0;
    return false;
  }
}
