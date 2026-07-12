import { createId } from '@sst-monorepo/core';
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
import { DUMMY_DEVICES, getDefaultConfiguration } from '$lib/devices';

function nowIso(): string {
  return new Date().toISOString();
}

const seedTimestamp = '2026-07-10T14:22:10.000Z';

const SEED_READINGS: Record<string, Reading[]> = {
  'dummy-hallway-smoke-alarm': [
    {
      readingId: 'reading-seed-smoke-1',
      deviceId: 'dummy-hallway-smoke-alarm',
      temperature: null,
      humidity: null,
      motionDetected: false,
      cameraOnline: true,
      recordedAt: '2026-07-10T14:22:00.000Z',
      createdAt: seedTimestamp,
    },
  ],
  'dummy-kitchen-heat-alarm': [
    {
      readingId: 'reading-seed-heat-1',
      deviceId: 'dummy-kitchen-heat-alarm',
      temperature: 24.5,
      humidity: null,
      motionDetected: null,
      cameraOnline: null,
      recordedAt: '2026-07-10T14:18:00.000Z',
      createdAt: seedTimestamp,
    },
  ],
  'dummy-landing-co-alarm': [
    {
      readingId: 'reading-seed-co-1',
      deviceId: 'dummy-landing-co-alarm',
      temperature: 12,
      humidity: null,
      motionDetected: null,
      cameraOnline: null,
      recordedAt: '2026-07-10T14:15:00.000Z',
      createdAt: seedTimestamp,
    },
  ],
  'dummy-bedroom-env-sensor': [
    {
      readingId: 'reading-seed-env-1',
      deviceId: 'dummy-bedroom-env-sensor',
      temperature: 21.2,
      humidity: 68,
      motionDetected: null,
      cameraOnline: null,
      recordedAt: '2026-07-10T14:10:00.000Z',
      createdAt: seedTimestamp,
    },
    {
      readingId: 'reading-seed-env-2',
      deviceId: 'dummy-bedroom-env-sensor',
      temperature: 20.8,
      humidity: 72,
      motionDetected: null,
      cameraOnline: null,
      recordedAt: '2026-07-10T08:15:00.000Z',
      createdAt: seedTimestamp,
    },
  ],
};

const SEED_COMMANDS: Record<string, Command[]> = {
  'dummy-hallway-smoke-alarm': [
    {
      commandId: 'command-seed-1',
      deviceId: 'dummy-hallway-smoke-alarm',
      command: 'button-test',
      status: 'ACKNOWLEDGED',
      result: null,
      createdAt: '2026-07-10T13:00:00.000Z',
      updatedAt: '2026-07-10T13:00:05.000Z',
    },
  ],
  'dummy-kitchen-heat-alarm': [
    {
      commandId: 'command-seed-2',
      deviceId: 'dummy-kitchen-heat-alarm',
      command: 'report-status',
      status: 'SENT',
      result: null,
      createdAt: '2026-07-10T12:30:00.000Z',
      updatedAt: '2026-07-10T12:30:02.000Z',
    },
  ],
  'dummy-landing-co-alarm': [
    {
      commandId: 'command-seed-3',
      deviceId: 'dummy-landing-co-alarm',
      command: 'button-test',
      status: 'ACKNOWLEDGED',
      result: null,
      createdAt: '2026-07-10T11:45:00.000Z',
      updatedAt: '2026-07-10T11:45:04.000Z',
    },
  ],
};

let devices: Device[] = structuredClone(DUMMY_DEVICES);
const readingsByDevice = new Map<string, Reading[]>(
  Object.entries(SEED_READINGS).map(([id, items]) => [id, structuredClone(items)])
);
const commandsByDevice = new Map<string, Command[]>(
  Object.entries(SEED_COMMANDS).map(([id, items]) => [id, structuredClone(items)])
);
let issues: HomeIssue[] = [];

function cloneDevices(): Device[] {
  return structuredClone(devices);
}

function findDevice(deviceId: string): Device | undefined {
  return devices.find((d) => d.deviceId === deviceId);
}

export const mockDeviceStore = {
  listDevices(): Device[] {
    return cloneDevices();
  },

  getDevice(deviceId: string): Device | null {
    const device = findDevice(deviceId);
    return device ? structuredClone(device) : null;
  },

  createDevice(input: CreateDeviceInput): Device {
    const timestamp = nowIso();
    const device: Device = {
      deviceId: createId(),
      name: input.name,
      type: input.type,
      location: input.location ?? null,
      status: 'UNKNOWN',
      configuration: input.configuration ?? JSON.stringify(getDefaultConfiguration(input.type)),
      lastSeenAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    devices = [...devices, device];
    return structuredClone(device);
  },

  updateDevice(deviceId: string, input: UpdateDeviceInput): Device {
    const index = devices.findIndex((d) => d.deviceId === deviceId);
    if (index === -1) {
      throw new Error('Device not found');
    }

    const current = devices[index];
    const updated: Device = {
      ...current,
      name: input.name ?? current.name,
      type: input.type ?? current.type,
      location: input.location !== undefined ? input.location : current.location,
      status: input.status ?? current.status,
      configuration:
        input.configuration !== undefined ? input.configuration : current.configuration,
      lastSeenAt: input.lastSeenAt !== undefined ? input.lastSeenAt : current.lastSeenAt,
      updatedAt: nowIso(),
    };

    devices = devices.map((d, i) => (i === index ? updated : d));
    return structuredClone(updated);
  },

  deleteDevice(deviceId: string): boolean {
    const before = devices.length;
    devices = devices.filter((d) => d.deviceId !== deviceId);
    readingsByDevice.delete(deviceId);
    commandsByDevice.delete(deviceId);
    issues = issues.filter((issue) => issue.deviceId !== deviceId);
    return devices.length < before;
  },

  listDeviceReadings(deviceId: string): Reading[] {
    return structuredClone(readingsByDevice.get(deviceId) ?? []);
  },

  createDeviceReading(deviceId: string, input: CreateReadingInput): Reading {
    if (!findDevice(deviceId)) {
      throw new Error('Device not found');
    }

    const timestamp = nowIso();
    const reading: Reading = {
      readingId: createId(),
      deviceId,
      temperature: input.temperature ?? null,
      humidity: input.humidity ?? null,
      motionDetected: input.motionDetected ?? null,
      cameraOnline: input.cameraOnline ?? null,
      recordedAt: input.recordedAt ?? timestamp,
      createdAt: timestamp,
    };

    const existing = readingsByDevice.get(deviceId) ?? [];
    readingsByDevice.set(deviceId, [reading, ...existing]);

    const deviceIndex = devices.findIndex((d) => d.deviceId === deviceId);
    if (deviceIndex !== -1) {
      devices = devices.map((d, i) =>
        i === deviceIndex ? { ...d, lastSeenAt: reading.recordedAt, updatedAt: timestamp } : d
      );
    }

    return structuredClone(reading);
  },

  listDeviceCommands(deviceId: string): Command[] {
    return structuredClone(commandsByDevice.get(deviceId) ?? []);
  },

  sendCommand(deviceId: string, input: SendCommandInput): Command {
    if (!findDevice(deviceId)) {
      throw new Error('Device not found');
    }

    const timestamp = nowIso();
    const command: Command = {
      commandId: createId(),
      deviceId,
      command: input.command,
      status: 'PENDING',
      result: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const existing = commandsByDevice.get(deviceId) ?? [];
    commandsByDevice.set(deviceId, [command, ...existing]);
    return structuredClone(command);
  },

  listDeviceIssues(deviceId: string): HomeIssue[] {
    return structuredClone(issues.filter((issue) => issue.deviceId === deviceId));
  },

  createIssue(input: CreateHomeIssueInput): HomeIssue {
    const timestamp = nowIso();
    const issue: HomeIssue = {
      issueId: createId(),
      title: input.title,
      deviceId: input.deviceId ?? null,
      severity: input.severity ?? 'MEDIUM',
      status: input.status ?? 'OPEN',
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    issues = [issue, ...issues];
    return structuredClone(issue);
  },
};
