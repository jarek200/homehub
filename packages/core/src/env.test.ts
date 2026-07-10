import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEnv, validateEnv } from './env';

describe('env', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEnv', () => {
    it('should validate valid environment variables', () => {
      process.env.NODE_ENV = 'development';
      process.env.AWS_REGION = 'us-east-1';

      const result = validateEnv();
      expect(result.NODE_ENV).toBe('development');
      expect(result.AWS_REGION).toBe('us-east-1');
    });

    it('should throw error for invalid NODE_ENV', () => {
      process.env.NODE_ENV = 'invalid';

      expect(() => validateEnv()).toThrow();
    });
  });

  describe('getEnv', () => {
    it('should return partial env without throwing', () => {
      process.env.NODE_ENV = 'invalid';

      const result = getEnv();
      expect(result).toBeDefined();
    });
  });
});
