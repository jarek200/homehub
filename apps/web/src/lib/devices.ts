import {
  type DeviceThresholds,
  defaultThresholdsForType,
  formatThresholdSummary,
  parseThresholds,
} from '$lib/device-thresholds';
import { DEVICE_TYPES, type DeviceType, normalizeDeviceType } from '$lib/device-type';

export type { DeviceThresholds };
export {
  DEVICE_TYPES,
  type DeviceType,
  defaultThresholdsForType,
  formatThresholdSummary,
  normalizeDeviceType,
  parseThresholds,
};

export const DEVICE_STATUSES = [
  { value: 'ONLINE', label: 'On' },
  { value: 'OFFLINE', label: 'Off' },
  { value: 'UNKNOWN', label: 'Unknown' },
] as const;

export const LIFECYCLE_STATUSES = [
  { value: 'PROVISIONING', label: 'Provisioning' },
  { value: 'READY', label: 'Ready' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'DECOMMISSIONED', label: 'Decommissioned' },
] as const;

export function getDefaultConfiguration(deviceType?: string): Record<string, unknown> {
  const normalizedType = normalizeDeviceType(deviceType ?? 'heat-alarm');
  return {
    reportingIntervalSeconds: 60,
    thresholds: defaultThresholdsForType(normalizedType),
  };
}

export function configurationForType(
  configuration: string | null | undefined,
  deviceType: string
): string {
  const normalizedType = normalizeDeviceType(deviceType);
  const defaults = getDefaultConfiguration(normalizedType);
  if (!configuration?.trim()) {
    return JSON.stringify(defaults);
  }
  try {
    const parsed = JSON.parse(configuration) as Record<string, unknown>;
    const parsedThresholds =
      typeof parsed.thresholds === 'object' && parsed.thresholds != null
        ? (parsed.thresholds as DeviceThresholds)
        : {};
    return JSON.stringify({
      ...parsed,
      reportingIntervalSeconds: defaults.reportingIntervalSeconds,
      thresholds: {
        ...(defaults.thresholds as DeviceThresholds),
        ...parsedThresholds,
      },
    });
  } catch {
    return JSON.stringify(defaults);
  }
}

/** Remote device commands. */
export const COMMAND_OPTIONS = [
  { value: 'button-test', label: 'Button test' },
  { value: 'silence-alarm', label: 'Silence alarm' },
  { value: 'report-status', label: 'Report status' },
  { value: 'restart', label: 'Restart device' },
] as const;

export function isEnvironmentalSensor(type: string): boolean {
  return normalizeDeviceType(type) === 'humidity-sensor';
}

export function isHeatAlarm(type: string): boolean {
  return type === 'heat-alarm';
}

export function isCarbonMonoxideAlarm(type: string): boolean {
  return type === 'carbon-monoxide-alarm';
}

export function supportsReadings(type: string): boolean {
  return isEnvironmentalSensor(type) || isHeatAlarm(type) || isCarbonMonoxideAlarm(type);
}

export function formatDeviceType(type: string): string {
  return DEVICE_TYPES.find((item) => item.value === normalizeDeviceType(type))?.label ?? type;
}

export function formatStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function isDeviceOn(status: string): boolean {
  return status === 'ONLINE';
}

export function formatOperatingStatus(status: string): string {
  const match = DEVICE_STATUSES.find((item) => item.value === status);
  return match?.label ?? formatStatus(status);
}

export function operatingStatusAriaLabel(isOn: boolean, deviceName: string): string {
  return isOn ? `Turn ${deviceName} off` : `Turn ${deviceName} on`;
}

export function formatLifecycleStatus(status: string): string {
  const match = LIFECYCLE_STATUSES.find((item) => item.value === status);
  return match?.label ?? formatStatus(status);
}

/** Text color for lifecycle status badges. */
export function lifecycleColorClass(status: string): string {
  if (status === 'READY') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'PROVISIONING') return 'text-amber-600 dark:text-amber-400';
  if (status === 'FAILED') return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

/** Text color for device power status — green on, red off. */
export function statusColorClass(status: string): string {
  if (status === 'ONLINE') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'OFFLINE') return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatConfigurationSummary(
  configuration: string | null | undefined,
  deviceType?: string
): string {
  if (!configuration) return '—';
  try {
    const parsed = JSON.parse(configuration) as Record<string, unknown>;
    const parts: string[] = [];
    if (parsed.reportingIntervalSeconds != null) {
      parts.push(`Reports every ${String(parsed.reportingIntervalSeconds)}s`);
    }
    if (deviceType) {
      const thresholdSummary = formatThresholdSummary(configuration, deviceType);
      if (thresholdSummary) parts.push(thresholdSummary);
    }
    return parts.length ? parts.join(' · ') : 'Default settings';
  } catch {
    return 'Configured';
  }
}

export const inputMinimal =
  'rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground';
