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
} from '@sst-monorepo/core';
import { mockDeviceStore } from './mock-device-store';
import * as rest from './rest-api';

/** Set true for offline UI without a deployed REST API. */
export const USE_MOCK_DEVICES = false;

export async function listDevices(): Promise<Device[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDevices();
  }
  return rest.listDevices();
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.getDevice(deviceId);
  }
  return rest.getDevice(deviceId);
}

export async function createDevice(input: CreateDeviceInput): Promise<Device> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.createDevice(input);
  }
  return rest.createDevice(input);
}

export async function updateDevice(deviceId: string, input: UpdateDeviceInput): Promise<Device> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.updateDevice(deviceId, input);
  }
  return rest.updateDevice(deviceId, input);
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.deleteDevice(deviceId);
  }
  return rest.deleteDevice(deviceId);
}

export async function listDeviceReadings(deviceId: string): Promise<Reading[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDeviceReadings(deviceId);
  }
  return rest.listDeviceReadings(deviceId);
}

export async function createDeviceReading(
  deviceId: string,
  input: CreateReadingInput
): Promise<Reading> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.createDeviceReading(deviceId, input);
  }
  return rest.createDeviceReading(deviceId, input);
}

export async function listDeviceCommands(deviceId: string): Promise<Command[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDeviceCommands(deviceId);
  }
  return rest.listDeviceCommands(deviceId);
}

export async function sendCommand(deviceId: string, input: SendCommandInput): Promise<Command> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.sendCommand(deviceId, input);
  }
  return rest.sendCommand(deviceId, input);
}

export async function listDeviceIssues(deviceId: string): Promise<HomeIssue[]> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.listDeviceIssues(deviceId);
  }
  return rest.listDeviceIssues(deviceId);
}

export async function createIssue(input: CreateHomeIssueInput): Promise<HomeIssue> {
  if (USE_MOCK_DEVICES) {
    return mockDeviceStore.createIssue(input);
  }
  return rest.createIssue(input);
}
