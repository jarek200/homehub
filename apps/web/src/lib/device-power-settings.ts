import type { DeviceConfiguration } from '@sst-monorepo/core';

export const PHYSICAL_REPORTING_MIN_MINUTES = 1;
export const PHYSICAL_REPORTING_MAX_MINUTES = 60;

export const REPORTING_INTERVAL_PRESETS_MINUTES = [1, 5, 10, 15, 30, 60] as const;

export function clampPhysicalReportingMinutes(minutes: number): number {
  return Math.min(
    PHYSICAL_REPORTING_MAX_MINUTES,
    Math.max(PHYSICAL_REPORTING_MIN_MINUTES, Math.round(minutes))
  );
}

export function reportingMinutesFromConfiguration(
  configuration: DeviceConfiguration | null | undefined,
  fallbackMinutes = 5
): number {
  const seconds = configuration?.reportingIntervalSeconds;
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) {
    return fallbackMinutes;
  }
  return clampPhysicalReportingMinutes(Math.round(seconds / 60));
}

export function reportingSecondsFromMinutes(minutes: number): number {
  return clampPhysicalReportingMinutes(minutes) * 60;
}

export function formatReportingIntervalSummary(
  configuration: DeviceConfiguration | null | undefined
): string {
  const minutes = reportingMinutesFromConfiguration(configuration);
  return `Reports every ${minutes} min`;
}
