<script lang="ts">
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { type DeviceThresholds, THRESHOLD_FIELDS } from '$lib/device-thresholds';
import { normalizeDeviceType } from '$lib/device-type';

interface Props {
  deviceType: string;
  thresholds: DeviceThresholds;
  idPrefix?: string;
  onchange?: (thresholds: DeviceThresholds) => void;
}

let { deviceType, thresholds, idPrefix = '', onchange }: Props = $props();

const fields = $derived.by(() => {
  const normalizedType = normalizeDeviceType(deviceType);
  return THRESHOLD_FIELDS[normalizedType] ?? THRESHOLD_FIELDS[deviceType] ?? [];
});

function updateThreshold(key: keyof DeviceThresholds, rawValue: string) {
  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) return;
  onchange?.({ ...thresholds, [key]: parsed });
}
</script>

{#if fields.length > 0}
  <div class="grid gap-4 sm:grid-cols-2">
    {#each fields as field (field.key)}
      <div class="flex flex-col gap-2">
        <Label for="{idPrefix}threshold-{field.key}" class="text-muted-foreground text-xs font-normal">
          {field.label} ({field.unit})
        </Label>
        <Input
          id="{idPrefix}threshold-{field.key}"
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={thresholds[field.key] ?? ''}
          oninput={(event) => updateThreshold(field.key, event.currentTarget.value)}
          class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
        />
      </div>
    {/each}
  </div>
{:else}
  <p class="text-[0.75rem] text-muted-foreground leading-relaxed">
    No configurable thresholds for this device type.
  </p>
{/if}
