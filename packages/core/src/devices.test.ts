import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATUSES } from './devices';

describe('LIFECYCLE_STATUSES', () => {
  it('includes provisioning and ready states', () => {
    expect(LIFECYCLE_STATUSES).toContain('PROVISIONING');
    expect(LIFECYCLE_STATUSES).toContain('READY');
    expect(LIFECYCLE_STATUSES).toContain('FAILED');
    expect(LIFECYCLE_STATUSES).toContain('DECOMMISSIONED');
  });
});
