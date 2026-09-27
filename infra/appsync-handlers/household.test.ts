import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'household.js'), 'utf8');

describe('AppSync household subscribe handler', () => {
  it('authorizes from the household Cognito group without AppSync-rejected JS', () => {
    expect(source).toContain("claims?.['cognito:groups']");
    expect(source).toContain('hh_');
    expect(source).toContain('householdId');
    expect(source).not.toMatch(/\bString\s*\(/);
    expect(source).not.toMatch(/\bfor\s*\(/);
  });
});
