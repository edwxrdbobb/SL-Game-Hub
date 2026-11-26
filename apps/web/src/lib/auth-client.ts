'use client';

// Sign-in and sign-out post to the Convex Auth route that our middleware serves (/api/auth),
// which sets the httpOnly auth cookies. This is the same call ConvexAuthNextjsProvider makes,
// done directly so ordinary pages don't have to ship the Convex client.

import { errorKeyFor } from '@slgh/shared/src/errors';

type Params = Record<string, string>;

async function call(action: 'auth:signIn' | 'auth:signOut', args: Record<string, unknown>) {
  const res = await fetch('/api/auth', { method: 'POST', body: JSON.stringify({ action, args }) })
    .catch(() => { throw new Error('errors.offline'); });
  if (res.status >= 400) {
    const message = String((await res.json().catch(() => null))?.error ?? '');
    throw new Error(errorKeyFor(message)); // an errors.* key the form shows in plain words
  }
  return res.json();
}

export const signInWithPassword = (params: Params) => call('auth:signIn', { provider: 'password', params });

/**
 * Google/Facebook: /api/auth answers with the provider's sign-in page (and keeps a verifier cookie);
 * the provider sends the player back to `redirectTo?code=...`, which our middleware exchanges for a session.
 */
export async function signInWithProvider(provider: 'google' | 'facebook', redirectTo: string) {
  const { redirect } = (await call('auth:signIn', { provider, params: { redirectTo } })) as { redirect?: string };
  if (!redirect) throw new Error('errors.socialFailed');
  window.location.assign(redirect);
}
export const signOut = () => call('auth:signOut', {});
