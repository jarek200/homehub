import type { SensorHistory } from './sensor-history';

export const LOCK_STATES = ['LOCKED', 'UNLOCKED'] as const;
export type LockState = (typeof LOCK_STATES)[number];

export const CONTACT_STATES = ['OPEN', 'CLOSED'] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

export const MOTION_STATES = ['CLEAR', 'DETECTED'] as const;
export type MotionState = (typeof MOTION_STATES)[number];

export const HUB_COMMANDS = [
  'all-lights-off',
  'all-plugs-off',
  'lock-house',
  'unlock-house',
  'evening',
  'home',
  'away',
] as const;
export type HubCommand = (typeof HUB_COMMANDS)[number];

export interface HubLight {
  id: string;
  name: string;
  on: boolean;
  brightness: number;
  /** False when the node stopped answering (wall switch / no mains). */
  reachable?: boolean;
  stale?: boolean;
}

export interface HubContact {
  id: string;
  name: string;
  state: ContactState;
  stale?: boolean;
}

export interface HubMotion {
  id: string;
  name: string;
  state: MotionState;
  lux?: number;
  stale?: boolean;
}

export interface HubLock {
  id: string;
  name: string;
  state: LockState;
  stale?: boolean;
}

export interface HubButton {
  id: string;
  name: string;
  lastPressAt?: string | null;
}

export interface HubPlug {
  id: string;
  name: string;
  on: boolean;
  /** False when the node stopped answering (switched socket / no mains). */
  reachable?: boolean;
  stale?: boolean;
}

export const LEAK_STATES = ['DRY', 'LEAK'] as const;
export type LeakState = (typeof LEAK_STATES)[number];

export interface HubLeak {
  id: string;
  name: string;
  state: LeakState;
  stale?: boolean;
}

export interface HubClimate {
  id: string;
  name: string;
  temperature?: number;
  humidity?: number;
  co2?: number;
  pm25?: number;
  airQuality?: number;
  stale?: boolean;
}

export const AIR_QUALITY_LABELS = [
  'Unknown',
  'Good',
  'Fair',
  'Moderate',
  'Poor',
  'Very poor',
  'Extremely poor',
] as const;

export function airQualityLabel(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const index = Math.round(value);
  if (index <= 0 || index >= AIR_QUALITY_LABELS.length) return null;
  return AIR_QUALITY_LABELS[index];
}

export interface HubHouseholdState {
  lock: HubLock | null;
  lights: HubLight[];
  plugs: HubPlug[];
  contacts: HubContact[];
  motions: HubMotion[];
  climates?: HubClimate[];
  leaks: HubLeak[];
  buttons: HubButton[];
  scene: 'home' | 'evening' | 'away' | null;
  updatedAt: string;
  stateVersion?: number;
  sensorHistory?: SensorHistory;
}

export function deviceHasPower(
  device: { reachable?: boolean; stale?: boolean } | null | undefined
): boolean {
  return device?.reachable !== false && device?.stale !== true;
}

export function lightsOnCount(state: HubHouseholdState): number {
  return state.lights.filter((light) => light.on && deviceHasPower(light)).length;
}

export function motionDetected(state: HubHouseholdState): boolean {
  return state.motions.some((motion) => motion.state === 'DETECTED');
}

function withLockState(
  state: HubHouseholdState,
  lockState: LockState,
  updatedAt: string
): HubHouseholdState {
  if (!state.lock) return { ...state, updatedAt };
  return { ...state, lock: { ...state.lock, state: lockState }, updatedAt };
}

export type HouseholdDeviceKind = 'light' | 'plug' | 'contact' | 'motion' | 'leak' | 'climate';

export interface HouseholdDevice {
  id: string;
  name: string;
  kind: HouseholdDeviceKind;
  on?: boolean;
  brightness?: number;
  reachable?: boolean;
  stale?: boolean;
  state?: string;
  lux?: number;
  temperature?: number;
  humidity?: number;
  co2?: number;
  pm25?: number;
  airQuality?: number;
}

export type HubDevicePatch = { on?: boolean; brightness?: number };

/** Live cards shown on the local hub list, using the same kind labels. */
export function householdLiveForDevice(
  household: HubHouseholdState | null | undefined,
  deviceId: string
): HouseholdDevice | undefined {
  if (!household) return undefined;
  return listHouseholdDevices(household).find((item) => item.id === deviceId);
}

/** Lights and plugs fade on the plan when the node is unreachable or stale. */
export function householdLiveUnavailable(live: HouseholdDevice | undefined): boolean {
  if (!live) return false;
  if (live.kind === 'light' || live.kind === 'plug') return !deviceHasPower(live);
  return false;
}

export function applyHouseholdLiveToMetrics(
  live: HouseholdDevice,
  metrics: Record<string, number | boolean> = {}
): Record<string, number | boolean> {
  const next = { ...metrics };
  if (live.kind === 'contact' && live.state) {
    next.open = live.state === 'OPEN';
  }
  if (live.kind === 'leak' && live.state) {
    next.leak = live.state === 'LEAK';
  }
  if (live.kind === 'motion' && live.state) {
    next.occupied = live.state === 'DETECTED';
    if (typeof live.lux === 'number') next.lightLux = live.lux;
  }
  if (live.kind === 'light' || live.kind === 'plug') {
    next.on = !!live.on;
    if (live.kind === 'light' && typeof live.brightness === 'number') {
      next.brightness = live.brightness;
    }
  }
  if (live.kind === 'climate') {
    if (typeof live.temperature === 'number') next.temperature = live.temperature;
    if (typeof live.humidity === 'number') next.humidity = live.humidity;
    if (typeof live.co2 === 'number') next.co2 = live.co2;
    if (typeof live.pm25 === 'number') next.pm25 = live.pm25;
    if (typeof live.airQuality === 'number') next.airQuality = live.airQuality;
  }
  return next;
}

/** Live cards shown on the local hub list, using the same kind labels. */
export function listHouseholdDevices(state: HubHouseholdState): HouseholdDevice[] {
  return [
    ...state.lights.map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'light' as const,
      on: item.on,
      brightness: item.brightness,
      reachable: item.reachable,
      stale: item.stale,
    })),
    ...state.plugs.map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'plug' as const,
      on: item.on,
      reachable: item.reachable,
      stale: item.stale,
    })),
    ...state.contacts.map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'contact' as const,
      state: item.state,
      stale: item.stale,
    })),
    ...state.motions.map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'motion' as const,
      state: item.state,
      lux: item.lux,
      stale: item.stale,
    })),
    ...state.leaks.map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'leak' as const,
      state: item.state,
      stale: item.stale,
    })),
    ...(state.climates ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'climate' as const,
      temperature: item.temperature,
      humidity: item.humidity,
      co2: item.co2,
      pm25: item.pm25,
      airQuality: item.airQuality,
      stale: item.stale,
    })),
  ];
}

export function householdKindLabel(device: Pick<HouseholdDevice, 'kind' | 'name'>): string {
  if (device.kind === 'light') return 'Light';
  if (device.kind === 'plug') return 'Plug';
  if (device.kind === 'contact') return 'Contact';
  if (device.kind === 'motion') return 'Motion';
  if (device.kind === 'leak') return 'Leak';
  if (device.kind === 'climate') {
    return device.name.toUpperCase().includes('TIMMERFLOTTE') ? 'Temp/Humidity' : 'Environmental';
  }
  return device.kind;
}

function climateHeadline(device: HouseholdDevice): string {
  if (
    typeof device.temperature === 'number' &&
    Number.isFinite(device.temperature) &&
    typeof device.humidity === 'number' &&
    Number.isFinite(device.humidity)
  ) {
    return `${Math.round(device.temperature)}°/${Math.round(device.humidity)}%`;
  }
  return '—';
}

function climateDetail(device: HouseholdDevice): string | null {
  const parts: string[] = [];
  if (typeof device.co2 === 'number' && Number.isFinite(device.co2)) {
    parts.push(String(Math.round(device.co2)));
  }
  if (typeof device.pm25 === 'number' && Number.isFinite(device.pm25)) {
    parts.push(String(Math.round(device.pm25)));
  }
  const quality = airQualityLabel(device.airQuality);
  if (quality) parts.push(quality);
  return parts.length ? parts.join(' · ') : null;
}

/** Main reading shown on the card, without the quieter second line. */
export function householdDeviceHeadline(device: HouseholdDevice): string {
  if ((device.kind === 'light' || device.kind === 'plug') && !deviceHasPower(device)) {
    return 'No power';
  }
  if (device.kind === 'light') {
    return device.on ? `ON ${Math.round(device.brightness || 0)}%` : 'OFF';
  }
  if (device.kind === 'plug') {
    return device.on ? 'ON' : 'OFF';
  }
  if (device.kind === 'contact' || device.kind === 'leak') {
    return device.state || '—';
  }
  if (device.kind === 'motion') {
    return device.state || '—';
  }
  return climateHeadline(device);
}

/** Extra reading under the headline, same size as the room label. */
export function householdDeviceDetail(device: HouseholdDevice): string | null {
  if (device.kind === 'motion' && typeof device.lux === 'number' && Number.isFinite(device.lux)) {
    return `${Math.round(device.lux)} lx`;
  }
  if (device.kind === 'climate') return climateDetail(device);
  return null;
}

export function householdDeviceValue(device: HouseholdDevice): string {
  const headline = householdDeviceHeadline(device);
  const detail = householdDeviceDetail(device);
  return detail ? `${headline} · ${detail}` : headline;
}

export function sortHouseholdDevices<T extends HouseholdDevice>(
  devices: T[],
  placeOf: (device: T) => string
): T[] {
  return devices.slice().sort((left, right) => {
    const byKind = householdKindLabel(left).localeCompare(householdKindLabel(right));
    if (byKind !== 0) return byKind;
    return placeOf(left).localeCompare(placeOf(right));
  });
}

export function applyHubDevice(
  state: HubHouseholdState,
  kind: 'light' | 'plug',
  id: string,
  patch: HubDevicePatch
): HubHouseholdState {
  const updatedAt = new Date().toISOString();
  if (kind === 'light') {
    return {
      ...state,
      updatedAt,
      lights: state.lights.map((light) => {
        if (light.id !== id) return light;
        if (patch.brightness !== undefined) {
          const brightness = Math.max(0, Math.min(100, Math.round(patch.brightness)));
          return { ...light, brightness, on: patch.on ?? brightness > 0 };
        }
        if (patch.on === undefined) return light;
        return {
          ...light,
          on: patch.on,
          brightness: patch.on && !light.brightness ? 100 : light.brightness,
        };
      }),
    };
  }
  if (patch.on === undefined) return { ...state, updatedAt };
  const on = patch.on;
  return {
    ...state,
    updatedAt,
    plugs: state.plugs.map((plug) => (plug.id === id ? { ...plug, on } : plug)),
  };
}

/** Command string the current CoreS3 firmware already understands. */
export function hubDeviceCommand(
  kind: 'light' | 'plug',
  id: string,
  patch: HubDevicePatch
): string {
  if (kind === 'light') {
    if (patch.brightness !== undefined) {
      const brightness = Math.max(0, Math.min(100, Math.round(patch.brightness)));
      return `light-bri-${id}-${brightness}`;
    }
    return patch.on ? `light-on-${id}` : `light-off-${id}`;
  }
  if (id === 'matter-10') return patch.on ? 'plug-on-11' : 'plug-off-11';
  return patch.on ? 'plug-on' : 'plug-off';
}

export function applyHubCommand(state: HubHouseholdState, command: HubCommand): HubHouseholdState {
  const updatedAt = new Date().toISOString();
  if (command === 'all-lights-off') {
    return {
      ...state,
      lights: state.lights.map((light) => ({ ...light, on: false })),
      scene: state.scene === 'evening' ? 'home' : state.scene,
      updatedAt,
    };
  }
  if (command === 'all-plugs-off') {
    return {
      ...state,
      plugs: state.plugs.map((plug) => ({ ...plug, on: false })),
      updatedAt,
    };
  }
  if (command === 'lock-house') {
    return withLockState(state, 'LOCKED', updatedAt);
  }
  if (command === 'unlock-house') {
    return withLockState(state, 'UNLOCKED', updatedAt);
  }
  if (command === 'evening') {
    return {
      ...withLockState(state, 'LOCKED', updatedAt),
      lights: state.lights.map((light) => ({ ...light, on: true, brightness: 40 })),
      scene: 'evening',
      updatedAt,
    };
  }
  if (command === 'home') {
    return { ...state, scene: 'home', updatedAt };
  }
  return {
    ...withLockState(state, 'LOCKED', updatedAt),
    scene: 'away',
    updatedAt,
  };
}

/** Live snapshot for the commissioned CoreS3 fabric. */
export function createCores3HouseholdState(now = new Date()): HubHouseholdState {
  return {
    lock: null,
    lights: [
      { id: 'matter-1', name: 'KAJPLATS', on: true, brightness: 100 },
      { id: 'matter-11', name: 'KAJPLATS 2', on: true, brightness: 100 },
    ],
    plugs: [
      { id: 'matter-9', name: 'GRILLPLATS', on: true },
      { id: 'matter-10', name: 'GRILLPLATS 2', on: true },
    ],
    contacts: [{ id: 'matter-5', name: 'MYGGBETT', state: 'CLOSED' }],
    motions: [{ id: 'matter-4', name: 'MYGGSPRAY', state: 'DETECTED' }],
    climates: [
      { id: 'matter-2', name: 'TIMMERFLOTTE 1' },
      { id: 'matter-3', name: 'TIMMERFLOTTE 2' },
      { id: 'matter-6', name: 'ALPSTUGA' },
    ],
    leaks: [{ id: 'matter-7', name: 'KLIPPBOK', state: 'DRY' }],
    buttons: [],
    scene: 'home',
    updatedAt: now.toISOString(),
  };
}

export function emptyHouseholdState(now = new Date()): HubHouseholdState {
  return {
    lock: null,
    lights: [],
    plugs: [],
    contacts: [],
    motions: [],
    climates: [],
    leaks: [],
    buttons: [],
    scene: null,
    updatedAt: now.toISOString(),
  };
}

export function placeKey(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('kitchen')) return 'kitchen';
  if (normalized.includes('living')) return 'living';
  if (normalized.includes('utility')) return 'utility';
  if (normalized.includes('bath')) return 'bath';
  if (normalized.includes('front')) return 'front';
  if (normalized.includes('back')) return 'back';
  if (normalized.includes('hall') || normalized.includes('entrance')) return 'hall';
  return normalized.replace(/[^a-z0-9]+/g, '');
}

function idsMatch(item: { id: string }, sensor: { id: string; deviceId?: string | null }): boolean {
  return item.id === sensor.deviceId || item.id === sensor.id;
}

function namesMatch(
  item: { id: string; name: string },
  sensorLabel: string,
  roomName?: string | null
): boolean {
  const keys = [placeKey(item.id), placeKey(item.name)];
  const targets = [placeKey(sensorLabel), placeKey(roomName ?? '')].filter(Boolean);
  return targets.some((target) => keys.includes(target));
}

function findNamed<T extends { id: string; name: string }>(
  items: T[] | undefined,
  sensor: { id: string; deviceId?: string | null; label: string },
  roomName?: string | null
): T | undefined {
  const list = items ?? [];
  return (
    list.find((item) => idsMatch(item, sensor)) ??
    list.find((item) => namesMatch(item, sensor.label, roomName))
  );
}

/** Live fabric devices that can be linked to a floor-plan mark of this kind. */
export function householdDevicesForKind(
  kind: string,
  household: HubHouseholdState
): Array<{ id: string; name: string }> {
  if (kind === 'contact') return household.contacts;
  if (kind === 'light') return household.lights;
  if (kind === 'motion') return household.motions;
  if (kind === 'plug') return household.plugs;
  if (kind === 'leak') return household.leaks;
  if (kind === 'button') return household.buttons ?? [];
  if (kind === 'lock') return household.lock ? [household.lock] : [];
  if (kind === 'climate' || kind === 'co2' || kind === 'pm25' || kind === 'air-quality') {
    return household.climates ?? [];
  }
  return [];
}

export function householdSensorStatus(
  sensor: { id: string; kind: string; deviceId?: string | null; label: string },
  household: HubHouseholdState,
  roomName?: string | null
): string | null {
  if (sensor.kind === 'lock') return household.lock?.state ?? null;
  if (sensor.kind === 'contact')
    return findNamed(household.contacts, sensor, roomName)?.state ?? null;
  if (sensor.kind === 'motion')
    return findNamed(household.motions, sensor, roomName)?.state ?? null;
  if (sensor.kind === 'light') {
    const light = findNamed(household.lights, sensor, roomName);
    if (!light) return null;
    return light.on ? 'ON' : 'OFF';
  }
  if (sensor.kind === 'plug') {
    const plug = findNamed(household.plugs, sensor, roomName);
    if (!plug) return null;
    return plug.on ? 'ON' : 'OFF';
  }
  if (sensor.kind === 'leak') return findNamed(household.leaks, sensor, roomName)?.state ?? null;
  return null;
}

export function householdSensorHasPower(
  sensor: { id: string; kind: string; deviceId?: string | null; label: string },
  household: HubHouseholdState,
  roomName?: string | null
): boolean {
  if (sensor.kind === 'light') {
    return deviceHasPower(findNamed(household.lights, sensor, roomName));
  }
  if (sensor.kind === 'plug') {
    return deviceHasPower(findNamed(household.plugs, sensor, roomName));
  }
  return true;
}

export function householdSensorIsStale(
  sensor: { id: string; kind: string; deviceId?: string | null; label: string },
  household: HubHouseholdState,
  roomName?: string | null
): boolean {
  if (sensor.kind === 'lock') return household.lock?.stale === true;
  if (sensor.kind === 'contact') {
    return findNamed(household.contacts, sensor, roomName)?.stale === true;
  }
  if (sensor.kind === 'motion') {
    return findNamed(household.motions, sensor, roomName)?.stale === true;
  }
  if (sensor.kind === 'light') {
    return findNamed(household.lights, sensor, roomName)?.stale === true;
  }
  if (sensor.kind === 'plug') {
    return findNamed(household.plugs, sensor, roomName)?.stale === true;
  }
  if (sensor.kind === 'leak') {
    return findNamed(household.leaks, sensor, roomName)?.stale === true;
  }
  if (
    sensor.kind === 'climate' ||
    sensor.kind === 'co2' ||
    sensor.kind === 'pm25' ||
    sensor.kind === 'air-quality'
  ) {
    return findNamed(household.climates, sensor, roomName)?.stale === true;
  }
  return false;
}

export function householdSensorClimate(
  sensor: { id: string; deviceId?: string | null; label: string },
  household: HubHouseholdState,
  roomName?: string | null
): HubClimate | null {
  return findNamed(household.climates, sensor, roomName) ?? null;
}

export function householdSensorMotion(
  sensor: { id: string; deviceId?: string | null; label: string },
  household: HubHouseholdState,
  roomName?: string | null
): HubMotion | null {
  return findNamed(household.motions, sensor, roomName) ?? null;
}
