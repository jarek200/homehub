import { Amplify } from 'aws-amplify';

// Track initialization state
let amplifyInitPromise: Promise<void> | null = null;
let isConfigured = false;

// Export function to ensure Amplify is initialized
export async function ensureAmplifyConfigured(): Promise<void> {
  if (isConfigured) return;

  if (amplifyInitPromise) return amplifyInitPromise;

  amplifyInitPromise = initializeAmplify();
  await amplifyInitPromise;
}

async function initializeAmplify(): Promise<void> {
  // Only configure on client-side (browser)
  if (typeof window === 'undefined') {
    console.log('[Amplify] Skipped configuration during SSR');
    return;
  }

  interface WindowWithAmplify extends Window {
    __AMPLIFY_CONFIGURED__?: boolean;
    ENV?: Record<string, string>;
  }

  const win = window as WindowWithAmplify;

  if (win.__AMPLIFY_CONFIGURED__) {
    isConfigured = true;
    console.log('[Amplify] Already configured, skipping');
    return;
  }

  win.__AMPLIFY_CONFIGURED__ = true;

  // Get environment variables from window.ENV (injected by SSR) or import.meta.env (Vite dev)
  const env = win.ENV || import.meta.env;

  if (
    !env.VITE_USER_POOL_ID ||
    !env.VITE_USER_POOL_CLIENT_ID ||
    !env.VITE_GRAPHQL_ENDPOINT ||
    !env.VITE_AWS_REGION
  ) {
    console.error('[Amplify] Missing environment variables');
    throw new Error('Amplify configuration failed: missing required environment variables');
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: env.VITE_USER_POOL_ID,
        userPoolClientId: env.VITE_USER_POOL_CLIENT_ID,
        loginWith: { email: true, username: true },
      },
    },
    API: {
      GraphQL: {
        endpoint: env.VITE_GRAPHQL_ENDPOINT,
        region: env.VITE_AWS_REGION,
        defaultAuthMode: 'userPool',
      },
    },
  });

  isConfigured = true;
  console.log('[Amplify] Configuration complete ✅');
}

// Auto-initialize on import
if (typeof window !== 'undefined') {
  initializeAmplify().catch((err) => {
    console.error('[Amplify] Auto-initialization failed:', err);
  });
}

export default Amplify;
