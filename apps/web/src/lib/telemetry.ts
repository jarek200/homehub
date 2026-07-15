import type { Reading } from '@sst-monorepo/core';
import { DEFAULT_THRESHOLDS, type DeviceThresholds, parseThresholds } from '$lib/device-thresholds';
import { normalizeDeviceType } from '$lib/device-type';

export type ReadingState = 'normal' | 'warning';
export type ReadingMetrics = Record<string, number | boolean>;

const METRIC_LABELS: Record<string, string> = {
  heat: 'Heat',
  co: 'CO',
  co2: 'CO₂',
  temperature: 'Temperature',
  humidity: 'Humidity',
  fault: 'Fault',
};

const METRIC_SHORT_LABELS: Record<string, string> = {
  heat: 'Heat',
  co: 'CO',
  co2: 'CO₂',
  temperature: 'T',
  humidity: 'H',
  fault: 'Fault',
};

const DEVICE_PROFILES: Record<string, { summaryKeys: string[]; chartKeys: string[] }> = {
  'heat-alarm': { summaryKeys: ['heat', 'temperature'], chartKeys: ['temperature', 'heat'] },
  'carbon-monoxide-alarm': {
    summaryKeys: ['co'],
    chartKeys: ['co'],
  },
  'humidity-sensor': {
    summaryKeys: ['humidity'],
    chartKeys: ['humidity'],
  },
  'environmental-sensor': {
    summaryKeys: ['humidity'],
    chartKeys: ['humidity'],
  },
};

const BOOLEAN_METRICS = new Set(['heat', 'fault']);

const METRIC_THRESHOLD_KEY: Partial<Record<string, keyof DeviceThresholds>> = {
  temperature: 'temperatureWarning',
  humidity: 'humidityWarning',
  co: 'coAlarm',
};

function thresholdLabelForKey(_key: string): string {
  return 'warn';
}

export type CompactReadingPart = {
  shortLabel: string;
  value: string;
  thresholdLabel?: string;
  thresholdValue?: string;
};

function buildCompactReadingPart(
  key: string,
  value: number | boolean,
  thresholds: DeviceThresholds
): CompactReadingPart {
  const shortLabel = metricShortLabel(key);
  if (typeof value === 'number') {
    const thresholdKey = METRIC_THRESHOLD_KEY[key];
    const limit = thresholdKey ? thresholds[thresholdKey] : undefined;
    if (limit != null) {
      return {
        shortLabel,
        value: formatMetricValue(key, value),
        thresholdLabel: thresholdLabelForKey(key),
        thresholdValue: String(limit),
      };
    }
  }
  return {
    shortLabel,
    value: formatMetricValue(key, value),
  };
}

function profileForDeviceType(deviceType: string) {
  const normalizedType = normalizeDeviceType(deviceType);
  return DEVICE_PROFILES[normalizedType] ?? DEVICE_PROFILES[deviceType];
}

export function lastReadingCompactParts(
  deviceType: string,
  reading: Reading | null | undefined,
  configuration?: string | null
): CompactReadingPart[] | null {
  if (!reading) return null;
  const metrics = readingMetrics(reading, deviceType);
  const thresholds = parseThresholds(configuration, deviceType);
  const profile = profileForDeviceType(deviceType);
  const keys = profile?.summaryKeys ?? Object.keys(metrics);
  const parts = keys
    .filter((key) => {
      const value = metrics[key];
      if (value == null) return false;
      if (typeof value === 'boolean' && !value) return false;
      return true;
    })
    .map((key) => buildCompactReadingPart(key, metrics[key]!, thresholds));

  return parts.length > 0 ? parts : null;
}

function formatCompactMetricPart(
  key: string,
  value: number | boolean,
  thresholds: DeviceThresholds
): string {
  const part = buildCompactReadingPart(key, value, thresholds);
  if (part.thresholdValue) {
    return `${part.value} (${part.thresholdLabel} ${part.thresholdValue})`;
  }
  return part.value;
}

function parseMetricsField(raw: unknown): ReadingMetrics {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed != null && !Array.isArray(parsed)
        ? (parsed as ReadingMetrics)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ReadingMetrics;
  }
  return {};
}

export function readingMetrics(reading: Reading, deviceType?: string): ReadingMetrics {
  const raw = parseMetricsField(reading.metrics);
  const metrics: ReadingMetrics = {};

  for (const [key, value] of Object.entries(raw) as [string, number | boolean | string][]) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      metrics[key] = value;
      continue;
    }
    if (typeof value === 'number') {
      metrics[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === 'false') {
        metrics[key] = lower === 'true';
        continue;
      }
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        metrics[key] = parsed;
      }
    }
  }

  if (
    deviceType === 'carbon-monoxide-alarm' &&
    metrics.co == null &&
    typeof metrics.temperature === 'number'
  ) {
    metrics.co = metrics.temperature;
  }

  if (deviceType && normalizeDeviceType(deviceType) === 'humidity-sensor') {
    delete metrics.temperature;
  }

  return metrics;
}

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

export function metricShortLabel(key: string): string {
  return METRIC_SHORT_LABELS[key] ?? key;
}

export function formatMetricValue(key: string, value: number | boolean): string {
  if (typeof value === 'boolean') {
    if (key === 'heat') return value ? 'Heat alarm' : 'Normal';
    return value ? 'Yes' : 'No';
  }
  if (key === 'temperature') return `${value}°C`;
  if (key === 'humidity') return `${value}%`;
  if (key === 'co') return `${value} ppm`;
  if (key === 'co2') return `${value} ppm`;
  return String(value);
}

export function formatReadingSummary(reading: Reading, deviceType: string): string {
  const metrics = readingMetrics(reading, deviceType);
  const profile = profileForDeviceType(deviceType);
  const keys = profile?.summaryKeys ?? Object.keys(metrics);
  const parts = keys
    .filter((key) => metrics[key] != null)
    .map((key) => `${metricLabel(key)}: ${formatMetricValue(key, metrics[key]!)}`);

  if (parts.length > 0) return parts.join(' · ');
  if (reading.alarm || reading.state === 'warning') return 'Warning';
  return 'Normal';
}

export function formatLastReadingPrimary(
  deviceType: string,
  reading: Reading | null | undefined
): string {
  if (!reading) return '—';
  const metrics = readingMetrics(reading, deviceType);
  const profile = profileForDeviceType(deviceType);
  const primaryKey = profile?.summaryKeys.find((key) => metrics[key] != null);
  if (primaryKey) {
    return `${metricLabel(primaryKey)}: ${formatMetricValue(primaryKey, metrics[primaryKey]!)}`;
  }
  if (reading.alarm || reading.state === 'warning') return 'Warning';
  return 'Normal';
}

/** Compact labels for tight list cells, e.g. "T: 26°C (warn 28°C)". */
export function formatLastReadingCompact(
  deviceType: string,
  reading: Reading | null | undefined,
  configuration?: string | null
): string {
  if (!reading) return '—';
  const metrics = readingMetrics(reading, deviceType);
  const thresholds = parseThresholds(configuration, deviceType);
  const profile = profileForDeviceType(deviceType);
  const keys = profile?.summaryKeys ?? Object.keys(metrics);
  const parts = keys
    .filter((key) => {
      const value = metrics[key];
      if (value == null) return false;
      if (typeof value === 'boolean' && !value) return false;
      return true;
    })
    .map((key) => formatCompactMetricPart(key, metrics[key]!, thresholds));

  if (parts.length > 0) return parts.join(' · ');
  if (reading.alarm || reading.state === 'warning') return 'Warning';
  return 'Normal';
}

export function chartMetricKeys(deviceType: string, readings: Reading[]): string[] {
  const profile = profileForDeviceType(deviceType);
  const preferred = profile?.chartKeys ?? [];
  const available = new Set<string>();
  for (const reading of readings) {
    for (const [key, value] of Object.entries(readingMetrics(reading, deviceType))) {
      if (value != null) available.add(key);
    }
  }
  return preferred.filter((key) => available.has(key));
}

export function summaryMetricKeys(deviceType: string, reading: Reading | null): string[] {
  const profile = profileForDeviceType(deviceType);
  const metrics = reading ? readingMetrics(reading, deviceType) : {};
  const keys = profile?.summaryKeys ?? Object.keys(metrics);
  return keys.filter((key) => metrics[key] != null);
}

export function isBooleanMetric(key: string): boolean {
  return BOOLEAN_METRICS.has(key);
}

export function formatState(state: ReadingState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export type DerivedReadingState = { alarm: boolean; state: ReadingState };

/** Re-derive state from metrics using the device's current thresholds. */
export function effectiveReadingState(
  reading: Reading,
  deviceType: string,
  configuration?: string | null
): DerivedReadingState {
  const thresholds = parseThresholds(configuration, deviceType);
  return deriveAlarmState(readingMetrics(reading, deviceType), thresholds, deviceType);
}

export function readingStateLabel({ state }: DerivedReadingState): string {
  return formatState(state);
}

export function readingStateClass({ state }: DerivedReadingState): string {
  if (state === 'warning') {
    return 'text-amber-600 dark:text-amber-400';
  }
  return 'text-emerald-600 dark:text-emerald-400';
}

export const READING_DOT_LIMIT = 10;

export type ReadingDotTone = 'normal' | 'alert';

export function readingDotTone(state: DerivedReadingState): ReadingDotTone {
  if (state.state === 'warning') {
    return 'alert';
  }
  return 'normal';
}

/** Oldest reading on the left, newest on the right. */
export function readingDotTones(
  readings: Reading[],
  deviceType: string,
  configuration?: string | null,
  limit = READING_DOT_LIMIT
): ReadingDotTone[] {
  return readings
    .slice(0, limit)
    .reverse()
    .map((reading) => readingDotTone(effectiveReadingState(reading, deviceType, configuration)));
}

export function readingDotsAriaLabel(tones: ReadingDotTone[]): string {
  if (tones.length === 0) return 'No readings yet';
  const alertCount = tones.filter((tone) => tone === 'alert').length;
  const normalCount = tones.length - alertCount;
  return `Last ${tones.length} readings: ${normalCount} normal, ${alertCount} warning`;
}

const SAMPLE_METRICS: Record<string, ReadingMetrics> = {
  'heat-alarm': {
    heat: false,
    temperature: 24.5,
  },
  'carbon-monoxide-alarm': {
    co: 8.2,
    heat: false,
  },
  'humidity-sensor': {
    humidity: 55,
  },
  'environmental-sensor': {
    humidity: 55,
  },
};

function deriveAlarmState(
  metrics: ReadingMetrics,
  thresholds: DeviceThresholds = DEFAULT_THRESHOLDS,
  deviceType?: string
): { alarm: boolean; state: ReadingState } {
  const humidityLimit = thresholds.humidityWarning ?? DEFAULT_THRESHOLDS.humidityWarning;
  const temperatureLimit = thresholds.temperatureWarning ?? DEFAULT_THRESHOLDS.temperatureWarning;
  const coAlarmLimit = thresholds.coAlarm ?? DEFAULT_THRESHOLDS.coAlarm;

  if (metrics.heat === true) {
    return { alarm: true, state: 'warning' };
  }
  if (typeof metrics.co === 'number' && metrics.co >= coAlarmLimit) {
    return { alarm: true, state: 'warning' };
  }
  if (metrics.fault === true) {
    return { alarm: false, state: 'warning' };
  }
  if (typeof metrics.humidity === 'number' && metrics.humidity >= humidityLimit) {
    return { alarm: false, state: 'warning' };
  }
  if (
    deviceType &&
    normalizeDeviceType(deviceType) !== 'humidity-sensor' &&
    typeof metrics.temperature === 'number' &&
    metrics.temperature >= temperatureLimit
  ) {
    return { alarm: false, state: 'warning' };
  }
  return { alarm: false, state: 'normal' };
}

/** Example telemetry payload the simulator sends for a device type. */
export function sampleTelemetryForType(
  deviceType: string,
  thresholds: DeviceThresholds = DEFAULT_THRESHOLDS
): {
  alarm: boolean;
  state: ReadingState;
  metrics: ReadingMetrics;
} {
  const normalizedType = normalizeDeviceType(deviceType);
  const metrics = {
    ...(SAMPLE_METRICS[normalizedType] ?? SAMPLE_METRICS[deviceType] ?? {}),
  };
  return { ...deriveAlarmState(metrics, thresholds, deviceType), metrics };
}

export function formatTelemetryPreview(
  deviceType: string,
  thresholds: DeviceThresholds = DEFAULT_THRESHOLDS
): string {
  return JSON.stringify(sampleTelemetryForType(deviceType, thresholds), null, 2);
}
