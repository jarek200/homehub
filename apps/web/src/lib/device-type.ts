/** Home safety device categories. */
export const DEVICE_TYPES = [
  { value: 'heat-alarm', label: 'Heat alarm' },
  { value: 'carbon-monoxide-alarm', label: 'Carbon monoxide alarm' },
  { value: 'humidity-sensor', label: 'Humidity sensor' },
  { value: 'camera', label: 'Camera' },
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number]['value'];

const DEVICE_TYPE_ALIASES: Record<string, DeviceType> = {
  'environmental-sensor': 'humidity-sensor',
};

/** Map legacy API/device records onto the current device type slug. */
export function normalizeDeviceType(type: string): DeviceType {
  const aliased = DEVICE_TYPE_ALIASES[type];
  if (aliased) return aliased;
  if (DEVICE_TYPES.some((item) => item.value === type)) {
    return type as DeviceType;
  }
  return type as DeviceType;
}
