import { describe, expect, it } from 'vitest';
import { createDeviceSchema, createReadingSchema, updateDeviceSchema } from './devices';

describe('createDeviceSchema', () => {
  it('accepts valid device input', () => {
    const result = createDeviceSchema.parse({
      name: 'Living Room Camera',
      type: 'security-camera',
      location: 'Living Room',
    });

    expect(result.name).toBe('Living Room Camera');
  });

  it('rejects missing name', () => {
    expect(() =>
      createDeviceSchema.parse({
        type: 'sensor',
      })
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      createDeviceSchema.parse({
        name: '   ',
        type: 'sensor',
      })
    ).toThrow();
  });
});

describe('updateDeviceSchema', () => {
  it('requires at least one field', () => {
    expect(() => updateDeviceSchema.parse({})).toThrow();
  });

  it('accepts status updates', () => {
    const result = updateDeviceSchema.parse({ status: 'ONLINE' });
    expect(result.status).toBe('ONLINE');
  });
});

describe('createReadingSchema', () => {
  it('accepts humidity readings', () => {
    const result = createReadingSchema.parse({ humidity: 72.5 });
    expect(result.humidity).toBe(72.5);
  });

  it('rejects empty readings', () => {
    expect(() => createReadingSchema.parse({})).toThrow();
  });

  it('rejects invalid humidity', () => {
    expect(() => createReadingSchema.parse({ humidity: 120 })).toThrow();
  });
});
