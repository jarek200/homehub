<script lang="ts">
import { getDeviceModelUrl } from '$lib/devices';

interface Props {
  model: string;
}

let { model }: Props = $props();

const url = $derived(getDeviceModelUrl(model));
</script>

{#if url}
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="View {model} product details on Aico (opens in new tab)"
    title="View product details on Aico"
    class="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
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
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  </a>
{/if}
