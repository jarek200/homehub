import { DEVICE_STATUSES, type DeviceRecord, type DeviceStatus } from './devices';
import {
  cognitoHouseholdGroup,
  householdIdFromPk,
  isHouseholdPk,
  normalizeCognitoGroups,
} from './household';
import type { HubHouseholdState } from './hub';
import { sanitizeSensorHistory } from './sensor-history';

export const HOUSEHOLD_STATE_EVENT_TYPE = 'household.state.v1' as const;
export const CAMERA_SNAPSHOT_EVENT_TYPE = 'camera.snapshot.v1' as const;
export const DEVICE_UPDATED_EVENT_TYPE = 'device.updated.v1' as const;
export const HOUSEHOLD_CHANNEL_NAMESPACE = 'household';

export interface HouseholdStateEventV1 {
  type: typeof HOUSEHOLD_STATE_EVENT_TYPE;
  eventId: string;
  stateVersion: number;
  updatedAt: string;
  state: HubHouseholdState;
}

export interface CameraSnapshotEventV1 {
  type: typeof CAMERA_SNAPSHOT_EVENT_TYPE;
  eventId: string;
  deviceId: string;
  recordedAt: string;
}

export interface DeviceUpdatedEventV1 {
  type: typeof DEVICE_UPDATED_EVENT_TYPE;
  eventId: string;
  deviceId: string;
  recordedAt: string;
  status?: DeviceStatus;
  occupied?: boolean;
}

const SECRET_KEY_PATTERN =
  /(password|secret|token|apikey|api_key|credential|setupcode|setup_code|pairing|cameraurl|camera_url|snapshoturl|snapshot_url|wifi)/i;

export function householdChannelForId(householdId: string): string {
  return `${HOUSEHOLD_CHANNEL_NAMESPACE}/${householdId}`;
}

export function householdChannelPathForId(householdId: string): string {
  return `/${householdChannelForId(householdId)}`;
}

export function householdChannelPathForSub(sub: string): string {
  return householdChannelPathForId(sub);
}

export function householdIdFromChannelPath(channelPath: string): string | null {
  const normalized = channelPath.startsWith('/') ? channelPath : `/${channelPath}`;
  const prefix = `/${HOUSEHOLD_CHANNEL_NAMESPACE}/`;
  if (!normalized.startsWith(prefix)) return null;
  const householdId = normalized.slice(prefix.length);
  return householdId && !householdId.includes('/') ? householdId : null;
}

export function isHouseholdSubscribeAllowed(
  channelPath: string,
  groups?: string[] | string | null
): boolean {
  const householdId = householdIdFromChannelPath(channelPath);
  if (!householdId) return false;
  const normalizedGroups = normalizeCognitoGroups(groups);
  return normalizedGroups.includes(cognitoHouseholdGroup(householdId));
}

export function channelForHouseholdPk(tenantPk: string): string | null {
  if (!isHouseholdPk(tenantPk)) return null;
  const householdId = householdIdFromPk(tenantPk);
  return householdId ? householdChannelForId(householdId) : null;
}

export function isNewerHouseholdEvent(
  incoming: { stateVersion?: number; updatedAt?: string },
  current: { stateVersion?: number; updatedAt?: string }
): boolean {
  const incomingVersion = incoming.stateVersion;
  const currentVersion = current.stateVersion;
  if (typeof incomingVersion === 'number' && typeof currentVersion === 'number') {
    return incomingVersion > currentVersion;
  }
  const incomingAt = incoming.updatedAt ?? '';
  const currentAt = current.updatedAt ?? '';
  if (incomingAt && currentAt) return incomingAt > currentAt;
  return true;
}

export function hasHouseholdSequenceGap(
  incomingVersion: number | undefined,
  currentVersion: number | undefined
): boolean {
  return (
    typeof incomingVersion === 'number' &&
    typeof currentVersion === 'number' &&
    incomingVersion > currentVersion + 1
  );
}

export function reconnectDelayMs(attempt: number, random = Math.random()): number {
  const exp = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(exp * (0.5 + random * 0.5));
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    out[key] = stripSecrets(item);
  }
  return out;
}

export function sanitizeHouseholdState(state: HubHouseholdState): HubHouseholdState {
  const cleaned = stripSecrets(state) as HubHouseholdState;
  const next: HubHouseholdState = {
    lock: cleaned.lock ?? null,
    lights: Array.isArray(cleaned.lights) ? cleaned.lights : [],
    plugs: Array.isArray(cleaned.plugs) ? cleaned.plugs : [],
    contacts: Array.isArray(cleaned.contacts) ? cleaned.contacts : [],
    motions: Array.isArray(cleaned.motions) ? cleaned.motions : [],
    climates: Array.isArray(cleaned.climates) ? cleaned.climates : [],
    leaks: Array.isArray(cleaned.leaks) ? cleaned.leaks : [],
    buttons: Array.isArray(cleaned.buttons) ? cleaned.buttons : [],
    scene: cleaned.scene ?? null,
    updatedAt: typeof cleaned.updatedAt === 'string' ? cleaned.updatedAt : '',
  };
  if (typeof cleaned.stateVersion === 'number') {
    next.stateVersion = cleaned.stateVersion;
  }
  const history = sanitizeSensorHistory(cleaned.sensorHistory);
  if (Object.keys(history).length) {
    next.sensorHistory = history;
  }
  return next;
}

export function parseCameraSnapshotEvent(raw: unknown): CameraSnapshotEventV1 | null {
  const envelope = unwrapEventPayload(raw);
  if (!envelope || typeof envelope !== 'object') return null;
  const record = envelope as Record<string, unknown>;
  if (record.type !== CAMERA_SNAPSHOT_EVENT_TYPE) return null;
  if (typeof record.eventId !== 'string' || !record.eventId) return null;
  if (typeof record.deviceId !== 'string' || !record.deviceId) return null;
  if (typeof record.recordedAt !== 'string' || !record.recordedAt) return null;
  return {
    type: CAMERA_SNAPSHOT_EVENT_TYPE,
    eventId: record.eventId,
    deviceId: record.deviceId,
    recordedAt: record.recordedAt,
  };
}

export function buildCameraSnapshotEvent(input: {
  eventId: string;
  deviceId: string;
  recordedAt: string;
}): CameraSnapshotEventV1 {
  return {
    type: CAMERA_SNAPSHOT_EVENT_TYPE,
    eventId: input.eventId,
    deviceId: input.deviceId,
    recordedAt: input.recordedAt,
  };
}

export function parseDeviceUpdatedEvent(raw: unknown): DeviceUpdatedEventV1 | null {
  const envelope = unwrapEventPayload(raw);
  if (!envelope || typeof envelope !== 'object') return null;
  const record = envelope as Record<string, unknown>;
  if (record.type !== DEVICE_UPDATED_EVENT_TYPE) return null;
  if (typeof record.eventId !== 'string' || !record.eventId) return null;
  if (typeof record.deviceId !== 'string' || !record.deviceId) return null;
  if (typeof record.recordedAt !== 'string' || !record.recordedAt) return null;
  const event: DeviceUpdatedEventV1 = {
    type: DEVICE_UPDATED_EVENT_TYPE,
    eventId: record.eventId,
    deviceId: record.deviceId,
    recordedAt: record.recordedAt,
  };
  if (
    typeof record.status === 'string' &&
    (DEVICE_STATUSES as readonly string[]).includes(record.status)
  ) {
    event.status = record.status as DeviceStatus;
  }
  if (typeof record.occupied === 'boolean') {
    event.occupied = record.occupied;
  }
  return event;
}

export function buildDeviceUpdatedEvent(input: {
  eventId: string;
  deviceId: string;
  recordedAt: string;
  status?: DeviceStatus;
  occupied?: boolean;
}): DeviceUpdatedEventV1 {
  const event: DeviceUpdatedEventV1 = {
    type: DEVICE_UPDATED_EVENT_TYPE,
    eventId: input.eventId,
    deviceId: input.deviceId,
    recordedAt: input.recordedAt,
  };
  if (input.status) event.status = input.status;
  if (input.occupied !== undefined) event.occupied = input.occupied;
  return event;
}

export function applyDeviceUpdatedEvent(
  device: DeviceRecord,
  event: DeviceUpdatedEventV1
): DeviceRecord {
  if (device.deviceId !== event.deviceId) return device;
  const next: DeviceRecord = {
    ...device,
    lastSeenAt: event.recordedAt,
    updatedAt: event.recordedAt,
  };
  if (event.status) next.status = event.status;
  if (event.occupied === undefined) return next;
  const base = device.lastReading;
  next.lastReading = {
    readingId: base?.readingId ?? `live-${device.deviceId}`,
    deviceId: device.deviceId,
    alarm: base?.alarm ?? false,
    state: base?.state ?? 'normal',
    metrics: { ...(base?.metrics ?? {}), occupied: event.occupied },
    recordedAt: event.recordedAt,
    createdAt: base?.createdAt ?? event.recordedAt,
  };
  return next;
}

export function parseHouseholdStateEvent(raw: unknown): HouseholdStateEventV1 | null {
  const envelope = unwrapEventPayload(raw);
  if (!envelope || typeof envelope !== 'object') return null;
  const record = envelope as Record<string, unknown>;
  if (record.type !== HOUSEHOLD_STATE_EVENT_TYPE) return null;
  if (typeof record.eventId !== 'string' || !record.eventId) return null;
  if (typeof record.updatedAt !== 'string' || !record.updatedAt) return null;
  const stateVersion = Number(record.stateVersion);
  if (!Number.isFinite(stateVersion)) return null;
  if (!record.state || typeof record.state !== 'object') return null;
  return {
    type: HOUSEHOLD_STATE_EVENT_TYPE,
    eventId: record.eventId,
    stateVersion,
    updatedAt: record.updatedAt,
    state: sanitizeHouseholdState(record.state as HubHouseholdState),
  };
}

function unwrapEventPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const record = raw as Record<string, unknown>;
  if (record.event && typeof record.event === 'object') return record.event;
  if (record.payload && typeof record.payload === 'object') return record.payload;
  return raw;
}

export function buildHouseholdStateEvent(input: {
  eventId: string;
  state: HubHouseholdState;
}): HouseholdStateEventV1 {
  const state = sanitizeHouseholdState(input.state);
  return {
    type: HOUSEHOLD_STATE_EVENT_TYPE,
    eventId: input.eventId,
    stateVersion: typeof state.stateVersion === 'number' ? state.stateVersion : 0,
    updatedAt: state.updatedAt,
    state,
  };
}
