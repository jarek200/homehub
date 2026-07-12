<svelte:head>
  <title>Sign in — HomeHub</title>
  <meta
    name="description"
    content="Sign in or create a HomeHub account. Authentication powered by AWS Cognito."
  />
</svelte:head>

<script lang="ts">
import {
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';
import { tick } from 'svelte';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { page as pageStore } from '$app/stores';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { getMyProfile } from '$lib/services/profile';
import { auth } from '$lib/stores/auth';

let email = $state('');
let password = $state('');
let confirmPassword = $state('');
let confirmationCode = $state('');
let loading = $state(false);
let error = $state('');
let isLogin = $state(true);
let needsConfirmation = $state(false);

const inputMinimal =
  'rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground';

$effect(() => {
  if (!browser) return;

  (async () => {
    try {
      await import('$lib/amplify');
      const user = await getCurrentUser();
      const session = await fetchAuthSession();

      if (user && session.tokens) {
        const redirect = $pageStore.url.searchParams.get('redirect') || '/devices';
        goto(redirect, { replaceState: true });
      }
    } catch {
      // Not logged in
    }
  })();
});

async function handleSubmit() {
  loading = true;
  error = '';

  try {
    if (needsConfirmation) {
      await confirmSignUp({
        username: email,
        confirmationCode: confirmationCode,
      });

      try {
        const { isSignedIn } = await signIn({
          username: email,
          password: password,
        });

        if (isSignedIn) {
          const user = await getCurrentUser();
          let username = email?.split('@')[0] || user.userId;

          try {
            const profile = await getMyProfile();
            if (profile?.username) {
              username = profile.username;
            }
          } catch {
            // fallback
          }

          auth.setUser(
            {
              id: user.userId,
              username: username,
              email: email,
            },
            true
          );

          await tick();
          const redirect = $pageStore.url.searchParams.get('redirect') || '/devices';
          goto(redirect, { replaceState: true });
          return;
        }
      } catch {
        console.log('Auto sign-in after confirmation failed');
      }

      needsConfirmation = false;
      isLogin = true;
      confirmationCode = '';
      error = 'Email verified! Please sign in.';
    } else if (isLogin) {
      try {
        await signOut({ global: true });
      } catch {
        // Ignore
      }

      const { isSignedIn } = await signIn({
        username: email,
        password: password,
      });

      if (isSignedIn) {
        const user = await getCurrentUser();
        let username = email?.split('@')[0] || user.userId;

        try {
          const profile = await getMyProfile();
          if (profile?.username) {
            username = profile.username;
          }
        } catch {
          // fallback
        }

        auth.setUser(
          {
            id: user.userId,
            username: username,
            email: email,
          },
          true
        );

        await tick();
        const redirect = $pageStore.url.searchParams.get('redirect') || '/devices';
        goto(redirect, { replaceState: true });
      }
    } else {
      if (password !== confirmPassword) {
        error = 'Passwords do not match';
        loading = false;
        return;
      }

      if (password.length < 8) {
        error = 'Password must be at least 8 characters';
        loading = false;
        return;
      }

      const { nextStep } = await signUp({
        username: email,
        password: password,
        options: {
          userAttributes: {
            email: email,
          },
          autoSignIn: {
            enabled: true,
          },
        },
      });

      if (nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
        needsConfirmation = true;
      } else if (nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
        try {
          const user = await getCurrentUser();
          let username = email?.split('@')[0] || user.userId;

          try {
            const profile = await getMyProfile();
            if (profile?.username) {
              username = profile.username;
            }
          } catch {
            // fallback
          }

          auth.setUser(
            {
              id: user.userId,
              username: username,
              email: email,
            },
            true
          );

          await tick();
          const redirect = $pageStore.url.searchParams.get('redirect') || '/devices';
          goto(redirect, { replaceState: true });
        } catch {
          isLogin = true;
          error = 'Account created! Please sign in.';
        }
      } else {
        isLogin = true;
      }
    }
  } catch (err: unknown) {
    console.error('Auth error:', err);

    const authError = err as { name?: string; message?: string };

    if (authError.name === 'NotAuthorizedException') {
      if (authError.message?.includes('CONFIRMED')) {
        error = 'Account already confirmed. Please sign in.';
        needsConfirmation = false;
        isLogin = true;
      } else {
        error = 'Incorrect email or password';
      }
    } else if (authError.name === 'UserNotFoundException') {
      error = 'User not found';
    } else if (authError.name === 'UsernameExistsException') {
      error = 'An account with this email already exists. Please sign in instead.';
      isLogin = true;
    } else if (authError.name === 'InvalidPasswordException') {
      error = 'Password does not meet requirements';
    } else if (authError.name === 'CodeMismatchException') {
      error = 'Invalid verification code';
    } else if (authError.name === 'AliasExistsException') {
      error = 'An account with this email already exists. Please sign in instead.';
      isLogin = true;
    } else {
      error = authError.message || (isLogin ? 'Login failed' : 'Signup failed');
    }
  } finally {
    loading = false;
  }
}

function toggleMode() {
  isLogin = !isLogin;
  error = '';
  needsConfirmation = false;
}
</script>

<main class="flex min-h-dvh flex-col items-center justify-center px-6 py-16 md:px-10">
  <form
    class="flex w-full max-w-xs flex-col gap-5"
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
  >
    <div>
      <p class="font-display font-semibold text-base tracking-tight">HomeHub</p>
    </div>

    {#if needsConfirmation}
      <h1 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Verify email</h1>
      <p class="text-[0.75rem] text-muted-foreground leading-relaxed">
        Enter the code sent to your email.
      </p>
      <div class="flex flex-col gap-2">
        <Label for="code" class="text-muted-foreground text-xs font-normal">Code</Label>
        <Input
          id="code"
          type="text"
          bind:value={confirmationCode}
          placeholder="6-digit code"
          required
          class={inputMinimal}
        />
      </div>
    {:else if isLogin}
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
          class={inputMinimal}
        />
      </div>
    {:else}
      <h1 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Create account</h1>
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
          autocomplete="new-password"
          placeholder="••••••••"
          bind:value={password}
          required
          class={inputMinimal}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="confirmPassword" class="text-muted-foreground text-xs font-normal">
          Confirm password
        </Label>
        <Input
          id="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="••••••••"
          bind:value={confirmPassword}
          required
          class={inputMinimal}
        />
      </div>
    {/if}

    {#if error}
      <p class="text-[0.75rem] text-destructive">{error}</p>
    {/if}

    <Button type="submit" disabled={loading} class="mt-1 w-full rounded-sm">
      {#if needsConfirmation}
        {loading ? 'Please wait…' : 'Verify'}
      {:else if isLogin}
        {loading ? 'Please wait…' : 'Continue'}
      {:else}
        {loading ? 'Please wait…' : 'Create account'}
      {/if}
    </Button>

    {#if !needsConfirmation}
      <button
        type="button"
        class="text-center text-muted-foreground text-xs underline decoration-muted-foreground/60 underline-offset-4 hover:text-foreground"
        onclick={toggleMode}
      >
        {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    {/if}
  </form>
</main>
