import type {
  Command,
  CreateDeviceInput,
  CreateHomeIssueInput,
  CreateReadingInput,
  Device,
  HomeIssue,
  Reading,
  SendCommandInput,
  UpdateDeviceInput,
  UpdateHomeIssueInput,
  UpdateUserInput,
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

export async function createDeviceReading(
  deviceId: string,
  input: CreateReadingInput
): Promise<Reading> {
  const result = await restRequest<{ reading: Reading }>(
    `/devices/${encodeURIComponent(deviceId)}/readings`,
    { method: 'POST', body: input }
  );
  return result.reading;
}

export async function listDeviceCommands(deviceId: string): Promise<Command[]> {
  const result = await restRequest<ListResponse<Command>>(
    `/devices/${encodeURIComponent(deviceId)}/commands`
  );
  return result.items ?? [];
}

export async function sendCommand(deviceId: string, input: SendCommandInput): Promise<Command> {
  return restRequest<Command>(`/devices/${encodeURIComponent(deviceId)}/commands`, {
    method: 'POST',
    body: input,
  });
}

export async function listIssues(): Promise<HomeIssue[]> {
  const result = await restRequest<ListResponse<HomeIssue>>('/issues');
  return result.items ?? [];
}

export async function createIssue(input: CreateHomeIssueInput): Promise<HomeIssue> {
  return restRequest<HomeIssue>('/issues', { method: 'POST', body: input });
}

export async function updateIssue(
  issueId: string,
  input: UpdateHomeIssueInput
): Promise<HomeIssue> {
  return restRequest<HomeIssue>(`/issues/${encodeURIComponent(issueId)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function listDeviceIssues(deviceId: string): Promise<HomeIssue[]> {
  const issues = await listIssues();
  return issues.filter((issue) => issue.deviceId === deviceId);
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

export async function updateUserProfile(input: UpdateUserInput): Promise<User> {
  return restRequest<User>('/me', { method: 'PATCH', body: input });
}
