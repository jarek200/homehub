import { describe, expect, it } from 'vitest';
import {
  cognitoHouseholdGroup,
  DEMO_TENANT_PK,
  HOME_POINTER_PK,
  HOME_POINTER_SK,
  householdIdFromCognitoGroup,
  householdIdFromPk,
  householdPk,
  isHouseholdPk,
  normalizeCognitoGroups,
  normalizeTenantPk,
  userPk,
} from './household';
import { isHouseholdSubscribeAllowed } from './household-events';

describe('household keys', () => {
  it('builds household and user keys', () => {
    expect(householdPk('abc')).toBe('HOUSEHOLD#abc');
    expect(userPk('abc')).toBe('USER#abc');
    expect(householdIdFromPk('HOUSEHOLD#abc')).toBe('abc');
    expect(isHouseholdPk('HOUSEHOLD#abc')).toBe(true);
    expect(normalizeTenantPk('abc')).toBe('HOUSEHOLD#abc');
    expect(DEMO_TENANT_PK).toBe('HOUSEHOLD#demo');
    expect(HOME_POINTER_PK).toBe('HOMEHUB#HOME');
    expect(HOME_POINTER_SK).toBe('HOUSEHOLD');
  });

  it('names Cognito household groups from the household id', () => {
    expect(cognitoHouseholdGroup('user-abc')).toBe('hh_user-abc');
    expect(householdIdFromCognitoGroup('hh_user-abc')).toBe('user-abc');
    expect(householdIdFromCognitoGroup('admin')).toBeNull();
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
