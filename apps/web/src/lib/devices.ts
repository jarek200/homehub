/** Aico HomeLINK product categories: smoke, heat, CO, and environmental sensors. */
export const DEVICE_TYPES = [
  { value: 'smoke-alarm', label: 'Smoke alarm' },
  { value: 'heat-alarm', label: 'Heat alarm' },
  { value: 'carbon-monoxide-alarm', label: 'Carbon monoxide alarm' },
  { value: 'environmental-sensor', label: 'Environmental sensor' },
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number]['value'];

export type DeviceModelOption = {
  value: string;
  label: string;
};

/** Official Aico product pages for each model. */
export const DEVICE_MODEL_URLS: Record<string, string> = {
  Ei3016: 'https://www.aico.co.uk/product/ei3016-optical-smoke-alarm/',
  Ei3024: 'https://www.aico.co.uk/product/ei3024-multi-sensor-fire-alarm/',
  Ei3014: 'https://www.aico.co.uk/product/ei3014-heat-alarm/',
  Ei3018: 'https://www.aico.co.uk/product/ei3018-carbon-monoxide-alarm/',
  Ei3028: 'https://www.aico.co.uk/product/ei3028-multi-sensor-heat-co-alarm/',
  Ei1020: 'https://www.aico.co.uk/homelink/products/ei1020-environmental-sensor/',
  Ei1025: 'https://www.aico.co.uk/homelink/products/ei1025-environmental-sensor/',
};

/** Aico product models per HomeLINK device category. */
export const DEVICE_MODELS: Record<DeviceType, DeviceModelOption[]> = {
  'smoke-alarm': [
    { value: 'Ei3016', label: 'Ei3016 Optical Smoke Alarm' },
    { value: 'Ei3024', label: 'Ei3024 Multi-Sensor Fire Alarm' },
  ],
  'heat-alarm': [{ value: 'Ei3014', label: 'Ei3014 Heat Alarm' }],
  'carbon-monoxide-alarm': [
    { value: 'Ei3018', label: 'Ei3018 Carbon Monoxide Alarm' },
    { value: 'Ei3028', label: 'Ei3028 Heat & CO Alarm' },
  ],
  'environmental-sensor': [
    { value: 'Ei1020', label: 'Ei1020 Temperature & Humidity Sensor' },
    { value: 'Ei1025', label: 'Ei1025 Temperature, Humidity & CO₂ Sensor' },
  ],
};

export const DEVICE_STATUSES = [
  { value: 'ONLINE', label: 'Online' },
  { value: 'OFFLINE', label: 'Offline' },
  { value: 'UNKNOWN', label: 'Unknown' },
] as const;

export function getDeviceModelsForType(type: string): DeviceModelOption[] {
  return DEVICE_MODELS[type as DeviceType] ?? [];
}

export function getDefaultModelForType(type: string): string {
  return getDeviceModelsForType(type)[0]?.value ?? '';
}

export function getDeviceModelLabel(type: string, model: string): string {
  return getDeviceModelsForType(type).find((item) => item.value === model)?.label ?? model;
}

export function getDeviceModelUrl(model: string): string | null {
  return DEVICE_MODEL_URLS[model] ?? null;
}

export function parseModelFromConfiguration(
  configuration: string | null | undefined,
  deviceType: string
): string {
  if (!configuration) return getDefaultModelForType(deviceType);
  try {
    const parsed = JSON.parse(configuration) as { model?: string };
    if (parsed.model && getDeviceModelsForType(deviceType).some((m) => m.value === parsed.model)) {
      return parsed.model;
    }
  } catch {
    // fall through
  }
  return getDefaultModelForType(deviceType);
}

export function applyModelToConfiguration(
  configuration: string | null | undefined,
  deviceType: string,
  model: string
): string {
  const defaults = getDefaultConfiguration(deviceType, model);
  if (!configuration?.trim()) {
    return JSON.stringify(defaults);
  }
  try {
    const parsed = JSON.parse(configuration) as Record<string, unknown>;
    return JSON.stringify({ ...defaults, ...parsed, model });
  } catch {
    return JSON.stringify(defaults);
  }
}

export function getDefaultConfiguration(
  deviceType: string,
  model = getDefaultModelForType(deviceType)
): Record<string, unknown> {
  if (deviceType === 'smoke-alarm') {
    return {
      model,
      series: '3000',
      interconnect: 'RadioLINK+',
      opticalSensor: model !== 'Ei3024',
      multiSensor: model === 'Ei3024',
      testIntervalDays: 30,
    };
  }
  if (deviceType === 'heat-alarm') {
    return {
      model,
      series: '3000',
      fixedTemperatureC: 58,
      rateOfRise: true,
    };
  }
  if (deviceType === 'carbon-monoxide-alarm') {
    return {
      model,
      series: '3000',
      coThresholdPpm: 50,
      sensorLifeYears: 10,
      dualHeatSensor: model === 'Ei3028',
    };
  }
  if (deviceType === 'environmental-sensor') {
    return {
      model,
      series: '1000',
      reportingIntervalSeconds: 300,
      temperatureAlertThreshold: 28,
      humidityAlertThreshold: 70,
      co2Monitoring: model === 'Ei1025',
    };
  }
  return { model, reportingIntervalSeconds: 300 };
}

/** HomeLINK-style remote actions (test, silence, status). */
export const COMMAND_OPTIONS = [
  { value: 'button-test', label: 'Button test' },
  { value: 'silence-alarm', label: 'Silence alarm' },
  { value: 'report-status', label: 'Report status' },
  { value: 'restart', label: 'Restart device' },
] as const;

export function isEnvironmentalSensor(type: string): boolean {
  return type === 'environmental-sensor';
}

export function isSmokeAlarm(type: string): boolean {
  return type === 'smoke-alarm';
}

export function isHeatAlarm(type: string): boolean {
  return type === 'heat-alarm';
}

export function isCarbonMonoxideAlarm(type: string): boolean {
  return type === 'carbon-monoxide-alarm';
}

export function supportsReadings(type: string): boolean {
  return (
    isEnvironmentalSensor(type) ||
    isSmokeAlarm(type) ||
    isHeatAlarm(type) ||
    isCarbonMonoxideAlarm(type)
  );
}

export function formatDeviceType(type: string, configuration?: string | null): string {
  const category = DEVICE_TYPES.find((t) => t.value === type)?.label ?? type;
  if (!configuration) return category;
  const model = parseModelFromConfiguration(configuration, type);
  if (model) {
    return getDeviceModelLabel(type, model);
  }
  return category;
}

export function formatStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Text color for device status — green Online, red Offline. */
export function statusColorClass(status: string): string {
  if (status === 'ONLINE') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'OFFLINE') return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatConfigurationSummary(configuration: string | null | undefined): string {
  if (!configuration) return '—';
  try {
    const parsed = JSON.parse(configuration) as Record<string, unknown>;
    const parts: string[] = [];
    if (parsed.model != null) parts.push(String(parsed.model));
    if (parsed.multiSensor === true) parts.push('Multi-sensor');
    if (parsed.dualHeatSensor === true) parts.push('Heat + CO');
    if (parsed.co2Monitoring === true) parts.push('CO₂ monitoring');
    if (parsed.series != null) parts.push(`${String(parsed.series)} Series`);
    if (parsed.interconnect != null) parts.push(String(parsed.interconnect));
    if (parsed.opticalSensor != null) {
      parts.push(parsed.opticalSensor ? 'Optical sensor' : 'No optical sensor');
    }
    if (parsed.fixedTemperatureC != null) {
      parts.push(`Fixed temp ${String(parsed.fixedTemperatureC)}°C`);
    }
    if (parsed.rateOfRise != null) {
      parts.push(parsed.rateOfRise ? 'Rate-of-rise on' : 'Rate-of-rise off');
    }
    if (parsed.coThresholdPpm != null) {
      parts.push(`CO threshold ${String(parsed.coThresholdPpm)} ppm`);
    }
    if (parsed.reportingIntervalSeconds != null) {
      parts.push(`Reports every ${String(parsed.reportingIntervalSeconds)}s`);
    }
    if (parsed.temperatureAlertThreshold != null) {
      parts.push(`Temp alert ${String(parsed.temperatureAlertThreshold)}°C`);
    }
    if (parsed.humidityAlertThreshold != null) {
      parts.push(`Humidity alert ${String(parsed.humidityAlertThreshold)}%`);
    }
    return parts.length ? parts.join(' · ') : 'Configured';
  } catch {
    return 'Configured';
  }
}

export const inputMinimal =
  'rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground';
