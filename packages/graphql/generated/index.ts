export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Command = {
  __typename?: 'Command';
  command: Scalars['String']['output'];
  commandId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  deviceId: Scalars['ID']['output'];
  result?: Maybe<Scalars['String']['output']>;
  status: CommandStatus;
  updatedAt: Scalars['String']['output'];
};

export type CommandConnection = {
  __typename?: 'CommandConnection';
  items: Array<Command>;
  nextToken?: Maybe<Scalars['String']['output']>;
};

export type CommandStatus =
  | 'ACKNOWLEDGED'
  | 'FAILED'
  | 'PENDING'
  | 'SENT';

export type CreateDeviceInput = {
  configuration?: InputMaybe<Scalars['String']['input']>;
  location?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  type: Scalars['String']['input'];
};

export type CreateHomeIssueInput = {
  deviceId?: InputMaybe<Scalars['ID']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  severity?: InputMaybe<IssueSeverity>;
  status?: InputMaybe<IssueStatus>;
  title: Scalars['String']['input'];
};

export type CreateReadingInput = {
  cameraOnline?: InputMaybe<Scalars['Boolean']['input']>;
  humidity?: InputMaybe<Scalars['Float']['input']>;
  motionDetected?: InputMaybe<Scalars['Boolean']['input']>;
  recordedAt?: InputMaybe<Scalars['String']['input']>;
  temperature?: InputMaybe<Scalars['Float']['input']>;
};

export type Device = {
  __typename?: 'Device';
  configuration?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  deviceId: Scalars['ID']['output'];
  lastSeenAt?: Maybe<Scalars['String']['output']>;
  location?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  status: DeviceStatus;
  type: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type DeviceConnection = {
  __typename?: 'DeviceConnection';
  items: Array<Device>;
  nextToken?: Maybe<Scalars['String']['output']>;
};

export type DeviceStatus =
  | 'OFFLINE'
  | 'ONLINE'
  | 'UNKNOWN';

export type HomeIssue = {
  __typename?: 'HomeIssue';
  createdAt: Scalars['String']['output'];
  deviceId?: Maybe<Scalars['ID']['output']>;
  issueId: Scalars['ID']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  severity: IssueSeverity;
  status: IssueStatus;
  title: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type HomeIssueConnection = {
  __typename?: 'HomeIssueConnection';
  items: Array<HomeIssue>;
  nextToken?: Maybe<Scalars['String']['output']>;
};

export type IssueSeverity =
  | 'HIGH'
  | 'LOW'
  | 'MEDIUM';

export type IssueStatus =
  | 'MONITORING'
  | 'OPEN'
  | 'RESOLVED';

export type Mutation = {
  __typename?: 'Mutation';
  createDevice: Device;
  createDeviceReading: Reading;
  createIssue: HomeIssue;
  deleteDevice: Scalars['Boolean']['output'];
  sendCommand: Command;
  updateDevice: Device;
  updateIssue: HomeIssue;
  updateUserProfile?: Maybe<User>;
};


export type MutationCreateDeviceArgs = {
  input: CreateDeviceInput;
};


export type MutationCreateDeviceReadingArgs = {
  deviceId: Scalars['ID']['input'];
  input: CreateReadingInput;
};


export type MutationCreateIssueArgs = {
  input: CreateHomeIssueInput;
};


export type MutationDeleteDeviceArgs = {
  deviceId: Scalars['ID']['input'];
};


export type MutationSendCommandArgs = {
  deviceId: Scalars['ID']['input'];
  input: SendCommandInput;
};


export type MutationUpdateDeviceArgs = {
  deviceId: Scalars['ID']['input'];
  input: UpdateDeviceInput;
};


export type MutationUpdateIssueArgs = {
  input: UpdateHomeIssueInput;
  issueId: Scalars['ID']['input'];
};


export type MutationUpdateUserProfileArgs = {
  input: UpdateUserInput;
};

export type Query = {
  __typename?: 'Query';
  getDevice?: Maybe<Device>;
  getIssue?: Maybe<HomeIssue>;
  getMyProfile?: Maybe<User>;
  listDeviceCommands: CommandConnection;
  listDeviceReadings: ReadingConnection;
  listMyDevices: DeviceConnection;
  listMyIssues: HomeIssueConnection;
};


export type QueryGetDeviceArgs = {
  deviceId: Scalars['ID']['input'];
};


export type QueryGetIssueArgs = {
  issueId: Scalars['ID']['input'];
};


export type QueryListDeviceCommandsArgs = {
  deviceId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  nextToken?: InputMaybe<Scalars['String']['input']>;
};


export type QueryListDeviceReadingsArgs = {
  deviceId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  nextToken?: InputMaybe<Scalars['String']['input']>;
};


export type QueryListMyDevicesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  nextToken?: InputMaybe<Scalars['String']['input']>;
};


export type QueryListMyIssuesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  nextToken?: InputMaybe<Scalars['String']['input']>;
};

export type Reading = {
  __typename?: 'Reading';
  cameraOnline?: Maybe<Scalars['Boolean']['output']>;
  createdAt: Scalars['String']['output'];
  deviceId: Scalars['ID']['output'];
  humidity?: Maybe<Scalars['Float']['output']>;
  motionDetected?: Maybe<Scalars['Boolean']['output']>;
  readingId: Scalars['ID']['output'];
  recordedAt: Scalars['String']['output'];
  temperature?: Maybe<Scalars['Float']['output']>;
};

export type ReadingConnection = {
  __typename?: 'ReadingConnection';
  items: Array<Reading>;
  nextToken?: Maybe<Scalars['String']['output']>;
};

export type SendCommandInput = {
  command: Scalars['String']['input'];
};

export type UpdateDeviceInput = {
  configuration?: InputMaybe<Scalars['String']['input']>;
  lastSeenAt?: InputMaybe<Scalars['String']['input']>;
  location?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<DeviceStatus>;
  type?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateHomeIssueInput = {
  deviceId?: InputMaybe<Scalars['ID']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  severity?: InputMaybe<IssueSeverity>;
  status?: InputMaybe<IssueStatus>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserInput = {
  avatar?: InputMaybe<Scalars['String']['input']>;
  bio?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type User = {
  __typename?: 'User';
  avatar?: Maybe<Scalars['String']['output']>;
  bio?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  email: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};
