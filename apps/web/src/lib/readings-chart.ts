import type { Reading } from '@sst-monorepo/core';
import { chartMetricKeys, isBooleanMetric, metricLabel, readingMetrics } from '$lib/telemetry';

export type ChartPoint = {
  time: number;
  label: string;
  value: number;
};

export type ReadingSeries = {
  key: string;
  label: string;
  unit: string;
  color: string;
  points: ChartPoint[];
};

export type BuildSeriesOptions = {
  /** Cap rendered points by averaging into time buckets (helps Athena 3h density). */
  maxPoints?: number;
};

const CHART_COLORS: Record<string, string> = {
  temperature: '#f97316',
  humidity: '#3b82f6',
  vocIndex: '#a855f7',
  co: '#f97316',
  co2: '#8b5cf6',
  heat: '#ef4444',
};

const METRIC_UNITS: Record<string, string> = {
  temperature: '°C',
  humidity: '%',
  vocIndex: '',
  co: 'ppm',
  co2: 'ppm',
  pressureHpa: 'hPa',
  lightLux: 'lx',
  batteryVoltage: 'V',
  batteryPercent: '%',
};

function readingTime(reading: Reading): number {
  const parsed = Date.parse(reading.recordedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatAxisLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function sortReadingsOldestFirst(readings: Reading[]): Reading[] {
  return [...readings].sort((a, b) => readingTime(a) - readingTime(b));
}

/** Average (or max for boolean) points into ~maxPoints time buckets. */
export function downsamplePoints(
  points: ChartPoint[],
  maxPoints: number,
  options: { booleanScale?: boolean } = {}
): ChartPoint[] {
  const booleanScale = options.booleanScale ?? false;
  if (points.length <= maxPoints || maxPoints < 2) return points;

  const sorted = [...points].sort((a, b) => a.time - b.time);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return points;
  const start = first.time;
  const end = last.time;
  const span = Math.max(end - start, 1);
  const bucketMs = span / maxPoints;

  const buckets = new Map<number, ChartPoint[]>();
  for (const point of sorted) {
    const index = Math.min(maxPoints - 1, Math.floor((point.time - start) / bucketMs));
    const group = buckets.get(index) ?? [];
    group.push(point);
    buckets.set(index, group);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, group]) => {
      const anchor = group[Math.floor(group.length / 2)];
      if (!anchor) return [];
      if (booleanScale) {
        return [
          {
            time: anchor.time,
            label: anchor.label,
            value: group.some((point) => point.value >= 1) ? 1 : 0,
          },
        ];
      }
      const sum = group.reduce((total, point) => total + point.value, 0);
      const average = sum / group.length;
      return [
        {
          time: anchor.time,
          label: anchor.label,
          value: Math.round(average * 10) / 10,
        },
      ];
    });
}

function metricSeries(
  readings: Reading[],
  key: string,
  options?: BuildSeriesOptions
): ReadingSeries | null {
  const color = CHART_COLORS[key] ?? '#64748b';
  const booleanScale = isBooleanMetric(key);
  let points = sortReadingsOldestFirst(readings).flatMap((reading) => {
    const raw = readingMetrics(reading)[key];
    if (raw == null) return [];
    const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
    return [
      {
        time: readingTime(reading),
        label: formatAxisLabel(reading.recordedAt),
        value,
      },
    ];
  });

  if (points.length === 0) return null;

  if (options?.maxPoints != null) {
    points = downsamplePoints(points, options.maxPoints, { booleanScale });
  }

  return {
    key,
    label: metricLabel(key),
    unit: booleanScale ? '' : (METRIC_UNITS[key] ?? ''),
    color,
    points,
  };
}

export function buildReadingSeries(
  deviceType: string,
  readings: Reading[],
  options?: BuildSeriesOptions
): ReadingSeries[] {
  return chartMetricKeys(deviceType, readings)
    .map((key) => metricSeries(readings, key, options))
    .filter((item): item is ReadingSeries => item != null);
}

export function chartPath(
  points: ChartPoint[],
  width: number,
  height: number,
  padding = 16
): string {
  if (points.length === 0) return '';

  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const times = points.map((point) => point.time);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return points
    .map((point, index) => {
      const x =
        points.length === 1
          ? padding + innerWidth / 2
          : padding + ((point.time - minTime) / timeRange) * innerWidth;
      const y = padding + innerHeight - ((point.value - minValue) / valueRange) * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export function chartDomain(points: ChartPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 1 };
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

export function formatChartValue(key: string, value: number): string {
  if (isBooleanMetric(key)) return value >= 1 ? 'Yes' : 'No';
  const unit = METRIC_UNITS[key];
  return unit ? `${value}${unit}` : String(value);
}
