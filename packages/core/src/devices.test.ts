import { describe, expect, it } from 'vitest';
import { DEMO_TENANT_PK, hubIdFromPk, hubPkForUser, LIFECYCLE_STATUSES } from './devices';

describe('LIFECYCLE_STATUSES', () => {
  it('includes provisioning and ready states', () => {
    expect(LIFECYCLE_STATUSES).toContain('PROVISIONING');
    expect(LIFECYCLE_STATUSES).toContain('READY');
    expect(LIFECYCLE_STATUSES).toContain('FAILED');
    expect(LIFECYCLE_STATUSES).toContain('DECOMMISSIONED');
  });
});

describe('hub helpers', () => {
  it('maps user ids to hub partition keys', () => {
    expect(hubPkForUser('user-abc')).toBe('HUB#user-abc');
    expect(hubIdFromPk('HUB#user-abc')).toBe('user-abc');
    expect(DEMO_TENANT_PK).toBe('HUB#demo');
  });
});
