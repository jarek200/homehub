/** Home safety device categories. */
export const DEVICE_TYPES = [
  { value: 'heat-alarm', label: 'Heat alarm' },
  { value: 'carbon-monoxide-alarm', label: 'Carbon monoxide alarm' },
  { value: 'humidity-sensor', label: 'Humidity sensor' },
  { value: 'environmental-sensor', label: 'Environmental sensor' },
  { value: 'camera', label: 'Camera' },
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number]['value'];

export const RUNTIME_KINDS = [
  { value: 'simulated', label: 'Simulated (Pi / cloud runtime)' },
  { value: 'physical', label: 'Physical device (FireBeetle / ESP32)' },
] as const;

export type RuntimeKind = (typeof RUNTIME_KINDS)[number]['value'];

/** Map legacy API/device records onto the current device type slug. */
export function normalizeDeviceType(type: string): DeviceType {
  if (DEVICE_TYPES.some((item) => item.value === type)) {
    return type as DeviceType;
  }
  return type as DeviceType;
}
