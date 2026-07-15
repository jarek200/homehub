/** Frontend / REST domain aliases. */

import type { DeviceRecord, ReadingRecord } from './devices';

export type Device = DeviceRecord;
export type Reading = ReadingRecord;

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
