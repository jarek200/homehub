<script lang="ts">
import { signOut } from 'aws-amplify/auth';
import type { Snippet } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { Button } from '$lib/components/ui/button/index.js';
import { auth, type User } from '$lib/stores/auth';

interface Props {
  children?: Snippet;
  actions?: Snippet;
}

let { children, actions }: Props = $props();

let authState = $state({ user: null as User | null, isAuthenticated: false });

$effect(() => {
  const unsubscribe = auth.subscribe((state) => {
    authState = { user: state.user, isAuthenticated: state.isAuthenticated };
  });
  return unsubscribe;
});

const user = $derived(authState.user);
const isDevices = $derived($page.url.pathname.startsWith('/devices'));

const navLink = 'text-xs uppercase tracking-widest transition-colors';
const navActive = 'text-foreground';
const navInactive = 'text-muted-foreground hover:text-foreground';

async function handleLogout() {
  try {
    await signOut();
    auth.logout();
  } catch (err) {
    console.error('Logout error:', err);
  }
}
</script>

<div class="min-h-dvh bg-background text-foreground">
  <header class="border-border border-b px-6 py-4 md:px-10">
    <div class="flex items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-8 md:gap-10">
        <button
          type="button"
          class="shrink-0 font-display font-semibold text-base tracking-tight md:text-lg"
          onclick={() => goto('/devices')}
        >
          HomeHub
        </button>
        <nav class="flex items-center gap-6 md:gap-8">
          <button
            type="button"
            class="{navLink} {isDevices ? navActive : navInactive}"
            onclick={() => goto('/devices')}
          >
            Devices
          </button>
        </nav>
      </div>
      <div class="flex shrink-0 items-center gap-4">
        {#if user}
          <span class="hidden text-muted-foreground text-sm sm:inline">{user.username}</span>
        {/if}
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="rounded-sm border-border"
          aria-label="Sign out"
          onclick={handleLogout}
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
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </Button>
      </div>
    </div>
  </header>

  <main class="w-full px-6 py-10 md:px-10">
    {#if actions}
      <div class="mb-8 flex w-full flex-wrap items-center justify-end gap-2">
        {@render actions()}
      </div>
    {/if}
    {@render children?.()}
  </main>
</div>
