<svelte:head>
  <title>Dashboard — SST Monorepo Starter</title>
  <meta name="description" content="Your dashboard — profile and settings." />
</svelte:head>

<script lang="ts">
import type { User as GraphQLUser } from '@sst-monorepo/graphql';
import { signOut } from 'aws-amplify/auth';
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import { Textarea } from '$lib/components/ui/textarea/index.js';
import { getMyProfile, updateUserProfile } from '$lib/services/graphql';
import { auth, type User } from '$lib/stores/auth';

let authState = $state({ user: null as User | null, isAuthenticated: false });

$effect(() => {
  const unsubscribe = auth.subscribe((state) => {
    authState = { user: state.user, isAuthenticated: state.isAuthenticated };
  });
  return unsubscribe;
});

const user = $derived(authState.user);

const inputMinimal =
  'rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground placeholder:text-muted-foreground';

let profile = $state<GraphQLUser | null>(null);
let loading = $state(true);
let saving = $state(false);
let error = $state('');
let success = $state('');

let name = $state('');
let bio = $state('');

onMount(async () => {
  auth.setLoading(false);
  await loadProfile();
});

async function loadProfile() {
  loading = true;
  error = '';
  try {
    const data = await getMyProfile();
    profile = data;
    name = data?.name || '';
    bio = data?.bio || '';
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to load profile';
  } finally {
    loading = false;
  }
}

async function saveProfile() {
  saving = true;
  error = '';
  success = '';

  try {
    const updated = await updateUserProfile({
      name: name.trim() || undefined,
      bio: bio.trim() || undefined,
    });

    profile = updated;
    success = 'Saved.';

    if (user && updated) {
      auth.setUser({
        id: user.id,
        username: updated.username || user.username,
        email: user.email,
      });
    }

    setTimeout(() => {
      success = '';
    }, 2500);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to update profile';
  } finally {
    saving = false;
  }
}

async function handleLogout() {
  try {
    await signOut({ global: true });
    auth.logout();
    goto('/login');
  } catch (err) {
    console.error('Logout error:', err);
  }
}
</script>

<div class="min-h-dvh bg-background text-foreground">
  <header class="border-border border-b px-6 py-4 md:px-10">
    <div class="mx-auto flex max-w-2xl items-center justify-between gap-4">
      <h1 class="font-display font-semibold text-base tracking-tight md:text-lg">Dashboard</h1>
      <div class="flex items-center gap-4">
        {#if user}
          <span class="hidden text-muted-foreground text-sm sm:inline">{user.username}</span>
        {/if}
        <Button type="button" variant="outline" class="rounded-sm border-border" onclick={handleLogout}>
          Sign out
        </Button>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-2xl px-6 py-10 md:px-10">
    {#if loading}
      <div class="space-y-6">
        <Skeleton class="h-8 w-40 rounded-sm bg-muted" />
        <Skeleton class="h-10 w-full rounded-sm bg-muted" />
        <Skeleton class="h-10 w-full rounded-sm bg-muted" />
        <Skeleton class="h-24 w-full rounded-sm bg-muted" />
      </div>
    {:else if profile}
      <div class="space-y-10">
        <div>
          <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Profile</h2>
          <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
            Update how you appear in the app. Email and username stay tied to your Cognito account.
          </p>
        </div>

        {#if error}
          <p class="text-[0.75rem] text-destructive">{error}</p>
        {/if}
        {#if success}
          <p class="text-[0.75rem] text-muted-foreground">{success}</p>
        {/if}

        <div class="space-y-6">
          <div class="flex flex-col gap-2">
            <Label for="email" class="text-muted-foreground text-xs font-normal">Email</Label>
            <Input id="email" type="email" value={profile.email} disabled class={inputMinimal} />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="username" class="text-muted-foreground text-xs font-normal">Username</Label>
            <Input id="username" type="text" value={profile.username} disabled class={inputMinimal} />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="name" class="text-muted-foreground text-xs font-normal">Display name</Label>
            <Input
              id="name"
              type="text"
              bind:value={name}
              placeholder="Your name"
              class={inputMinimal}
            />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="bio" class="text-muted-foreground text-xs font-normal">Bio</Label>
            <Textarea
              id="bio"
              bind:value={bio}
              placeholder="Short introduction"
              rows={4}
              class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none"
            />
          </div>
        </div>

        <div class="flex flex-wrap gap-3">
          <Button type="button" class="rounded-sm" disabled={saving} onclick={saveProfile}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="outline"
            class="rounded-sm border-border"
            disabled={saving}
            onclick={loadProfile}
          >
            Reset
          </Button>
        </div>

        <div class="border-border border-t pt-8 text-[0.75rem] text-muted-foreground leading-relaxed">
          <p><span class="text-foreground">User ID</span> — {profile.userId}</p>
          <p class="mt-2">
            <span class="text-foreground">Created</span> —
            {new Date(profile.createdAt).toLocaleDateString()}
          </p>
          <p class="mt-2">
            <span class="text-foreground">Updated</span> —
            {new Date(profile.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    {:else}
      <p class="text-muted-foreground text-sm">No profile found.</p>
    {/if}
  </main>
</div>
