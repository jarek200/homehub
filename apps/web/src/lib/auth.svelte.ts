import { browser } from '$app/environment';
import { goto } from '$app/navigation';

export interface User {
  id: string;
  username: string;
  email: string;
  householdId?: string | null;
  role?: 'OWNER' | 'MEMBER' | null;
}

function clearSessionCache() {
  if (!browser) return;
  try {
    (window as Window & { __amplifySessionCache__?: unknown }).__amplifySessionCache__ = null;
  } catch {
    // Ignore
  }
}

class Auth {
  user = $state<User | null>(null);
  isLoading = $state(true);

  get isAuthenticated() {
    return this.user != null;
  }

  setUser(user: User | null, keepLoading = false) {
    this.user = user;
    this.isLoading = keepLoading;
    clearSessionCache();
  }

  setLoading(isLoading: boolean) {
    this.isLoading = isLoading;
  }

  logout() {
    this.user = null;
    this.isLoading = false;
    clearSessionCache();
    if (browser) goto('/login');
  }
}

export const auth = new Auth();
