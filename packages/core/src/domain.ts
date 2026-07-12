/** Frontend / REST domain aliases (replaces former GraphQL codegen types). */

import type { CommandRecord, DeviceRecord, ReadingRecord } from './devices';
import type { CreateIssueInput, IssueRecord, UpdateIssueInput } from './issues';

export type Device = DeviceRecord;
export type Reading = ReadingRecord;
export type Command = CommandRecord;
export type HomeIssue = IssueRecord;

export type CreateHomeIssueInput = CreateIssueInput;
export type UpdateHomeIssueInput = UpdateIssueInput;

export interface SendCommandInput {
  command: string;
}

export interface User {
  userId: string;
  username: string;
  email: string;
  name?: string | null;
  bio?: string | null;
  avatar?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserInput {
  name?: string | null;
  bio?: string | null;
  avatar?: string | null;
}
