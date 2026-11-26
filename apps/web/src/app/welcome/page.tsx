import { redirect } from 'next/navigation';
import { t, AGE_BANDS } from '@slgh/shared';
import { Flash } from '@/components/Flash';
import { AuthShell } from '@/components/AuthShell';
import { Icon } from '@/components/Icon';
import { getMe } from '@/lib/session';
import { completeProfile } from '../actions';

export const metadata = { title: t('auth.welcomeTitle') };
type SP = { error?: string; next?: string; fullName?: string; username?: string; ageBand?: string };

// Only same-site relative paths are allowed as destinations (prevents open redirects).
const safeNext = (n: string | undefined) => (n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');

/**
 * Where Google/Facebook sign-in lands. Players who already have a full profile go straight on;
 * new ones choose a username and age range first (until then their account has the most limited settings).
 */
export default async function Welcome({ searchParams: s }: { searchParams: SP }) {
  const me = await getMe();
  const next = safeNext(s.next);
  if (!me) redirect(`/login?${new URLSearchParams({ next, error: 'errors.socialFailed' })}`);
  if (!me.profile_pending) redirect(next);

  return (
    <AuthShell title={t('auth.welcomeTitle')} subtitle={t('auth.welcomeSubtitle')}>
      <Flash error={s.error} />
      <form action={completeProfile} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div><label className="label" htmlFor="fullName">{t('auth.fullName')}</label>
          <div className="input-icon"><Icon name="user" />
            <input id="fullName" name="fullName" required minLength={2} maxLength={80} autoComplete="name"
              defaultValue={s.fullName ?? me.full_name} className="input" /></div></div>
        <div><label className="label" htmlFor="username">{t('auth.username')}</label>
          <div className="input-icon"><Icon name="sparkles" />
            <input id="username" name="username" required pattern="[A-Za-z0-9_]{3,20}" autoComplete="username" autoCapitalize="none"
              defaultValue={s.username ?? me.username} className="input" aria-describedby="uh" /></div>
          <p id="uh" className="hint">{t('auth.usernameHint')}</p></div>
        <div><label className="label" htmlFor="ageBand">{t('auth.ageBand')}</label>
          <div className="input-icon"><Icon name="calendar" />
            <select id="ageBand" name="ageBand" required defaultValue={s.ageBand ?? ''} className="input" aria-describedby="ah">
              <option value="" disabled>{t('auth.ageChoose')}</option>
              {AGE_BANDS.map((b) => <option key={b} value={b}>{t(`auth.${b}`)}</option>)}
            </select></div>
          <p id="ah" className="hint">{t('auth.ageNote')}</p></div>
        <button className="btn btn-primary btn-lg w-full"><Icon name="sparkles" />{t('auth.welcomeSubmit')}</button>
      </form>
    </AuthShell>
  );
}
