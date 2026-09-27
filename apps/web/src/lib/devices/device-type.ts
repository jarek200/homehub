/** Home safety device categories. */
export const DEVICE_TYPES = [
  { value: 'environmental-sensor', label: 'Environmental sensor' },
  { value: 'camera', label: 'Camera (Timer Camera F)' },
  { value: 'matter-gateway', label: 'Matter gateway (CoreS3)' },
  { value: 'light', label: 'Light' },
  { value: 'plug', label: 'IKEA plug' },
  { value: 'contact-sensor', label: 'Door / window sensor' },
  { value: 'leak-sensor', label: 'Leak detector' },
  { value: 'motion-sensor', label: 'Motion sensor' },
  { value: 'button', label: 'Button / switch' },
  { value: 'lock', label: 'Lock' },
  { value: 'blind', label: 'Blind' },
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number]['value'];

/** Register-form picker. Lights/plugs/sensors join via Matter; lock/blind stay display-only. */
export const CREATE_DEVICE_TYPES = DEVICE_TYPES.filter(
  (item) =>
    item.value === 'environmental-sensor' ||
    item.value === 'camera' ||
    item.value === 'matter-gateway'
);

export const RUNTIME_KINDS = [
  { value: 'physical', label: 'Physical device' },
  { value: 'matter', label: 'Matter device (via CoreS3 gateway)' },
] as const;

export type RuntimeKind = (typeof RUNTIME_KINDS)[number]['value'];

/** Return a known device type, or the raw slug when it is not in the catalog. */
export function normalizeDeviceType(type: string): DeviceType {
  if (DEVICE_TYPES.some((item) => item.value === type)) {
    return type as DeviceType;
  }
  return type as DeviceType;
}
