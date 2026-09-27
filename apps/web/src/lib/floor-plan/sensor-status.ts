import {
  airQualityLabel,
  type Device,
  type FloorPlanSensor,
  type HubHouseholdState,
  householdSensorClimate,
  householdSensorHasPower,
  householdSensorIsStale,
  householdSensorMotion,
  householdSensorStatus,
  isClimateSensorKind,
} from '@homehub/core';

export function cameraStatusFromDevice(device?: Device | null): string {
  if (device?.status !== 'ONLINE') {
    return 'OFFLINE';
  }
  if (device.lastReading?.metrics?.occupied === true) {
    return 'DETECTED';
  }
  return 'CLEAR';
}

export function sensorStatus(
  sensor: FloorPlanSensor,
  household: HubHouseholdState,
  roomName?: string | null,
  device?: Device | null
): string {
  if (sensor.kind === 'camera') {
    return cameraStatusFromDevice(device);
  }
  const live = householdSensorStatus(sensor, household, roomName);
  if (sensor.kind === 'motion') {
    const motion = householdSensorMotion(sensor, household, roomName);
    const lux = motion?.lux;
    if (live && typeof lux === 'number' && Number.isFinite(lux)) {
      return `${live} · ${Math.round(lux)} lx`;
    }
  }
  if (live) return live;
  if (isClimateSensorKind(sensor.kind)) {
    return sensorReadingText(sensor, household, roomName);
  }
  return '—';
}

export function sensorIsActive(status: string): boolean {
  const token = status.split(' · ')[0] ?? status;
  return (
    token === 'OPEN' ||
    token === 'UNLOCKED' ||
    token === 'DETECTED' ||
    token === 'ON' ||
    token === 'LEAK' ||
    token === 'Poor' ||
    token === 'Very poor'
  );
}

export function sensorIsUnavailable(
  sensor: FloorPlanSensor,
  household: HubHouseholdState,
  roomName?: string | null,
  device?: Device | null
): boolean {
  if (sensor.kind === 'camera') {
    return device?.status !== 'ONLINE';
  }
  return (
    !householdSensorHasPower(sensor, household, roomName) ||
    householdSensorIsStale(sensor, household, roomName)
  );
}

function sensorClimate(
  sensor: FloorPlanSensor,
  household: HubHouseholdState,
  roomName?: string | null
): {
  temperature: number;
  humidity: number;
  co2?: number;
  pm25?: number;
  airQuality?: number;
} | null {
  const climate = householdSensorClimate(sensor, household, roomName);
  if (!climate || typeof climate.temperature !== 'number' || typeof climate.humidity !== 'number') {
    return null;
  }
  return {
    temperature: climate.temperature,
    humidity: climate.humidity,
    co2: climate.co2,
    pm25: climate.pm25,
    airQuality: climate.airQuality,
  };
}

function climateReadingParts(reading: {
  temperature: number;
  humidity: number;
  co2?: number;
  pm25?: number;
  airQuality?: number;
}): string[] {
  const parts = [`${Math.round(reading.temperature)}°/${Math.round(reading.humidity)}%`];
  if (typeof reading.co2 === 'number') parts.push(`${Math.round(reading.co2)}`);
  if (typeof reading.pm25 === 'number') parts.push(`${Math.round(reading.pm25)}`);
  const quality = airQualityLabel(reading.airQuality);
  if (quality) parts.push(quality);
  return parts;
}

/** Lines drawn on the canvas for climate-family sensors. */
export function sensorReadingLines(
  sensor: FloorPlanSensor,
  household: HubHouseholdState,
  roomName?: string | null
): string[] {
  if (!isClimateSensorKind(sensor.kind)) return [];
  const reading = sensorClimate(sensor, household, roomName);
  if (!reading) return ['—'];
  if (sensor.kind === 'co2') {
    return [typeof reading.co2 === 'number' ? `${Math.round(reading.co2)}` : '—'];
  }
  if (sensor.kind === 'pm25') {
    return [typeof reading.pm25 === 'number' ? `${Math.round(reading.pm25)}` : '—'];
  }
  if (sensor.kind === 'air-quality') {
    return [airQualityLabel(reading.airQuality) ?? '—'];
  }
  const parts = climateReadingParts(reading);
  if (parts.length === 1) return parts;
  return [parts[0] ?? '—', parts.slice(1).join(' · ')];
}

/** Combined climate reading, e.g. 23°/74% · 1114 · 0 · Poor. */
export function sensorReadingText(
  sensor: FloorPlanSensor,
  household: HubHouseholdState,
  roomName?: string | null
): string {
  return sensorReadingLines(sensor, household, roomName).join(' · ');
}
