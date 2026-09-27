import { createCores3HouseholdState, type Device, type FloorPlanSensor } from '@homehub/core';
import { describe, expect, it } from 'vitest';
import {
  cameraStatusFromDevice,
  sensorIsUnavailable,
  sensorReadingLines,
  sensorReadingText,
  sensorStatus,
} from './sensor-status';

const climate: FloorPlanSensor = {
  id: 'plan-air',
  kind: 'climate',
  label: 'ALPSTUGA',
  deviceId: 'matter-6',
  x: 10,
  y: 10,
};

function liveHousehold() {
  return {
    ...createCores3HouseholdState(),
    climates: [
      {
        id: 'matter-6',
        name: 'ALPSTUGA',
        temperature: 23.2,
        humidity: 74.4,
        co2: 1114,
        pm25: 0,
        airQuality: 4,
      },
    ],
  };
}

describe('light reachability on the floor plan', () => {
  it('keeps the last ON value when the bulb stopped answering', () => {
    const household = {
      ...createCores3HouseholdState(),
      lights: [{ id: 'matter-1', name: 'KAJPLATS', on: true, brightness: 100, reachable: false }],
    };
    expect(
      sensorStatus(
        { id: 'plan-light', kind: 'light', label: 'Bulb', deviceId: 'matter-1', x: 10, y: 10 },
        household
      )
    ).toBe('ON');
  });

  it('marks an unpowered light unavailable', () => {
    const household = {
      ...createCores3HouseholdState(),
      lights: [{ id: 'matter-1', name: 'KAJPLATS', on: true, brightness: 100, reachable: false }],
    };
    expect(
      sensorIsUnavailable(
        { id: 'plan-light', kind: 'light', label: 'Bulb', deviceId: 'matter-1', x: 10, y: 10 },
        household
      )
    ).toBe(true);
  });

  it('marks a stale light unavailable and keeps the last on value', () => {
    const household = {
      ...createCores3HouseholdState(),
      lights: [{ id: 'matter-1', name: 'KAJPLATS', on: true, brightness: 100, stale: true }],
    };
    const sensor = {
      id: 'plan-light',
      kind: 'light' as const,
      label: 'Bulb',
      deviceId: 'matter-1',
      x: 10,
      y: 10,
    };
    expect(sensorIsUnavailable(sensor, household)).toBe(true);
    expect(sensorStatus(sensor, household)).toBe('ON');
  });
});

describe('stale devices on the floor plan', () => {
  it('marks stale motion and climate sensors unavailable', () => {
    const household = {
      ...liveHousehold(),
      motions: [{ id: 'matter-4', name: 'MYGGSPRAY', state: 'CLEAR' as const, stale: true }],
      climates: [{ ...liveHousehold().climates[0], stale: true }],
    };
    expect(
      sensorIsUnavailable(
        {
          id: 'plan-motion',
          kind: 'motion',
          label: 'Motion',
          deviceId: 'matter-4',
          x: 10,
          y: 10,
        },
        household
      )
    ).toBe(true);
    expect(sensorIsUnavailable(climate, household)).toBe(true);
  });
});

function cameraDevice(overrides: Partial<Device> = {}): Device {
  return {
    deviceId: 'cam-1',
    name: 'Hall camera',
    type: 'camera',
    status: 'ONLINE',
    lifecycleStatus: 'READY',
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-17T15:42:00Z',
    lastSnapshotAt: '2026-09-17T15:42:00Z',
    lastReading: {
      readingId: 'r1',
      deviceId: 'cam-1',
      alarm: false,
      state: 'normal',
      metrics: { occupied: true },
      recordedAt: '2026-09-17T15:42:00Z',
      createdAt: '2026-09-17T15:42:00Z',
    },
    ...overrides,
  };
}

const planCamera: FloorPlanSensor = {
  id: 'plan-cam',
  kind: 'camera',
  label: 'Hall',
  deviceId: 'cam-1',
  x: 20,
  y: 20,
};

describe('camera status from a REST device', () => {
  const household = createCores3HouseholdState();

  it('shows DETECTED when the last reading is occupied', () => {
    const device = cameraDevice();
    expect(cameraStatusFromDevice(device)).toBe('DETECTED');
    expect(sensorStatus(planCamera, household, 'Hall', device)).toBe('DETECTED');
    expect(sensorIsUnavailable(planCamera, household, 'Hall', device)).toBe(false);
  });

  it('shows CLEAR when the camera is up and idle', () => {
    const device = cameraDevice({
      lastReading: {
        readingId: 'r2',
        deviceId: 'cam-1',
        alarm: false,
        state: 'normal',
        metrics: { occupied: false },
        recordedAt: '2026-09-17T15:50:00Z',
        createdAt: '2026-09-17T15:50:00Z',
      },
    });
    expect(cameraStatusFromDevice(device)).toBe('CLEAR');
    expect(sensorStatus(planCamera, household, 'Hall', device)).toBe('CLEAR');
  });

  it('marks a missing or offline camera unavailable', () => {
    expect(sensorStatus(planCamera, household)).toBe('OFFLINE');
    expect(sensorIsUnavailable(planCamera, household)).toBe(true);
    expect(
      sensorIsUnavailable(planCamera, household, 'Hall', cameraDevice({ status: 'OFFLINE' }))
    ).toBe(true);
  });
});

describe('climate reading on the floor plan', () => {
  it('shows temp, humidity, CO2, PM2.5 and air quality together', () => {
    const household = liveHousehold();
    expect(sensorReadingText(climate, household)).toBe('23°/74% · 1114 · 0 · Poor');
    expect(sensorStatus(climate, household)).toBe('23°/74% · 1114 · 0 · Poor');
    expect(sensorReadingLines(climate, household)).toEqual(['23°/74%', '1114 · 0 · Poor']);
  });
});
