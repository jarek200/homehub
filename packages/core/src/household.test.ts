import { describe, expect, it } from 'vitest';
import {
  cognitoHouseholdGroup,
  DEMO_TENANT_PK,
  emailsMatch,
  householdIdFromCognitoGroup,
  householdIdFromPk,
  householdPk,
  inviteExpiresAt,
  isHouseholdPk,
  isInviteExpired,
  isLegacyHubPk,
  LEGACY_DEMO_TENANT_PK,
  normalizeCognitoGroups,
  normalizeEmail,
  normalizeTenantPk,
  userPk,
} from './household';
import { isHouseholdSubscribeAllowed } from './household-events';

describe('household keys', () => {
  it('builds household and user keys and reads both prefixes', () => {
    expect(householdPk('abc')).toBe('HOUSEHOLD#abc');
    expect(userPk('abc')).toBe('USER#abc');
    expect(householdIdFromPk('HOUSEHOLD#abc')).toBe('abc');
    expect(householdIdFromPk('HUB#abc')).toBe('abc');
    expect(isHouseholdPk('HOUSEHOLD#abc')).toBe(true);
    expect(isLegacyHubPk('HUB#abc')).toBe(true);
    expect(normalizeTenantPk('abc')).toBe('HOUSEHOLD#abc');
    expect(normalizeTenantPk('HUB#abc')).toBe('HOUSEHOLD#abc');
    expect(DEMO_TENANT_PK).toBe('HOUSEHOLD#demo');
    expect(LEGACY_DEMO_TENANT_PK).toBe('HUB#demo');
  });

  it('names Cognito household groups from the household id', () => {
    expect(cognitoHouseholdGroup('user-abc')).toBe('hh_user-abc');
    expect(householdIdFromCognitoGroup('hh_user-abc')).toBe('user-abc');
    expect(householdIdFromCognitoGroup('admin')).toBeNull();
  });
});

describe('invitation helpers', () => {
  it('normalizes and hashes emails, and hashes tokens', () => {
    expect(normalizeEmail('  Alex@Example.com ')).toBe('alex@example.com');
    expect(emailsMatch('Alex@Example.com', 'alex@example.com')).toBe(true);
  });

  it('expires invitations from a unix TTL', () => {
    const expiresAt = inviteExpiresAt(1_000_000_000_000, 60);
    expect(isInviteExpired(expiresAt, 1_000_000_000_000)).toBe(false);
    expect(isInviteExpired(expiresAt, 1_000_000_070_000)).toBe(true);
  });
});

describe('cognito group claims', () => {
  it('normalizes array, csv, and serialized claim forms', () => {
    expect(normalizeCognitoGroups(['hh_a', 'hh_b'])).toEqual(['hh_a', 'hh_b']);
    expect(normalizeCognitoGroups('hh_a, hh_b')).toEqual(['hh_a', 'hh_b']);
    expect(normalizeCognitoGroups('["hh_a","hh_b"]')).toEqual(['hh_a', 'hh_b']);
    expect(normalizeCognitoGroups(null)).toEqual([]);
    expect(isHouseholdSubscribeAllowed('/household/abc', ['hh_abc'])).toBe(true);
    expect(isHouseholdSubscribeAllowed('/household/abc', ['hh_other'])).toBe(false);
    expect(isHouseholdSubscribeAllowed('/household/abc', [])).toBe(false);
  });
});
