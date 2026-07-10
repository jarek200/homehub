import type { HomeIssue, IssueSeverity, IssueStatus } from '@sst-monorepo/graphql';

export const ISSUE_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'MONITORING', label: 'Monitoring' },
  { value: 'RESOLVED', label: 'Resolved' },
] as const;

export const ISSUE_SEVERITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
] as const;

export const HUMIDITY_ISSUE_THRESHOLD = 70;

export function formatIssueStatus(status: IssueStatus | string): string {
  return ISSUE_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function formatIssueSeverity(severity: IssueSeverity | string): string {
  return ISSUE_SEVERITIES.find((item) => item.value === severity)?.label ?? severity;
}

export function shouldSuggestHumidityIssue(humidity: number | null | undefined): boolean {
  return typeof humidity === 'number' && humidity >= HUMIDITY_ISSUE_THRESHOLD;
}

export function humidityIssueTitle(humidity: number): string {
  return `High humidity detected (${humidity.toFixed(1)}%)`;
}

export function formatReadingSummary(reading: {
  temperature?: number | null;
  humidity?: number | null;
  motionDetected?: boolean | null;
  cameraOnline?: boolean | null;
}): string {
  const parts: string[] = [];
  if (reading.temperature != null) parts.push(`${reading.temperature}°C`);
  if (reading.humidity != null) parts.push(`${reading.humidity}% humidity`);
  if (reading.motionDetected != null) {
    parts.push(reading.motionDetected ? 'Motion detected' : 'No motion');
  }
  if (reading.cameraOnline != null) {
    parts.push(reading.cameraOnline ? 'Camera online' : 'Camera offline');
  }
  return parts.length ? parts.join(' · ') : 'Reading recorded';
}

export function issueMatchesDevice(issue: HomeIssue, deviceId: string): boolean {
  return issue.deviceId === deviceId;
}
