/** Parity helpers for the DeviceProvision JSONata state machine. */

export const DEMO_TENANT_PK = 'HOUSEHOLD#demo';
const HOUSEHOLD_PREFIX = 'HOUSEHOLD#';
const HUB_PREFIX = 'HUB#';
const DEVICE_SK_PREFIX = 'DEVICE#';

export type ProvisionStreamRecord = {
  eventName?: string;
  dynamodb?: {
    Keys?: { SK?: { S?: string }; PK?: { S?: string } };
    NewImage?: Record<string, { S?: string } | undefined>;
  };
};

export type ProvisionContext = {
  tenantPk: string;
  deviceId: string;
  name: string;
  type: string;
  runtimeKind: string;
  configuration: string | null;
  thingName: string;
  ssmCertPrefix: string;
  hubId: string;
};

export function thingNameFor(deviceId: string): string {
  return `homehub-${deviceId}`;
}

export function ssmPrefixFor(deviceId: string): string {
  return `/homehub/devices/${deviceId}`;
}

export function hubIdFromPk(tenantPk: string): string {
  if (tenantPk.startsWith(HOUSEHOLD_PREFIX)) {
    return tenantPk.slice(HOUSEHOLD_PREFIX.length);
  }
  if (tenantPk.startsWith(HUB_PREFIX)) {
    return tenantPk.slice(HUB_PREFIX.length);
  }
  return tenantPk;
}

export function firstPipeRecord(input: unknown): ProvisionStreamRecord | undefined {
  if (Array.isArray(input)) {
    const first = input[0];
    return first && typeof first === 'object' ? (first as ProvisionStreamRecord) : undefined;
  }
  if (input && typeof input === 'object') {
    return input as ProvisionStreamRecord;
  }
  return undefined;
}

export function parseProvisionContext(input: unknown): ProvisionContext | null {
  const record = firstPipeRecord(input);
  const dynamodb = record?.dynamodb;
  const sk = dynamodb?.Keys?.SK?.S ?? '';
  const image = dynamodb?.NewImage ?? {};
  const fromImage = image.deviceId?.S?.trim() ?? '';
  const fromSk = sk.startsWith(DEVICE_SK_PREFIX) ? sk.slice(DEVICE_SK_PREFIX.length) : '';
  const deviceId = fromImage || fromSk;
  if (!deviceId) {
    return null;
  }
  const tenantPk = image.PK?.S?.trim() || DEMO_TENANT_PK;
  const configuration = image.configuration?.S ?? null;
  return {
    tenantPk,
    deviceId,
    name: image.name?.S ?? '',
    type: image.type?.S ?? '',
    runtimeKind: image.runtimeKind?.S?.trim() || 'simulated',
    configuration,
    thingName: thingNameFor(deviceId),
    ssmCertPrefix: ssmPrefixFor(deviceId),
    hubId: hubIdFromPk(tenantPk),
  };
}

export function shadowUpdatePayload(
  configuration: string | null | undefined,
  deviceType: string
): { state: { desired: Record<string, unknown> } } {
  const desired: Record<string, unknown> = { type: deviceType };
  if (configuration == null || configuration === '') {
    return { state: { desired } };
  }
  try {
    const parsed: unknown = JSON.parse(configuration);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed as Record<string, unknown>).length > 0
    ) {
      desired.configuration = parsed;
    }
  } catch {
    /* invalid JSON — omit configuration, same as as_config_dict */
  }
  return { state: { desired } };
}

export function truncateFailureCause(
  cause: string | undefined,
  fallback = 'Provisioning failed'
): string {
  const text = cause?.trim() || fallback;
  return text.length > 500 ? text.slice(0, 500) : text;
}
