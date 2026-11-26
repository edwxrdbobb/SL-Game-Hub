import { convexAuth } from '@convex-dev/auth/server';
import { Password } from '@convex-dev/auth/providers/Password';
import Resend from '@auth/core/providers/resend';
import Google from '@auth/core/providers/google';
import Facebook from '@auth/core/providers/facebook';
import { ConvexError } from 'convex/values';
import type { GenericActionCtx } from 'convex/server';
import { USERNAME_RE, isAgeBand, isEmail } from '@slgh/shared/src/validation';
import type { DataModel, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { WELCOME_CREDIT, welcomeEligible } from '@slgh/shared/src/promo';
import { formatLeones } from '@slgh/shared/src/wallet';
import { emailUser } from './emails';
import { welcome } from './emailTemplates';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Emails a 6-digit code; the player types it in with their new password. */
const PasswordResetCode = Resend({
  id: 'password-reset-code',
  apiKey: process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY,
  maxAge: 15 * 60,
  async generateVerificationToken() {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    return String(n).padStart(6, '0');
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? 'Dodo <onboarding@resend.dev>',
        to: [email],
        subject: 'Your Dodo password reset code',
        text: `Your password reset code is ${token}. It expires in 15 minutes. If you did not ask for this, ignore this email.`,
      }),
    });
    if (!res.ok) throw new Error(`Could not send reset email: ${await res.text()}`);
  },
});

const password = Password<DataModel>({
  // Runs for every flow; only sign-up carries (and must validate) the profile fields.
  profile(params) {
    const email = str(params.email).toLowerCase();
    if (params.flow !== 'signUp') return { email } as never;
    const full_name = str(params.fullName), username = str(params.username), age_band = str(params.ageBand);
    if (!isEmail(email)) throw new ConvexError('errors.emailInvalid');
    if (full_name.length < 2 || full_name.length > 80) throw new ConvexError('errors.fullNameRequired');
    if (!USERNAME_RE.test(username)) throw new ConvexError('errors.usernameInvalid');
    if (!isAgeBand(age_band)) throw new ConvexError('errors.ageRequired');
    return { email, full_name, username, age_band } as never;
  },
  validatePasswordRequirements(password) {
    if (password.length < 8 || password.length > 72) throw new ConvexError('errors.passwordShort');
  },
  reset: PasswordResetCode,
});

// Sign in with a username as well as an email: password accounts are keyed by email, so a username
// is swapped for its account's email before the Password provider checks it. An unknown username
// fails exactly like a wrong password (no account enumeration).
// Password() keeps its authorize() in `options` (Convex Auth merges options into the provider);
// if a Convex Auth upgrade changes that, fail at deploy instead of silently breaking sign-in.
type Authorize = (params: Record<string, unknown>, ctx: GenericActionCtx<DataModel>) => Promise<unknown>;
const passwordOptions = (password as unknown as { options?: { authorize?: Authorize } }).options;
const passwordAuthorize = passwordOptions?.authorize;
if (!passwordOptions || !passwordAuthorize) throw new Error('Convex Auth changed: Password provider has no options.authorize');
passwordOptions.authorize = async (params, ctx) => {
  const id = str(params.email);
  if (params.flow === 'signIn' && id && !isEmail(id) && USERNAME_RE.test(id)) {
    const email = await ctx.runQuery(internal.users.loginEmail, { username: id });
    return passwordAuthorize({ ...params, email: email ?? `${id.toLowerCase()}@username.invalid` }, ctx);
  }
  return passwordAuthorize(params, ctx);
};

/** A free username like "aminata_k" or "aminata_k4821", from the player's name or email. */
async function freeUsername(ctx: MutationCtx, name: string, email: string | undefined) {
  const base = (name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '') || email?.split('@')[0]?.replace(/[^A-Za-z0-9_]/g, '') || '')
    .slice(0, 15);
  const stem = base.length >= 3 ? base : 'player';
  for (let i = 0; i < 20; i++) {
    const username = i === 0 && base.length >= 3 ? stem : `${stem}${Math.floor(1000 + Math.random() * 9000)}`;
    const taken = await ctx.db.query('users').withIndex('by_username_lower', (q) => q.eq('username_lower', username.toLowerCase())).first();
    if (!taken) return username;
  }
  throw new ConvexError('errors.generic');
}

/**
 * Google/Facebook sign-in. An email that already has a Dodo account signs in to that account;
 * otherwise a new one is made with the most limited settings until the player finishes /welcome.
 */
async function socialUser(ctx: MutationCtx, profile: Record<string, unknown>): Promise<Id<'users'>> {
  const email = str(profile.email).toLowerCase();
  const verified = isEmail(email) ? email : undefined;
  if (verified) {
    const existing = await ctx.db.query('users').withIndex('email', (q) => q.eq('email', verified)).first();
    if (existing) return existing._id;
  }
  const name = str(profile.name).slice(0, 80);
  const username = await freeUsername(ctx, name, verified);
  return ctx.db.insert('users', {
    ...(verified ? { email: verified, emailVerificationTime: Date.now() } : {}),
    ...(typeof profile.image === 'string' ? { image: profile.image } : {}),
    full_name: name.length >= 2 ? name : username, username, username_lower: username.toLowerCase(),
    avatar: 'av_lion', country: 'SL', age_band: 'under_13', role: 'player',
    is_public: false, banned: false, profile_pending: true, updated_at: Date.now(),
  });
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  // Google/Facebook read AUTH_GOOGLE_ID/_SECRET and AUTH_FACEBOOK_ID/_SECRET from the deployment's env.
  providers: [password, Google, Facebook],
  callbacks: {
    // Replaces the handle_new_user trigger: the user row IS the player profile.
    async createOrUpdateUser(genericCtx, { existingUserId, profile, type }) {
      if (existingUserId) return existingUserId;
      const ctx = genericCtx as unknown as MutationCtx;
      if (type === 'oauth') return socialUser(ctx, profile);
      const p = profile as { email: string; full_name?: string; username?: string; age_band?: string };
      if (!p.full_name || !p.username || !p.age_band || !isAgeBand(p.age_band)) throw new ConvexError('errors.generic');
      // One player per email: a Google/Facebook account may already use it.
      const sameEmail = await ctx.db.query('users').withIndex('email', (q) => q.eq('email', p.email)).first();
      if (sameEmail) throw new ConvexError('errors.emailTaken');
      const username_lower = p.username.toLowerCase();
      const taken = await ctx.db.query('users').withIndex('by_username_lower', (q) => q.eq('username_lower', username_lower)).first();
      if (taken) throw new ConvexError('errors.usernameTaken');
      const id = await ctx.db.insert('users', {
        email: p.email, full_name: p.full_name, username: p.username, username_lower,
        avatar: 'av_lion', country: 'SL', age_band: p.age_band, role: 'player',
        is_public: p.age_band !== 'under_13', banned: false, updated_at: Date.now(),
      });
      const welcomeCredit = welcomeEligible(Date.now()) ? formatLeones(WELCOME_CREDIT.amount) : undefined;
      await emailUser(ctx, id, (who) => welcome(who, { welcomeCredit, walletOk: p.age_band === '18_plus' }), { key: `welcome/${id}` });
      return id;
    },
  },
});
