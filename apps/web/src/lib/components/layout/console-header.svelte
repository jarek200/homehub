<script lang="ts">
import { signOut } from 'aws-amplify/auth';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { auth } from '$lib/auth.svelte';
import { Button } from '$lib/components/ui/button/index.js';

const isDevices = $derived(page.url.pathname.startsWith('/devices'));
const isPlan = $derived(page.url.pathname.startsWith('/plan'));
const isApiDocs = $derived(page.url.pathname.startsWith('/api-docs'));

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

<header class="border-border border-b px-3 py-3 md:px-10 md:py-4">
  <div class="flex items-center justify-between gap-3">
    <div class="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 md:gap-x-10">
      <button
        type="button"
        class="shrink-0 font-display font-semibold text-base tracking-tight md:text-lg"
        onclick={() => goto('/plan')}
      >
        HomeHub
      </button>
      <nav class="flex flex-wrap items-center gap-x-5 gap-y-1 md:gap-x-8">
        <button
          type="button"
          class="{navLink} {isPlan ? navActive : navInactive}"
          onclick={() => goto('/plan')}
        >
          Plan
        </button>
        <button
          type="button"
          class="{navLink} {isDevices ? navActive : navInactive}"
          onclick={() => goto('/devices')}
        >
          Devices
        </button>
        <a href="/api-docs" class="{navLink} {isApiDocs ? navActive : navInactive}">API docs</a>
      </nav>
    </div>
    <div class="flex shrink-0 items-center gap-4">
      {#if auth.user}
        <span class="hidden text-muted-foreground text-sm sm:inline">{auth.user.username}</span>
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
      {/if}
    </div>
  </div>
</header>
