<svelte:head>
  <title>API docs — HomeHub</title>
  <meta
    name="description"
    content="Interactive OpenAPI docs for the HomeHub IoT device management API."
  />
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@5.27.1/swagger-ui.css"
    crossorigin="anonymous"
  />
</svelte:head>

<script lang="ts">
import { fetchAuthSession } from 'aws-amplify/auth';
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { getRestApiBaseUrl } from '$lib/services/rest';

let host = $state<HTMLDivElement | undefined>();
let error = $state('');
let loading = $state(true);
let apiBase = $state('');
let authStatus = $state<'loading' | 'bearer' | 'apiKey' | 'none'>('loading');

type AuthPayload = {
  bearer?: string;
  apiKey?: string;
};

type SwaggerAuthActions = {
  authorize: (payload: Record<string, unknown>) => void;
};

type SwaggerUIInstance = {
  getSystem?: () => { authActions?: SwaggerAuthActions };
  authActions?: SwaggerAuthActions;
  preauthorizeApiKey?: (key: string, value: string) => void;
};

type SwaggerUIBundleFn = (options: Record<string, unknown>) => SwaggerUIInstance;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

function getEnvApiKey(): string | undefined {
  if (typeof window !== 'undefined') {
    const win = window as Window & { ENV?: Record<string, string> };
    const fromWindow = win.ENV?.VITE_REST_API_KEY?.trim();
    if (fromWindow) return fromWindow;
  }
  const fromVite = import.meta.env.VITE_REST_API_KEY?.trim();
  return fromVite || undefined;
}

async function resolveAuth(): Promise<AuthPayload> {
  try {
    await import('$lib/amplify');
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      return { bearer: token };
    }
  } catch {
    // not signed in
  }

  const apiKey = getEnvApiKey();
  if (apiKey) {
    return { apiKey };
  }

  return {};
}

function applySwaggerAuth(ui: SwaggerUIInstance, auth: AuthPayload) {
  const authorize = ui.authActions?.authorize ?? ui.getSystem?.()?.authActions?.authorize;

  if (auth.bearer) {
    authorize?.({
      BearerAuth: {
        name: 'BearerAuth',
        schema: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        value: auth.bearer,
      },
    });
    return;
  }

  if (auth.apiKey) {
    if (ui.preauthorizeApiKey) {
      ui.preauthorizeApiKey('ApiKeyAuth', auth.apiKey);
      return;
    }
    authorize?.({
      ApiKeyAuth: {
        name: 'ApiKeyAuth',
        schema: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        value: auth.apiKey,
      },
    });
  }
}

onMount(() => {
  if (!browser) return;

  let cancelled = false;

  const waitForHost = async () => {
    for (let i = 0; i < 20 && !host; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (cancelled || !host) {
      error = 'Failed to mount docs panel';
      loading = false;
      authStatus = 'none';
      return;
    }

    try {
      const base = getRestApiBaseUrl();
      apiBase = base;

      const auth = await resolveAuth();
      if (cancelled) return;
      authStatus = auth.bearer ? 'bearer' : auth.apiKey ? 'apiKey' : 'none';

      await loadScript('https://unpkg.com/swagger-ui-dist@5.27.1/swagger-ui-bundle.js');
      if (cancelled || !host) return;

      const SwaggerUIBundle = (window as Window & { SwaggerUIBundle?: SwaggerUIBundleFn })
        .SwaggerUIBundle;
      if (!SwaggerUIBundle) {
        throw new Error('Swagger UI failed to initialize');
      }

      const ui = SwaggerUIBundle({
        url: `${base}/openapi.json`,
        domNode: host,
        deepLinking: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        requestInterceptor: (request: { headers?: Record<string, string> }) => {
          const headers = request.headers ?? {};
          if (auth.bearer) {
            headers.Authorization = `Bearer ${auth.bearer}`;
          } else if (auth.apiKey) {
            headers['X-Api-Key'] = auth.apiKey;
          }
          request.headers = headers;
          return request;
        },
        onComplete: () => {
          applySwaggerAuth(ui, auth);
        },
      });

      // Some Swagger builds fire auth before onComplete is reliable.
      applySwaggerAuth(ui, auth);
      loading = false;
    } catch (err) {
      if (cancelled) return;
      error = err instanceof Error ? err.message : 'Failed to load API docs';
      loading = false;
      authStatus = 'none';
    }
  };

  void waitForHost();

  return () => {
    cancelled = true;
  };
});
</script>

<div class="min-h-dvh bg-background text-foreground">
  <header class="border-border border-b px-6 py-4 md:px-10">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-8 md:gap-10">
        <a href="/devices" class="font-display font-semibold text-base tracking-tight md:text-lg">
          HomeHub
        </a>
        <nav class="flex items-center gap-6 md:gap-8 text-xs uppercase tracking-widest">
          <a href="/devices" class="text-muted-foreground hover:text-foreground">Devices</a>
          <span class="text-foreground">API docs</span>
        </nav>
      </div>
    </div>
  </header>

  <div class="border-border border-b bg-secondary/40 px-6 py-3 md:px-10">
    <p class="text-muted-foreground text-sm">
      {#if authStatus === 'bearer'}
        Auto-authorized with your Cognito session. Expand an endpoint and
        <span class="text-foreground">Try it out</span>.
      {:else if authStatus === 'apiKey'}
        Auto-authorized with the configured API key. Expand an endpoint and
        <span class="text-foreground">Try it out</span>.
      {:else if authStatus === 'loading'}
        Resolving authorization…
      {:else}
        Not signed in and no API key configured. Use
        <span class="text-foreground">Authorize</span> manually, or
        <a href="/login" class="text-foreground underline underline-offset-2">sign in</a>
        first for automatic Bearer auth.
      {/if}
    </p>
  </div>

  <main class="api-docs-swagger bg-white text-black">
    {#if loading}
      <div class="flex min-h-[40vh] items-center justify-center bg-background text-muted-foreground text-sm">
        Loading OpenAPI…
      </div>
    {/if}
    {#if error}
      <div class="px-6 py-10 md:px-10">
        <p class="text-destructive text-sm">{error}</p>
        <p class="mt-2 text-muted-foreground text-sm">
          Confirm <code>VITE_REST_API_URL</code> is set (SST prints <code>restApiUrl</code>).
        </p>
      </div>
    {/if}
    <div bind:this={host} class={loading || error ? 'hidden' : ''}></div>
  </main>
</div>

<style>
  :global(.api-docs-swagger .swagger-ui) {
    max-width: 80rem;
    margin: 0 auto;
    padding: 1rem 1.5rem 3rem;
  }

  :global(.api-docs-swagger .swagger-ui .topbar) {
    display: none;
  }
</style>
