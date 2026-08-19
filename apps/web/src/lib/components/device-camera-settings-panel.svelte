<script lang="ts">
import type { Device, DeviceConfiguration } from '@sst-monorepo/core';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import {
  buildCameraConfiguration,
  CAMERA_FRAME_SIZES,
  CAMERA_JPEG_QUALITY_MAX,
  CAMERA_JPEG_QUALITY_MIN,
  CAMERA_REPORTING_MAX_SECONDS,
  CAMERA_REPORTING_MIN_SECONDS,
  CAMERA_REPORTING_PRESETS_SECONDS,
  CAMERA_SENSOR_ADJUST_MAX,
  CAMERA_SENSOR_ADJUST_MIN,
  cameraSettingsFromConfiguration,
  formatCameraFrameSizeLabel,
  formatReportingIntervalLabel,
  type CameraSettings,
} from '$lib/device-camera-settings';
import { configurationForType, inputMinimal } from '$lib/devices';
import { updateDevice } from '$lib/services/rest-api';

let {
  device,
  onUpdated,
}: {
  device: Device;
  onUpdated?: (device: Device) => void;
} = $props();

let settings = $state<CameraSettings>(cameraSettingsFromConfiguration(device.configuration));
let saving = $state(false);
let saveError = $state('');
let savedNotice = $state('');

const isPhysical = $derived(device.runtimeKind === 'physical');

$effect(() => {
  settings = cameraSettingsFromConfiguration(device.configuration);
});

function clampReportingSeconds() {
  settings.reportingIntervalSeconds = Math.min(
    CAMERA_REPORTING_MAX_SECONDS,
    Math.max(CAMERA_REPORTING_MIN_SECONDS, Math.round(settings.reportingIntervalSeconds))
  );
}

async function saveSettings() {
  saving = true;
  saveError = '';
  savedNotice = '';
  clampReportingSeconds();
  try {
    const configuration: DeviceConfiguration = buildCameraConfiguration(
      configurationForType(device.configuration, device.type),
      settings
    );
    const updated = await updateDevice(device.deviceId, { configuration });
    settings = cameraSettingsFromConfiguration(updated.configuration);
    savedNotice = 'Settings saved. The camera applies them on its next cloud sync.';
    onUpdated?.(updated);
  } catch (err) {
    saveError = err instanceof Error ? err.message : 'Failed to save camera settings';
  } finally {
    saving = false;
  }
}
</script>

<section class="space-y-6 border-border border-t pt-8">
  <div>
    <h3 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Camera settings</h3>
    <p class="mt-1 text-[0.7rem] text-muted-foreground leading-relaxed">
      {#if isPhysical}
        Resolution, image quality, and sensor tuning for the ESP32-S3 camera. Changes sync over
        AWS IoT shadow — usually within a minute while the camera is online.
      {:else}
        Snapshot timing for the hub camera runtime. Pan and tilt are adjusted above.
      {/if}
    </p>
  </div>

  <div class="grid gap-6 lg:grid-cols-2">
    <div class="flex flex-col gap-2">
      <Label for="{device.deviceId}-frame-size" class="text-muted-foreground text-xs font-normal">
        Resolution
      </Label>
      <select
        id="{device.deviceId}-frame-size"
        class="rounded-sm border border-border bg-background px-3 py-2 text-sm"
        bind:value={settings.frameSize}
        disabled={!isPhysical}
      >
        {#each CAMERA_FRAME_SIZES as option (option.id)}
          <option value={option.id}>{formatCameraFrameSizeLabel(option.id)}</option>
        {/each}
      </select>
      {#if isPhysical}
        <p class="text-[0.7rem] text-muted-foreground">
          Larger resolutions need more Wi‑Fi bandwidth. QVGA–VGA work best over MQTT.
        </p>
      {/if}
    </div>

    <div class="flex flex-col gap-2">
      <Label for="{device.deviceId}-jpeg-quality" class="text-muted-foreground text-xs font-normal">
        JPEG quality {settings.jpegQuality}
      </Label>
      <input
        id="{device.deviceId}-jpeg-quality"
        type="range"
        min={CAMERA_JPEG_QUALITY_MIN}
        max={CAMERA_JPEG_QUALITY_MAX}
        step="1"
        bind:value={settings.jpegQuality}
        class="w-full accent-foreground"
        disabled={!isPhysical}
      />
      <p class="text-[0.7rem] text-muted-foreground">Lower number = higher quality and larger files.</p>
    </div>
  </div>

  {#if isPhysical}
    <div class="grid gap-6 sm:grid-cols-3">
      <div class="flex flex-col gap-2">
        <Label for="{device.deviceId}-brightness" class="text-muted-foreground text-xs font-normal">
          Brightness {settings.brightness}
        </Label>
        <input
          id="{device.deviceId}-brightness"
          type="range"
          min={CAMERA_SENSOR_ADJUST_MIN}
          max={CAMERA_SENSOR_ADJUST_MAX}
          step="1"
          bind:value={settings.brightness}
          class="w-full accent-foreground"
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="{device.deviceId}-saturation" class="text-muted-foreground text-xs font-normal">
          Saturation {settings.saturation}
        </Label>
        <input
          id="{device.deviceId}-saturation"
          type="range"
          min={CAMERA_SENSOR_ADJUST_MIN}
          max={CAMERA_SENSOR_ADJUST_MAX}
          step="1"
          bind:value={settings.saturation}
          class="w-full accent-foreground"
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="{device.deviceId}-contrast" class="text-muted-foreground text-xs font-normal">
          Contrast {settings.contrast}
        </Label>
        <input
          id="{device.deviceId}-contrast"
          type="range"
          min={CAMERA_SENSOR_ADJUST_MIN}
          max={CAMERA_SENSOR_ADJUST_MAX}
          step="1"
          bind:value={settings.contrast}
          class="w-full accent-foreground"
        />
      </div>
    </div>

    <div class="flex flex-wrap gap-6">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={settings.vflip} />
        Flip vertically
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={settings.hmirror} />
        Mirror horizontally
      </label>
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <Label for="{device.deviceId}-reporting-seconds" class="text-muted-foreground text-xs font-normal">
      Snapshot interval
    </Label>
    <div class="flex flex-wrap gap-2">
      {#each CAMERA_REPORTING_PRESETS_SECONDS as preset (preset)}
        <Button
          type="button"
          variant={settings.reportingIntervalSeconds === preset ? 'default' : 'outline'}
          size="sm"
          class="rounded-sm"
          onclick={() => {
            settings.reportingIntervalSeconds = preset;
          }}
        >
          {formatReportingIntervalLabel(preset)}
        </Button>
      {/each}
    </div>
    <Input
      id="{device.deviceId}-reporting-seconds"
      type="number"
      min={CAMERA_REPORTING_MIN_SECONDS}
      max={CAMERA_REPORTING_MAX_SECONDS}
      step={15}
      bind:value={settings.reportingIntervalSeconds}
      class={inputMinimal}
    />
  </div>

  <div class="flex items-center gap-3">
    <Button type="button" class="rounded-sm" disabled={saving} onclick={saveSettings}>
      {saving ? 'Saving…' : 'Save settings'}
    </Button>
    {#if savedNotice}
      <p class="text-[0.7rem] text-muted-foreground">{savedNotice}</p>
    {/if}
  </div>
  {#if saveError}
    <p class="text-[0.75rem] text-destructive">{saveError}</p>
  {/if}
</section>
