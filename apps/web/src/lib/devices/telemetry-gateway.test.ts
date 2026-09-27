import { describe, expect, it } from 'vitest';
import { formatByteSize, formatLastReadingCompact, formatMetricValue } from './telemetry';

const gatewayReading = {
  readingId: 'r1',
  deviceId: 'matter-gateway',
  alarm: false,
  state: 'normal' as const,
  recordedAt: '2026-09-19T12:00:00.000Z',
  createdAt: '2026-09-19T12:00:00.000Z',
  metrics: {
    heapInternalFree: 31744,
    heapInternalLargest: 45651,
    heapInternalMinFree: 68695,
    heapSpiramFree: 7875320,
    heapSpiramLargest: 7843352,
    heapSpiramMinFree: 7733248,
  },
};

describe('matter-gateway heap readings', () => {
  it('formats bytes as KB or MB', () => {
    expect(formatByteSize(31744)).toBe('31 KB');
    expect(formatByteSize(7875320)).toBe('7.5 MB');
    expect(formatByteSize(512)).toBe('512 B');
  });

  it('does not dump every heap counter on the devices list', () => {
    expect(formatLastReadingCompact('matter-gateway', gatewayReading)).toBe(
      '31 KB RAM · 7.5 MB PSRAM'
    );
  });

  it('keeps extra heap stats as byte sizes for the detail page', () => {
    expect(formatMetricValue('heapInternalLargest', 45651)).toBe('45 KB');
    expect(formatMetricValue('heapSpiramMinFree', 7733248)).toBe('7.4 MB');
  });
});

describe('devices list readings', () => {
  it('keeps battery out of the reading column', () => {
    expect(
      formatLastReadingCompact('contact-sensor', {
        readingId: 'r2',
        deviceId: 'contact-1',
        alarm: false,
        state: 'normal',
        recordedAt: '2026-09-19T12:00:00.000Z',
        createdAt: '2026-09-19T12:00:00.000Z',
        metrics: { open: false, batteryPercent: 82 },
      })
    ).toBe('Closed');
    expect(
      formatLastReadingCompact('motion-sensor', {
        readingId: 'r3',
        deviceId: 'motion-1',
        alarm: false,
        state: 'normal',
        recordedAt: '2026-09-19T12:00:00.000Z',
        createdAt: '2026-09-19T12:00:00.000Z',
        metrics: { occupied: false, lightLux: 24, batteryPercent: 80 },
      })
    ).toBe('Clear · 24.0 lx');
    expect(
      formatLastReadingCompact('leak-sensor', {
        readingId: 'r4',
        deviceId: 'leak-1',
        alarm: false,
        state: 'normal',
        recordedAt: '2026-09-19T12:00:00.000Z',
        createdAt: '2026-09-19T12:00:00.000Z',
        metrics: { leak: false, batteryPercent: 100 },
      })
    ).toBe('Dry');
  });
});
