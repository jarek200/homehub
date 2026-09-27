import { describe, expect, it } from 'vitest';
import {
  durableEventsForLocalDay,
  eventsOnLocalDay,
  filledHoursByLocalDay,
  filledHoursForToday,
  filterSensorHistory,
  historyFilterChips,
  hourActive,
  isCurrentLocalMonth,
  isLoggedSensorValue,
  localDayKey,
  localDayRange,
  localMonthCells,
  localMonthRange,
  loggedSensorValue,
  mergeDurableSensorEvents,
  mergeSensorEvents,
  newestSensorHistory,
  sanitizeSensorHistory,
  sensorEventLabel,
  sensorHistoryClock,
  sensorHistoryDate,
  shiftLocalMonth,
} from './sensor-history';

describe('hour dots', () => {
  it('fills only OPEN, DETECTED, and LEAK', () => {
    expect(hourActive('OPEN')).toBe(true);
    expect(hourActive('DETECTED')).toBe(true);
    expect(hourActive('LEAK')).toBe(true);
    expect(hourActive('CLOSED')).toBe(false);
    expect(hourActive('CLEAR')).toBe(false);
    expect(hourActive('DRY')).toBe(false);
    expect(loggedSensorValue('contact')).toBe('OPEN');
    expect(loggedSensorValue('motion')).toBe('DETECTED');
    expect(loggedSensorValue('leak')).toBe('LEAK');
    expect(isLoggedSensorValue('contact', 'OPEN')).toBe(true);
    expect(isLoggedSensorValue('contact', 'CLOSED')).toBe(false);
    expect(sensorEventLabel('LEAK')).toBe('Leak');
  });

  it('fills the local hour for 17:09 and ignores dry or closed', () => {
    const now = new Date('2026-09-18T16:09:00Z');
    const hour = now.getHours();
    const filled = filledHoursForToday(
      [
        { at: '2026-09-18T16:09:00Z', value: 'OPEN' },
        { at: '2026-09-18T16:10:00Z', value: 'CLOSED' },
        { at: '2026-09-18T16:11:00Z', value: 'DRY' },
      ],
      'DRY',
      now
    );
    expect(filled[hour]).toBe(true);
    expect(filled.filter(Boolean)).toHaveLength(1);
  });

  it('fills the current hour from a live open or detected value', () => {
    const now = new Date('2026-09-18T16:20:00Z');
    const filled = filledHoursForToday([], 'DETECTED', now);
    expect(filled[now.getHours()]).toBe(true);
  });

  it('groups active hours by local calendar day', () => {
    const now = new Date(2026, 8, 19, 20, 17);
    const byDay = filledHoursByLocalDay([
      { at: now.toISOString(), value: 'OPEN' },
      { at: new Date(2026, 8, 19, 11, 14).toISOString(), value: 'DETECTED' },
      { at: new Date(2026, 8, 19, 11, 16).toISOString(), value: 'CLOSED' },
      { at: new Date(2026, 8, 18, 10, 0).toISOString(), value: 'OPEN' },
    ]);
    expect(byDay['2026-09-19']?.[20]).toBe(true);
    expect(byDay['2026-09-19']?.[11]).toBe(true);
    expect(byDay['2026-09-19']?.filter(Boolean)).toHaveLength(2);
    expect(byDay['2026-09-18']?.[10]).toBe(true);
  });

  it('ignores events from another local day', () => {
    const now = new Date('2026-09-18T16:09:00Z');
    const filled = filledHoursForToday([{ at: '2026-09-17T16:09:00Z', value: 'LEAK' }], 'DRY', now);
    expect(filled.some(Boolean)).toBe(false);
  });
});

describe('history sheet', () => {
  it('lists the newest 50 events first and formats local time', () => {
    const events = newestSensorHistory([
      { kind: 'contact', at: '2026-09-18T16:08:56Z', value: 'OPEN' },
      { kind: 'contact', at: '2026-09-18T16:09:04Z', value: 'CLOSED' },
    ]);
    expect(events.map((event) => event.value)).toEqual(['CLOSED', 'OPEN']);
    const clock = sensorHistoryClock('2026-09-18T16:09:04Z');
    expect(clock).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(clock).toBe(sensorHistoryClock('2026-09-18T16:09:04Z'));
  });

  it('filters motion to clear or detected and uses C A D letters', () => {
    const events = [
      { kind: 'motion' as const, at: '2026-09-18T16:12:07Z', value: 'DETECTED' },
      { kind: 'motion' as const, at: '2026-09-18T16:12:35Z', value: 'CLEAR' },
    ];
    expect(historyFilterChips('motion').map((chip) => chip.letter)).toEqual(['C', 'A', 'D']);
    expect(filterSensorHistory(events, 'idle', 'motion').map((event) => event.value)).toEqual([
      'CLEAR',
    ]);
    expect(filterSensorHistory(events, 'active', 'motion').map((event) => event.value)).toEqual([
      'DETECTED',
    ]);
    expect(filterSensorHistory(events, 'all', 'motion')).toHaveLength(2);
  });

  it('uses closed/open and dry/leak chips for the other sheets', () => {
    expect(historyFilterChips('contact').map((chip) => chip.letter)).toEqual(['C', 'A', 'O']);
    expect(historyFilterChips('leak').map((chip) => chip.letter)).toEqual(['D', 'A', 'L']);
    expect(
      filterSensorHistory(
        [{ kind: 'contact', at: '2026-09-18T16:08:56Z', value: 'OPEN' }],
        'idle',
        'contact'
      )
    ).toEqual([]);
  });
});

describe('sanitizeSensorHistory', () => {
  it('keeps well-formed device events and drops junk', () => {
    const cleaned = sanitizeSensorHistory({
      'matter-5': {
        kind: 'contact',
        events: [{ kind: 'contact', at: '2026-09-18T16:08:56Z', value: 'OPEN' }, { value: 'OPEN' }],
      },
      bad: { kind: 'light', events: [] },
    });
    expect(cleaned['matter-5']?.events).toEqual([
      { kind: 'contact', at: '2026-09-18T16:08:56Z', value: 'OPEN' },
    ]);
    expect(cleaned.bad).toBeUndefined();
  });
});

describe('durable events', () => {
  it('merges hub and dynamo rows without duplicates', () => {
    const merged = mergeSensorEvents(
      [{ kind: 'contact', at: '2026-09-19T08:12:00Z', value: 'OPEN' }],
      [
        { kind: 'contact', at: '2026-09-19T08:12:00Z', value: 'OPEN' },
        { kind: 'motion', at: '2026-09-19T08:13:00Z', value: 'DETECTED' },
      ]
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.value).toBe('DETECTED');
  });

  it('builds a local calendar day range', () => {
    const now = new Date(2026, 8, 19, 23, 30);
    const range = localDayRange(now);
    expect(new Date(range.from).getDate()).toBe(19);
    expect(new Date(range.to).getDate()).toBe(20);
  });

  it('formats a local calendar date and month grid starting Monday', () => {
    const now = new Date(2026, 8, 19, 12, 0);
    expect(sensorHistoryDate(now.toISOString())).toBe('19/09/2026');
    expect(localDayKey(now)).toBe('2026-09-19');
    expect(localMonthCells(2026, 8)[0]?.day).toBeNull();
    expect(localMonthCells(2026, 8).find((cell) => cell.day === 1)?.dayKey).toBe('2026-09-01');
    expect(shiftLocalMonth(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
    expect(isCurrentLocalMonth(2026, 8, now)).toBe(true);
    const { from, to } = localMonthRange(2026, 8);
    expect(new Date(from).getMonth()).toBe(8);
    expect(new Date(to).getMonth()).toBe(9);
    expect(eventsOnLocalDay([{ at: now.toISOString() }], '2026-09-19')).toHaveLength(1);
  });

  it('keeps only today OPEN and DETECTED rows from hub history', () => {
    const now = new Date(2026, 8, 19, 12, 0);
    const events = durableEventsForLocalDay(
      {
        'matter-5': {
          kind: 'contact',
          events: [
            { kind: 'contact', at: new Date(2026, 8, 19, 8, 12).toISOString(), value: 'OPEN' },
            { kind: 'contact', at: new Date(2026, 8, 19, 8, 13).toISOString(), value: 'CLOSED' },
            { kind: 'contact', at: new Date(2026, 8, 18, 8, 12).toISOString(), value: 'OPEN' },
          ],
        },
        'matter-4': {
          kind: 'motion',
          events: [
            { kind: 'motion', at: new Date(2026, 8, 19, 8, 13).toISOString(), value: 'DETECTED' },
          ],
        },
      },
      { 'matter-5': 'MYGGBETT', 'matter-4': 'MYGGSPRAY' },
      now
    );
    expect(events.map((event) => event.name)).toEqual(['MYGGSPRAY', 'MYGGBETT']);
    expect(mergeDurableSensorEvents(events, events)).toHaveLength(2);
  });
});
