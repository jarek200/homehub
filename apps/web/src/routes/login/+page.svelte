<svelte:head>
  <title>Sign in — HomeHub</title>
  <meta name="description" content="Sign in to HomeHub. Authentication powered by AWS Cognito." />
</svelte:head>

<script lang="ts">
import { confirmSignIn, fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { onMount, tick } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { auth } from '$lib/auth.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { getMyProfile } from '$lib/services/rest-api';
import { cognitoAuthError } from './auth-errors';

let email = $state('');
let password = $state('');
let totpCode = $state('');
let needsTotp = $state(false);
let loading = $state(false);
let error = $state('');

const inputMinimal =
  'rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground';

const redirectTarget = $derived(page.url.searchParams.get('redirect') || '/plan');

onMount(() => {
  const destination = redirectTarget;
  void (async () => {
    try {
      await import('$lib/amplify');
      const user = await getCurrentUser();
      const session = await fetchAuthSession();
      if (user && session.tokens) {
        goto(destination, { replaceState: true });
      }
    } catch {
      // Not logged in
    }
  })();
});

async function finishSignIn() {
  const user = await getCurrentUser();
  let username = email?.split('@')[0] || user.userId;

  try {
    const profile = await getMyProfile();
    if (profile?.username) username = profile.username;
  } catch {
    // fallback
  }

  auth.setUser(
    {
      id: user.userId,
      username,
      email,
    },
    true
  );

  await tick();
  goto(redirectTarget, { replaceState: true });
}

async function handleSubmit() {
  loading = true;
  error = '';

  try {
    if (needsTotp) {
      const confirmed = await confirmSignIn({ challengeResponse: totpCode });
      if (confirmed.isSignedIn) await finishSignIn();
      return;
    }

    try {
      await signOut({ global: true });
    } catch {
      // Ignore
    }

    const result = await signIn({ username: email, password });
    if (result.isSignedIn) {
      await finishSignIn();
      return;
    }
    if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      needsTotp = true;
      return;
    }
    error = 'Sign-in needs another step that this page does not handle';
  } catch (err: unknown) {
    console.error('Auth error:', err);
    error = cognitoAuthError(err);
  } finally {
    loading = false;
  }
}
</script>

<main class="flex min-h-dvh flex-col items-center justify-center px-6 py-16 md:px-10">
  <form
    class="flex w-full max-w-xs flex-col gap-5"
    onsubmit={(event) => {
      event.preventDefault();
      handleSubmit();
    }}
  >
    <div>
      <p class="font-display font-semibold text-base tracking-tight">HomeHub</p>
    </div>

    <h1 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Sign in</h1>
    <div class="flex flex-col gap-2">
      <Label for="email" class="text-muted-foreground text-xs font-normal">Email</Label>
      <Input
        id="email"
        type="email"
        name="email"
        autocomplete="username"
        placeholder="you@company.com"
        bind:value={email}
        required
        class={inputMinimal}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="password" class="text-muted-foreground text-xs font-normal">Password</Label>
      <Input
        id="password"
        type="password"
        name="password"
        autocomplete="current-password"
        placeholder="••••••••"
        bind:value={password}
        required
        disabled={needsTotp}
        class={inputMinimal}
      />
    </div>
    {#if needsTotp}
      <div class="flex flex-col gap-2">
        <Label for="totp" class="text-muted-foreground text-xs font-normal">Authenticator code</Label>
        <Input
          id="totp"
          type="text"
          name="totp"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="123456"
          bind:value={totpCode}
          required
          class={inputMinimal}
        />
      </div>
    {/if}

    {#if error}
      <p class="text-[0.75rem] text-destructive">{error}</p>
    {/if}

    <Button type="submit" disabled={loading} class="mt-1 w-full rounded-sm">
      {loading ? 'Please wait…' : 'Continue'}
    </Button>

    <a
      href="/api-docs"
      class="text-center text-muted-foreground text-xs uppercase tracking-widest hover:text-foreground"
    >
      API docs
    </a>
  </form>
</main>
