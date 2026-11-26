'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { t } from '@slgh/shared';
import { signInWithProvider } from '@/lib/auth-client';

type Provider = 'google' | 'facebook';

// Only same-site relative paths are allowed as post-login destinations (prevents open redirects).
const safeNext = (n: string) => (n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');

const GoogleMark = () => (
  <svg aria-hidden viewBox="0 0 24 24" width="20" height="20">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.2 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

const FacebookMark = () => (
  <svg aria-hidden viewBox="0 0 24 24" width="20" height="20">
    <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z" />
  </svg>
);

/**
 * "Continue with Google / Facebook". New players land on /welcome to pick a username and age range;
 * players who already have an account (same email) go straight on to `next`.
 */
export function SocialSignIn({ google, facebook, next = '/' }: { google: boolean; facebook: boolean; next?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState<Provider | null>(null);
  if (!google && !facebook) return null;

  async function go(provider: Provider) {
    if (busy) return;
    setBusy(provider);
    try {
      await signInWithProvider(provider, `/welcome?${new URLSearchParams({ next: safeNext(next) })}`);
    } catch (err) {
      setBusy(null);
      const key = (err as Error).message;
      router.replace(`${pathname}?${new URLSearchParams({ error: key.startsWith('errors.') ? key : 'errors.socialFailed' })}`);
    }
  }

  return (
    <div className="space-y-3">
      {google && (
        <button type="button" onClick={() => go('google')} disabled={!!busy} aria-busy={busy === 'google'}
          className="btn btn-secondary btn-lg w-full"><GoogleMark />{t('auth.continueGoogle')}</button>
      )}
      {facebook && (
        <button type="button" onClick={() => go('facebook')} disabled={!!busy} aria-busy={busy === 'facebook'}
          className="btn btn-secondary btn-lg w-full"><FacebookMark />{t('auth.continueFacebook')}</button>
      )}
      <p className="flex items-center gap-3 text-sm text-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" />{t('auth.orUse')}<span className="h-px flex-1 bg-border" />
      </p>
    </div>
  );
}
