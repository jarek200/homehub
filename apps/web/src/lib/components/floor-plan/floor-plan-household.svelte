<script lang="ts">
import {
  type Device,
  deviceHasPower,
  type FloorPlan,
  type HouseholdDevice,
  type HubHouseholdState,
  householdDeviceDetail,
  householdDeviceHeadline,
  householdDevicePlace,
  householdKindLabel,
  listHouseholdDevices,
  planRoomAt,
  type SensorHistoryEvent,
  sortHouseholdDevices,
} from '@homehub/core';
import DeviceBatteryStatus from '$lib/components/devices/device-battery-status.svelte';
import HourDots from '$lib/components/sensors/hour-dots.svelte';
import { cameraStatusFromDevice } from '$lib/floor-plan/sensor-status';

interface Props {
  plan: FloorPlan;
  household: HubHouseholdState;
  devices?: Device[];
  roomFilter?: string | null;
  onLight?: (id: string, patch: { on?: boolean; brightness?: number }) => void;
  onPlug?: (id: string, on: boolean) => void;
  onCameraInspect?: (deviceId: string) => void;
  onSensorHistory?: (id: string, kind: 'contact' | 'motion' | 'leak') => void;
}

let {
  plan,
  household,
  devices: registeredDevices = [],
  roomFilter = null,
  onLight,
  onPlug,
  onCameraInspect,
  onSensorHistory,
}: Props = $props();

let draggingId = $state<string | null>(null);
let draggingBri = $state(0);

function deviceIsInRoom(deviceId: string, roomName: string, location?: string | null): boolean {
  const sensor = plan.sensors.find((item) => item.deviceId === deviceId);
  if (sensor) return planRoomAt(plan, sensor.x, sensor.y)?.name === roomName;
  return location === roomName;
}

const devices = $derived.by(() => {
  const listed = listHouseholdDevices(household);
  const filtered = roomFilter
    ? listed.filter((device) => deviceIsInRoom(device.id, roomFilter))
    : listed;
  return sortHouseholdDevices(filtered, (device) => householdDevicePlace(plan, device.id));
});
const cameras = $derived.by(() => {
  const listed = registeredDevices.filter((device) => device.type === 'camera');
  return roomFilter
    ? listed.filter((device) => deviceIsInRoom(device.deviceId, roomFilter, device.location))
    : listed;
});
const mid = $derived(Math.ceil(devices.length / 2));
const leftHousehold = $derived(devices.slice(0, mid));
const rightHousehold = $derived(devices.slice(mid));
const registeredById = $derived(
  new Map(registeredDevices.map((device) => [device.deviceId, device] as const))
);

function isTempHumidity(device: HouseholdDevice): boolean {
  return householdKindLabel(device) === 'Temp/Humidity';
}

function historyKindOf(device: HouseholdDevice): 'contact' | 'motion' | 'leak' | null {
  return device.kind === 'contact' || device.kind === 'motion' || device.kind === 'leak'
    ? device.kind
    : null;
}

function hourDotEvents(device: HouseholdDevice): SensorHistoryEvent[] {
  return household.sensorHistory?.[device.id]?.events ?? [];
}

function zipKinds(leftKind: HouseholdDevice[], rightKind: HouseholdDevice[]): HouseholdDevice[] {
  const zipped: HouseholdDevice[] = [];
  const shared = Math.min(leftKind.length, rightKind.length);
  for (let i = 0; i < shared; i += 1) {
    const leftItem = leftKind[i];
    const rightItem = rightKind[i];
    if (leftItem && rightItem) zipped.push(leftItem, rightItem);
  }
  return [...zipped, ...leftKind.slice(shared), ...rightKind.slice(shared)];
}

const phoneGroups = $derived.by(() => {
  const contacts = devices.filter((device) => device.kind === 'contact');
  const motions = devices.filter((device) => device.kind === 'motion');
  const plugs = devices.filter((device) => device.kind === 'plug');
  const climates = devices.filter(isTempHumidity);
  const lights = devices.filter((device) => device.kind === 'light');
  const rest = devices.filter(
    (device) =>
      device.kind !== 'contact' &&
      device.kind !== 'motion' &&
      device.kind !== 'plug' &&
      device.kind !== 'light' &&
      !isTempHumidity(device)
  );
  return [
    { id: 'sense', pair: true, items: zipKinds(contacts, motions) },
    { id: 'plugs', pair: true, items: plugs },
    { id: 'temps', pair: true, items: climates },
    { id: 'lights', pair: true, items: lights },
    { id: 'rest', pair: true, items: rest },
  ].filter((group) => group.items.length > 0);
});

function cameraPlace(device: Device): string {
  return householdDevicePlace(plan, device.deviceId) || device.location || '';
}

function brightnessOf(device: HouseholdDevice): number {
  if (draggingId === device.id) return draggingBri;
  return Math.max(0, Math.min(100, Math.round(device.brightness || 0)));
}

function beginBrightness(device: HouseholdDevice, value: string) {
  draggingId = device.id;
  draggingBri = Number(value) || 0;
}

function commitBrightness(id: string, value: string) {
  const brightness = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  draggingId = null;
  onLight?.(id, { brightness });
}
</script>

{#snippet row(device: HouseholdDevice)}
  {@const place = householdDevicePlace(plan, device.id)}
  {@const dead = !deviceHasPower(device)}
  {@const unavailable = dead || device.stale === true}
  {@const bri = brightnessOf(device)}
  {@const detail = householdDeviceDetail(device)}
  {@const registered = registeredById.get(device.id)}
  {@const batteryReading = registered?.lastReading ?? registered?.recentReadings?.[0] ?? null}
  {@const historyKind = historyKindOf(device)}
  <svelte:element
    this={historyKind ? 'button' : 'div'}
    type={historyKind ? 'button' : undefined}
    role={historyKind ? 'button' : undefined}
    class="device"
    class:light={device.kind === 'light'}
    class:unavailable
    aria-label={historyKind ? `${householdKindLabel(device)} history` : undefined}
    onclick={historyKind ? () => onSensorHistory?.(device.id, historyKind) : undefined}
  >
    <span>
      {householdKindLabel(device)}
      {#if place}<small>{place}</small>{/if}
    </span>
    <div class="device-end">
      {#if device.kind === 'light'}
        <span class="light-ctl">
          <label>
            <span>{bri}%</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={bri}
              aria-label="{householdKindLabel(device)} brightness"
              oninput={(event) => beginBrightness(device, event.currentTarget.value)}
              onchange={(event) => commitBrightness(device.id, event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            class="sw"
            class:on={!!device.on}
            class:dead
            role="switch"
            aria-checked={!!device.on}
            aria-label="ON OFF"
            disabled={dead}
            onclick={() => onLight?.(device.id, { on: !device.on })}
          >
            <span class="sw-lab on">ON</span>
            <span class="sw-lab off">OFF</span>
            <span class="sw-knob"></span>
          </button>
        </span>
      {:else if device.kind === 'plug'}
        <span class="light-ctl">
          <button
            type="button"
            class="sw"
            class:on={!!device.on}
            class:dead
            role="switch"
            aria-checked={!!device.on}
            aria-label="ON OFF"
            disabled={dead}
            onclick={() => onPlug?.(device.id, !device.on)}
          >
            <span class="sw-lab on">ON</span>
            <span class="sw-lab off">OFF</span>
            <span class="sw-knob"></span>
          </button>
        </span>
      {:else}
        <div class="reading">
          <strong>{householdDeviceHeadline(device)}</strong>
          <div class="reading-detail">
            {#if detail}<small>{detail}</small>{/if}
            {#if registered}
              <DeviceBatteryStatus
                reading={batteryReading}
                deviceType={registered.type}
                muted
              />
            {/if}
          </div>
        </div>
      {/if}
    </div>
    {#if historyKind}
      <HourDots events={hourDotEvents(device)} liveValue={device.state} />
    {/if}
  </svelte:element>
{/snippet}

{#snippet cameraRow(device: Device)}
  {@const place = cameraPlace(device)}
  {@const headline = cameraStatusFromDevice(device)}
  {@const unavailable = headline === 'OFFLINE'}
  {@const batteryReading = device.lastReading ?? device.recentReadings?.[0] ?? null}
  <button
    type="button"
    class="device camera wide"
    class:unavailable
    onclick={() => onCameraInspect?.(device.deviceId)}
  >
    <span>
      Camera
      {#if place}<small>{place}</small>{/if}
    </span>
    <div class="device-end">
      <div class="reading">
        <strong>{headline}</strong>
        <div class="reading-detail">
          <DeviceBatteryStatus reading={batteryReading} deviceType={device.type} muted />
        </div>
      </div>
    </div>
  </button>
{/snippet}

{#if devices.length || cameras.length}
  <section class="devices" aria-label="Household devices">
    <div class="device-cols">
      <div class="device-col">
        {#each leftHousehold as device (device.id)}
          {@render row(device)}
        {/each}
      </div>
      <div class="device-col">
        {#each rightHousehold as device (device.id)}
          {@render row(device)}
        {/each}
      </div>
    </div>
    <div class="device-phone">
      {#each phoneGroups as group (group.id)}
        <div class="device-group" class:pair={group.pair}>
          {#each group.items as device (device.id)}
            {@render row(device)}
          {/each}
        </div>
      {/each}
    </div>
    {#if cameras.length}
      <div class="device-cameras">
        {#each cameras as device (device.deviceId)}
          {@render cameraRow(device)}
        {/each}
      </div>
    {/if}
  </section>
{:else if roomFilter}
  <section class="devices" aria-label="Household devices">
    <p class="empty-room">No devices registered in {roomFilter}.</p>
  </section>
{/if}

<style>
  .devices {
    margin-top: 0.15rem;
  }

  .empty-room {
    margin: 0;
    border-bottom: 1px solid currentcolor;
    padding: 0.65rem 0.1rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  .device-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 1.75rem;
  }

  .device-cameras {
    width: 100%;
  }

  .device-phone {
    display: none;
  }

  .device-col,
  .device-group {
    min-width: 0;
  }

  .device {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.5rem 0.75rem;
    border-bottom: 1px solid currentcolor;
    padding: 0.65rem 0.1rem;
    font-size: 0.95rem;
  }

  button.device {
    width: 100%;
    border-left: 0;
    border-right: 0;
    border-top: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .device.unavailable {
    opacity: 0.45;
  }

  .device small {
    display: block;
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  .device-end {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .device-end strong {
    font-weight: 600;
  }

  .reading {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    line-height: 1.2;
  }

  .reading small {
    display: block;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 400;
  }

  .reading-detail {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .light-ctl {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.5rem;
  }

  .light-ctl label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  .light-ctl input[type='range'] {
    width: 6.8rem;
    accent-color: currentcolor;
  }

  .sw {
    position: relative;
    display: inline-block;
    width: 4.6rem;
    height: 2.125rem;
    border: 0;
    border-radius: 999px;
    background: #d8d8d8;
    padding: 0;
    cursor: pointer;
    touch-action: manipulation;
  }

  .sw.on {
    background: #111;
  }

  .sw.dead {
    cursor: default;
  }

  .sw-lab {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    pointer-events: none;
  }

  .sw-lab.on {
    left: 0.7rem;
    color: #fff;
    opacity: 0;
  }

  .sw-lab.off {
    right: 0.65rem;
    color: #111;
    opacity: 1;
  }

  .sw.on .sw-lab.on {
    opacity: 1;
  }

  .sw.on .sw-lab.off {
    opacity: 0;
  }

  .sw-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 28%);
    transition: left 0.16s ease;
  }

  .sw.on .sw-knob {
    left: calc(100% - 1.95rem);
  }

  @media (max-width: 720px) {
    .device-cols {
      display: none;
    }

    .device-phone {
      display: flex;
      flex-direction: column;
    }

    .device-group.pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 0.85rem;
    }

    .device-group.pair .device > span:first-child {
      min-width: 0;
    }

    .device-group.pair .device small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .device {
      padding: 0.45rem 0;
      font-size: 0.85rem;
    }

    .device.light {
      gap: 0.35rem 0.4rem;
    }

    .device.light .light-ctl {
      gap: 0.3rem;
    }

    .device.light .light-ctl label {
      gap: 0.2rem;
      font-size: 0.68rem;
    }

    .device.light .light-ctl input[type='range'] {
      width: 2.6rem;
    }

    .device.light .sw {
      width: 2.85rem;
      height: 1.55rem;
    }

    .device.light .sw-lab {
      font-size: 0.52rem;
    }

    .device.light .sw-lab.on {
      left: 0.35rem;
    }

    .device.light .sw-lab.off {
      right: 0.3rem;
    }

    .device.light .sw-knob {
      top: 2px;
      left: 2px;
      width: 1.25rem;
      height: 1.25rem;
    }

    .device.light .sw.on .sw-knob {
      left: calc(100% - 1.4rem);
    }

    .light-ctl input[type='range'] {
      width: 4.5rem;
    }
  }
</style>
