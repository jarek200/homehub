<svelte:head>
  <title>Join household — HomeHub</title>
</svelte:head>

<script lang="ts">
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { Button } from '$lib/components/ui/button/index.js';
import {
  clearInviteToken,
  loginRedirectForInvite,
  persistInviteToken,
  readInviteToken,
} from '$lib/household';
import { RestApiError } from '$lib/services/rest';
import { acceptHouseholdInvite } from '$lib/services/rest-api';

let token = $state('');
let status = $state<'loading' | 'ready' | 'accepting' | 'error'>('loading');
let error = $state('');

$effect(() => {
  if (!browser) return;
  const next = readInviteToken($page.url.searchParams);
  if (!next) {
    status = 'error';
    error = 'This invitation link is missing a token.';
    return;
  }
  token = next;
  persistInviteToken(next);
  void acceptIfSignedIn();
});

async function acceptIfSignedIn() {
  try {
    await import('$lib/amplify');
    const session = await fetchAuthSession();
    if (!session.tokens?.idToken) {
      status = 'ready';
      return;
    }
    await acceptInvite();
  } catch {
    status = 'ready';
  }
}

async function acceptInvite() {
  status = 'accepting';
  error = '';
  try {
    await getCurrentUser();
    const household = await acceptHouseholdInvite(token);
    clearInviteToken();
    if (household.tokenRefreshRequired) {
      await fetchAuthSession({ forceRefresh: true });
    }
    goto('/plan', { replaceState: true });
  } catch (err) {
    if (err instanceof RestApiError && err.status === 401) {
      goto(loginRedirectForInvite(token), { replaceState: true });
      return;
    }
    status = 'error';
    error = err instanceof Error ? err.message : 'This invitation could not be accepted.';
  }
}
</script>

<main class="flex min-h-dvh flex-col items-center justify-center px-6 py-16 md:px-10">
  <div class="flex w-full max-w-sm flex-col gap-5">
    <p class="font-display font-semibold text-base tracking-tight">HomeHub</p>
    <h1 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
      Household invitation
    </h1>
    {#if status === 'loading' || status === 'accepting'}
      <p class="text-muted-foreground text-sm">Joining the household…</p>
    {:else if status === 'error'}
      <p class="text-[0.75rem] text-destructive">{error}</p>
      <Button class="rounded-sm" onclick={() => goto('/login')}>Sign in</Button>
    {:else}
      <p class="text-muted-foreground text-sm leading-relaxed">
        Sign in with the invited email to join this household. The account has to exist in Cognito already.
      </p>
      <Button class="rounded-sm" onclick={() => goto(loginRedirectForInvite(token))}>
        Continue
      </Button>
    {/if}
  </div>
</main>
