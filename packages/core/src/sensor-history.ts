export const SENSOR_HISTORY_KINDS = ['contact', 'motion', 'leak'] as const;
export type SensorHistoryKind = (typeof SENSOR_HISTORY_KINDS)[number];

export const HOUR_ACTIVE_VALUES = ['OPEN', 'DETECTED', 'LEAK'] as const;

export const DURABLE_SENSOR_KINDS = ['contact', 'motion'] as const;
export type DurableSensorKind = (typeof DURABLE_SENSOR_KINDS)[number];

export interface SensorEvent {
  deviceId: string;
  name: string;
  kind: DurableSensorKind;
  value: 'OPEN' | 'DETECTED';
  at: string;
}

export interface SensorHistoryEvent {
  kind: SensorHistoryKind;
  at: string;
  value: string;
}

export interface SensorHistoryDevice {
  kind: SensorHistoryKind;
  events: SensorHistoryEvent[];
}

export type SensorHistory = Record<string, SensorHistoryDevice>;

export function isSensorHistoryKind(value: unknown): value is SensorHistoryKind {
  return value === 'contact' || value === 'motion' || value === 'leak';
}

export function hourActive(value?: string | null): boolean {
  return value === 'OPEN' || value === 'DETECTED' || value === 'LEAK';
}

export function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function filledHoursForToday(
  events: Array<{ at?: string; value?: string }> | undefined,
  liveValue?: string | null,
  now = new Date()
): boolean[] {
  const filled = Array.from({ length: 24 }, () => false);
  for (const event of events ?? []) {
    if (!hourActive(event.value)) continue;
    const at = event.at ? new Date(event.at) : null;
    if (!at || Number.isNaN(at.getTime()) || !sameLocalDay(at, now)) continue;
    filled[at.getHours()] = true;
  }
  if (hourActive(liveValue)) {
    filled[now.getHours()] = true;
  }
  return filled;
}

export function filledHoursByLocalDay(
  events: Array<{ at?: string; value?: string }> | undefined
): Record<string, boolean[]> {
  const byDay: Record<string, boolean[]> = {};
  for (const event of events ?? []) {
    if (!hourActive(event.value) || !event.at) continue;
    const at = new Date(event.at);
    if (Number.isNaN(at.getTime())) continue;
    const key = localDayKey(at);
    if (!key) continue;
    const hours = byDay[key] ?? Array.from({ length: 24 }, () => false);
    hours[at.getHours()] = true;
    byDay[key] = hours;
  }
  return byDay;
}

export const SENSOR_HISTORY_LIMIT = 50;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function sensorHistoryClock(iso?: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
}

export function sensorHistoryDate(iso?: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${pad2(at.getDate())}/${pad2(at.getMonth() + 1)}/${at.getFullYear()}`;
}

export function localDayKey(at: Date | string = new Date()): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function localMonthRange(year: number, monthIndex: number): { from: string; to: string } {
  return {
    from: new Date(year, monthIndex, 1).toISOString(),
    to: new Date(year, monthIndex + 1, 1).toISOString(),
  };
}

export function shiftLocalMonth(
  year: number,
  monthIndex: number,
  delta: number
): { year: number; monthIndex: number } {
  const next = new Date(year, monthIndex + delta, 1);
  return { year: next.getFullYear(), monthIndex: next.getMonth() };
}

export function isCurrentLocalMonth(year: number, monthIndex: number, now = new Date()): boolean {
  return now.getFullYear() === year && now.getMonth() === monthIndex;
}

export function localMonthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export interface CalendarDayCell {
  key: string;
  day: number | null;
  dayKey: string | null;
}

export function localMonthCells(year: number, monthIndex: number): CalendarDayCell[] {
  const mondayPad = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalendarDayCell[] = [];
  for (let index = 0; index < mondayPad; index += 1) {
    cells.push({ key: `pad-${index}`, day: null, dayKey: null });
  }
  for (let day = 1; day <= lastDay; day += 1) {
    const dayKey = `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
    cells.push({ key: dayKey, day, dayKey });
  }
  return cells;
}

export function eventsOnLocalDay<T extends { at: string }>(events: T[], dayKey: string): T[] {
  return events.filter((event) => localDayKey(event.at) === dayKey);
}

export function eventDayKeys(events: Array<{ at: string }>): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    const key = localDayKey(event.at);
    if (key) keys.add(key);
  }
  return keys;
}

export function newestSensorHistory(
  events: SensorHistoryEvent[] | undefined,
  limit = SENSOR_HISTORY_LIMIT
): SensorHistoryEvent[] {
  return [...(events ?? [])]
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
    .slice(0, limit);
}

export function mergeSensorEvents(
  ...lists: Array<SensorHistoryEvent[] | undefined>
): SensorHistoryEvent[] {
  const seen = new Set<string>();
  const merged: SensorHistoryEvent[] = [];
  for (const list of lists) {
    for (const event of list ?? []) {
      const key = `${event.at}|${event.kind}|${event.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return newestSensorHistory(merged, 2000);
}

export function isDurableSensorValue(value: string): value is SensorEvent['value'] {
  return value === 'OPEN' || value === 'DETECTED';
}

export function loggedSensorValue(kind: SensorHistoryKind): string {
  if (kind === 'contact') return 'OPEN';
  if (kind === 'motion') return 'DETECTED';
  return 'LEAK';
}

export function isLoggedSensorValue(kind: SensorHistoryKind, value: string): boolean {
  return value === loggedSensorValue(kind);
}

export function durableEventsForLocalDay(
  history: SensorHistory | undefined,
  names: Record<string, string> | undefined,
  now = new Date()
): SensorEvent[] {
  const { from, to } = localDayRange(now);
  const start = new Date(from);
  const end = new Date(to);
  const events: SensorEvent[] = [];
  for (const [deviceId, item] of Object.entries(history ?? {})) {
    if (item.kind !== 'contact' && item.kind !== 'motion') continue;
    for (const event of item.events) {
      if (!isDurableSensorValue(event.value)) continue;
      const at = new Date(event.at);
      if (Number.isNaN(at.getTime()) || at < start || at >= end) continue;
      events.push({
        deviceId,
        name: names?.[deviceId] || deviceId,
        kind: item.kind,
        value: event.value,
        at: event.at,
      });
    }
  }
  return mergeDurableSensorEvents(events);
}

export function mergeDurableSensorEvents(
  ...lists: Array<SensorEvent[] | undefined>
): SensorEvent[] {
  const seen = new Set<string>();
  const merged: SensorEvent[] = [];
  for (const list of lists) {
    for (const event of list ?? []) {
      const key = `${event.at}|${event.deviceId}|${event.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
}

export function localDayRange(now = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function sensorEventLabel(value: string): string {
  if (value === 'OPEN') return 'Open';
  if (value === 'DETECTED') return 'Detected';
  if (value === 'LEAK') return 'Leak';
  return value;
}

export const HISTORY_LIST_FILTERS = ['idle', 'all', 'active'] as const;
export type HistoryListFilter = (typeof HISTORY_LIST_FILTERS)[number];

export interface HistoryFilterChip {
  id: HistoryListFilter;
  letter: string;
  label: string;
  value: string | null;
}

export function isHistoryListFilter(value: unknown): value is HistoryListFilter {
  return value === 'idle' || value === 'all' || value === 'active';
}

export function historyFilterChips(kind: SensorHistoryKind): HistoryFilterChip[] {
  if (kind === 'contact') {
    return [
      { id: 'idle', letter: 'C', label: 'Closed', value: 'CLOSED' },
      { id: 'all', letter: 'A', label: 'All', value: null },
      { id: 'active', letter: 'O', label: 'Open', value: 'OPEN' },
    ];
  }
  if (kind === 'leak') {
    return [
      { id: 'idle', letter: 'D', label: 'Dry', value: 'DRY' },
      { id: 'all', letter: 'A', label: 'All', value: null },
      { id: 'active', letter: 'L', label: 'Leak', value: 'LEAK' },
    ];
  }
  return [
    { id: 'idle', letter: 'C', label: 'Clear', value: 'CLEAR' },
    { id: 'all', letter: 'A', label: 'All', value: null },
    { id: 'active', letter: 'D', label: 'Detected', value: 'DETECTED' },
  ];
}

export function filterSensorHistory(
  events: SensorHistoryEvent[] | undefined,
  filter: HistoryListFilter,
  kind: SensorHistoryKind
): SensorHistoryEvent[] {
  const rows = newestSensorHistory(events);
  const chip = historyFilterChips(kind).find((item) => item.id === filter);
  if (!chip?.value) return rows;
  return rows.filter((event) => event.value === chip.value);
}

export function sanitizeSensorHistory(raw: unknown): SensorHistory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SensorHistory = {};
  for (const [deviceId, item] of Object.entries(raw as Record<string, unknown>)) {
    if (!deviceId || !item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (!isSensorHistoryKind(record.kind)) continue;
    const events: SensorHistoryEvent[] = [];
    if (Array.isArray(record.events)) {
      for (const event of record.events) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
        const next = event as Record<string, unknown>;
        if (typeof next.at !== 'string' || !next.at) continue;
        if (typeof next.value !== 'string' || !next.value) continue;
        events.push({
          kind: isSensorHistoryKind(next.kind) ? next.kind : record.kind,
          at: next.at,
          value: next.value,
        });
      }
    }
    out[deviceId] = { kind: record.kind, events };
  }
  return out;
}
