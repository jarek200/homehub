<svelte:head>
  <title>Members — HomeHub</title>
  <meta name="description" content="People who can use this HomeHub household." />
</svelte:head>

<script lang="ts">
import { onMount } from 'svelte';
import ConsoleShell from '$lib/components/layout/console-shell.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { getHousehold, type Household, removeHouseholdMember } from '$lib/services/rest-api';

let household = $state<Household | null>(null);
let loading = $state(true);
let error = $state('');

const isOwner = $derived(household?.role === 'OWNER');

async function load() {
  loading = true;
  error = '';
  try {
    household = await getHousehold();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load household members.';
  } finally {
    loading = false;
  }
}

onMount(() => {
  void load();
});

async function remove(userId: string) {
  error = '';
  try {
    household = await removeHouseholdMember(userId);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not remove that member.';
  }
}
</script>

<ConsoleShell dense>
  <div class="mx-auto flex w-full max-w-xl flex-col gap-8">
    <div>
      <p class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Household</p>
      <h1 class="mt-2 font-display font-semibold text-2xl tracking-tight">Members</h1>
      <p class="mt-2 text-muted-foreground text-sm leading-relaxed">
        Everyone here sees the same devices, floor plan, and live updates. People are added in
        Cognito and appear after they sign in.
      </p>
    </div>

    {#if loading}
      <p class="text-muted-foreground text-sm">Loading members…</p>
    {:else if household}
      <section class="flex flex-col gap-3">
        {#each household.members as member (member.userId)}
          <div class="flex items-center justify-between gap-4 border-border border-b py-3">
            <div>
              <p class="text-sm">{member.email || member.userId}</p>
              <p class="text-muted-foreground text-xs uppercase tracking-widest">{member.role}</p>
            </div>
            {#if isOwner && member.role !== 'OWNER'}
              <Button
                variant="outline"
                size="sm"
                class="rounded-sm"
                onclick={() => remove(member.userId)}
              >
                Remove
              </Button>
            {/if}
          </div>
        {:else}
          <p class="text-muted-foreground text-sm">
            People added in Cognito show up here after they sign in.
          </p>
        {/each}
      </section>
    {/if}

    {#if error}
      <p class="text-destructive text-sm">{error}</p>
    {/if}
  </div>
</ConsoleShell>
