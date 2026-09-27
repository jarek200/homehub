<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import type { DeviceType } from '$lib/devices/device-type';
import { CREATE_DEVICE_TYPES, inputMinimal } from '$lib/devices/devices';
import { formatTelemetryPreview } from '$lib/devices/telemetry';

interface Props {
  type: DeviceType;
  name: string;
  location: string;
  creating: boolean;
  onSubmit: () => void;
}

let {
  type = $bindable(),
  name = $bindable(),
  location = $bindable(),
  creating,
  onSubmit,
}: Props = $props();

const telemetryPreview = $derived(formatTelemetryPreview(type));
</script>

<form
  class="mb-10 space-y-6 border-border border-b pb-10"
  onsubmit={(event) => {
    event.preventDefault();
    onSubmit();
  }}
>
  <div>
    <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
      Register other device
    </h2>
    <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
      Register a Timer Camera F, CoreS3 gateway, or environmental sensor. Lights and sensors join
      through Add Matter product.
    </p>
  </div>

  <div class="flex flex-col gap-2">
    <Label for="device-type" class="text-muted-foreground text-xs font-normal">Type</Label>
    <select
      id="device-type"
      bind:value={type}
      class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
    >
      {#each CREATE_DEVICE_TYPES as item (item.value)}
        <option value={item.value}>{item.label}</option>
      {/each}
    </select>
  </div>

  <div class="flex flex-col gap-2">
    <Label for="name" class="text-muted-foreground text-xs font-normal">Name</Label>
    <Input
      id="name"
      bind:value={name}
      placeholder={type === 'camera'
        ? 'Living room camera'
        : type === 'matter-gateway'
          ? 'CoreS3 gateway'
          : 'Environmental sensor'}
      required
      class={inputMinimal}
    />
  </div>

  <div class="flex flex-col gap-2">
    <Label for="location" class="text-muted-foreground text-xs font-normal">Location</Label>
    <Input
      id="location"
      bind:value={location}
      placeholder="Living Room"
      required
      class={inputMinimal}
    />
  </div>

  <div class="rounded-sm border border-border bg-muted/20 px-4 py-3">
    <p class="text-[0.65rem] text-muted-foreground uppercase tracking-widest">Telemetry sent</p>
    <p class="mt-1 text-[0.7rem] text-muted-foreground leading-relaxed">
      Example payload reported once the device is online.
    </p>
    <pre
      class="mt-3 overflow-x-auto rounded-sm border border-border bg-background px-3 py-2 font-mono text-[0.7rem] text-foreground leading-relaxed">{telemetryPreview}</pre>
  </div>

  <Button type="submit" class="rounded-sm" disabled={creating || !name.trim() || !location.trim()}>
    {creating ? 'Registering…' : 'Register'}
  </Button>
</form>
