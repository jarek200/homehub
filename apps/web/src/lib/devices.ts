import type { Device } from '@sst-monorepo/graphql';

export const DEVICE_TYPES = [
  { value: 'security-camera', label: 'Security camera' },
  { value: 'thermostat', label: 'Thermostat' },
  { value: 'smart-light', label: 'Smart light' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'other', label: 'Other' },
] as const;

export const DEVICE_STATUSES = [
  { value: 'ONLINE', label: 'Online' },
  { value: 'OFFLINE', label: 'Offline' },
  { value: 'UNKNOWN', label: 'Unknown' },
] as const;

const dummyTimestamp = '2026-07-10T14:22:10.000Z';

/**
 * Sample home devices aligned with the interview task:
 * lights, thermostats, and security cameras.
 */
export const DUMMY_DEVICES: Device[] = [
  {
    deviceId: 'dummy-living-room-camera',
    name: 'Living Room Camera',
    type: 'security-camera',
    location: 'Living Room',
    status: 'ONLINE',
    configuration: JSON.stringify({
      motionDetection: true,
      captureEnabled: true,
      captureIntervalSeconds: 30,
    }),
    lastSeenAt: dummyTimestamp,
    createdAt: dummyTimestamp,
    updatedAt: dummyTimestamp,
  },
  {
    deviceId: 'dummy-hallway-light',
    name: 'Hallway Smart Light',
    type: 'smart-light',
    location: 'Hallway',
    status: 'ONLINE',
    configuration: JSON.stringify({ power: 'on', brightness: 72 }),
    lastSeenAt: '2026-07-10T14:18:00.000Z',
    createdAt: dummyTimestamp,
    updatedAt: dummyTimestamp,
  },
  {
    deviceId: 'dummy-bedroom-thermostat',
    name: 'Bedroom Thermostat',
    type: 'thermostat',
    location: 'Bedroom',
    status: 'OFFLINE',
    configuration: JSON.stringify({ targetTemperature: 21, mode: 'heat' }),
    lastSeenAt: '2026-07-09T22:41:00.000Z',
    createdAt: dummyTimestamp,
    updatedAt: dummyTimestamp,
  },
  {
    deviceId: 'dummy-front-door-camera',
    name: 'Front Door Camera',
    type: 'security-camera',
    location: 'Entrance',
    status: 'UNKNOWN',
    configuration: JSON.stringify({ motionDetection: false, captureEnabled: true }),
    lastSeenAt: null,
    createdAt: dummyTimestamp,
    updatedAt: dummyTimestamp,
  },
];

export function isDummyDevice(deviceId: string): boolean {
  return deviceId.startsWith('dummy-');
}

export function getDummyDevice(deviceId: string): Device | null {
  return DUMMY_DEVICES.find((device) => device.deviceId === deviceId) ?? null;
}

export const COMMAND_OPTIONS = [
  { value: 'capture-image', label: 'Capture image' },
  { value: 'report-status', label: 'Report status' },
  { value: 'restart', label: 'Restart' },
] as const;

export function formatDeviceType(type: string): string {
  return DEVICE_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function formatStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatConfigurationSummary(configuration: string | null | undefined): string {
  if (!configuration) return '—';
  try {
    const parsed = JSON.parse(configuration) as Record<string, unknown>;
    const parts: string[] = [];
    if (parsed.power != null) parts.push(`Power ${String(parsed.power)}`);
    if (parsed.brightness != null) parts.push(`Brightness ${String(parsed.brightness)}%`);
    if (parsed.targetTemperature != null) parts.push(`${String(parsed.targetTemperature)}°C`);
    if (parsed.mode != null) parts.push(String(parsed.mode));
    if (parsed.motionDetection != null) {
      parts.push(parsed.motionDetection ? 'Motion on' : 'Motion off');
    }
    if (parsed.captureEnabled != null) {
      parts.push(parsed.captureEnabled ? 'Capture on' : 'Capture off');
    }
    return parts.length ? parts.join(' · ') : 'Configured';
  } catch {
    return 'Configured';
  }
}

export const inputMinimal =
  'rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground';
