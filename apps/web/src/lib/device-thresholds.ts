import { normalizeDeviceType } from '$lib/device-type';

export type ThresholdKey = 'humidityWarning' | 'temperatureWarning' | 'coAlarm';

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

export function parseThresholds(
  configuration: string | null | undefined,
  deviceType: string
): DeviceThresholds {
  const thresholds = defaultThresholdsForType(deviceType);
  if (!configuration?.trim()) return thresholds;
  try {
    const parsed = JSON.parse(configuration) as { thresholds?: DeviceThresholds };
    return { ...thresholds, ...(parsed.thresholds ?? {}) };
  } catch {
    return thresholds;
  }
}

export function buildConfiguration(
  deviceType: string,
  thresholds: DeviceThresholds,
  existingConfiguration?: string | null
): string {
  let reportingIntervalSeconds = 60;
  if (existingConfiguration?.trim()) {
    try {
      const parsed = JSON.parse(existingConfiguration) as { reportingIntervalSeconds?: number };
      if (typeof parsed.reportingIntervalSeconds === 'number') {
        reportingIntervalSeconds = parsed.reportingIntervalSeconds;
      }
    } catch {
      // keep default
    }
  }
  return JSON.stringify({
    reportingIntervalSeconds,
    thresholds: { ...defaultThresholdsForType(deviceType), ...thresholds },
  });
}

export function formatThresholdSummary(
  configuration: string | null | undefined,
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
