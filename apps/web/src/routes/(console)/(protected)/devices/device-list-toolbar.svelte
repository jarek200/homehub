<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';

interface Props {
  query: string;
  selectedCount: number;
  bulkDeleting: boolean;
  showCreate: boolean;
  onBulkDelete: () => void;
  onToggleCreate: () => void;
}

let {
  query = $bindable(),
  selectedCount,
  bulkDeleting,
  showCreate,
  onBulkDelete,
  onToggleCreate,
}: Props = $props();
</script>

<div class="flex w-full min-w-0 items-center gap-3">
  <div class="relative min-w-0 flex-1">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <Input
      id="device-search"
      type="search"
      bind:value={query}
      placeholder="Filter devices…"
      aria-label="Filter devices"
      class="rounded-none border-x-0 border-t-0 border-b border-border bg-transparent py-2 pr-0 pl-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground"
    />
  </div>
  {#if selectedCount > 0}
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="shrink-0 rounded-sm border-border text-destructive hover:text-destructive"
      aria-label="Delete {selectedCount} selected device{selectedCount === 1 ? '' : 's'}"
      disabled={bulkDeleting}
      onclick={onBulkDelete}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </Button>
  {/if}
  <Button
    type="button"
    variant="outline"
    size="icon"
    class="shrink-0 rounded-sm border-border"
    aria-label={showCreate ? 'Cancel' : 'Register device'}
    onclick={onToggleCreate}
  >
    {#if showCreate}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    {:else}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
        aria-hidden="true"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    {/if}
  </Button>
</div>
