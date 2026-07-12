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
} from '@sst-monorepo/graphql';
import * as graphql from './graphql';
import { mockDeviceStore } from './mock-device-store';

/** Flip to false in Phase 2 to persist devices via AppSync GraphQL. */
export const USE_MOCK_DEVICES = true;

export async function listDevices(): Promise<Device[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDevices();
  }
  const result = await graphql.listMyDevices();
  return result.items ?? [];
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.getDevice(deviceId);
  }
  return graphql.getDevice(deviceId);
}

export async function createDevice(input: CreateDeviceInput): Promise<Device> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.createDevice(input);
  }
  return graphql.createDevice(input);
}

export async function updateDevice(deviceId: string, input: UpdateDeviceInput): Promise<Device> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.updateDevice(deviceId, input);
  }
  return graphql.updateDevice(deviceId, input);
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.deleteDevice(deviceId);
  }
  return graphql.deleteDevice(deviceId);
}

export async function listDeviceReadings(deviceId: string): Promise<Reading[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDeviceReadings(deviceId);
  }
  const result = await graphql.listDeviceReadings(deviceId);
  return result.items ?? [];
}

export async function createDeviceReading(
  deviceId: string,
  input: CreateReadingInput
): Promise<Reading> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.createDeviceReading(deviceId, input);
  }
  return graphql.createDeviceReading(deviceId, input);
}

export async function listDeviceCommands(deviceId: string): Promise<Command[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDeviceCommands(deviceId);
  }
  const result = await graphql.listDeviceCommands(deviceId);
  return result.items ?? [];
}

export async function sendCommand(deviceId: string, input: SendCommandInput): Promise<Command> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.sendCommand(deviceId, input);
  }
  return graphql.sendCommand(deviceId, input);
}

export async function listDeviceIssues(deviceId: string): Promise<HomeIssue[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDeviceIssues(deviceId);
  }
  const result = await graphql.listMyIssues();
  return (result.items ?? []).filter((issue) => issue.deviceId === deviceId);
}

export async function createIssue(input: CreateHomeIssueInput): Promise<HomeIssue> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.createIssue(input);
  }
  return graphql.createIssue(input);
}
