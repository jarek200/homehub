/** Frontend / REST domain aliases. */

import type { DeviceRecord, ReadingRecord } from './devices';

export type Device = DeviceRecord;
export type Reading = ReadingRecord;

import type { HouseholdRole } from './household';

export interface User {
  userId: string;
  username: string;
  email: string;
  name?: string | null;
  householdId?: string | null;
  role?: HouseholdRole | null;
  createdAt: string;
  updatedAt: string;
}
