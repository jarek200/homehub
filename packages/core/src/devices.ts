import catalog from '@homehub/catalog/homehub.json';

export const INPUT_LIMITS = catalog.inputLimits;

export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'UNKNOWN'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const LIFECYCLE_STATUSES = ['PROVISIONING', 'READY', 'FAILED', 'DECOMMISSIONED'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const RUNTIME_KINDS = ['physical', 'matter'] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

export const DEVICE_TYPE_IDS = [
  'environmental-sensor',
  'camera',
  'matter-gateway',
  'light',
  'plug',
  'contact-sensor',
  'leak-sensor',
  'motion-sensor',
  'button',
  'lock',
  'blind',
] as const;
export type DeviceType = (typeof DEVICE_TYPE_IDS)[number];

export const POWER_MODES = catalog.powerModes;
export type PowerMode = (typeof POWER_MODES)[number];

/** Device settings exposed by the REST API (object, not a JSON string). */
export interface DeviceConfiguration {
  reportingIntervalSeconds?: number;
  thresholds?: Record<string, number>;
  pan?: number;
  tilt?: number;
  powerMode?: PowerMode;
  maintenanceMode?: boolean;
  frameSize?: string;
  jpegQuality?: number;
  brightness?: number;
  saturation?: number;
  contrast?: number;
  vflip?: boolean;
  hmirror?: boolean;
  motionEnabled?: boolean;
  motionCooldownSeconds?: number;
  captureMode?: string;
  captureNow?: string;
  [key: string]: unknown;
}

export interface CreateDeviceInput {
  name: string;
  type: string;
  location: string;
  runtimeKind?: RuntimeKind;
  configuration?: DeviceConfiguration | null;
  gatewayId?: string | null;
  nodeId?: number | null;
  endpoint?: number | null;
  clusters?: string[] | null;
}

export interface CreateMatterCommissionInput {
  productId: string;
  setupPayload: string;
  gatewayId?: string | null;
  name?: string | null;
  location?: string | null;
}

export type MatterCommissionStatus = 'pairing' | 'succeeded' | 'failed';

export interface MatterCommissionJob {
  commissionId: string;
  status: MatterCommissionStatus;
  productId: string;
  gatewayId: string;
  nodeId: number;
  name?: string | null;
  location?: string | null;
  deviceId?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDeviceInput {
  name?: string;
  type?: string;
  location?: string;
  status?: DeviceStatus;
  configuration?: DeviceConfiguration | null;
  lastSeenAt?: string | null;
}

export const READING_STATES = ['normal', 'warning'] as const;
export type ReadingState = (typeof READING_STATES)[number];

export type ReadingMetrics = Record<string, number | boolean>;

export interface ReadingRecord {
  readingId: string;
  deviceId: string;
  alarm: boolean;
  state: ReadingState;
  metrics: ReadingMetrics;
  recordedAt: string;
  createdAt: string;
}

export interface DeviceRecord {
  deviceId: string;
  name: string;
  type: string;
  location?: string | null;
  runtimeKind?: RuntimeKind;
  gatewayId?: string | null;
  nodeId?: number | null;
  endpoint?: number | null;
  clusters?: string[] | null;
  status: DeviceStatus;
  lifecycleStatus: LifecycleStatus;
  thingName?: string | null;
  certificateId?: string | null;
  failureReason?: string | null;
  configuration?: DeviceConfiguration | null;
  lastSeenAt?: string | null;
  lastSnapshotKey?: string | null;
  lastSnapshotAt?: string | null;
  /** Latest reading denormalized onto the device for list views. */
  lastReading?: ReadingRecord | null;
  /** Newest-first recent readings (up to 10) denormalized for list sparklines. */
  recentReadings?: ReadingRecord[];
  createdAt: string;
  updatedAt: string;
}
