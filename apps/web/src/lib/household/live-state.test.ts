import {
  hasHouseholdSequenceGap,
  isNewerHouseholdEvent,
  parseCameraSnapshotEvent,
  parseDeviceUpdatedEvent,
  parseHouseholdStateEvent,
  reconnectDelayMs,
} from '@homehub/core';
import { describe, expect, it } from 'vitest';

describe('live household event application', () => {
  it('applies only supported newer events', () => {
    const current = { stateVersion: 4, updatedAt: '2026-09-17T12:00:00Z' };
    const next = parseHouseholdStateEvent({
      type: 'household.state.v1',
      eventId: 'evt-2',
      stateVersion: 5,
      updatedAt: '2026-09-17T12:00:01Z',
      state: {
        lock: null,
        lights: [],
        plugs: [],
        contacts: [],
        motions: [],
        leaks: [],
        buttons: [],
        scene: 'home',
        updatedAt: '2026-09-17T12:00:01Z',
        stateVersion: 5,
      },
    });
    expect(next).not.toBeNull();
    expect(isNewerHouseholdEvent(next ?? {}, current)).toBe(true);
    expect(isNewerHouseholdEvent({ stateVersion: 3 }, current)).toBe(false);
  });

  it('detects sequence gaps that should trigger a REST reconcile', () => {
    expect(hasHouseholdSequenceGap(8, 5)).toBe(true);
    expect(hasHouseholdSequenceGap(6, 5)).toBe(false);
  });

  it('parses a camera snapshot ping without treating it as household state', () => {
    const snapshot = parseCameraSnapshotEvent({
      type: 'camera.snapshot.v1',
      eventId: 'cam-1:2026-09-21T00:00:00Z',
      deviceId: 'cam-1',
      recordedAt: '2026-09-21T00:00:00Z',
    });
    expect(snapshot?.deviceId).toBe('cam-1');
    expect(parseHouseholdStateEvent(snapshot)).toBeNull();
  });

  it('parses a device update without treating it as household state', () => {
    const update = parseDeviceUpdatedEvent({
      type: 'device.updated.v1',
      eventId: 'cam-1:updated:2026-09-21T00:00:00Z',
      deviceId: 'cam-1',
      recordedAt: '2026-09-21T00:00:00Z',
      status: 'ONLINE',
      occupied: true,
    });
    expect(update?.occupied).toBe(true);
    expect(parseHouseholdStateEvent(update)).toBeNull();
    expect(parseCameraSnapshotEvent(update)).toBeNull();
  });

  it('backs off reconnects with jitter and a 30s cap', () => {
    expect(reconnectDelayMs(0, 0.5)).toBe(750);
    expect(reconnectDelayMs(3, 0)).toBe(4000);
    expect(reconnectDelayMs(20, 1)).toBe(30_000);
  });
});
