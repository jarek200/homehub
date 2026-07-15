import type { Reading } from '@sst-monorepo/core';
import {
  chartMetricKeys,
  formatMetricValue,
  isBooleanMetric,
  metricLabel,
  readingMetrics,
} from '$lib/telemetry';

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

const CHART_COLORS: Record<string, string> = {
  temperature: '#f97316',
  humidity: '#3b82f6',
  co: '#f97316',
  co2: '#8b5cf6',
  heat: '#ef4444',
};

const METRIC_UNITS: Record<string, string> = {
  temperature: '°C',
  humidity: '%',
  co: 'ppm',
  co2: 'ppm',
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

function metricSeries(readings: Reading[], key: string): ReadingSeries | null {
  const color = CHART_COLORS[key] ?? '#64748b';
  const booleanScale = isBooleanMetric(key);
  const points = sortReadingsOldestFirst(readings)
    .filter((reading) => readingMetrics(reading)[key] != null)
    .map((reading) => {
      const raw = readingMetrics(reading)[key]!;
      const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
      return {
        time: readingTime(reading),
        label: formatAxisLabel(reading.recordedAt),
        value,
      };
    });

  if (points.length === 0) return null;

  return {
    key,
    label: metricLabel(key),
    unit: booleanScale ? '' : (METRIC_UNITS[key] ?? ''),
    color,
    points,
  };
}

export function buildReadingSeries(deviceType: string, readings: Reading[]): ReadingSeries[] {
  return chartMetricKeys(deviceType, readings)
    .map((key) => metricSeries(readings, key))
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

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return points
    .map((point, index) => {
      const x = padding + (index / Math.max(points.length - 1, 1)) * innerWidth;
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
