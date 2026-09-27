import { normalizeDeviceType } from '$lib/devices/device-type';

const POWER_DEVICE_TYPES = new Set(['light', 'plug']);
const ENV_DEVICE_TYPES = new Set(['environmental-sensor']);
const SECURITY_DEVICE_TYPES = new Set(['contact-sensor', 'motion-sensor']);
const LEAK_DEVICE_TYPES = new Set(['leak-sensor']);

export function deviceMatchesListFilters(
  device: { type: string },
  filters: { power: boolean; env: boolean; security: boolean; leak: boolean }
): boolean {
  if (!filters.power && !filters.env && !filters.security && !filters.leak) return true;
  const type = normalizeDeviceType(device.type);
  return (
    (filters.power && POWER_DEVICE_TYPES.has(type)) ||
    (filters.env && ENV_DEVICE_TYPES.has(type)) ||
    (filters.security && SECURITY_DEVICE_TYPES.has(type)) ||
    (filters.leak && LEAK_DEVICE_TYPES.has(type))
  );
}
