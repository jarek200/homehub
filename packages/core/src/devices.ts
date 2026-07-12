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

export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'UNKNOWN'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const COMMAND_STATUSES = ['PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export interface CreateDeviceInput {
  name: string;
  type: string;
  location?: string | null;
  configuration?: string | null;
}

export interface UpdateDeviceInput {
  name?: string;
  type?: string;
  location?: string | null;
  status?: DeviceStatus;
  configuration?: string | null;
  lastSeenAt?: string | null;
}

export interface CreateReadingInput {
  temperature?: number | null;
  humidity?: number | null;
  motionDetected?: boolean | null;
  cameraOnline?: boolean | null;
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
  configuration?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingRecord {
  readingId: string;
  deviceId: string;
  temperature?: number | null;
  humidity?: number | null;
  motionDetected?: boolean | null;
  cameraOnline?: boolean | null;
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
