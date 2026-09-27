<script lang="ts">
import '../app.css';

import type { Snippet } from 'svelte';
import { browser } from '$app/environment';

interface Props {
  children?: Snippet;
}

let { children }: Props = $props();

$effect(() => {
  if (browser) {
    import('$lib/amplify');
  }
});
</script>

{@render children?.()}
