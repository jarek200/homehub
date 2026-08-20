import type { DeviceConfiguration } from '@sst-monorepo/core';
import { normalizeDeviceType } from '$lib/device-type';

export type ThresholdKey =
  | 'humidityWarning'
  | 'temperatureWarning'
  | 'coAlarm'
  | 'vocIndexWarning';

export type DeviceThresholds = Partial<Record<ThresholdKey, number>>;

export type ThresholdField = {
  key: ThresholdKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

export const DEFAULT_THRESHOLDS: Record<ThresholdKey, number> = {
  humidityWarning: 70,
  temperatureWarning: 28,
  coAlarm: 50,
  vocIndexWarning: 200,
};

export const THRESHOLD_FIELDS: Record<string, ThresholdField[]> = {
  'heat-alarm': [
    {
      key: 'temperatureWarning',
      label: 'Temperature warning',
      unit: '°C',
      min: 0,
      max: 100,
      step: 0.5,
    },
  ],
  'carbon-monoxide-alarm': [
    {
      key: 'coAlarm',
      label: 'CO alarm level',
      unit: 'ppm',
      min: 0,
      max: 500,
      step: 1,
    },
  ],
  'humidity-sensor': [
    {
      key: 'humidityWarning',
      label: 'Humidity warning',
      unit: '%',
      min: 0,
      max: 100,
      step: 1,
    },
  ],
  'environmental-sensor': [
    {
      key: 'humidityWarning',
      label: 'Humidity warning',
      unit: '%',
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: 'temperatureWarning',
      label: 'Temperature warning',
      unit: '°C',
      min: 0,
      max: 100,
      step: 0.5,
    },
    {
      key: 'vocIndexWarning',
      label: 'VOC index warning',
      unit: '',
      min: 0,
      max: 500,
      step: 1,
    },
  ],
};

function thresholdFieldsForType(deviceType: string): ThresholdField[] {
  const normalizedType = normalizeDeviceType(deviceType);
  return THRESHOLD_FIELDS[normalizedType] ?? THRESHOLD_FIELDS[deviceType] ?? [];
}

export function defaultThresholdsForType(deviceType: string): DeviceThresholds {
  const fields = thresholdFieldsForType(deviceType);
  const thresholds: DeviceThresholds = {};
  for (const field of fields) {
    thresholds[field.key] = DEFAULT_THRESHOLDS[field.key];
  }
  return thresholds;
}

export function asDeviceConfiguration(
  configuration: DeviceConfiguration | null | undefined
): DeviceConfiguration | null {
  if (configuration == null) return null;
  return configuration;
}

export function parseThresholds(
  configuration: DeviceConfiguration | null | undefined,
  deviceType: string
): DeviceThresholds {
  const thresholds = defaultThresholdsForType(deviceType);
  const parsed = asDeviceConfiguration(configuration);
  if (!parsed?.thresholds) return thresholds;
  return { ...thresholds, ...parsed.thresholds };
}

export function buildConfiguration(
  deviceType: string,
  thresholds: DeviceThresholds,
  existingConfiguration?: DeviceConfiguration | null,
  extras?: Partial<DeviceConfiguration>
): DeviceConfiguration {
  const existing = asDeviceConfiguration(existingConfiguration);
  return {
    ...(existing ?? {}),
    ...(extras ?? {}),
    reportingIntervalSeconds:
      extras?.reportingIntervalSeconds ??
      existing?.reportingIntervalSeconds ??
      defaultReportingIntervalSeconds(deviceType),
    powerMode: extras?.powerMode ?? existing?.powerMode,
    maintenanceMode: extras?.maintenanceMode ?? existing?.maintenanceMode,
    thresholds: { ...defaultThresholdsForType(deviceType), ...thresholds },
  };
}

export function defaultReportingIntervalSeconds(deviceType: string): number {
  const normalizedType = normalizeDeviceType(deviceType);
  if (normalizedType === 'camera') return 30;
  if (normalizedType === 'environmental-sensor') return 300;
  return 10;
}

const METRIC_THRESHOLD_KEY: Partial<Record<string, ThresholdKey>> = {
  temperature: 'temperatureWarning',
  humidity: 'humidityWarning',
  co: 'coAlarm',
  vocIndex: 'vocIndexWarning',
};

export function formatMetricThreshold(
  configuration: DeviceConfiguration | null | undefined,
  deviceType: string,
  metricKey: string
): string | null {
  const thresholdKey = METRIC_THRESHOLD_KEY[metricKey];
  if (!thresholdKey) return null;
  const field = thresholdFieldsForType(deviceType).find((item) => item.key === thresholdKey);
  if (!field) return null;
  const value = parseThresholds(configuration, deviceType)[field.key];
  if (value == null) return null;
  return `Warning ${value}${field.unit}`;
}

export function isMetricWarning(
  metricKey: string,
  value: number | boolean | undefined,
  configuration: DeviceConfiguration | null | undefined,
  deviceType: string
): boolean {
  if (typeof value !== 'number') return false;
  const thresholdKey = METRIC_THRESHOLD_KEY[metricKey];
  if (!thresholdKey) return false;
  if (!thresholdFieldsForType(deviceType).some((field) => field.key === thresholdKey)) {
    return false;
  }
  const limit = parseThresholds(configuration, deviceType)[thresholdKey];
  return limit != null && value >= limit;
}

export function formatThresholdSummary(
  configuration: DeviceConfiguration | null | undefined,
  deviceType: string
): string {
  const fields = thresholdFieldsForType(deviceType);
  if (fields.length === 0) {
    return 'No configurable thresholds';
  }
  const thresholds = parseThresholds(configuration, deviceType);
  return fields
    .map((field) => {
      const value = thresholds[field.key];
      return value != null ? `${field.label} ${value}${field.unit}` : null;
    })
    .filter((part): part is string => part != null)
    .join(' · ');
}
