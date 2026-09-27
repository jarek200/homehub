import type { DeviceConfiguration, Reading } from '@homehub/core';
import {
  DEFAULT_THRESHOLDS,
  type DeviceThresholds,
  parseThresholds,
} from '$lib/devices/device-thresholds';
import { normalizeDeviceType } from '$lib/devices/device-type';

export type ReadingState = 'normal' | 'warning';
export type ReadingMetrics = Record<string, number | boolean>;
type ConfigArg = DeviceConfiguration | null | undefined;

const METRIC_LABELS: Record<string, string> = {
  heat: 'Heat',
  co: 'CO',
  co2: 'CO₂',
  temperature: 'Temperature',
  humidity: 'Humidity',
  vocIndex: 'VOC index',
  pressureHpa: 'Pressure',
  lightLux: 'Light',
  uvMwCm2: 'UV',
  batteryVoltage: 'Battery',
  batteryPercent: 'Battery %',
  fault: 'Fault',
  leak: 'Leak',
  occupied: 'Motion',
  open: 'Contact',
  on: 'On',
  brightness: 'Brightness',
  pan: 'Pan',
  tilt: 'Tilt',
  heapInternalFree: 'Internal RAM',
  heapInternalLargest: 'Largest internal block',
  heapInternalMinFree: 'Internal low-water',
  heapSpiramFree: 'PSRAM',
  heapSpiramLargest: 'Largest PSRAM block',
  heapSpiramMinFree: 'PSRAM low-water',
};

const METRIC_SHORT_LABELS: Record<string, string> = {
  heat: 'Heat',
  co: 'CO',
  co2: 'CO₂',
  temperature: 'T',
  humidity: 'H',
  vocIndex: 'VOC',
  pressureHpa: 'P',
  lightLux: 'Lux',
  uvMwCm2: 'UV',
  batteryVoltage: 'V',
  batteryPercent: 'Bat',
  fault: 'Fault',
  leak: 'Leak',
  occupied: 'PIR',
  open: 'Contact',
  on: 'On',
  brightness: 'Bri',
  pan: 'Pan',
  tilt: 'Tilt',
  heapInternalFree: 'RAM',
  heapInternalLargest: 'RAM max',
  heapInternalMinFree: 'RAM min',
  heapSpiramFree: 'PSRAM',
  heapSpiramLargest: 'PSRAM max',
  heapSpiramMinFree: 'PSRAM min',
};

const DEVICE_PROFILES: Record<
  string,
  { summaryKeys: string[]; chartKeys: string[]; detailKeys: string[] }
> = {
  'environmental-sensor': {
    summaryKeys: ['temperature', 'humidity', 'co2', 'vocIndex'],
    chartKeys: ['temperature', 'humidity', 'co2', 'vocIndex'],
    detailKeys: ['pressureHpa', 'lightLux', 'uvMwCm2', 'batteryVoltage', 'batteryPercent'],
  },
  camera: {
    summaryKeys: ['occupied'],
    chartKeys: ['batteryPercent'],
    detailKeys: ['batteryVoltage'],
  },
  'leak-sensor': {
    summaryKeys: ['leak'],
    chartKeys: ['leak'],
    detailKeys: ['batteryPercent'],
  },
  'contact-sensor': {
    summaryKeys: ['open'],
    chartKeys: ['batteryPercent'],
    detailKeys: [],
  },
  'motion-sensor': {
    summaryKeys: ['occupied', 'lightLux'],
    chartKeys: ['lightLux'],
    detailKeys: ['batteryPercent'],
  },
  lock: { summaryKeys: ['batteryPercent'], chartKeys: ['batteryPercent'], detailKeys: [] },
  plug: { summaryKeys: ['on'], chartKeys: [], detailKeys: [] },
  light: { summaryKeys: ['on', 'brightness'], chartKeys: ['brightness'], detailKeys: [] },
  'matter-gateway': {
    summaryKeys: ['heapInternalFree', 'heapSpiramFree'],
    chartKeys: ['heapInternalFree', 'heapSpiramFree'],
    detailKeys: [
      'heapInternalLargest',
      'heapInternalMinFree',
      'heapSpiramLargest',
      'heapSpiramMinFree',
    ],
  },
};

const HEAP_LIST_SUFFIX: Record<string, string> = {
  heapInternalFree: 'RAM',
  heapSpiramFree: 'PSRAM',
};

const BOOLEAN_METRICS = new Set(['heat', 'fault', 'leak']);

const METRIC_THRESHOLD_KEY: Partial<Record<string, keyof DeviceThresholds>> = {
  temperature: 'temperatureWarning',
  humidity: 'humidityWarning',
  co: 'coAlarm',
  vocIndex: 'vocIndexWarning',
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
  configuration?: ConfigArg
): CompactReadingPart[] | null {
  if (!reading) return null;
  const metrics = readingMetrics(reading, deviceType);
  const thresholds = parseThresholds(configuration, deviceType);
  const profile = profileForDeviceType(deviceType);
  const keys = profile?.summaryKeys ?? Object.keys(metrics);
  const parts = keys.flatMap((key) => {
    const value = metrics[key];
    if (value == null) return [];
    return [buildCompactReadingPart(key, value, thresholds)];
  });

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

export function readingMetrics(reading: Reading, _deviceType?: string): ReadingMetrics {
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

  return metrics;
}

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

export function metricShortLabel(key: string): string {
  return METRIC_SHORT_LABELS[key] ?? key;
}

function formatNumericMetric(value: number): string {
  return value.toFixed(1);
}

/** Heap snapshots are raw bytes from the CoreS3. */
export function formatByteSize(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_048_576) {
    const mb = value / 1_048_576;
    const rounded = Math.round(mb * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded} MB` : `${rounded.toFixed(1)} MB`;
  }
  if (abs >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${Math.round(value)} B`;
}

export function formatMetricValue(key: string, value: number | boolean): string {
  if (typeof value === 'boolean') {
    if (key === 'heat') return value ? 'Heat alarm' : 'Normal';
    if (key === 'leak') return value ? 'Leak' : 'Dry';
    if (key === 'occupied') return value ? 'Detected' : 'Clear';
    if (key === 'open') return value ? 'Open' : 'Closed';
    if (key === 'on') return value ? 'On' : 'Off';
    return value ? 'Yes' : 'No';
  }
  const formatted = formatNumericMetric(value);
  if (key === 'temperature') return `${formatted}°C`;
  if (key === 'humidity') return `${formatted}%`;
  if (key === 'co') return `${formatted} ppm`;
  if (key === 'co2') return `${formatted} ppm`;
  if (key === 'pressureHpa') return `${formatted} hPa`;
  if (key === 'lightLux') return `${formatted} lx`;
  if (key === 'uvMwCm2') return `${formatted} mW/cm²`;
  if (key === 'vocIndex') return formatted;
  if (key === 'batteryVoltage') return `${formatted} V`;
  if (key === 'batteryPercent') return `${formatted}%`;
  if (key === 'brightness') return `${formatted}%`;
  if (key.startsWith('heap')) {
    const size = formatByteSize(value);
    const suffix = HEAP_LIST_SUFFIX[key];
    return suffix ? `${size} ${suffix}` : size;
  }
  return formatted;
}

export function primaryMetricKey(
  deviceType: string,
  reading: Reading | null | undefined
): string | undefined {
  if (!reading) return undefined;
  const metrics = readingMetrics(reading, deviceType);
  const profile = profileForDeviceType(deviceType);
  return profile?.summaryKeys.find((key) => metrics[key] != null);
}

export function formatLastReadingPrimary(
  deviceType: string,
  reading: Reading | null | undefined
): string {
  if (!reading) return '—';
  const metrics = readingMetrics(reading, deviceType);
  const primaryKey = primaryMetricKey(deviceType, reading);
  if (primaryKey) {
    const value = metrics[primaryKey];
    if (value != null) {
      return formatMetricValue(primaryKey, value);
    }
  }
  if (reading.alarm || reading.state === 'warning') return 'Warning';
  return 'Normal';
}

/** Compact labels for tight list cells, e.g. "T: 26°C (warn 28°C)". */
export function formatLastReadingCompact(
  deviceType: string,
  reading: Reading | null | undefined,
  configuration?: ConfigArg
): string {
  if (!reading) return '—';
  const metrics = readingMetrics(reading, deviceType);
  const thresholds = parseThresholds(configuration, deviceType);
  const profile = profileForDeviceType(deviceType);
  const keys = profile?.summaryKeys ?? Object.keys(metrics);
  const parts = keys.flatMap((key) => {
    const value = metrics[key];
    if (value == null) return [];
    return [formatCompactMetricPart(key, value, thresholds)];
  });

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
  const keys = [...(profile?.summaryKeys ?? []), ...(profile?.detailKeys ?? [])];
  if (keys.length === 0) return Object.keys(metrics).filter((key) => metrics[key] != null);
  return keys.filter((key) => metrics[key] != null);
}

export function isBooleanMetric(key: string): boolean {
  return BOOLEAN_METRICS.has(key);
}

export type DerivedReadingState = { alarm: boolean; state: ReadingState };

/** Re-derive state from metrics using the device's current thresholds. */
export function effectiveReadingState(
  reading: Reading,
  deviceType: string,
  configuration?: ConfigArg
): DerivedReadingState {
  const thresholds = parseThresholds(configuration, deviceType);
  return deriveAlarmState(readingMetrics(reading, deviceType), thresholds, deviceType);
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
  configuration?: ConfigArg,
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
  'environmental-sensor': {
    temperature: 22.1,
    humidity: 55,
    pressureHpa: 1013,
    lightLux: 120,
    uvMwCm2: 0.4,
    vocIndex: 110,
    batteryVoltage: 3.95,
    batteryPercent: 72,
  },
  camera: {
    occupied: false,
    batteryPercent: 84,
    batteryVoltage: 4.05,
  },
  'leak-sensor': {
    leak: false,
    batteryPercent: 81,
  },
  'contact-sensor': {
    batteryPercent: 88,
  },
  'motion-sensor': {
    batteryPercent: 76,
  },
  lock: {
    batteryPercent: 64,
  },
  plug: {
    on: true,
  },
  light: {
    on: true,
    brightness: 80,
  },
  'matter-gateway': {
    heapInternalFree: 31744,
    heapInternalLargest: 45651,
    heapInternalMinFree: 68695,
    heapSpiramFree: 7875320,
    heapSpiramLargest: 7843352,
    heapSpiramMinFree: 7733248,
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
  const vocLimit = thresholds.vocIndexWarning ?? DEFAULT_THRESHOLDS.vocIndexWarning;

  if (metrics.heat === true) {
    return { alarm: true, state: 'warning' };
  }
  if (metrics.leak === true) {
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
  if (typeof metrics.temperature === 'number' && metrics.temperature >= temperatureLimit) {
    return { alarm: false, state: 'warning' };
  }
  if (
    deviceType &&
    normalizeDeviceType(deviceType) === 'environmental-sensor' &&
    typeof metrics.vocIndex === 'number' &&
    metrics.vocIndex >= vocLimit
  ) {
    return { alarm: false, state: 'warning' };
  }
  return { alarm: false, state: 'normal' };
}

/** Example telemetry payload for a device type. */
function sampleTelemetryForType(
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
