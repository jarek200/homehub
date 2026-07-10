import { z } from 'zod';
import { INPUT_LIMITS } from './devices';

export const ISSUE_STATUSES = ['OPEN', 'MONITORING', 'RESOLVED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const HUMIDITY_ISSUE_THRESHOLD = 70;

export const createIssueSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(INPUT_LIMITS.issueTitle),
  deviceId: z.string().trim().min(1).optional().nullable(),
  severity: z.enum(ISSUE_SEVERITIES).default('MEDIUM'),
  status: z.enum(ISSUE_STATUSES).default('OPEN'),
  notes: z.string().trim().max(INPUT_LIMITS.issueNotes).optional().nullable(),
});

export const updateIssueSchema = z
  .object({
    title: z.string().trim().min(1).max(INPUT_LIMITS.issueTitle).optional(),
    deviceId: z.string().trim().min(1).optional().nullable(),
    severity: z.enum(ISSUE_SEVERITIES).optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
    notes: z.string().trim().max(INPUT_LIMITS.issueNotes).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

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

export function toIssueRecord(item: Record<string, unknown>): IssueRecord {
  return {
    issueId: String(item.issueId),
    title: String(item.title),
    deviceId: item.deviceId != null ? String(item.deviceId) : null,
    severity: (item.severity as IssueSeverity) ?? 'MEDIUM',
    status: (item.status as IssueStatus) ?? 'OPEN',
    notes: item.notes != null ? String(item.notes) : null,
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}

export function shouldRaiseHumidityIssue(humidity: number | null | undefined): boolean {
  return typeof humidity === 'number' && humidity >= HUMIDITY_ISSUE_THRESHOLD;
}

export function humidityIssueTitle(humidity: number): string {
  return `High humidity detected (${humidity.toFixed(1)}%)`;
}
