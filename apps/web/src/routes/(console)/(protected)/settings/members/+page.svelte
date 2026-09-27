<svelte:head>
  <title>Members — HomeHub</title>
  <meta name="description" content="Invite another person to this HomeHub household." />
</svelte:head>

<script lang="ts">
import { auth } from '$lib/auth.svelte';
import ConsoleShell from '$lib/components/layout/console-shell.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { RestApiError } from '$lib/services/rest';
import {
  cancelHouseholdInvite,
  createHouseholdInvite,
  getHousehold,
  type Household,
  removeHouseholdMember,
  resendHouseholdInvite,
} from '$lib/services/rest-api';

let household = $state<Household | null>(null);
let email = $state('');
let loading = $state(true);
let saving = $state(false);
let error = $state('');
let notice = $state('');

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

$effect(() => {
  void load();
});

async function invite() {
  saving = true;
  error = '';
  notice = '';
  try {
    const invite = await createHouseholdInvite(email);
    email = '';
    household = await getHousehold();
    notice = invite.emailSent
      ? `Invitation sent to ${invite.email}.`
      : invite.emailError || `Invitation created for ${invite.email}, but email was not delivered.`;
  } catch (err) {
    error = err instanceof RestApiError ? err.message : 'Could not send the invitation.';
  } finally {
    saving = false;
  }
}

async function resend(inviteId: string) {
  error = '';
  notice = '';
  try {
    const invite = await resendHouseholdInvite(inviteId);
    household = await getHousehold();
    notice = invite.emailSent
      ? `Invitation resent to ${invite.email}.`
      : invite.emailError || 'Invitation refreshed, but email was not delivered.';
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not resend the invitation.';
  }
}

async function cancel(inviteId: string) {
  error = '';
  try {
    await cancelHouseholdInvite(inviteId);
    household = await getHousehold();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not cancel the invitation.';
  }
}

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
        Everyone here sees the same devices, floor plan, and live updates. Only the owner can invite
        or remove people.
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
              <Button variant="outline" size="sm" class="rounded-sm" onclick={() => remove(member.userId)}>
                Remove
              </Button>
            {/if}
          </div>
        {/each}
      </section>

      {#if household.invites.length}
        <section class="flex flex-col gap-3">
          <h2 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
            Pending invitations
          </h2>
          {#each household.invites as invite (invite.inviteId)}
            <div class="flex items-center justify-between gap-4 border-border border-b py-3">
              <div>
                <p class="text-sm">{invite.email}</p>
                <p class="text-muted-foreground text-xs">{invite.status}</p>
              </div>
              {#if isOwner}
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" class="rounded-sm" onclick={() => resend(invite.inviteId)}>
                    Resend
                  </Button>
                  <Button variant="outline" size="sm" class="rounded-sm" onclick={() => cancel(invite.inviteId)}>
                    Cancel
                  </Button>
                </div>
              {/if}
            </div>
          {/each}
        </section>
      {/if}

      {#if isOwner}
        <form
          class="flex flex-col gap-4"
          onsubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
          <div class="flex flex-col gap-2">
            <Label for="invite-email" class="text-muted-foreground text-xs font-normal">
              Invite email
            </Label>
            <Input
              id="invite-email"
              type="email"
              bind:value={email}
              required
              placeholder="alex@example.com"
              class="rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <Button type="submit" disabled={saving} class="w-fit rounded-sm">
            {saving ? 'Sending…' : 'Send invitation'}
          </Button>
        </form>
      {:else}
        <p class="text-muted-foreground text-sm">
          Signed in as {auth.user?.email || 'member'}. Ask the owner if you need to invite someone else.
        </p>
      {/if}
    {/if}

    {#if notice}
      <p class="text-sm">{notice}</p>
    {/if}
    {#if error}
      <p class="text-destructive text-sm">{error}</p>
    {/if}
  </div>
</ConsoleShell>
