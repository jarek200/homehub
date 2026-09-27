import { createCores3HouseholdState } from '@homehub/core';
import { describe, expect, it } from 'vitest';
import { deviceListUnavailable } from './household-overlay';

function camera(status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN') {
  return {
    deviceId: 'cam-1',
    name: 'Timer Camera F',
    type: 'camera',
    status,
    lifecycleStatus: 'READY' as const,
    createdAt: '2026-09-18T00:00:00Z',
    updatedAt: '2026-09-18T00:00:00Z',
  };
}

describe('deviceListUnavailable', () => {
  const household = createCores3HouseholdState();

  it('greys out a camera that is not powered on', () => {
    expect(deviceListUnavailable(camera('OFFLINE'), household)).toBe(true);
    expect(deviceListUnavailable(camera('UNKNOWN'), household)).toBe(true);
    expect(deviceListUnavailable(camera('ONLINE'), household)).toBe(false);
  });

  it('still greys out unpowered lights from household live', () => {
    const live = createCores3HouseholdState();
    const light = live.lights[0];
    if (!light) throw new Error('expected fixture light');
    live.lights[0] = { ...light, reachable: false };
    expect(
      deviceListUnavailable(
        {
          deviceId: light.id,
          name: light.name,
          type: 'light',
          status: 'ONLINE',
          lifecycleStatus: 'READY',
          createdAt: '2026-09-18T00:00:00Z',
          updatedAt: '2026-09-18T00:00:00Z',
        },
        live
      )
    ).toBe(true);
  });
});
