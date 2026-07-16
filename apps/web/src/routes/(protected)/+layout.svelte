<script lang="ts">
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { auth } from '$lib/stores/auth';

const { children } = $props<{ children: import('svelte').Snippet }>();

let checking = $state(true);
let authLoading = $state(true);

$effect(() => {
  const unsubscribe = auth.subscribe((state) => {
    authLoading = state.isLoading;
  });
  return unsubscribe;
});

$effect(() => {
  if (!browser) {
    checking = false;
    return;
  }

  checkAuth();
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

    try {
      const { getMyProfile } = await import('$lib/services/rest-api');
      const profile = await getMyProfile();
      if (profile?.username) {
        username = profile.username;
      }
    } catch {
      // fallback
    }

    auth.setUser({
      id: user.userId,
      username: username,
      email: loginId,
    });

    checking = false;
  } catch (err) {
    console.error('Auth failed:', err);
    goto('/login', { replaceState: true });
  }
}
</script>

{#if checking || authLoading}
  <div class="flex min-h-dvh items-center justify-center bg-background">
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
