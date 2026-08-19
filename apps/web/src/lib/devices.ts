import type { DeviceConfiguration } from '@sst-monorepo/core';
import {
  asDeviceConfiguration,
  type DeviceThresholds,
  defaultReportingIntervalSeconds,
  defaultThresholdsForType,
  formatThresholdSummary,
  parseThresholds,
} from '$lib/device-thresholds';
import { formatCameraSettingsSummary } from '$lib/device-camera-settings';
import {
  formatReportingIntervalSummary,
} from '$lib/device-power-settings';
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

export function getDefaultConfiguration(deviceType?: string): DeviceConfiguration {
  const normalizedType = normalizeDeviceType(deviceType ?? 'heat-alarm');
  if (normalizedType === 'camera') {
    return {
      reportingIntervalSeconds: 30,
      pan: 90,
      tilt: 90,
      frameSize: 'qvga',
      jpegQuality: 12,
      brightness: 1,
      saturation: -2,
      contrast: 0,
      vflip: true,
      hmirror: false,
    };
  }
  if (normalizedType === 'environmental-sensor') {
    return {
      reportingIntervalSeconds: 300,
      powerMode: 'low-power-voc',
      maintenanceMode: false,
      thresholds: defaultThresholdsForType(normalizedType),
    };
  }
  return {
    reportingIntervalSeconds: 10,
    thresholds: defaultThresholdsForType(normalizedType),
  };
}

export function configurationForType(
  configuration: DeviceConfiguration | null | undefined,
  deviceType: string
): DeviceConfiguration {
  const normalizedType = normalizeDeviceType(deviceType);
  const defaults = getDefaultConfiguration(normalizedType);
  const parsed = asDeviceConfiguration(configuration);
  if (!parsed) {
    return defaults;
  }
  const parsedThresholds =
    typeof parsed.thresholds === 'object' && parsed.thresholds != null
      ? (parsed.thresholds as DeviceThresholds)
      : {};
  if (normalizedType === 'camera') {
    const merged = {
      ...defaults,
      ...parsed,
      reportingIntervalSeconds:
        typeof parsed.reportingIntervalSeconds === 'number'
          ? parsed.reportingIntervalSeconds
          : defaults.reportingIntervalSeconds,
      pan: typeof parsed.pan === 'number' ? parsed.pan : 90,
      tilt: typeof parsed.tilt === 'number' ? parsed.tilt : 90,
    };
    return merged;
  }
  if (normalizedType === 'environmental-sensor') {
    return {
      ...parsed,
      reportingIntervalSeconds:
        typeof parsed.reportingIntervalSeconds === 'number'
          ? parsed.reportingIntervalSeconds
          : defaults.reportingIntervalSeconds,
      powerMode: parsed.powerMode ?? defaults.powerMode,
      maintenanceMode: parsed.maintenanceMode ?? defaults.maintenanceMode,
      thresholds: {
        ...(defaults.thresholds as DeviceThresholds),
        ...parsedThresholds,
      },
    };
  }
  return {
    ...parsed,
    reportingIntervalSeconds:
      typeof parsed.reportingIntervalSeconds === 'number'
        ? parsed.reportingIntervalSeconds
        : defaults.reportingIntervalSeconds,
    thresholds: {
      ...(defaults.thresholds as DeviceThresholds),
      ...parsedThresholds,
    },
  };
}

export function isEnvironmentalSensor(type: string): boolean {
  const normalized = normalizeDeviceType(type);
  return normalized === 'humidity-sensor' || normalized === 'environmental-sensor';
}

export function isHeatAlarm(type: string): boolean {
  return type === 'heat-alarm';
}

export function isCarbonMonoxideAlarm(type: string): boolean {
  return type === 'carbon-monoxide-alarm';
}

export function isCamera(type: string): boolean {
  return normalizeDeviceType(type) === 'camera';
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
  configuration: DeviceConfiguration | null | undefined,
  deviceType?: string
): string {
  if (!configuration) return '—';
  try {
    const parts: string[] = [];
    const defaults = getDefaultConfiguration(deviceType);
    const parsed = asDeviceConfiguration(configuration);
    const interval =
      typeof parsed?.reportingIntervalSeconds === 'number'
        ? parsed.reportingIntervalSeconds
        : defaultReportingIntervalSeconds(deviceType ?? '');
    if (normalizeDeviceType(deviceType ?? '') === 'environmental-sensor') {
      parts.push(formatReportingIntervalSummary(parsed ?? { reportingIntervalSeconds: interval }));
    } else {
      parts.push(`Reports every ${String(interval)}s`);
    }
    if (normalizeDeviceType(deviceType ?? '') === 'camera') {
      parts.push(formatCameraSettingsSummary(configuration));
      const pan = typeof parsed?.pan === 'number' ? parsed.pan : 90;
      const tilt = typeof parsed?.tilt === 'number' ? parsed.tilt : 90;
      parts.push(`Pan ${pan}° · Tilt ${tilt}°`);
      return parts.join(' · ');
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
