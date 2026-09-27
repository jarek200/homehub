import type { Device, HubHouseholdState, Reading } from '@homehub/core';
import {
  applyHouseholdLiveToMetrics,
  householdLiveForDevice,
  householdLiveUnavailable,
} from '@homehub/core';

/** Fade a list row the same way the plan does for dead lights, plugs, and cameras. */
export function deviceListUnavailable(
  device: Device,
  household: HubHouseholdState | null | undefined
): boolean {
  if (device.type === 'camera') return device.status !== 'ONLINE';
  return householdLiveUnavailable(householdLiveForDevice(household, device.deviceId));
}

/** Prefer the CoreS3 household snapshot over a stale Dynamo reading. */
export function overlayDeviceWithHousehold(
  device: Device,
  household: HubHouseholdState | null | undefined
): Device {
  const live = householdLiveForDevice(household, device.deviceId);
  if (!live || !household) return device;
  const base = device.lastReading ?? device.recentReadings?.[0] ?? null;
  const lastReading: Reading = {
    readingId: base?.readingId ?? `live-${device.deviceId}`,
    deviceId: device.deviceId,
    alarm: base?.alarm ?? false,
    state: base?.state ?? 'normal',
    metrics: applyHouseholdLiveToMetrics(live, { ...(base?.metrics ?? {}) }),
    recordedAt: household.updatedAt || base?.recordedAt || new Date().toISOString(),
    createdAt: base?.createdAt ?? household.updatedAt,
  };
  return { ...device, lastReading };
}
