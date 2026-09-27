<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
  children?: Snippet;
  actions?: Snippet;
  dense?: boolean;
}

let { children, actions, dense = false }: Props = $props();
</script>

<main class="w-full {dense ? 'px-3 py-3 md:px-10 md:py-6' : 'px-4 py-5 md:px-10 md:py-10'}">
  {#if actions}
    <div
      class="flex w-full flex-wrap items-center justify-start gap-2 {dense
        ? 'mb-3'
        : 'mb-4 md:mb-8'}"
    >
      {@render actions()}
    </div>
  {/if}
  {@render children?.()}
</main>
