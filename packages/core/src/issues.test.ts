import { describe, expect, it } from 'vitest';
import { humidityIssueTitle, shouldRaiseHumidityIssue } from './issues';

describe('shouldRaiseHumidityIssue', () => {
  it('returns true at threshold', () => {
    expect(shouldRaiseHumidityIssue(70)).toBe(true);
  });

  it('returns false below threshold', () => {
    expect(shouldRaiseHumidityIssue(69.9)).toBe(false);
  });

  it('returns false for null', () => {
    expect(shouldRaiseHumidityIssue(null)).toBe(false);
  });
});

describe('humidityIssueTitle', () => {
  it('formats humidity in title', () => {
    expect(humidityIssueTitle(72.4)).toBe('High humidity detected (72.4%)');
  });
});
