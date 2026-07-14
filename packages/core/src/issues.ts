export const ISSUE_STATUSES = ['OPEN', 'MONITORING', 'RESOLVED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const HUMIDITY_ISSUE_THRESHOLD = 70;

export interface CreateIssueInput {
  title: string;
  deviceId?: string | null;
  severity?: IssueSeverity;
  status?: IssueStatus;
  notes?: string | null;
}

export interface UpdateIssueInput {
  title?: string;
  deviceId?: string | null;
  severity?: IssueSeverity;
  status?: IssueStatus;
  notes?: string | null;
}

export interface IssueRecord {
  issueId: string;
  title: string;
  deviceId?: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function shouldRaiseHumidityIssue(humidity: number | null | undefined): boolean {
  return typeof humidity === 'number' && humidity >= HUMIDITY_ISSUE_THRESHOLD;
}

export function humidityIssueTitle(humidity: number): string {
  return `High humidity detected (${humidity.toFixed(1)}%)`;
}
