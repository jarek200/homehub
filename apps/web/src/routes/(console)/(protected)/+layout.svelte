<script lang="ts">
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { auth } from '$lib/auth.svelte';
import { bootstrapHousehold, getMyProfile } from '$lib/services/rest-api';

const { children } = $props<{ children: import('svelte').Snippet }>();

let checking = $state(true);
const authLoading = $derived(auth.isLoading);

onMount(() => {
  void checkAuth();
});

async function checkAuth() {
  if (!browser) return;

  try {
    await import('$lib/amplify');
    const session = await fetchAuthSession();

    if (!session.tokens?.idToken) {
      goto('/login', { replaceState: true });
      return;
    }

    const user = await getCurrentUser();
    const loginId = user.signInDetails?.loginId ?? '';
    let username = loginId.includes('@') ? loginId.split('@')[0] : user.username || user.userId;
    let householdId: string | null = null;
    let role: 'OWNER' | 'MEMBER' | null = null;

    try {
      const household = await bootstrapHousehold();
      householdId = household.householdId;
      role = household.role;
      if (household.tokenRefreshRequired) {
        await fetchAuthSession({ forceRefresh: true });
      }
    } catch {
      const profile = await getMyProfile().catch(() => null);
      householdId = profile?.householdId ?? null;
      role = profile?.role ?? null;
    }

    try {
      const profile = await getMyProfile();
      if (profile?.username) {
        username = profile.username;
      }
      householdId = profile?.householdId ?? householdId;
      role = profile?.role ?? role;
    } catch {
      // fallback
    }

    auth.setUser({
      id: user.userId,
      username: username,
      email: loginId,
      householdId,
      role,
    });

    checking = false;
  } catch (err) {
    console.error('Auth failed:', err);
    goto('/login', { replaceState: true });
  }
}
</script>

<div class="flex flex-1 flex-col">
  {#if checking || authLoading}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <div
          class="mx-auto mb-4 size-8 animate-spin border-2 border-muted-foreground border-t-foreground"
          aria-hidden="true"
        ></div>
        <p class="text-muted-foreground text-sm">
          {authLoading ? 'Loading…' : 'Verifying session…'}
        </p>
      </div>
    </div>
  {:else}
    {@render children()}
  {/if}
</div>
