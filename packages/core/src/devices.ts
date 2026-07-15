export const INPUT_LIMITS = {
  name: 100,
  type: 64,
  location: 100,
  configuration: 4096,
  command: 64,
  issueTitle: 200,
  issueNotes: 2000,
} as const;

export const DEMO_TENANT_ID = 'demo';
export const DEMO_TENANT_PK = `HUB#${DEMO_TENANT_ID}`;

export function hubPkForUser(userId: string): string {
  return `HUB#${userId}`;
}

export function hubIdFromPk(tenantPk: string): string {
  return tenantPk.startsWith('HUB#') ? tenantPk.slice(4) : tenantPk;
}

export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'UNKNOWN'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const LIFECYCLE_STATUSES = ['PROVISIONING', 'READY', 'FAILED', 'DECOMMISSIONED'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const COMMAND_STATUSES = ['PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export interface CreateDeviceInput {
  name: string;
  type: string;
  location: string;
  configuration?: string | null;
}

export interface UpdateDeviceInput {
  name?: string;
  type?: string;
  location?: string;
  status?: DeviceStatus;
  configuration?: string | null;
  lastSeenAt?: string | null;
}

export const READING_STATES = ['normal', 'warning'] as const;
export type ReadingState = (typeof READING_STATES)[number];

export type ReadingMetrics = Record<string, number | boolean>;

export interface CreateReadingInput {
  alarm?: boolean | null;
  state?: ReadingState | null;
  metrics?: ReadingMetrics | null;
  recordedAt?: string | null;
}

export interface CreateCommandInput {
  command: string;
}

export interface DeviceRecord {
  deviceId: string;
  name: string;
  type: string;
  location?: string | null;
  status: DeviceStatus;
  lifecycleStatus: LifecycleStatus;
  thingName?: string | null;
  certificateId?: string | null;
  failureReason?: string | null;
  configuration?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingRecord {
  readingId: string;
  deviceId: string;
  alarm: boolean;
  state: ReadingState;
  metrics: ReadingMetrics;
  recordedAt: string;
  createdAt: string;
}

export interface CommandRecord {
  commandId: string;
  deviceId: string;
  command: string;
  status: CommandStatus;
  result?: string | null;
  createdAt: string;
  updatedAt: string;
}
