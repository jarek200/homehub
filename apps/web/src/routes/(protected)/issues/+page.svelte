<svelte:head>
  <title>Issues — HomeHub</title>
  <meta name="description" content="Home issues raised from IoT sensor data." />
</svelte:head>

<script lang="ts">
import type { HomeIssue, IssueSeverity, IssueStatus } from '@sst-monorepo/core';
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import ConsoleShell from '$lib/components/console-shell.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import { Label } from '$lib/components/ui/label/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';
import { Textarea } from '$lib/components/ui/textarea/index.js';
import { inputMinimal } from '$lib/devices';
import {
  formatIssueSeverity,
  formatIssueStatus,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
} from '$lib/issues';
import { createIssue, listIssues, updateIssue } from '$lib/services/rest-api';

let issues = $state<HomeIssue[]>([]);
let loading = $state(true);
let error = $state('');
let showCreate = $state(false);
let creating = $state(false);
let updatingId = $state<string | null>(null);

let title = $state('');
let notes = $state('');
let severity = $state<IssueSeverity>('MEDIUM');
let status = $state<IssueStatus>('OPEN');

onMount(() => {
  loadIssues();
});

async function loadIssues() {
  loading = true;
  error = '';
  try {
    issues = await listIssues();
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to list issues';
  } finally {
    loading = false;
  }
}

async function handleCreate() {
  creating = true;
  error = '';
  try {
    const issue = await createIssue({
      title: title.trim(),
      severity,
      status,
      notes: notes.trim() || undefined,
    });
    title = '';
    notes = '';
    severity = 'MEDIUM';
    status = 'OPEN';
    showCreate = false;
    issues = [issue, ...issues];
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to create issue';
  } finally {
    creating = false;
  }
}

async function handleResolve(issue: HomeIssue) {
  updatingId = issue.issueId;
  error = '';
  try {
    const updated = await updateIssue(issue.issueId, { status: 'RESOLVED' });
    issues = issues.map((item) => (item.issueId === updated.issueId ? updated : item));
  } catch (err) {
    console.error(err);
    error = err instanceof Error ? err.message : 'Failed to update issue';
  } finally {
    updatingId = null;
  }
}
</script>

<ConsoleShell>
  {#snippet actions()}
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="rounded-sm border-border"
      aria-label={showCreate ? 'Cancel' : 'Create issue'}
      onclick={() => {
        showCreate = !showCreate;
        error = '';
      }}
    >
      {#if showCreate}
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
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      {:else}
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
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      {/if}
    </Button>
  {/snippet}

  <div class="mb-8 max-w-2xl">
    <h2 class="font-display font-semibold text-lg tracking-tight">Home issues</h2>
    <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">
      Lightweight case tracking inspired by housing IoT workflows. Sensor readings can raise issues
      automatically when humidity exceeds 70%.
    </p>
  </div>

  {#if error}
    <p class="mb-6 text-[0.75rem] text-destructive">{error}</p>
  {/if}

  {#if showCreate}
    <form
      class="mb-10 space-y-6 border-border border-b pb-10"
      onsubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
    >
      <div>
        <h3 class="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Create issue
        </h3>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="title" class="text-muted-foreground text-xs font-normal">Title</Label>
        <Input id="title" bind:value={title} required class={inputMinimal} />
      </div>

      <div class="grid gap-6 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="severity" class="text-muted-foreground text-xs font-normal">Severity</Label>
          <select
            id="severity"
            bind:value={severity}
            class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
          >
            {#each ISSUE_SEVERITIES as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="issue-status" class="text-muted-foreground text-xs font-normal">Status</Label>
          <select
            id="issue-status"
            bind:value={status}
            class="h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm outline-none focus:border-foreground"
          >
            {#each ISSUE_STATUSES as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="notes" class="text-muted-foreground text-xs font-normal">Notes</Label>
        <Textarea
          id="notes"
          bind:value={notes}
          rows={4}
          class="rounded-sm border border-border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <Button type="submit" class="rounded-sm" disabled={creating || !title.trim()}>
        {creating ? 'Creating…' : 'Create issue'}
      </Button>
    </form>
  {/if}

  {#if loading}
    <div class="space-y-4">
      <Skeleton class="h-16 w-full rounded-sm bg-muted" />
      <Skeleton class="h-16 w-full rounded-sm bg-muted" />
    </div>
  {:else if issues.length === 0}
    <p class="text-[0.75rem] text-muted-foreground">
      No issues yet. Record a high-humidity reading on a sensor device or create one manually.
    </p>
  {:else}
    <ul class="divide-y divide-border border-border border-y">
      {#each issues as issue (issue.issueId)}
        <li class="flex flex-wrap items-start justify-between gap-4 px-1 py-5">
          <div class="min-w-0">
            <p class="font-medium text-sm">{issue.title}</p>
            {#if issue.notes}
              <p class="mt-2 text-[0.75rem] text-muted-foreground leading-relaxed">{issue.notes}</p>
            {/if}
            <div class="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" class="rounded-sm font-normal">
                {formatIssueStatus(issue.status)}
              </Badge>
              <Badge variant="outline" class="rounded-sm font-normal">
                {formatIssueSeverity(issue.severity)}
              </Badge>
              {#if issue.deviceId}
                <button
                  type="button"
                  class="text-[0.7rem] text-muted-foreground underline-offset-2 hover:underline"
                  onclick={() => goto(`/devices/${issue.deviceId}`)}
                >
                  View device
                </button>
              {/if}
            </div>
          </div>

          {#if issue.status !== 'RESOLVED'}
            <Button
              type="button"
              variant="outline"
              class="rounded-sm border-border"
              disabled={updatingId === issue.issueId}
              onclick={() => handleResolve(issue)}
            >
              {updatingId === issue.issueId ? 'Resolving…' : 'Resolve'}
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</ConsoleShell>
