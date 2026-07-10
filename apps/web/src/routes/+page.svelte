<svelte:head>
  <title>SST Monorepo Starter</title>
  <meta
    name="description"
    content="Starter template: SvelteKit, AWS AppSync, Cognito, and DynamoDB."
  />
</svelte:head>

<script lang="ts">
import { goto } from '$app/navigation';
import { Button } from '$lib/components/ui/button/index.js';
</script>

<main class="flex min-h-dvh flex-col px-6 py-16 md:px-10 md:py-20">
  <div class="flex flex-1 flex-col justify-center">
    <p class="font-medium text-muted-foreground text-xs uppercase tracking-widest">Starter</p>
    <h1
      class="mt-6 max-w-xl font-semibold font-display text-[clamp(2rem,6vw,3.25rem)] text-foreground leading-[1.1] tracking-tight"
    >
      Ship full-stack apps on AWS.
    </h1>
    <p class="mt-6 max-w-md text-[0.9375rem] text-muted-foreground leading-relaxed">
      SvelteKit frontend, Cognito auth, AppSync GraphQL, and DynamoDB — wired for local dev and
      multi-stage deploys.
    </p>
    <div class="mt-10 flex flex-wrap gap-3">
      <Button class="rounded-sm px-6" onclick={() => goto('/login')}>Sign in</Button>
      <Button variant="outline" class="rounded-sm border-border px-6" onclick={() => goto('/login')}>
        Create account
      </Button>
    </div>
  </div>
  <footer class="mt-16 border-border border-t pt-8 text-[0.7rem] text-muted-foreground">
    SST monorepo starter — minimal UI, same tokens as production auth screens.
  </footer>
</main>
