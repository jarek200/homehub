/**
 * GraphQL Service
 * Handles all GraphQL queries and mutations to AWS AppSync
 *
 * Types are auto-generated from schema.graphql using GraphQL Code Generator.
 * Run `pnpm codegen` to regenerate types after schema changes.
 */

import type { GraphQLResult } from '@aws-amplify/api-graphql';
import type {
  Command,
  CommandConnection,
  CreateDeviceInput,
  CreateHomeIssueInput,
  CreateReadingInput,
  Device,
  DeviceConnection,
  HomeIssue,
  HomeIssueConnection,
  Reading,
  ReadingConnection,
  SendCommandInput,
  UpdateDeviceInput,
  UpdateHomeIssueInput,
  UpdateUserInput,
  User,
} from '@sst-monorepo/graphql';
import { generateClient } from 'aws-amplify/api';
import { ensureAmplifyConfigured } from '../amplify';

// Lazy client initialization
// biome-ignore lint/suspicious/noExplicitAny: AWS Amplify generateClient return type is complex
let client: any = null;
// biome-ignore lint/suspicious/noExplicitAny: AWS Amplify generateClient return type is complex
let clientPromise: Promise<any> | null = null;

async function getClient() {
  if (client) return client;

  if (!clientPromise) {
    clientPromise = (async () => {
      if (typeof window === 'undefined') {
        throw new Error('GraphQL client cannot be created during SSR');
      }

      try {
        await ensureAmplifyConfigured();
        client = generateClient({ authMode: 'userPool' });
        return client;
      } catch (e) {
        clientPromise = null;
        const error = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to initialize GraphQL client: ${error.message}`);
      }
    })();
  }

  return clientPromise;
}

// Reset GraphQL client state
export function resetGraphQLClient(): void {
  client = null;
  clientPromise = null;
}

const DEVICE_FIELDS = `
  deviceId
  name
  type
  location
  status
  configuration
  lastSeenAt
  createdAt
  updatedAt
`;

const READING_FIELDS = `
  readingId
  deviceId
  temperature
  humidity
  motionDetected
  cameraOnline
  recordedAt
  createdAt
`;

const COMMAND_FIELDS = `
  commandId
  deviceId
  command
  status
  result
  createdAt
  updatedAt
`;

const ISSUE_FIELDS = `
  issueId
  title
  deviceId
  severity
  status
  notes
  createdAt
  updatedAt
`;

// User Queries
export async function getMyProfile(): Promise<User | null> {
  const query = `
    query GetMyProfile {
      getMyProfile {
        userId
        username
        email
        name
        bio
        avatar
        createdAt
        updatedAt
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query,
  })) as GraphQLResult<{ getMyProfile: User | null }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to get profile');
  }

  return result.data?.getMyProfile || null;
}

// User Mutations
export async function updateUserProfile(input: UpdateUserInput): Promise<User | null> {
  const mutation = `
    mutation UpdateUserProfile($input: UpdateUserInput!) {
      updateUserProfile(input: $input) {
        userId
        username
        email
        name
        bio
        avatar
        createdAt
        updatedAt
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { input },
  })) as GraphQLResult<{ updateUserProfile: User | null }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to update profile');
  }

  return result.data?.updateUserProfile || null;
}

// Device Queries
export async function listMyDevices(
  limit = 50,
  nextToken?: string | null
): Promise<DeviceConnection> {
  const query = `
    query ListMyDevices($limit: Int, $nextToken: String) {
      listMyDevices(limit: $limit, nextToken: $nextToken) {
        items { ${DEVICE_FIELDS} }
        nextToken
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query,
    variables: { limit, nextToken: nextToken || null },
  })) as GraphQLResult<{ listMyDevices: DeviceConnection }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to list devices');
  }

  return result.data?.listMyDevices ?? { items: [], nextToken: null };
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  const query = `
    query GetDevice($deviceId: ID!) {
      getDevice(deviceId: $deviceId) {
        ${DEVICE_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query,
    variables: { deviceId },
  })) as GraphQLResult<{ getDevice: Device | null }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to get device');
  }

  return result.data?.getDevice || null;
}

export async function listDeviceReadings(
  deviceId: string,
  limit = 50,
  nextToken?: string | null
): Promise<ReadingConnection> {
  const query = `
    query ListDeviceReadings($deviceId: ID!, $limit: Int, $nextToken: String) {
      listDeviceReadings(deviceId: $deviceId, limit: $limit, nextToken: $nextToken) {
        items { ${READING_FIELDS} }
        nextToken
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query,
    variables: { deviceId, limit, nextToken: nextToken || null },
  })) as GraphQLResult<{ listDeviceReadings: ReadingConnection }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to list readings');
  }

  return result.data?.listDeviceReadings ?? { items: [], nextToken: null };
}

export async function listDeviceCommands(
  deviceId: string,
  limit = 50,
  nextToken?: string | null
): Promise<CommandConnection> {
  const query = `
    query ListDeviceCommands($deviceId: ID!, $limit: Int, $nextToken: String) {
      listDeviceCommands(deviceId: $deviceId, limit: $limit, nextToken: $nextToken) {
        items { ${COMMAND_FIELDS} }
        nextToken
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query,
    variables: { deviceId, limit, nextToken: nextToken || null },
  })) as GraphQLResult<{ listDeviceCommands: CommandConnection }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to list commands');
  }

  return result.data?.listDeviceCommands ?? { items: [], nextToken: null };
}

// Device Mutations
export async function createDevice(input: CreateDeviceInput): Promise<Device> {
  const mutation = `
    mutation CreateDevice($input: CreateDeviceInput!) {
      createDevice(input: $input) {
        ${DEVICE_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { input },
  })) as GraphQLResult<{ createDevice: Device }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to create device');
  }

  if (!result.data?.createDevice) {
    throw new Error('Failed to create device');
  }

  return result.data.createDevice;
}

export async function updateDevice(deviceId: string, input: UpdateDeviceInput): Promise<Device> {
  const mutation = `
    mutation UpdateDevice($deviceId: ID!, $input: UpdateDeviceInput!) {
      updateDevice(deviceId: $deviceId, input: $input) {
        ${DEVICE_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { deviceId, input },
  })) as GraphQLResult<{ updateDevice: Device }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to update device');
  }

  if (!result.data?.updateDevice) {
    throw new Error('Failed to update device');
  }

  return result.data.updateDevice;
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  const mutation = `
    mutation DeleteDevice($deviceId: ID!) {
      deleteDevice(deviceId: $deviceId)
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { deviceId },
  })) as GraphQLResult<{ deleteDevice: boolean }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to delete device');
  }

  return result.data?.deleteDevice ?? false;
}

export async function createDeviceReading(
  deviceId: string,
  input: CreateReadingInput
): Promise<Reading> {
  const mutation = `
    mutation CreateDeviceReading($deviceId: ID!, $input: CreateReadingInput!) {
      createDeviceReading(deviceId: $deviceId, input: $input) {
        ${READING_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { deviceId, input },
  })) as GraphQLResult<{ createDeviceReading: Reading }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to create reading');
  }

  if (!result.data?.createDeviceReading) {
    throw new Error('Failed to create reading');
  }

  return result.data.createDeviceReading;
}

export async function sendCommand(deviceId: string, input: SendCommandInput): Promise<Command> {
  const mutation = `
    mutation SendCommand($deviceId: ID!, $input: SendCommandInput!) {
      sendCommand(deviceId: $deviceId, input: $input) {
        ${COMMAND_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { deviceId, input },
  })) as GraphQLResult<{ sendCommand: Command }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to send command');
  }

  if (!result.data?.sendCommand) {
    throw new Error('Failed to send command');
  }

  return result.data.sendCommand;
}

export async function listMyIssues(
  limit = 50,
  nextToken?: string | null
): Promise<HomeIssueConnection> {
  const query = `
    query ListMyIssues($limit: Int, $nextToken: String) {
      listMyIssues(limit: $limit, nextToken: $nextToken) {
        items { ${ISSUE_FIELDS} }
        nextToken
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query,
    variables: { limit, nextToken: nextToken || null },
  })) as GraphQLResult<{ listMyIssues: HomeIssueConnection }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to list issues');
  }

  return result.data?.listMyIssues ?? { items: [], nextToken: null };
}

export async function createIssue(input: CreateHomeIssueInput): Promise<HomeIssue> {
  const mutation = `
    mutation CreateIssue($input: CreateHomeIssueInput!) {
      createIssue(input: $input) {
        ${ISSUE_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { input },
  })) as GraphQLResult<{ createIssue: HomeIssue }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to create issue');
  }

  if (!result.data?.createIssue) {
    throw new Error('Failed to create issue');
  }

  return result.data.createIssue;
}

export async function updateIssue(
  issueId: string,
  input: UpdateHomeIssueInput
): Promise<HomeIssue> {
  const mutation = `
    mutation UpdateIssue($issueId: ID!, $input: UpdateHomeIssueInput!) {
      updateIssue(issueId: $issueId, input: $input) {
        ${ISSUE_FIELDS}
      }
    }
  `;

  const client = await getClient();
  const result = (await client.graphql({
    query: mutation,
    variables: { issueId, input },
  })) as GraphQLResult<{ updateIssue: HomeIssue }>;

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'Failed to update issue');
  }

  if (!result.data?.updateIssue) {
    throw new Error('Failed to update issue');
  }

  return result.data.updateIssue;
}
