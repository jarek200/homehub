import { describe, expect, it } from 'vitest';
import { addRoom, createEmptyFloorPlan, stampFloorPlan } from './floor-plan';
import {
  addNamedPlan,
  DEFAULT_HOME_PLAN_NAME,
  deviceIdsInLibrary,
  deviceListLocation,
  emptyFloorPlanLibrary,
  libraryActivePlan,
  libraryDeviceLocation,
  libraryFromLegacyPlan,
  libraryHasContent,
  mergeFloorPlanLibraries,
  parseFloorPlanLibrary,
  switchActivePlan,
  upsertLibraryPlan,
} from './floor-plan-library';

describe('floor plan library', () => {
  it('keeps a legacy singleton name', () => {
    const plan = addRoom(
      createEmptyFloorPlan('Cottage'),
      { x: 40, y: 40, w: 200, h: 160 },
      'Living'
    );
    const library = libraryFromLegacyPlan(plan);
    expect(library.plans).toHaveLength(1);
    expect(library.plans[0]?.name).toBe('Cottage');
    expect(library.activePlanId).toBe(plan.id);
    expect(libraryHasContent(library)).toBe(true);
  });

  it('defaults a blank singleton name', () => {
    const plan = addRoom(
      { ...createEmptyFloorPlan(''), name: '   ' },
      { x: 40, y: 40, w: 200, h: 160 },
      'Living'
    );
    expect(libraryFromLegacyPlan(plan).plans[0]?.name).toBe(DEFAULT_HOME_PLAN_NAME);
  });

  it('adds a named plan and makes it active', () => {
    const homeA = libraryFromLegacyPlan(
      addRoom(
        { ...createEmptyFloorPlan('Home A'), id: 'home-a' },
        { x: 40, y: 40, w: 200, h: 160 },
        'Living'
      )
    );
    const next = addNamedPlan(homeA, 'Home B');
    expect(next.plans.map((plan) => plan.name)).toEqual(['Home A', 'Home B']);
    expect(libraryActivePlan(next).name).toBe('Home B');
    expect(libraryActivePlan(next).rooms).toHaveLength(0);
  });

  it('ignores a blank plan name', () => {
    const library = emptyFloorPlanLibrary();
    expect(library.plans[0]?.name).toBe(DEFAULT_HOME_PLAN_NAME);
    expect(addNamedPlan(library, '   ')).toBe(library);
  });

  it('toggles the active plan', () => {
    const homeA = libraryFromLegacyPlan(
      addRoom(
        { ...createEmptyFloorPlan(), id: 'home-a' },
        { x: 40, y: 40, w: 200, h: 160 },
        'Living'
      )
    );
    const two = addNamedPlan(homeA, 'Home B');
    const back = switchActivePlan(two, 'home-a');
    expect(libraryActivePlan(back).id).toBe('home-a');
    expect(switchActivePlan(back, 'missing')).toBe(back);
  });

  it('upserts edits onto the active drawing', () => {
    const library = libraryFromLegacyPlan(
      addRoom(
        { ...createEmptyFloorPlan(), id: 'home-a' },
        { x: 40, y: 40, w: 200, h: 160 },
        'Living'
      )
    );
    const edited = addRoom(
      libraryActivePlan(library),
      { x: 260, y: 40, w: 120, h: 100 },
      'Kitchen'
    );
    const next = upsertLibraryPlan(library, edited);
    expect(libraryActivePlan(next).rooms.map((room) => room.name)).toEqual(['Living', 'Kitchen']);
  });

  it('merges libraries by plan id and prefers the local active home', () => {
    const localHomeA = stampFloorPlan(
      addRoom(
        { ...createEmptyFloorPlan(), id: 'home-a', name: 'Home A' },
        { x: 40, y: 40, w: 200, h: 160 },
        'Local'
      ),
      '2026-09-12T12:00:00.000Z'
    );
    const remoteHomeA = stampFloorPlan(
      addRoom(
        { ...createEmptyFloorPlan(), id: 'home-a', name: 'Home A' },
        { x: 40, y: 40, w: 200, h: 160 },
        'Remote'
      ),
      '2026-09-12T11:00:00.000Z'
    );
    const local = addNamedPlan(libraryFromLegacyPlan(localHomeA), 'Home B');
    const remote = { activePlanId: 'home-a', plans: [remoteHomeA] };
    const merged = mergeFloorPlanLibraries(local, remote);
    expect(merged.plans.map((plan) => plan.name)).toEqual(['Home A', 'Home B']);
    expect(merged.plans[0]?.rooms[0]?.name).toBe('Local');
    expect(libraryActivePlan(merged).name).toBe('Home B');
  });

  it('prefers a richer stored drawing over a leftover draft with a different id', () => {
    const draft = {
      ...createEmptyFloorPlan('Home B'),
      id: 'plan-old-side',
      width: 680,
      height: 400,
      rooms: [
        { id: 'living', name: 'Kitchen / Living', x: 410, y: 40, w: 230, h: 280 },
        { id: 'store-1', name: 'Store', x: 340, y: 180, w: 70, h: 80 },
      ],
      doors: [],
      windows: [],
      walls: [],
      sensors: [],
    };
    const current = {
      ...createEmptyFloorPlan('Home B'),
      id: 'home-b-current',
      rooms: [
        { id: 'living', name: 'Kitchen / Living', x: 50, y: 70, w: 230, h: 280 },
        { id: 'bed-1', name: 'Bedroom 1', x: 280, y: 70, w: 140, h: 180 },
        { id: 'bed-2', name: 'Bedroom 2', x: 280, y: 250, w: 140, h: 140 },
        { id: 'bath', name: 'Bathroom', x: 480, y: 130, w: 80, h: 120 },
        { id: 'store', name: 'Store', x: 480, y: 70, w: 80, h: 60 },
        { id: 'hall', name: 'Hallway', x: 230, y: 70, w: 50, h: 280 },
      ],
      sensors: [{ id: 's1', kind: 'leak' as const, label: 'Sink', x: 110, y: 100 }],
    };
    const merged = mergeFloorPlanLibraries(
      { activePlanId: current.id, plans: [current] },
      { activePlanId: draft.id, plans: [draft] }
    );
    expect(merged.plans).toHaveLength(1);
    expect(merged.plans[0]?.id).toBe(current.id);
    expect(merged.plans[0]?.sensors).toHaveLength(1);
    expect(merged.plans[0]?.rooms).toHaveLength(6);
  });

  it('keeps one drawing when local and remote singletons have different ids', () => {
    const local = libraryFromLegacyPlan(
      addRoom(
        { ...createEmptyFloorPlan(), id: 'user-plan' },
        { x: 40, y: 40, w: 80, h: 80 },
        'Hall'
      )
    );
    const remote = libraryFromLegacyPlan(
      addRoom(
        addRoom(
          { ...createEmptyFloorPlan(), id: 'sample-home-a' },
          { x: 40, y: 40, w: 200, h: 160 },
          'Living'
        ),
        { x: 260, y: 40, w: 120, h: 100 },
        'Kitchen'
      )
    );
    const merged = mergeFloorPlanLibraries(local, remote);
    expect(merged.plans).toHaveLength(1);
    expect(merged.plans[0]?.id).toBe('sample-home-a');
    expect(merged.plans[0]?.name).toBe('My plan');
  });

  it('collapses two Home A copies and keeps Home B', () => {
    const homeA = addRoom(
      { ...createEmptyFloorPlan('Home A'), id: 'sample-home-a' },
      { x: 40, y: 40, w: 200, h: 160 },
      'Living'
    );
    const leftover = addRoom(
      { ...createEmptyFloorPlan('Home A'), id: 'user-plan' },
      { x: 40, y: 40, w: 80, h: 80 },
      'Hall'
    );
    const homeB = { ...createEmptyFloorPlan('Home B'), id: 'home-b' };
    const merged = mergeFloorPlanLibraries(
      { activePlanId: 'home-b', plans: [homeA, leftover, homeB] },
      { activePlanId: 'sample-home-a', plans: [homeA] }
    );
    expect(merged.plans.map((plan) => plan.name)).toEqual(['Home A', 'Home B']);
    expect(merged.plans[0]?.id).toBe('sample-home-a');
  });

  it('takes a remote drawing when the local library is still empty', () => {
    const remote = libraryFromLegacyPlan(
      addRoom(createEmptyFloorPlan('Home A'), { x: 40, y: 40, w: 200, h: 160 }, 'Living')
    );
    const merged = mergeFloorPlanLibraries(emptyFloorPlanLibrary(), remote);
    expect(libraryActivePlan(merged).rooms[0]?.name).toBe('Living');
    expect(libraryActivePlan(merged).name).toBe('Home A');
  });

  it('parses a stored library and lists devices on one plan', () => {
    const homeA = {
      ...createEmptyFloorPlan('Home A'),
      id: 'home-a',
      rooms: [{ id: 'living', name: 'Living', x: 40, y: 40, w: 200, h: 160 }],
      sensors: [
        { id: 's1', kind: 'light' as const, label: 'Lamp', x: 80, y: 80, deviceId: 'bulb-1' },
      ],
    };
    const parsed = parseFloorPlanLibrary({
      activePlanId: 'home-a',
      plans: [homeA, { ...createEmptyFloorPlan('Home B'), id: 'home-b' }],
    });
    expect(parsed).toBeTruthy();
    if (!parsed) return;
    expect(parsed.plans).toHaveLength(2);
    expect(deviceIdsInLibrary(parsed, 'home-a')).toEqual(new Set(['bulb-1']));
    expect(deviceIdsInLibrary(parsed, 'all')).toBeNull();
    expect(deviceIdsInLibrary(parsed, 'home-b')?.size).toBe(0);
  });

  it('resolves device list locations from the active plan room', () => {
    const homeB = {
      ...createEmptyFloorPlan('Home B'),
      id: 'home-b',
      rooms: [{ id: 'hall', name: 'Hallway', x: 0, y: 0, w: 200, h: 200 }],
      sensors: [
        {
          id: 'door',
          kind: 'contact' as const,
          label: 'Main Door',
          x: 10,
          y: 10,
          deviceId: 'matter-5',
        },
      ],
    };
    const homeA = {
      ...createEmptyFloorPlan('Home A'),
      id: 'home-a',
      rooms: [{ id: 'living', name: 'Living', x: 0, y: 0, w: 200, h: 200 }],
      sensors: [
        {
          id: 'door',
          kind: 'contact' as const,
          label: 'Door BLC',
          x: 10,
          y: 10,
          deviceId: 'matter-5',
        },
      ],
    };
    const library = { activePlanId: 'home-b', plans: [homeA, homeB] };
    expect(libraryDeviceLocation(library, 'matter-5')).toBe('Hallway');
    expect(libraryDeviceLocation(library, 'matter-5', 'home-a')).toBe('Living');
    expect(deviceListLocation(library, { deviceId: 'matter-5', location: 'Home' })).toBe('Hallway');
    expect(deviceListLocation(library, { deviceId: 'cores3-gateway', location: 'Home' })).toBe(
      'Home'
    );
  });
});
