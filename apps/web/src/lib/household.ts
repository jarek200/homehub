export const INVITE_TOKEN_KEY = 'homehub.inviteToken';

export function readInviteToken(search?: URLSearchParams | null): string | null {
  const fromQuery = search?.get('token')?.trim();
  if (fromQuery) {
    persistInviteToken(fromQuery);
    return fromQuery;
  }
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(INVITE_TOKEN_KEY);
}

export function persistInviteToken(token: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(INVITE_TOKEN_KEY, token);
}

export function clearInviteToken(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(INVITE_TOKEN_KEY);
}

export function loginRedirectForInvite(token: string): string {
  return `/login?redirect=${encodeURIComponent(`/invite?token=${token}`)}`;
}
