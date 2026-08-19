import type { DeviceConfiguration } from '@sst-monorepo/core';

export const CAMERA_FRAME_SIZES = [
  { id: 'qqvga', label: 'QQVGA', dimensions: '160×120' },
  { id: 'qcif', label: 'QCIF', dimensions: '176×144' },
  { id: 'qvga', label: 'QVGA', dimensions: '320×240' },
  { id: 'cif', label: 'CIF', dimensions: '400×296' },
  { id: 'hvga', label: 'HVGA', dimensions: '480×320' },
  { id: 'vga', label: 'VGA', dimensions: '640×480' },
  { id: 'svga', label: 'SVGA', dimensions: '800×600' },
  { id: 'xga', label: 'XGA', dimensions: '1024×768' },
  { id: 'hd', label: 'HD', dimensions: '1280×720' },
  { id: 'sxga', label: 'SXGA', dimensions: '1280×1024' },
  { id: 'uxga', label: 'UXGA', dimensions: '1600×1200' },
] as const;

export type CameraFrameSizeId = (typeof CAMERA_FRAME_SIZES)[number]['id'];

export const CAMERA_FRAME_SIZE_IDS = new Set<string>(CAMERA_FRAME_SIZES.map((item) => item.id));

export const CAMERA_JPEG_QUALITY_MIN = 4;
export const CAMERA_JPEG_QUALITY_MAX = 63;
export const CAMERA_SENSOR_ADJUST_MIN = -2;
export const CAMERA_SENSOR_ADJUST_MAX = 2;

export const CAMERA_REPORTING_MIN_SECONDS = 15;
export const CAMERA_REPORTING_MAX_SECONDS = 3600;
export const CAMERA_REPORTING_PRESETS_SECONDS = [15, 30, 60, 120, 300, 600, 1800, 3600] as const;

export type CameraCaptureMode = 'both' | 'interval' | 'motion';

export type CameraPowerMode = 'always-on' | 'sleep-motion';

export const CAMERA_CAPTURE_MODES: { id: CameraCaptureMode; label: string }[] = [
  { id: 'both', label: 'Motion + timed snapshots' },
  { id: 'motion', label: 'Motion only' },
  { id: 'interval', label: 'Timed only' },
];

export const CAMERA_POWER_MODES: { id: CameraPowerMode; label: string; description: string }[] = [
  {
    id: 'always-on',
    label: 'Always on',
    description: 'Wi‑Fi stays connected for timed snapshots and instant settings sync.',
  },
  {
    id: 'sleep-motion',
    label: 'Sleep between captures',
    description:
      'Camera sleeps most of the time and wakes on PIR motion to take a snapshot. Uses light sleep (GPIO44 cannot wake from deep sleep on ESP32-S3).',
  },
];

export interface CameraSettings {
  reportingIntervalSeconds: number;
  frameSize: CameraFrameSizeId;
  jpegQuality: number;
  brightness: number;
  saturation: number;
  contrast: number;
  vflip: boolean;
  hmirror: boolean;
  motionEnabled: boolean;
  motionCooldownSeconds: number;
  captureMode: CameraCaptureMode;
  powerMode: CameraPowerMode;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  reportingIntervalSeconds: 30,
  frameSize: 'qvga',
  jpegQuality: 12,
  brightness: 1,
  saturation: -2,
  contrast: 0,
  vflip: true,
  hmirror: false,
  motionEnabled: true,
  motionCooldownSeconds: 15,
  captureMode: 'both',
  powerMode: 'always-on',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCameraFrameSize(value: unknown): CameraFrameSizeId {
  if (typeof value === 'string' && CAMERA_FRAME_SIZE_IDS.has(value)) {
    return value as CameraFrameSizeId;
  }
  return DEFAULT_CAMERA_SETTINGS.frameSize;
}

export function cameraSettingsFromConfiguration(
  configuration: DeviceConfiguration | null | undefined
): CameraSettings {
  const parsed = configuration ?? {};
  const interval =
    typeof parsed.reportingIntervalSeconds === 'number'
      ? parsed.reportingIntervalSeconds
      : DEFAULT_CAMERA_SETTINGS.reportingIntervalSeconds;
  return {
    reportingIntervalSeconds: clamp(
      Math.round(interval),
      CAMERA_REPORTING_MIN_SECONDS,
      CAMERA_REPORTING_MAX_SECONDS
    ),
    frameSize: normalizeCameraFrameSize(parsed.frameSize),
    jpegQuality: clamp(
      typeof parsed.jpegQuality === 'number'
        ? Math.round(parsed.jpegQuality)
        : DEFAULT_CAMERA_SETTINGS.jpegQuality,
      CAMERA_JPEG_QUALITY_MIN,
      CAMERA_JPEG_QUALITY_MAX
    ),
    brightness: clamp(
      typeof parsed.brightness === 'number'
        ? Math.round(parsed.brightness)
        : DEFAULT_CAMERA_SETTINGS.brightness,
      CAMERA_SENSOR_ADJUST_MIN,
      CAMERA_SENSOR_ADJUST_MAX
    ),
    saturation: clamp(
      typeof parsed.saturation === 'number'
        ? Math.round(parsed.saturation)
        : DEFAULT_CAMERA_SETTINGS.saturation,
      CAMERA_SENSOR_ADJUST_MIN,
      CAMERA_SENSOR_ADJUST_MAX
    ),
    contrast: clamp(
      typeof parsed.contrast === 'number'
        ? Math.round(parsed.contrast)
        : DEFAULT_CAMERA_SETTINGS.contrast,
      CAMERA_SENSOR_ADJUST_MIN,
      CAMERA_SENSOR_ADJUST_MAX
    ),
    vflip:
      typeof parsed.vflip === 'boolean' ? parsed.vflip : DEFAULT_CAMERA_SETTINGS.vflip,
    hmirror:
      typeof parsed.hmirror === 'boolean' ? parsed.hmirror : DEFAULT_CAMERA_SETTINGS.hmirror,
    motionEnabled:
      typeof parsed.motionEnabled === 'boolean'
        ? parsed.motionEnabled
        : DEFAULT_CAMERA_SETTINGS.motionEnabled,
    motionCooldownSeconds: clamp(
      typeof parsed.motionCooldownSeconds === 'number'
        ? Math.round(parsed.motionCooldownSeconds)
        : DEFAULT_CAMERA_SETTINGS.motionCooldownSeconds,
      5,
      300
    ),
    captureMode:
      parsed.captureMode === 'interval' ||
      parsed.captureMode === 'motion' ||
      parsed.captureMode === 'both'
        ? parsed.captureMode
        : DEFAULT_CAMERA_SETTINGS.captureMode,
    powerMode:
      parsed.powerMode === 'sleep-motion' || parsed.powerMode === 'always-on'
        ? parsed.powerMode
        : DEFAULT_CAMERA_SETTINGS.powerMode,
  };
}

export function buildCameraConfiguration(
  base: DeviceConfiguration | null | undefined,
  settings: CameraSettings
): DeviceConfiguration {
  return {
    ...(base ?? {}),
    reportingIntervalSeconds: settings.reportingIntervalSeconds,
    frameSize: settings.frameSize,
    jpegQuality: settings.jpegQuality,
    brightness: settings.brightness,
    saturation: settings.saturation,
    contrast: settings.contrast,
    vflip: settings.vflip,
    hmirror: settings.hmirror,
    motionEnabled: settings.motionEnabled,
    motionCooldownSeconds: settings.motionCooldownSeconds,
    captureMode: settings.captureMode,
    powerMode: settings.powerMode,
  };
}

export function formatCameraFrameSizeLabel(frameSize: CameraFrameSizeId): string {
  const match = CAMERA_FRAME_SIZES.find((item) => item.id === frameSize);
  if (!match) return frameSize;
  return `${match.label} (${match.dimensions})`;
}

export function formatCameraSettingsSummary(
  configuration: DeviceConfiguration | null | undefined
): string {
  const settings = cameraSettingsFromConfiguration(configuration);
  const parts = [
    formatCameraFrameSizeLabel(settings.frameSize),
    `Q${settings.jpegQuality}`,
    `Every ${settings.reportingIntervalSeconds}s`,
  ];
  if (settings.vflip) parts.push('Flipped');
  if (settings.hmirror) parts.push('Mirrored');
  if (settings.motionEnabled) parts.push('PIR on');
  if (settings.powerMode === 'sleep-motion') parts.push('Sleep on motion');
  return parts.join(' · ');
}

export function formatReportingIntervalLabel(seconds: number): string {
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return `${minutes} min`;
  }
  return `${seconds}s`;
}
