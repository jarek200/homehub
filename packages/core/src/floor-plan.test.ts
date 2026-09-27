import { describe, expect, it } from 'vitest';
import {
  addOpening,
  addRoom,
  addRoomFromPoints,
  addSensor,
  addTracePoint,
  closeTrace,
  createEmptyFloorPlan,
  createHomeAPlan,
  createHomeBPlan,
  createPlanForName,
  DEFAULT_DOOR_LENGTH,
  DEFAULT_SENSOR_SCALE,
  DEFAULT_WINDOW_LENGTH,
  deletePlanItem,
  deletePlanItems,
  doorGeometry,
  FLOOR_PLAN_CELL,
  FLOOR_PLAN_GRID,
  FLOOR_PLAN_SENSOR_META,
  FLOOR_PLAN_UNITS_PER_METRE,
  flipDoor,
  hitTestPlan,
  householdDevicePlace,
  isClimateSensorKind,
  isLegacySideBySideLayout,
  isPublishedSideBySideLayout,
  MIN_ROOM_SIZE,
  mirrorFloorPlanHorizontal,
  moveRoom,
  moveRoomLabel,
  moveRooms,
  moveSensor,
  nearestRoomEdge,
  normalizeRect,
  parseFloorPlan,
  pickNewerFloorPlan,
  planColumnLabel,
  planContentViewBox,
  planDeviceLocation,
  planDevicePlace,
  planDeviceRoomLocation,
  planGridCellRect,
  planGridOverlay,
  planGridRef,
  planScaleMark,
  renamePlanItem,
  resizeDoor,
  resizeRoom,
  resizeWindow,
  roomLabelAngle,
  rotateFloorPlanCounterClockwise,
  rotateRoomLabel,
  selectionsInRect,
  sensorHitReach,
  setSensorDeviceId,
  setSensorScale,
  setShowSensorLabels,
  snapToGrid,
  stampFloorPlan,
  wallsFromRooms,
} from './floor-plan';

describe('floor plan editor geometry', () => {
  it('snaps values to the grid', () => {
    expect(snapToGrid(14)).toBe(10);
    expect(snapToGrid(16)).toBe(20);
  });

  it('names locator cells like a spreadsheet', () => {
    expect(planColumnLabel(0)).toBe('A');
    expect(planColumnLabel(25)).toBe('Z');
    expect(planColumnLabel(26)).toBe('AA');
    expect(planGridRef(0, 0)).toBe('A1');
    expect(planGridRef(FLOOR_PLAN_CELL - 1, 0)).toBe('A1');
    expect(planGridRef(FLOOR_PLAN_CELL, 0)).toBe('B1');
    expect(planGridRef(0, FLOOR_PLAN_CELL)).toBe('A2');
    expect(FLOOR_PLAN_CELL).toBe(FLOOR_PLAN_UNITS_PER_METRE);
    expect(planGridCellRect(FLOOR_PLAN_CELL + 5, FLOOR_PLAN_CELL * 2 + 5)).toEqual({
      ref: 'B3',
      x: FLOOR_PLAN_CELL,
      y: FLOOR_PLAN_CELL * 2,
      w: FLOOR_PLAN_CELL,
      h: FLOOR_PLAN_CELL,
    });
    expect(
      planDeviceLocation('Kitchen / Living', FLOOR_PLAN_CELL + 5, FLOOR_PLAN_CELL * 2 + 5)
    ).toBe('Kitchen / Living B3');
    expect(
      planDeviceRoomLocation('Kitchen / Living', FLOOR_PLAN_CELL + 5, FLOOR_PLAN_CELL * 2 + 5)
    ).toBe('Kitchen / Living');
    expect(planDevicePlace('Kitchen / Living', FLOOR_PLAN_CELL + 5, FLOOR_PLAN_CELL * 2 + 5)).toBe(
      'B3-Kitchen / Living'
    );
    expect(planDeviceLocation('  ', 0, 0)).toBe('A1');
    expect(planDeviceRoomLocation('  ', 0, 0)).toBe('A1');
    expect(
      householdDevicePlace(
        {
          rooms: [{ id: 'hall', name: 'Hallway', x: 0, y: 0, w: 200, h: 200 }],
          sensors: [
            { id: 'door', kind: 'contact', label: 'Main Door', x: 10, y: 10, deviceId: 'matter-5' },
          ],
        },
        'matter-5'
      )
    ).toBe('A1-Hallway');

    const overlay = planGridOverlay(
      { x: 0, y: 0, width: 680, height: 400 },
      { width: 680, height: 400 }
    );
    expect(overlay.cols.map((col) => col.label).slice(0, 3)).toEqual(['A', 'B', 'C']);
    expect(overlay.rows.map((row) => row.label).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(overlay.cols).toHaveLength(14);
    expect(overlay.rows).toHaveLength(8);

    const scale = planScaleMark({ x: 0, y: 0, width: 680, height: 400 });
    expect(scale.x2 - scale.x1).toBe(FLOOR_PLAN_UNITS_PER_METRE);
    expect(scale.label).toBe('1 m');
  });

  it('normalizes a dragged rectangle', () => {
    expect(normalizeRect(80, 60, 20, 10)).toEqual({ x: 20, y: 10, w: 60, h: 50 });
  });

  it('builds walls from a room and punches a door gap', () => {
    const room = { id: 'living', name: 'Living', x: 40, y: 40, w: 200, h: 160 };
    const walls = wallsFromRooms(room ? [room] : [], [{ x: 110, y: 200, wall: 's', length: 50 }]);

    expect(walls).toContainEqual({ x1: 40, y1: 200, x2: 110, y2: 200 });
    expect(walls).toContainEqual({ x1: 160, y1: 200, x2: 240, y2: 200 });
    expect(walls.some((wall) => wall.x1 === 110 && wall.x2 === 160 && wall.y1 === 200)).toBe(false);
  });

  it('adds a room and a door on the nearest wall', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    expect(plan.rooms).toHaveLength(1);
    expect(plan.walls.length).toBeGreaterThan(0);

    plan = addOpening(plan, 'door', 140, 204);
    expect(plan.doors).toHaveLength(1);
    expect(plan.doors[0]?.wall).toBe('s');
    expect(plan.doors[0]?.name).toBe('Door 1');
    expect(plan.doors[0]?.length).toBe(DEFAULT_DOOR_LENGTH);
    expect(DEFAULT_DOOR_LENGTH).toBe(20);

    plan = addOpening(plan, 'window', 40, 100);
    expect(plan.windows[0]?.length).toBe(DEFAULT_WINDOW_LENGTH);
    expect(DEFAULT_WINDOW_LENGTH).toBe(20);
  });

  it('draws side-wall doors perpendicular to the wall', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Hall');
    plan = addOpening(plan, 'door', 40, 100);
    const door = plan.doors[0];
    expect(door?.wall).toBe('w');
    const drawn = doorGeometry(door ?? { id: '', name: '', x: 0, y: 0, wall: 'w', length: 20 });
    expect(drawn.leaf.x2 - drawn.leaf.x1).toBe(door?.length);
    expect(drawn.leaf.y2).toBe(drawn.leaf.y1);
    expect(drawn.swing.startsWith('M ')).toBe(true);
  });

  it('flips a door to the other hinge', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Hall');
    plan = addOpening(plan, 'door', 140, 40);
    const door = plan.doors[0];
    expect(door).toBeTruthy();
    const before = doorGeometry(door ?? { id: '', name: '', x: 0, y: 0, wall: 'n', length: 20 });
    plan = flipDoor(plan, door?.id ?? '');
    const flipped = plan.doors[0];
    expect(flipped?.hinge).toBe('end');
    const after = doorGeometry(flipped ?? { id: '', name: '', x: 0, y: 0, wall: 'n', length: 20 });
    expect(after.leaf.x1).not.toBe(before.leaf.x1);
  });

  it('moves a room and the door on its wall', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Kitchen');
    plan = addOpening(plan, 'door', 140, 40);
    const doorX = plan.doors[0]?.x ?? 0;

    const movedId = plan.rooms[0]?.id;
    expect(movedId).toBeTruthy();
    plan = moveRoom(plan, movedId ?? '', 30, 0);
    expect(plan.rooms[0]?.x).toBe(70);
    expect(plan.doors[0]?.x).toBe(doorX + 30);
  });

  it('deletes a room and its openings', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Bedroom 1');
    plan = addOpening(plan, 'window', 40, 100);
    const deletedId = plan.rooms[0]?.id ?? '';
    plan = deletePlanItem(plan, { kind: 'room', id: deletedId });

    expect(plan.rooms).toHaveLength(0);
    expect(plan.windows).toHaveLength(0);
    expect(plan.beds).toBe(0);
  });

  it('resizes a room and keeps a window on the same wall', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Bathroom');
    plan = addOpening(plan, 'window', 40, 100);
    const roomId = plan.rooms[0]?.id ?? '';

    plan = resizeRoom(plan, roomId, { x: 40, y: 40, w: 260, h: 180 });
    expect(plan.rooms[0]?.w).toBe(260);
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0]?.wall).toBe('w');
    expect(plan.baths).toBe(1);
  });

  it('finds the nearest room edge', () => {
    const rooms = [{ id: 'a', name: 'A', x: 40, y: 40, w: 200, h: 160 }];
    const hit = nearestRoomEdge(rooms, 42, 100);
    expect(hit?.edge.wall).toBe('w');
  });

  it('hits a room under the pointer', () => {
    const plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Hall');
    expect(hitTestPlan(plan, 80, 80)).toEqual({ kind: 'room', id: plan.rooms[0]?.id });
    expect(hitTestPlan(plan, 10, 10)).toBeNull();
  });

  it('moves several rooms by the same amount', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'A');
    plan = addRoom(plan, { x: 280, y: 40, w: 200, h: 160 }, 'B');
    const ids = plan.rooms.map((room) => room.id);
    plan = moveRooms(plan, ids, 30, 20);

    expect(plan.rooms[0]?.x).toBe(70);
    expect(plan.rooms[0]?.y).toBe(60);
    expect(plan.rooms[1]?.x).toBe(310);
    expect(plan.rooms[1]?.y).toBe(60);
  });

  it('selects rooms and doors inside a dragged rectangle', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    plan = addOpening(plan, 'door', 140, 204);
    const hits = selectionsInRect(plan, { x: 30, y: 30, w: 220, h: 200 });

    expect(hits.some((hit) => hit.kind === 'room' && hit.id === plan.rooms[0]?.id)).toBe(true);
    expect(hits.some((hit) => hit.kind === 'door' && hit.id === plan.doors[0]?.id)).toBe(true);
  });

  it('deletes every selected item', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'A');
    plan = addRoom(plan, { x: 280, y: 40, w: 200, h: 160 }, 'B');
    plan = deletePlanItems(
      plan,
      plan.rooms.map((room) => ({ kind: 'room' as const, id: room.id }))
    );
    expect(plan.rooms).toHaveLength(0);
  });

  it('rejects stored junk and accepts a drawn plan', () => {
    expect(parseFloorPlan({ nope: true })).toBeNull();

    const stored = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    const parsed = parseFloorPlan(JSON.parse(JSON.stringify(stored)));
    expect(parsed?.rooms[0]?.name).toBe('Living');
    expect(parsed?.walls.length).toBeGreaterThan(0);
  });

  it('keeps updatedAt and prefers the newer hub or local copy', () => {
    const local = stampFloorPlan(
      addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Study Room'),
      '2026-09-09T10:00:00.000Z'
    );
    const remote = stampFloorPlan(
      addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Bedroom 1'),
      '2026-09-09T11:00:00.000Z'
    );

    expect(parseFloorPlan(JSON.parse(JSON.stringify(local)))?.updatedAt).toBe(local.updatedAt);
    expect(pickNewerFloorPlan(local, remote)?.rooms[0]?.name).toBe('Bedroom 1');
    expect(
      pickNewerFloorPlan(stampFloorPlan(local, '2026-09-09T12:00:00.000Z'), remote)?.rooms[0]?.name
    ).toBe('Study Room');
    expect(
      pickNewerFloorPlan(
        addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Local'),
        remote
      )?.rooms[0]?.name
    ).toBe('Bedroom 1');
    expect(
      pickNewerFloorPlan(
        addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Local'),
        addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Remote')
      )?.rooms[0]?.name
    ).toBe('Local');
    expect(pickNewerFloorPlan(createEmptyFloorPlan(), remote)?.rooms[0]?.name).toBe('Bedroom 1');
  });

  it('stretches a selected window along its wall', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    plan = addOpening(plan, 'window', 140, 40);
    const window = plan.windows[0];
    expect(window?.length).toBe(DEFAULT_WINDOW_LENGTH);
    expect(window).toBeTruthy();

    plan = resizeWindow(plan, window?.id ?? '', 'end', (window?.x ?? 0) + 80, window?.y ?? 0);
    expect(plan.windows[0]?.length).toBeGreaterThan(DEFAULT_WINDOW_LENGTH);
    expect(plan.windows[0]?.wall).toBe('n');
    expect(plan.windows[0]?.y).toBe(window?.y);
  });

  it('stretches a selected door along its wall', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    plan = addOpening(plan, 'door', 140, 200);
    const door = plan.doors[0];
    expect(door?.length).toBe(DEFAULT_DOOR_LENGTH);
    expect(door?.wall).toBe('s');
    expect(
      hitTestPlan(plan, (door?.x ?? 0) + (door?.length ?? 0), door?.y ?? 0, [
        { kind: 'door', id: door?.id ?? '' },
      ])?.kind
    ).toBe('door-handle');

    plan = resizeDoor(plan, door?.id ?? '', 'end', (door?.x ?? 0) + 80, door?.y ?? 0);
    expect(plan.doors[0]?.length).toBeGreaterThan(DEFAULT_DOOR_LENGTH);
    expect(plan.doors[0]?.wall).toBe('s');
    expect(plan.doors[0]?.y).toBe(door?.y);
  });

  it('closes a pen trace into a named room', () => {
    let added = addTracePoint(createEmptyFloorPlan(), null, 40, 40);
    added = addTracePoint(added.plan, added.traceId, 200, 40);
    added = addTracePoint(added.plan, added.traceId, 200, 160);
    added = addTracePoint(added.plan, added.traceId, 40, 160);
    expect(added.plan.traces).toHaveLength(1);
    expect(added.closed).toBe(false);

    added = addTracePoint(added.plan, added.traceId, 40, 40);
    expect(added.closed).toBe(true);
    expect(added.plan.traces).toHaveLength(0);
    expect(added.plan.rooms[0]?.name).toBe('Room 1');
    expect(added.plan.rooms[0]?.points).toHaveLength(4);
  });

  it('closes an open trace with closeTrace', () => {
    let added = addTracePoint(createEmptyFloorPlan(), null, 40, 40);
    added = addTracePoint(added.plan, added.traceId, 180, 40);
    added = addTracePoint(added.plan, added.traceId, 180, 140);
    const closed = closeTrace(added.plan, added.traceId);
    expect(closed.rooms).toHaveLength(1);
    expect(closed.traces).toEqual([]);
  });

  it('hits the inside of a non-square room and misses the cutout', () => {
    const plan = addRoomFromPoints(
      createEmptyFloorPlan(),
      [
        { x: 40, y: 40 },
        { x: 200, y: 40 },
        { x: 200, y: 120 },
        { x: 120, y: 120 },
        { x: 120, y: 200 },
        { x: 40, y: 200 },
      ],
      'Kitchen'
    );
    expect(hitTestPlan(plan, 80, 80)).toEqual({ kind: 'room', id: plan.rooms[0]?.id });
    expect(hitTestPlan(plan, 160, 160)).toBeNull();
  });

  it('snaps a nearly horizontal pen stroke to a straight wall', () => {
    let added = addTracePoint(createEmptyFloorPlan(), null, 40, 40);
    added = addTracePoint(added.plan, added.traceId, 180, 52);
    const last = added.plan.traces?.[0]?.points.at(-1);
    expect(last).toEqual({ x: 180, y: 40 });
  });

  it('keeps a clearly diagonal pen stroke', () => {
    let added = addTracePoint(createEmptyFloorPlan(), null, 40, 40);
    added = addTracePoint(added.plan, added.traceId, 180, 160);
    const last = added.plan.traces?.[0]?.points.at(-1);
    expect(last).toEqual({ x: 180, y: 160 });
  });

  it('moves a room name and keeps it inside the room', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Room 1');
    const roomId = plan.rooms[0]?.id ?? '';
    plan = moveRoomLabel(plan, roomId, 80, 70);
    expect(plan.rooms[0]?.label).toEqual({ x: 80, y: 70 });
    expect(hitTestPlan(plan, 80, 70)).toEqual({ kind: 'room-label', roomId });

    plan = moveRoomLabel(plan, roomId, 10, 10);
    const label = plan.rooms[0]?.label;
    expect(label).toBeTruthy();
    expect(label?.x).toBeGreaterThan(40);
    expect(label?.y).toBeGreaterThan(40);
    expect(label?.x).toBeLessThan(240);
    expect(label?.y).toBeLessThan(200);
  });

  it('keeps a stored room label when parsing', () => {
    const stored = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Room 1');
    const first = stored.rooms[0];
    if (first) stored.rooms[0] = { ...first, label: { x: 90, y: 80 } };
    const parsed = parseFloorPlan(JSON.parse(JSON.stringify(stored)));
    expect(parsed?.rooms[0]?.label).toEqual({ x: 90, y: 80 });
  });

  it('keeps open traces when parsing a stored plan', () => {
    const stored = {
      ...createEmptyFloorPlan(),
      traces: [
        {
          id: 'trace-1',
          points: [
            { x: 40, y: 40 },
            { x: 120, y: 40 },
            { x: 120, y: 80 },
          ],
        },
      ],
    };
    const parsed = parseFloorPlan(stored);
    expect(parsed?.traces).toEqual(stored.traces);
  });

  it('shares the ALPSTUGA climate feed with the air-quality sensors', () => {
    expect(FLOOR_PLAN_SENSOR_META.co2).toEqual({
      label: 'CO₂',
      deviceType: 'environmental-sensor',
    });
    expect(FLOOR_PLAN_SENSOR_META.pm25).toEqual({
      label: 'PM2.5',
      deviceType: 'environmental-sensor',
    });
    expect(FLOOR_PLAN_SENSOR_META['air-quality']).toEqual({
      label: 'Air quality',
      deviceType: 'environmental-sensor',
    });
    expect(isClimateSensorKind('climate')).toBe(true);
    expect(isClimateSensorKind('co2')).toBe(true);
    expect(isClimateSensorKind('pm25')).toBe(true);
    expect(isClimateSensorKind('air-quality')).toBe(true);
    expect(isClimateSensorKind('motion')).toBe(false);
    const plan = createEmptyFloorPlan();
    expect(sensorHitReach(plan, 'co2')).toBe(sensorHitReach(plan, 'climate'));
    expect(sensorHitReach(plan, 'pm25')).toBe(sensorHitReach(plan, 'climate'));
    expect(sensorHitReach(plan, 'air-quality')).toBe(sensorHitReach(plan, 'climate'));
    let placed = addRoom(plan, { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    placed = addSensor(placed, 'co2', 80, 80);
    placed = addSensor(placed, 'pm25', 100, 100);
    placed = addSensor(placed, 'air-quality', 120, 120);
    expect(placed.sensors.map((sensor) => sensor.label)).toEqual([
      'CO₂ 1',
      'PM2.5 1',
      'Air quality 1',
    ]);
    expect(parseFloorPlan(JSON.parse(JSON.stringify(placed)))?.sensors).toHaveLength(3);
  });

  it('places a sensor inside a room and keeps it there', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Kitchen');
    plan = addSensor(plan, 'light', 80, 80);
    expect(plan.sensors).toHaveLength(1);
    expect(plan.sensors[0]?.kind).toBe('light');
    expect(plan.sensors[0]?.label).toBe('Bulb 1');
    expect(hitTestPlan(plan, plan.sensors[0]?.x ?? 0, plan.sensors[0]?.y ?? 0)?.kind).toBe(
      'sensor'
    );

    const id = plan.sensors[0]?.id ?? '';
    plan = moveSensor(plan, id, 10, 10);
    expect(plan.sensors[0]?.x).toBeGreaterThan(40);
    expect(plan.sensors[0]?.y).toBeGreaterThan(40);
  });

  it('does not place a sensor on an empty plan', () => {
    const plan = addSensor(createEmptyFloorPlan(), 'leak', 80, 80);
    expect(plan.sensors).toHaveLength(0);
  });

  it('parses a climate sensor', () => {
    const stored = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Hall');
    const withSensor = {
      ...stored,
      sensors: [{ id: 'c1', kind: 'climate' as const, label: 'Hall air', x: 80, y: 80 }],
    };
    expect(parseFloorPlan(withSensor)?.sensors[0]?.kind).toBe('climate');
  });

  it('parses a camera sensor', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Hall');
    plan = addSensor(plan, 'camera', 80, 80);
    expect(plan.sensors[0]?.kind).toBe('camera');
    expect(plan.sensors[0]?.label).toBe('Camera 1');
    expect(parseFloorPlan(JSON.parse(JSON.stringify(plan)))?.sensors[0]?.kind).toBe('camera');
  });

  it('renames a sensor and stores a linked device id', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Kitchen');
    plan = addSensor(plan, 'lock', 80, 80);
    const id = plan.sensors[0]?.id ?? '';
    plan = renamePlanItem(plan, { kind: 'sensor', id }, 'Front Nuki');
    plan = setSensorDeviceId(plan, id, 'dev-nuki-1');
    expect(plan.sensors[0]?.label).toBe('Front Nuki');
    expect(plan.sensors[0]?.deviceId).toBe('dev-nuki-1');
  });

  it('allows a sensor to have no name', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Kitchen');
    plan = addSensor(plan, 'leak', 80, 80, 'Leak 1');
    const id = plan.sensors[0]?.id ?? '';
    plan = renamePlanItem(plan, { kind: 'sensor', id }, '  ');
    expect(plan.sensors[0]?.label).toBe('');
  });

  it('parses an IKEA plug and can hide every sensor name', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Kitchen');
    plan = addSensor(plan, 'plug', 80, 80);
    expect(plan.sensors[0]?.kind).toBe('plug');
    expect(plan.sensors[0]?.label).toBe('Plug 1');
    plan = setShowSensorLabels(plan, false);
    expect(plan.showSensorLabels).toBe(false);
    expect(parseFloorPlan(plan)?.showSensorLabels).toBe(false);
  });

  it('scales every sensor icon together', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Kitchen');
    plan = addSensor(plan, 'light', 80, 80);
    expect(sensorHitReach(plan, 'light')).toBe(16);
    plan = setSensorScale(plan, 200);
    expect(plan.sensorScale).toBe(200);
    expect(sensorHitReach(plan, 'light')).toBe(32);
    expect(parseFloorPlan(plan)?.sensorScale).toBe(200);
    expect(setSensorScale(plan, 9).sensorScale).toBe(DEFAULT_SENSOR_SCALE / 2);
  });

  it('builds the fictional Home A two-bed sample', () => {
    const plan = createHomeAPlan();
    expect(plan.beds).toBe(2);
    expect(plan.baths).toBe(1);
    expect(plan.name).toBe('Home A');
    expect(plan.rooms.map((room) => room.name)).toEqual([
      'Living',
      'Kitchen',
      'Hall',
      'Bedroom 1',
      'Bedroom 2',
      'Bathroom',
    ]);
    expect(plan.sensors).toHaveLength(0);
    expect(plan.doors.some((door) => door.id === 'front-door' && door.exterior)).toBe(true);
    expect(plan.walls.length).toBeGreaterThan(0);
    expect(parseFloorPlan(plan)?.rooms).toHaveLength(6);
    expect(createPlanForName('Home A').rooms).toHaveLength(0);
    expect(createPlanForName('Holiday cottage').id).toBe('user-plan');
    for (const room of plan.rooms) {
      expect(room.x % FLOOR_PLAN_GRID).toBe(0);
      expect(room.y % FLOOR_PLAN_GRID).toBe(0);
      expect(room.w).toBeGreaterThanOrEqual(MIN_ROOM_SIZE);
      expect(room.h).toBeGreaterThanOrEqual(MIN_ROOM_SIZE);
    }
  });

  it('mirrors a plan left-to-right and restores it on a second flip', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    plan = addOpening(plan, 'door', 40, 80);
    const original = JSON.parse(JSON.stringify(plan)) as typeof plan;
    plan = mirrorFloorPlanHorizontal(plan);
    expect(plan.rooms[0]).toMatchObject({ x: 760, y: 40, w: 200, h: 160 });
    plan = mirrorFloorPlanHorizontal(plan);
    expect(plan.rooms[0]?.x).toBe(original.rooms[0]?.x);
    expect(plan.rooms[0]?.w).toBe(original.rooms[0]?.w);
  });

  it('loads a stored side-by-side sample as-is without rebuilding', () => {
    const published = {
      ...createEmptyFloorPlan('Home A'),
      id: 'sample-home-a',
      width: 680,
      height: 400,
      rooms: [
        { id: 'living', name: 'Kitchen / Living', x: 40, y: 40, w: 230, h: 280 },
        { id: 'bed-1', name: 'Bedroom 1', x: 420, y: 40, w: 180, h: 140 },
      ],
      doors: [],
      windows: [],
      walls: [],
    };
    expect(isPublishedSideBySideLayout(published)).toBe(true);
    const parsed = parseFloorPlan(published);
    expect(parsed?.rooms).toHaveLength(2);
    expect(parsed?.width).toBe(680);
    expect(parsed?.height).toBe(400);
    expect(parsed?.rooms.find((room) => room.id === 'living')).toMatchObject({
      x: 40,
      y: 40,
      w: 230,
      h: 280,
    });
  });

  it('loads the kitchen-on-the-right 680 draft as-is without rebuilding', () => {
    const draft = {
      ...createEmptyFloorPlan('Home A'),
      id: 'plan-old-side',
      width: 680,
      height: 400,
      rooms: [
        { id: 'living', name: 'Kitchen / Living', x: 410, y: 40, w: 230, h: 280 },
        { id: 'bed-2', name: 'Bedroom 2', x: 260, y: 40, w: 150, h: 140 },
        { id: 'bed-1', name: 'Bedroom 1', x: 80, y: 40, w: 180, h: 140 },
        { id: 'store-1', name: 'Store', x: 340, y: 180, w: 70, h: 80 },
        { id: 'store-2', name: 'Store 2', x: 260, y: 180, w: 80, h: 80 },
        { id: 'bath', name: 'Bathroom', x: 80, y: 180, w: 130, h: 80 },
        { id: 'hall', name: 'Hallway', x: 80, y: 180, w: 330, h: 140 },
      ],
      doors: [],
      windows: [],
      walls: [],
    };
    expect(isLegacySideBySideLayout(draft)).toBe(true);
    const parsed = parseFloorPlan(draft);
    expect(parsed?.rooms.find((room) => room.id === 'living')).toMatchObject({
      x: 410,
      y: 40,
      w: 230,
      h: 280,
    });
    expect(parsed?.rooms).toHaveLength(7);
    expect(parsed?.width).toBe(680);
    expect(parsed?.height).toBe(400);
  });

  it('rotates a stored portrait stacked draft in place without rebuilding rooms', () => {
    const draft = {
      ...createEmptyFloorPlan('Home A'),
      id: 'sample-home-a',
      width: 400,
      height: 700,
      rooms: [
        { id: 'living', name: 'Kitchen / Living', x: 50, y: 50, w: 280, h: 230 },
        { id: 'bed-2', name: 'Bedroom 2', x: 50, y: 280, w: 140, h: 140 },
        { id: 'bed-1', name: 'Bedroom 1', x: 50, y: 420, w: 140, h: 180 },
        { id: 'bath', name: 'Bathroom', x: 190, y: 520, w: 120, h: 80 },
        { id: 'hall', name: 'Hallway', x: 190, y: 280, w: 140, h: 320 },
      ],
      doors: [],
      windows: [],
      walls: [],
    };
    const parsed = parseFloorPlan(draft);
    expect(parsed?.rooms).toHaveLength(5);
    expect(parsed?.width).toBe(700);
    expect(parsed?.height).toBe(400);
    expect(parsed?.rooms.some((room) => room.id === 'store')).toBe(false);
  });

  it('rotates a stored portrait stacked plan counterclockwise to landscape', () => {
    const portrait = {
      ...createEmptyFloorPlan('Home A'),
      id: 'sample-home-a',
      width: 400,
      height: 700,
      rooms: [
        { id: 'living', name: 'Kitchen / Living', x: 50, y: 50, w: 280, h: 230 },
        { id: 'bed-2', name: 'Bedroom 2', x: 50, y: 280, w: 140, h: 140 },
        { id: 'bed-1', name: 'Bedroom 1', x: 50, y: 420, w: 140, h: 180 },
        { id: 'bath', name: 'Bathroom', x: 190, y: 480, w: 80, h: 120, labelAngle: 90 as const },
        { id: 'store', name: 'Store', x: 250, y: 280, w: 80, h: 60 },
        { id: 'hall', name: 'Hallway', x: 190, y: 280, w: 140, h: 320 },
      ],
      doors: [],
      windows: [],
      walls: [],
      sensors: [{ id: 's1', kind: 'light' as const, label: 'Lamp', x: 100, y: 100 }],
    };
    const parsed = parseFloorPlan(portrait);
    expect(parsed?.width).toBe(700);
    expect(parsed?.height).toBe(400);
    expect(parsed?.rooms.find((room) => room.id === 'living')).toMatchObject({
      x: 50,
      y: 70,
      w: 230,
      h: 280,
    });
    // Bathroom label is horizontal again in the landscape drawing.
    expect(parsed?.rooms.find((room) => room.id === 'bath')?.labelAngle).toBeUndefined();
    // Sensors rotate with the drawing.
    expect(parsed?.sensors[0]).toMatchObject({ x: 100, y: 300 });
    expect(parsed?.rooms).toHaveLength(6);
  });

  it('builds the fictional Home B three-bed sample', () => {
    const plan = createHomeBPlan();
    expect(plan.beds).toBe(3);
    expect(plan.baths).toBe(2);
    expect(plan.name).toBe('Home B');
    expect(plan.rooms.map((room) => room.name)).toEqual([
      'Living',
      'Kitchen',
      'Hall',
      'Bedroom 1',
      'Bathroom 1',
      'Bedroom 2',
      'Bathroom 2',
      'Bedroom 3',
    ]);
    expect(plan.sensors).toHaveLength(0);
    expect(plan.doors.some((door) => door.id === 'front-door' && door.exterior)).toBe(true);
    expect(plan.walls.length).toBeGreaterThan(0);
    expect(parseFloorPlan(plan)?.rooms).toHaveLength(8);
    for (const room of plan.rooms) {
      expect(room.x % FLOOR_PLAN_GRID).toBe(0);
      expect(room.y % FLOOR_PLAN_GRID).toBe(0);
      expect(room.w).toBeGreaterThanOrEqual(MIN_ROOM_SIZE);
      expect(room.h).toBeGreaterThanOrEqual(MIN_ROOM_SIZE);
    }
  });

  it('rotates a room and a north door 90 degrees counterclockwise', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Living');
    plan = addOpening(plan, 'door', 140, 40);
    const door = plan.doors[0];
    expect(door?.wall).toBe('n');

    plan = rotateFloorPlanCounterClockwise(plan);
    expect(plan.width).toBe(740);
    expect(plan.height).toBe(1000);
    expect(plan.rooms[0]).toMatchObject({ x: 40, y: 760, w: 160, h: 200 });
    expect(plan.doors[0]?.wall).toBe('w');
    expect(plan.doors[0]?.hinge).toBe('end');
    expect(plan.doors[0]?.x).toBe(door?.y);
  });

  it('returns to the same layout after four counterclockwise turns', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Hall');
    plan = addOpening(plan, 'door', 140, 40);
    const original = JSON.parse(JSON.stringify(plan)) as typeof plan;
    plan = rotateFloorPlanCounterClockwise(plan);
    plan = rotateFloorPlanCounterClockwise(plan);
    plan = rotateFloorPlanCounterClockwise(plan);
    plan = rotateFloorPlanCounterClockwise(plan);
    expect(plan.rooms[0]?.x).toBe(original.rooms[0]?.x);
    expect(plan.rooms[0]?.y).toBe(original.rooms[0]?.y);
    expect(plan.rooms[0]?.w).toBe(original.rooms[0]?.w);
    expect(plan.rooms[0]?.h).toBe(original.rooms[0]?.h);
    expect(plan.doors[0]?.wall).toBe(original.doors[0]?.wall);
    expect(plan.doors[0]?.x).toBe(original.doors[0]?.x);
    expect(plan.doors[0]?.y).toBe(original.doors[0]?.y);
  });

  it('flips a room name by 90 degrees and keeps it when parsing', () => {
    let plan = addRoom(createEmptyFloorPlan(), { x: 40, y: 40, w: 200, h: 160 }, 'Balcony');
    const roomId = plan.rooms[0]?.id ?? '';
    expect(roomLabelAngle(plan.rooms[0] ?? {})).toBe(0);

    plan = rotateRoomLabel(plan, roomId);
    expect(plan.rooms[0]?.labelAngle).toBe(90);
    expect(hitTestPlan(plan, 140, 120)).toEqual({ kind: 'room-label', roomId });

    plan = rotateRoomLabel(plan, roomId);
    expect(plan.rooms[0]?.labelAngle).toBe(180);
    plan = rotateRoomLabel(plan, roomId);
    plan = rotateRoomLabel(plan, roomId);
    expect(plan.rooms[0]?.labelAngle).toBeUndefined();
    expect(
      parseFloorPlan(JSON.parse(JSON.stringify(rotateRoomLabel(plan, roomId))))?.rooms[0]
        ?.labelAngle
    ).toBe(90);
  });

  it('rotates a stored portrait sample plan when parsing', () => {
    const stored = {
      id: 'sample-portrait',
      name: 'Home B',
      beds: 1,
      baths: 0,
      width: 820,
      height: 860,
      rooms: [{ id: 'living', name: 'Living', x: 200, y: 120, w: 280, h: 340 }],
      walls: [],
      doors: [],
      windows: [],
      sensors: [],
    };
    const parsed = parseFloorPlan(stored);
    expect(parsed?.width).toBe(860);
    expect(parsed?.height).toBe(820);
    expect(parsed?.rooms[0]).toMatchObject({ x: 120, y: 340, w: 340, h: 280 });
  });

  it('crops the view box to the rooms instead of the empty canvas', () => {
    const empty = createEmptyFloorPlan();
    expect(planContentViewBox(empty)).toEqual({ x: 0, y: 0, width: 1000, height: 740 });

    const plan = addRoom(empty, { x: 400, y: 400, w: 200, h: 120 }, 'Kitchen');
    expect(planContentViewBox(plan, { padding: 40 })).toEqual({
      x: 360,
      y: 360,
      width: 280,
      height: 200,
    });
  });
});
