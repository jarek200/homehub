<script lang="ts">
import type { Cores3Product } from '@homehub/core';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { inputMinimal } from '$lib/devices/devices';

interface Props {
  products: Cores3Product[];
  productId: string;
  matterName: string;
  matterLocation: string;
  matterCode: string;
  suggestedMatterName: string;
  createdMatterHint: string;
  addingMatter: boolean;
  onSubmit: () => void;
}

let {
  products,
  productId = $bindable(),
  matterName = $bindable(),
  matterLocation = $bindable(),
  matterCode = $bindable(),
  suggestedMatterName,
  createdMatterHint,
  addingMatter,
  onSubmit,
}: Props = $props();
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
      Add Matter product
    </h2>
    <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
      Select a known IKEA product, enter its Matter number, then Pair. The device appears on this
      list only after the CoreS3 succeeds. Keep it advertising and close to the gateway.
    </p>
  </div>

  <div class="flex flex-col gap-2">
    <Label for="matter-product" class="text-muted-foreground text-xs font-normal">Product</Label>
    <select
      id="matter-product"
      bind:value={productId}
      class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
    >
      {#each products as product (product.productId)}
        <option value={product.productId}>{product.label}</option>
      {/each}
    </select>
  </div>

  <div class="flex flex-col gap-2">
    <Label for="matter-name" class="text-muted-foreground text-xs font-normal">Name</Label>
    <Input
      id="matter-name"
      bind:value={matterName}
      placeholder={suggestedMatterName || 'KAJPLATS 2'}
      class={inputMinimal}
    />
  </div>

  <div class="flex flex-col gap-2">
    <Label for="matter-location" class="text-muted-foreground text-xs font-normal">Location</Label>
    <Input
      id="matter-location"
      bind:value={matterLocation}
      placeholder="Home"
      class={inputMinimal}
    />
  </div>

  <div class="flex flex-col gap-2">
    <Label for="matter-code" class="text-muted-foreground text-xs font-normal">Matter number</Label>
    <Input
      id="matter-code"
      bind:value={matterCode}
      placeholder="11-digit code"
      autocomplete="off"
      inputmode="numeric"
      class={inputMinimal}
    />
  </div>

  {#if createdMatterHint}
    <p class="text-[0.75rem] text-muted-foreground leading-relaxed">{createdMatterHint}</p>
  {/if}

  <Button
    type="submit"
    class="rounded-sm"
    disabled={addingMatter || products.length === 0 || !matterCode.trim()}
  >
    {addingMatter ? 'Pairing…' : 'Pair'}
  </Button>
</form>
