import {
  type Cores3Product,
  type CreateDeviceInput,
  type CreateMatterCommissionInput,
  type Device,
  type FloorPlan,
  type FloorPlanLibrary,
  type HubCommand,
  type HubHouseholdState,
  type MatterCommissionJob,
  parseFloorPlan,
  parseFloorPlanLibrary,
  type Reading,
  type UpdateDeviceInput,
  type User,
} from '@homehub/core';
import { RestApiError, restRequest } from './rest';

interface ListResponse<T> {
  items: T[];
}

export async function listDevices(): Promise<Device[]> {
  const result = await restRequest<ListResponse<Device>>('/devices');
  return result.items ?? [];
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  try {
    return await restRequest<Device>(`/devices/${encodeURIComponent(deviceId)}`);
  } catch (err) {
    if (err instanceof RestApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function createDevice(input: CreateDeviceInput): Promise<Device> {
  return restRequest<Device>('/devices', { method: 'POST', body: input });
}

export async function listMatterProducts(): Promise<Cores3Product[]> {
  const result = await restRequest<ListResponse<Cores3Product>>('/matter/products');
  return result.items ?? [];
}

export async function startMatterCommission(
  input: CreateMatterCommissionInput
): Promise<MatterCommissionJob> {
  return restRequest<MatterCommissionJob>('/matter/commission', { method: 'POST', body: input });
}

export async function getMatterCommission(commissionId: string): Promise<MatterCommissionJob> {
  return restRequest<MatterCommissionJob>(`/matter/commission/${encodeURIComponent(commissionId)}`);
}

export async function updateDevice(deviceId: string, input: UpdateDeviceInput): Promise<Device> {
  return restRequest<Device>(`/devices/${encodeURIComponent(deviceId)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  const result = await restRequest<{ deleted: boolean }>(
    `/devices/${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' }
  );
  return result.deleted;
}

export interface DeviceSnapshot {
  url: string;
  recordedAt: string | null;
}

export interface DeviceSnapshotList {
  items: DeviceSnapshot[];
  sampled: boolean;
  total: number;
}

export async function getDeviceSnapshot(deviceId: string): Promise<DeviceSnapshot> {
  return restRequest<DeviceSnapshot>(`/devices/${encodeURIComponent(deviceId)}/snapshot`);
}

export async function listDeviceSnapshots(
  deviceId: string,
  from: string,
  to: string
): Promise<DeviceSnapshotList> {
  const params = new URLSearchParams({ from, to });
  return restRequest<DeviceSnapshotList>(
    `/devices/${encodeURIComponent(deviceId)}/snapshots?${params.toString()}`
  );
}

export async function listDeviceReadings(deviceId: string): Promise<Reading[]> {
  const result = await restRequest<ListResponse<Reading>>(
    `/devices/${encodeURIComponent(deviceId)}/readings`
  );
  return result.items ?? [];
}

export async function getHouseholdState(): Promise<HubHouseholdState> {
  const result = await restRequest<{ state: HubHouseholdState }>('/household/state');
  return result.state;
}

export async function getHouseholdPlanDocument(): Promise<{
  plan: FloorPlan | null;
  library: FloorPlanLibrary | null;
}> {
  const result = await restRequest<{ plan?: unknown; library?: unknown }>('/household/plan');
  return {
    plan: parseFloorPlan(result.plan) ?? null,
    library: parseFloorPlanLibrary(result.library),
  };
}

export async function getHouseholdPlan(): Promise<FloorPlan | null> {
  return (await getHouseholdPlanDocument()).plan;
}

export async function putHouseholdPlan(plan: FloorPlan, library?: FloorPlanLibrary): Promise<void> {
  await restRequest('/household/plan', { method: 'PUT', body: { plan, library } });
}

export async function postHouseholdCommand(command: HubCommand): Promise<HubHouseholdState> {
  const result = await restRequest<{ state: HubHouseholdState }>('/household/commands', {
    method: 'POST',
    body: { command },
  });
  return result.state;
}

export async function postHouseholdDevice(input: {
  kind: 'light' | 'plug';
  id: string;
  on?: boolean;
  brightness?: number;
}): Promise<HubHouseholdState> {
  const result = await restRequest<{ state: HubHouseholdState }>('/household/device', {
    method: 'POST',
    body: input,
  });
  return result.state;
}

export async function getMyProfile(): Promise<User | null> {
  try {
    return await restRequest<User>('/me');
  } catch (err) {
    if (err instanceof RestApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export type HouseholdRole = 'OWNER' | 'MEMBER';

export interface HouseholdMember {
  userId: string;
  email: string;
  role: HouseholdRole;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdInvite {
  inviteId: string;
  email: string;
  role: HouseholdRole;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expiresAt: number;
  createdAt: string;
  updatedAt: string;
  emailSent?: boolean | null;
  emailError?: string | null;
}

export interface Household {
  householdId: string;
  role: HouseholdRole;
  created: boolean;
  tokenRefreshRequired: boolean;
  members: HouseholdMember[];
  invites: HouseholdInvite[];
}

export interface SensorEvent {
  deviceId: string;
  name: string;
  kind: 'contact' | 'motion';
  value: 'OPEN' | 'DETECTED';
  at: string;
}

export async function listSensorEvents(options: {
  from: string;
  to: string;
  deviceId?: string;
  kind?: 'contact' | 'motion';
  limit?: number;
}): Promise<SensorEvent[]> {
  const params = new URLSearchParams({ from: options.from, to: options.to });
  if (options.deviceId) params.set('deviceId', options.deviceId);
  if (options.kind) params.set('kind', options.kind);
  if (options.limit) params.set('limit', String(options.limit));
  const result = await restRequest<ListResponse<SensorEvent>>(
    `/household/sensor-events?${params.toString()}`
  );
  return result.items ?? [];
}

export async function bootstrapHousehold(): Promise<Household> {
  return restRequest<Household>('/household/bootstrap', { method: 'POST' });
}

export async function getHousehold(): Promise<Household> {
  return restRequest<Household>('/household');
}

export async function createHouseholdInvite(email: string): Promise<HouseholdInvite> {
  return restRequest<HouseholdInvite>('/household/invites', {
    method: 'POST',
    body: { email },
  });
}

export async function resendHouseholdInvite(inviteId: string): Promise<HouseholdInvite> {
  return restRequest<HouseholdInvite>(`/household/invites/${encodeURIComponent(inviteId)}/resend`, {
    method: 'POST',
  });
}

export async function cancelHouseholdInvite(inviteId: string): Promise<HouseholdInvite> {
  return restRequest<HouseholdInvite>(`/household/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
  });
}

export async function acceptHouseholdInvite(token: string): Promise<Household> {
  return restRequest<Household>('/household/invites/accept', {
    method: 'POST',
    body: { token },
  });
}

export async function removeHouseholdMember(userId: string): Promise<Household> {
  return restRequest<Household>(`/household/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
