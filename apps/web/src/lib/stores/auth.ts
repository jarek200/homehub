import { derived, writable } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resetGraphQLClient } from '../services/graphql';

export interface User {
  id: string;
  username: string;
  email: string;
}

// Auth state store
const createAuthStore = () => {
  const { subscribe, set, update } = writable<{
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
  }>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  return {
    subscribe,
    setUser: (user: User | null, keepLoading = false) => {
      set({
        user,
        isAuthenticated: !!user,
        isLoading: keepLoading,
      });
      if (browser) {
        try {
          interface WindowWithCache extends Window {
            __amplifySessionCache__?: unknown;
          }
          (window as WindowWithCache).__amplifySessionCache__ = null;
        } catch (_e) {
          // Ignore
        }
      }
    },
    setLoading: (isLoading: boolean) => {
      update((state) => ({ ...state, isLoading }));
    },
    logout: () => {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
      if (browser) {
        try {
          interface WindowWithCache extends Window {
            __amplifySessionCache__?: unknown;
          }
          (window as WindowWithCache).__amplifySessionCache__ = null;
        } catch (_e) {
          // Ignore
        }
        // Reset GraphQL client to prevent cache leaks when switching accounts
        resetGraphQLClient();
        goto('/login');
      }
    },
  };
};

export const auth = createAuthStore();

// Derived stores for convenience
export const user = derived(auth, ($auth) => $auth.user);
export const isAuthenticated = derived(auth, ($auth) => $auth.isAuthenticated);
export const isLoading = derived(auth, ($auth) => $auth.isLoading);
