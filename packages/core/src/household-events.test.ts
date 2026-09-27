import { describe, expect, it } from 'vitest';
import {
  applyDeviceUpdatedEvent,
  buildCameraSnapshotEvent,
  buildDeviceUpdatedEvent,
  buildHouseholdStateEvent,
  channelForHouseholdPk,
  hasHouseholdSequenceGap,
  householdChannelForId,
  householdChannelPathForId,
  isHouseholdSubscribeAllowed,
  isNewerHouseholdEvent,
  parseCameraSnapshotEvent,
  parseDeviceUpdatedEvent,
  parseHouseholdStateEvent,
  reconnectDelayMs,
  sanitizeHouseholdState,
} from './household-events';
import { createCores3HouseholdState } from './hub';

describe('household event channels', () => {
  it('derives a tenant channel from a household partition', () => {
    expect(channelForHouseholdPk('HOUSEHOLD#user-abc')).toBe('household/user-abc');
    expect(householdChannelForId('user-abc')).toBe('household/user-abc');
    expect(householdChannelPathForId('user-abc')).toBe('/household/user-abc');
    expect(channelForHouseholdPk('USER#abc')).toBeNull();
  });

  it('allows subscribe only when the household Cognito group is present', () => {
    expect(isHouseholdSubscribeAllowed('/household/user-abc', ['hh_user-abc'])).toBe(true);
    expect(isHouseholdSubscribeAllowed('household/user-abc', 'hh_user-abc')).toBe(true);
    expect(isHouseholdSubscribeAllowed('/household/other', ['hh_user-abc'])).toBe(false);
    expect(isHouseholdSubscribeAllowed('/household/user-abc', null)).toBe(false);
  });
});

describe('household event envelope', () => {
  it('strips secrets and unsupported keys from the snapshot', () => {
    const state = sanitizeHouseholdState({
      ...createCores3HouseholdState(),
      setupCode: '1111-2222',
      cameraUrl: 'https://cam.example/live',
    } as ReturnType<typeof createCores3HouseholdState> & {
      setupCode: string;
      cameraUrl: string;
    });
    expect(state).not.toHaveProperty('setupCode');
    expect(state).not.toHaveProperty('cameraUrl');
  });

  it('keeps contact motion and leak hour-dot history', () => {
    const state = sanitizeHouseholdState({
      ...createCores3HouseholdState(),
      sensorHistory: {
        'matter-5': {
          kind: 'contact',
          events: [{ kind: 'contact', at: '2026-09-18T16:08:56Z', value: 'OPEN' }],
        },
      },
    });
    expect(state.sensorHistory?.['matter-5']?.events[0]?.value).toBe('OPEN');
  });

  it('parses a supported envelope and ignores older versions', () => {
    const event = buildHouseholdStateEvent({
      eventId: 'evt-1',
      state: {
        ...createCores3HouseholdState(),
        stateVersion: 4,
        updatedAt: '2026-09-17T12:00:00Z',
      },
    });
    expect(parseHouseholdStateEvent({ event })).toEqual(event);
    expect(parseHouseholdStateEvent({ type: 'household.state.v0', eventId: 'x' })).toBeNull();
    expect(isNewerHouseholdEvent({ stateVersion: 5 }, { stateVersion: 4 })).toBe(true);
    expect(isNewerHouseholdEvent({ stateVersion: 3 }, { stateVersion: 4 })).toBe(false);
    expect(hasHouseholdSequenceGap(6, 4)).toBe(true);
    expect(hasHouseholdSequenceGap(5, 4)).toBe(false);
  });

  it('parses a camera snapshot ping and ignores other envelopes', () => {
    const event = buildCameraSnapshotEvent({
      eventId: 'cam-1:2026-09-21T00:00:00Z',
      deviceId: 'cam-1',
      recordedAt: '2026-09-21T00:00:00Z',
    });
    expect(parseCameraSnapshotEvent({ event })).toEqual(event);
    expect(parseCameraSnapshotEvent({ type: 'household.state.v1', eventId: 'x' })).toBeNull();
    expect(parseHouseholdStateEvent(event)).toBeNull();
  });

  it('parses a device update and patches camera occupancy', () => {
    const event = buildDeviceUpdatedEvent({
      eventId: 'cam-1:updated:2026-09-21T00:00:00Z',
      deviceId: 'cam-1',
      recordedAt: '2026-09-21T00:00:00Z',
      status: 'ONLINE',
      occupied: true,
    });
    expect(parseDeviceUpdatedEvent({ event })).toEqual(event);
    expect(parseDeviceUpdatedEvent({ type: 'camera.snapshot.v1', eventId: 'x' })).toBeNull();
    expect(parseHouseholdStateEvent(event)).toBeNull();
    const patched = applyDeviceUpdatedEvent(
      {
        deviceId: 'cam-1',
        name: 'Hall',
        type: 'camera',
        status: 'UNKNOWN',
        lifecycleStatus: 'READY',
        createdAt: '2026-09-20T00:00:00Z',
        updatedAt: '2026-09-20T00:00:00Z',
      },
      event
    );
    expect(patched.status).toBe('ONLINE');
    expect(patched.lastReading?.metrics.occupied).toBe(true);
    const other = { ...patched, deviceId: 'other', lastReading: undefined };
    expect(applyDeviceUpdatedEvent(other, event)).toEqual(other);
  });

  it('uses jittered exponential reconnect delays', () => {
    expect(reconnectDelayMs(0, 0)).toBe(500);
    expect(reconnectDelayMs(1, 1)).toBe(2000);
    expect(reconnectDelayMs(10, 1)).toBe(30_000);
  });
});
