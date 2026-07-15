import type {
  CreateDeviceInput,
  Device,
  Reading,
  UpdateDeviceInput,
  User,
} from '@sst-monorepo/core';
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

export async function listDeviceReadings(deviceId: string): Promise<Reading[]> {
  const result = await restRequest<ListResponse<Reading>>(
    `/devices/${encodeURIComponent(deviceId)}/readings`
  );
  return result.items ?? [];
}

export async function listDeviceReadingHistory(deviceId: string, hours = 3): Promise<Reading[]> {
  const result = await restRequest<ListResponse<Reading>>(
    `/devices/${encodeURIComponent(deviceId)}/readings/history?hours=${hours}`
  );
  return result.items ?? [];
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
