import { describe, expect, it } from 'vitest';
import { deviceMatchesListFilters } from './device-list-filters';

describe('device list filters', () => {
  it('limits power to lights and plugs', () => {
    expect(
      deviceMatchesListFilters(
        { type: 'light' },
        { power: true, env: false, security: false, leak: false }
      )
    ).toBe(true);
    expect(
      deviceMatchesListFilters(
        { type: 'contact-sensor' },
        { power: true, env: false, security: false, leak: false }
      )
    ).toBe(false);
  });

  it('treats climate and air-quality sensors as env', () => {
    expect(
      deviceMatchesListFilters(
        { type: 'environmental-sensor' },
        { power: false, env: true, security: false, leak: false }
      )
    ).toBe(true);
    expect(
      deviceMatchesListFilters(
        { type: 'leak-sensor' },
        { power: false, env: true, security: false, leak: false }
      )
    ).toBe(false);
  });

  it('treats contact and motion as security, not leak', () => {
    expect(
      deviceMatchesListFilters(
        { type: 'motion-sensor' },
        { power: false, env: false, security: true, leak: false }
      )
    ).toBe(true);
    expect(
      deviceMatchesListFilters(
        { type: 'leak-sensor' },
        { power: false, env: false, security: true, leak: false }
      )
    ).toBe(false);
  });

  it('limits leak to leak sensors', () => {
    expect(
      deviceMatchesListFilters(
        { type: 'leak-sensor' },
        { power: false, env: false, security: false, leak: true }
      )
    ).toBe(true);
    expect(
      deviceMatchesListFilters(
        { type: 'contact-sensor' },
        { power: false, env: false, security: false, leak: true }
      )
    ).toBe(false);
  });

  it('unions selected categories when more than one chip is on', () => {
    expect(
      deviceMatchesListFilters(
        { type: 'environmental-sensor' },
        { power: false, env: true, security: false, leak: true }
      )
    ).toBe(true);
    expect(
      deviceMatchesListFilters(
        { type: 'leak-sensor' },
        { power: false, env: true, security: false, leak: true }
      )
    ).toBe(true);
    expect(
      deviceMatchesListFilters(
        { type: 'plug' },
        { power: false, env: true, security: false, leak: true }
      )
    ).toBe(false);
  });
});
