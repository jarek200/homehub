import type { DeviceType } from '@homehub/core';

/** Home safety device categories. Labels stay here; the slugs live in @homehub/core. */
const DEVICE_TYPE_LABELS = {
  'environmental-sensor': 'Environmental sensor',
  camera: 'Camera (Timer Camera F)',
  'matter-gateway': 'Matter gateway (CoreS3)',
  light: 'Light',
  plug: 'IKEA plug',
  'contact-sensor': 'Door / window sensor',
  'leak-sensor': 'Leak detector',
  'motion-sensor': 'Motion sensor',
  button: 'Button / switch',
  lock: 'Lock',
  blind: 'Blind',
} as const satisfies Record<DeviceType, string>;

export const DEVICE_TYPES = (Object.keys(DEVICE_TYPE_LABELS) as DeviceType[]).map((value) => ({
  value,
  label: DEVICE_TYPE_LABELS[value],
}));

export type { DeviceType };

/** Register-form picker. Lights/plugs/sensors join via Matter; lock/blind stay display-only. */
export const CREATE_DEVICE_TYPES = DEVICE_TYPES.filter(
  (item) =>
    item.value === 'environmental-sensor' ||
    item.value === 'camera' ||
    item.value === 'matter-gateway'
);

/** Return a known device type, or the raw slug when it is not in the catalog. */
export function normalizeDeviceType(type: string): DeviceType {
  if (DEVICE_TYPES.some((item) => item.value === type)) {
    return type as DeviceType;
  }
  return type as DeviceType;
}
