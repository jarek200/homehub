import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATUSES } from './devices';
import {
  airQualityLabel,
  applyHouseholdLiveToMetrics,
  applyHubCommand,
  applyHubDevice,
  createCores3HouseholdState,
  householdDeviceDetail,
  householdDeviceHeadline,
  householdDevicesForKind,
  householdDeviceValue,
  householdKindLabel,
  householdLiveForDevice,
  householdLiveUnavailable,
  householdSensorClimate,
  householdSensorHasPower,
  householdSensorMotion,
  householdSensorStatus,
  hubDeviceCommand,
  lightsOnCount,
  listHouseholdDevices,
  sortHouseholdDevices,
} from './hub';

describe('LIFECYCLE_STATUSES', () => {
  it('includes provisioning and ready states', () => {
    expect(LIFECYCLE_STATUSES).toContain('PROVISIONING');
    expect(LIFECYCLE_STATUSES).toContain('READY');
    expect(LIFECYCLE_STATUSES).toContain('FAILED');
    expect(LIFECYCLE_STATUSES).toContain('DECOMMISSIONED');
  });
});

describe('cores3 household state', () => {
  const household = createCores3HouseholdState();

  it('exposes the commissioned fabric and no dummy rooms', () => {
    expect(household.lock).toBeNull();
    expect(household.lights).toEqual([
      { id: 'matter-1', name: 'KAJPLATS', on: true, brightness: 100 },
      { id: 'matter-11', name: 'KAJPLATS 2', on: true, brightness: 100 },
    ]);
    expect(household.leaks).toEqual([{ id: 'matter-7', name: 'KLIPPBOK', state: 'DRY' }]);
    expect(household.plugs).toEqual([
      { id: 'matter-9', name: 'GRILLPLATS', on: true },
      { id: 'matter-10', name: 'GRILLPLATS 2', on: true },
    ]);
    expect(household.climates?.map((item) => item.id)).toEqual([
      'matter-2',
      'matter-3',
      'matter-6',
    ]);
  });

  it('maps climate sensors by device id', () => {
    const live = {
      ...household,
      climates: household.climates?.map((item) =>
        item.id === 'matter-6'
          ? { ...item, temperature: 24.7, humidity: 52, co2: 900, pm25: 8, airQuality: 2 }
          : item
      ),
    };
    expect(
      householdSensorClimate({ id: 'plan-air', label: 'ALPSTUGA', deviceId: 'matter-6' }, live)
    ).toMatchObject({ temperature: 24.7, humidity: 52, co2: 900, pm25: 8, airQuality: 2 });
    expect(airQualityLabel(2)).toBe('Fair');
  });

  it('lists live plugs and leaks for the floor-plan picker', () => {
    expect(householdDevicesForKind('plug', household).map((item) => item.name)).toEqual([
      'GRILLPLATS',
      'GRILLPLATS 2',
    ]);
    expect(householdDevicesForKind('leak', household).map((item) => item.name)).toEqual([
      'KLIPPBOK',
    ]);
    expect(householdDevicesForKind('camera', household)).toEqual([]);
  });

  it('maps fabric sensors by device id', () => {
    expect(
      householdSensorStatus(
        { id: 'plan-light', kind: 'light', label: 'KAJPLATS', deviceId: 'matter-1' },
        household
      )
    ).toBe('ON');
    expect(
      householdSensorStatus(
        { id: 'plan-motion', kind: 'motion', label: 'MYGGSPRAY', deviceId: 'matter-4' },
        household
      )
    ).toBe('DETECTED');
    expect(
      householdSensorMotion(
        { id: 'plan-motion', label: 'MYGGSPRAY', deviceId: 'matter-4' },
        { ...household, motions: [{ ...household.motions[0], lux: 42 }] }
      )?.lux
    ).toBe(42);
    expect(
      householdSensorStatus(
        { id: 'plan-contact', kind: 'contact', label: 'MYGGBETT', deviceId: 'matter-5' },
        household
      )
    ).toBe('CLOSED');
    expect(
      householdSensorStatus(
        { id: 'nuki-1', kind: 'lock', label: 'Nuki' },
        household,
        'Entrance Hall'
      )
    ).toBeNull();
    expect(
      householdSensorStatus(
        { id: 'plan-leak', kind: 'leak', label: 'KLIPPBOK', deviceId: 'matter-7' },
        household
      )
    ).toBe('DRY');
    expect(
      householdSensorStatus(
        { id: 'plan-plug', kind: 'plug', label: 'GRILLPLATS', deviceId: 'matter-9' },
        household
      )
    ).toBe('ON');
    expect(
      householdSensorStatus(
        { id: 'plan-plug-2', kind: 'plug', label: 'GRILLPLATS 2', deviceId: 'matter-10' },
        household
      )
    ).toBe('ON');
    const unpowered = {
      ...household,
      lights: [{ ...household.lights[0], on: true, reachable: false }, household.lights[1]],
      plugs: [{ ...household.plugs[0], on: true, reachable: false }, household.plugs[1]],
    };
    expect(
      householdSensorStatus(
        { id: 'plan-light', kind: 'light', label: 'KAJPLATS', deviceId: 'matter-1' },
        unpowered
      )
    ).toBe('ON');
    expect(
      householdSensorHasPower(
        { id: 'plan-light', kind: 'light', label: 'KAJPLATS', deviceId: 'matter-1' },
        unpowered
      )
    ).toBe(false);
    expect(
      householdSensorStatus(
        { id: 'plan-plug', kind: 'plug', label: 'GRILLPLATS', deviceId: 'matter-9' },
        unpowered
      )
    ).toBe('ON');
    expect(
      householdSensorHasPower(
        { id: 'plan-plug', kind: 'plug', label: 'GRILLPLATS', deviceId: 'matter-9' },
        unpowered
      )
    ).toBe(false);
    expect(
      householdSensorStatus({ id: 'leak-1', kind: 'leak', label: 'Leak 1' }, household, 'Kitchen')
    ).toBeNull();
  });

  it('does not count an unreachable bulb as on', () => {
    expect(lightsOnCount(household)).toBe(2);
    expect(
      lightsOnCount({
        ...household,
        lights: [{ ...household.lights[0], on: true, reachable: false }, household.lights[1]],
      })
    ).toBe(1);
    const stale = {
      ...household,
      lights: [{ ...household.lights[0], on: true, stale: true }, household.lights[1]],
    };
    expect(
      householdSensorStatus(
        { id: 'plan-light', kind: 'light', label: 'KAJPLATS', deviceId: 'matter-1' },
        stale
      )
    ).toBe('ON');
    expect(
      householdSensorHasPower(
        { id: 'plan-light', kind: 'light', label: 'KAJPLATS', deviceId: 'matter-1' },
        stale
      )
    ).toBe(false);
    expect(
      lightsOnCount({
        ...household,
        lights: [{ ...household.lights[0], on: true, stale: true }, household.lights[1]],
      })
    ).toBe(1);
  });

  it('dims every light for evening without inventing a hallway fixture', () => {
    const evening = applyHubCommand(household, 'evening');
    expect(evening.scene).toBe('evening');
    expect(evening.lights[0]).toMatchObject({ id: 'matter-1', on: true, brightness: 40 });
    expect(evening.lights[1]).toMatchObject({ id: 'matter-11', on: true, brightness: 40 });
    expect(applyHubCommand(household, 'lock-house').lock).toBeNull();
  });

  it('sets away without changing lights', () => {
    const away = applyHubCommand(household, 'away');
    expect(away.scene).toBe('away');
    expect(away.lights.every((light) => light.on)).toBe(true);
  });

  it('sets home without changing lights', () => {
    const away = applyHubCommand(household, 'away');
    const home = applyHubCommand(away, 'home');
    expect(home.scene).toBe('home');
    expect(home.lights.every((light) => light.on)).toBe(true);
  });

  it('turns every plug off without touching lights', () => {
    const off = applyHubCommand(household, 'all-plugs-off');
    expect(off.plugs.every((plug) => !plug.on)).toBe(true);
    expect(off.lights.every((light) => light.on)).toBe(true);
    expect(off.scene).toBe(household.scene);
  });

  it('uses the local hub kind names', () => {
    expect(householdKindLabel({ kind: 'contact', name: 'MYGGBETT' })).toBe('Contact');
    expect(householdKindLabel({ kind: 'light', name: 'KAJPLATS' })).toBe('Light');
    expect(householdKindLabel({ kind: 'climate', name: 'TIMMERFLOTTE 1' })).toBe('Temp/Humidity');
    expect(householdKindLabel({ kind: 'climate', name: 'ALPSTUGA' })).toBe('Environmental');
  });

  it('lists live household cards in the local order', () => {
    const listed = sortHouseholdDevices(listHouseholdDevices(household), (device) => device.id);
    expect(listed.map((device) => householdKindLabel(device))).toEqual([
      'Contact',
      'Environmental',
      'Leak',
      'Light',
      'Light',
      'Motion',
      'Plug',
      'Plug',
      'Temp/Humidity',
      'Temp/Humidity',
    ]);
    expect(
      householdDeviceHeadline({
        id: 'matter-4',
        name: 'MYGGSPRAY',
        kind: 'motion',
        state: 'CLEAR',
        lux: 22,
      })
    ).toBe('CLEAR');
    expect(
      householdDeviceDetail({
        id: 'matter-4',
        name: 'MYGGSPRAY',
        kind: 'motion',
        state: 'CLEAR',
        lux: 22,
      })
    ).toBe('22 lx');
    expect(
      householdDeviceValue({
        id: 'matter-4',
        name: 'MYGGSPRAY',
        kind: 'motion',
        state: 'CLEAR',
        lux: 22,
      })
    ).toBe('CLEAR · 22 lx');
    expect(
      householdDeviceHeadline({
        id: 'matter-3',
        name: 'ALPSTUGA',
        kind: 'climate',
        temperature: 22,
        humidity: 64,
        co2: 445,
        pm25: 0,
        airQuality: 1,
      })
    ).toBe('22°/64%');
    expect(
      householdDeviceDetail({
        id: 'matter-3',
        name: 'ALPSTUGA',
        kind: 'climate',
        temperature: 22,
        humidity: 64,
        co2: 445,
        pm25: 0,
        airQuality: 1,
      })
    ).toBe('445 · 0 · Good');
  });

  it('overlays live contact and unpowered lights for the devices list', () => {
    expect(householdLiveForDevice(household, 'matter-5')?.state).toBe('CLOSED');
    expect(
      applyHouseholdLiveToMetrics(
        { id: 'matter-5', name: 'MYGGBETT', kind: 'contact', state: 'CLOSED' },
        { open: true, batteryPercent: 82 }
      )
    ).toEqual({ open: false, batteryPercent: 82 });
    expect(
      householdLiveUnavailable({
        id: 'matter-1',
        name: 'KAJPLATS',
        kind: 'light',
        on: true,
        reachable: false,
      })
    ).toBe(true);
    expect(
      householdLiveUnavailable({
        id: 'matter-5',
        name: 'MYGGBETT',
        kind: 'contact',
        state: 'CLOSED',
      })
    ).toBe(false);
  });

  it('applies a single light or plug change', () => {
    const dimmed = applyHubDevice(household, 'light', 'matter-1', { brightness: 40 });
    expect(dimmed.lights[0]).toMatchObject({ id: 'matter-1', on: true, brightness: 40 });
    expect(dimmed.lights[1]?.on).toBe(true);
    const off = applyHubDevice(household, 'plug', 'matter-10', { on: false });
    expect(off.plugs[1]).toMatchObject({ id: 'matter-10', on: false });
    expect(off.plugs[0]?.on).toBe(true);
  });

  it('maps device actions to the firmware command strings', () => {
    expect(hubDeviceCommand('light', 'matter-1', { on: false })).toBe('light-off-matter-1');
    expect(hubDeviceCommand('light', 'matter-1', { brightness: 40 })).toBe('light-bri-matter-1-40');
    expect(hubDeviceCommand('plug', 'matter-9', { on: true })).toBe('plug-on');
    expect(hubDeviceCommand('plug', 'matter-10', { on: false })).toBe('plug-off-11');
  });
});
