<script lang="ts">
import type { Snippet } from 'svelte';
import ConsoleHeader from '$lib/components/layout/console-header.svelte';

interface Props {
  children?: Snippet;
}

let { children }: Props = $props();
</script>

<div class="flex min-h-dvh flex-col bg-background text-foreground">
  <ConsoleHeader />
  {@render children?.()}
</div>
