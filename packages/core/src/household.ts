/** Shared household keys and membership roles. */

export const HOUSEHOLD_PREFIX = 'HOUSEHOLD#';
export const USER_PREFIX = 'USER#';
export const GATEWAY_PREFIX = 'GATEWAY#';

export const HOUSEHOLD_METADATA_SK = 'METADATA';
export const HOUSEHOLD_LOOKUP_SK = 'HOUSEHOLD';
export const HOME_POINTER_PK = 'HOMEHUB#HOME';
export const HOME_POINTER_SK = 'HOUSEHOLD';
export const PROFILE_SK = 'PROFILE';
export const HUB_STATE_SK = 'HUB_STATE';
export const FLOOR_PLAN_SK = 'FLOOR_PLAN';
export const HUB_RULES_SK = 'HUB_RULES';

export const HOUSEHOLD_ROLES = ['OWNER', 'MEMBER'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const STATE_WRITE_MAX_ATTEMPTS = 5;

export const DEMO_TENANT_ID = 'demo';
export const DEMO_TENANT_PK = `${HOUSEHOLD_PREFIX}${DEMO_TENANT_ID}`;

export function householdPk(householdId: string): string {
  return `${HOUSEHOLD_PREFIX}${householdId}`;
}

export function userPk(userId: string): string {
  return `${USER_PREFIX}${userId}`;
}

export function gatewayPk(gatewayId: string): string {
  return `${GATEWAY_PREFIX}${gatewayId}`;
}

export function memberSk(userId: string): string {
  return `MEMBER#${userId}`;
}

export function deviceSk(deviceId: string): string {
  return `DEVICE#${deviceId}`;
}

export function isHouseholdPk(tenantPk: string): boolean {
  return tenantPk.startsWith(HOUSEHOLD_PREFIX);
}

export function householdIdFromPk(tenantPk: string): string {
  if (isHouseholdPk(tenantPk)) return tenantPk.slice(HOUSEHOLD_PREFIX.length);
  return tenantPk;
}

export function normalizeTenantPk(value: string): string {
  const raw = value.trim();
  if (!raw) return DEMO_TENANT_PK;
  if (isHouseholdPk(raw)) return raw;
  return householdPk(raw);
}

export function cognitoHouseholdGroup(householdId: string): string {
  return `hh_${householdId}`;
}

export function householdIdFromCognitoGroup(group: string): string | null {
  if (!group.startsWith('hh_')) return null;
  const householdId = group.slice(3);
  return householdId || null;
}

export function normalizeCognitoGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
      }
    } catch {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface HouseholdMember {
  userId: string;
  email: string;
  role: HouseholdRole;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdProfile {
  userId: string;
  username: string;
  email: string;
  name?: string | null;
  householdId?: string | null;
  role?: HouseholdRole | null;
  createdAt: string;
  updatedAt: string;
}
