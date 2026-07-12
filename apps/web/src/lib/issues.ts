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

export function formatLastReadingPrimary(
  deviceType: string,
  reading:
    | {
        temperature?: number | null;
        humidity?: number | null;
        motionDetected?: boolean | null;
        cameraOnline?: boolean | null;
      }
    | null
    | undefined
): string {
  if (!reading) return '—';

  if (deviceType === 'carbon-monoxide-alarm' && reading.temperature != null) {
    return `${reading.temperature} ppm CO`;
  }

  if (deviceType === 'heat-alarm' && reading.temperature != null) {
    return `${reading.temperature}°C`;
  }

  if (deviceType === 'smoke-alarm') {
    if (reading.motionDetected != null) {
      return reading.motionDetected ? 'Smoke detected' : 'No smoke';
    }
    if (reading.cameraOnline != null) {
      return reading.cameraOnline ? 'Online' : 'Offline';
    }
  }

  if (deviceType === 'environmental-sensor') {
    const parts: string[] = [];
    if (reading.temperature != null) parts.push(`${reading.temperature}°C`);
    if (reading.humidity != null) parts.push(`${reading.humidity}%`);
    if (parts.length) return parts.join(' · ');
  }

  if (reading.temperature != null) return `${reading.temperature}°C`;
  if (reading.humidity != null) return `${reading.humidity}%`;

  return '—';
}

export function formatLastReading(
  deviceType: string,
  reading:
    | {
        temperature?: number | null;
        humidity?: number | null;
        motionDetected?: boolean | null;
        cameraOnline?: boolean | null;
      }
    | null
    | undefined
): string {
  if (!reading) return '—';
  return formatReadingSummary(reading, deviceType);
}

export function formatReadingSummary(
  reading: {
    temperature?: number | null;
    humidity?: number | null;
    motionDetected?: boolean | null;
    cameraOnline?: boolean | null;
  },
  deviceType?: string
): string {
  const parts: string[] = [];

  if (deviceType === 'carbon-monoxide-alarm' && reading.temperature != null) {
    parts.push(`${reading.temperature} ppm CO`);
  } else if (deviceType === 'heat-alarm' && reading.temperature != null) {
    parts.push(`${reading.temperature}°C heat`);
  } else {
    if (reading.temperature != null) parts.push(`${reading.temperature}°C`);
  }

  if (reading.humidity != null) parts.push(`${reading.humidity}% humidity`);

  if (deviceType === 'smoke-alarm') {
    if (reading.motionDetected != null) {
      parts.push(reading.motionDetected ? 'Smoke detected' : 'No smoke');
    }
    if (reading.cameraOnline != null) {
      parts.push(reading.cameraOnline ? 'Device online' : 'Device offline');
    }
  } else {
    if (reading.motionDetected != null) {
      parts.push(reading.motionDetected ? 'Motion detected' : 'No motion');
    }
    if (reading.cameraOnline != null) {
      parts.push(reading.cameraOnline ? 'Camera online' : 'Camera offline');
    }
  }

  return parts.length ? parts.join(' · ') : 'Reading recorded';
}

export function issueMatchesDevice(issue: HomeIssue, deviceId: string): boolean {
  return issue.deviceId === deviceId;
}
