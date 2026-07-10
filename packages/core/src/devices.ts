import { z } from 'zod';

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

export const createDeviceSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(INPUT_LIMITS.name),
  type: z.string().trim().min(1, 'type is required').max(INPUT_LIMITS.type),
  location: z.string().trim().max(INPUT_LIMITS.location).optional().nullable(),
  configuration: z.string().max(INPUT_LIMITS.configuration).optional().nullable(),
});

export const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(1, 'name cannot be empty').max(INPUT_LIMITS.name).optional(),
    type: z.string().trim().max(INPUT_LIMITS.type).optional(),
    location: z.string().trim().max(INPUT_LIMITS.location).optional().nullable(),
    status: z.enum(DEVICE_STATUSES).optional(),
    configuration: z.string().max(INPUT_LIMITS.configuration).optional().nullable(),
    lastSeenAt: z.string().datetime().optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const createReadingSchema = z
  .object({
    temperature: z.number().finite().optional().nullable(),
    humidity: z.number().finite().min(0).max(100).optional().nullable(),
    motionDetected: z.boolean().optional().nullable(),
    cameraOnline: z.boolean().optional().nullable(),
    recordedAt: z.string().datetime().optional().nullable(),
  })
  .refine(
    (value) =>
      value.temperature != null ||
      value.humidity != null ||
      value.motionDetected != null ||
      value.cameraOnline != null,
    { message: 'At least one reading value is required' }
  );

export const createCommandSchema = z.object({
  command: z.string().trim().min(1, 'command is required').max(INPUT_LIMITS.command),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type CreateReadingInput = z.infer<typeof createReadingSchema>;
export type CreateCommandInput = z.infer<typeof createCommandSchema>;

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

export function toDeviceRecord(item: Record<string, unknown>): DeviceRecord {
  return {
    deviceId: String(item.deviceId),
    name: String(item.name),
    type: String(item.type),
    location: item.location != null ? String(item.location) : null,
    status: (item.status as DeviceStatus) ?? 'UNKNOWN',
    configuration: item.configuration != null ? String(item.configuration) : null,
    lastSeenAt: item.lastSeenAt != null ? String(item.lastSeenAt) : null,
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}

export function toReadingRecord(item: Record<string, unknown>): ReadingRecord {
  return {
    readingId: String(item.readingId),
    deviceId: String(item.deviceId),
    temperature: typeof item.temperature === 'number' ? item.temperature : null,
    humidity: typeof item.humidity === 'number' ? item.humidity : null,
    motionDetected: typeof item.motionDetected === 'boolean' ? item.motionDetected : null,
    cameraOnline: typeof item.cameraOnline === 'boolean' ? item.cameraOnline : null,
    recordedAt: String(item.recordedAt),
    createdAt: String(item.createdAt),
  };
}

export function toCommandRecord(item: Record<string, unknown>): CommandRecord {
  return {
    commandId: String(item.commandId),
    deviceId: String(item.deviceId),
    command: String(item.command),
    status: (item.status as CommandStatus) ?? 'PENDING',
    result: item.result != null ? String(item.result) : null,
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}
