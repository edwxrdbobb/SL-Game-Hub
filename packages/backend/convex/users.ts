import { ConvexError, v } from 'convex/values';
import { query, mutation, internalQuery } from './_generated/server';
import { USERNAME_RE, isAgeBand } from '@slgh/shared/src/validation';
import { isAvatarId } from '@slgh/shared/src/avatars';
import { currentUser, requireAdmin, requireActiveUser } from './lib';
import { isProActive } from '@slgh/shared/src/pro';
import { WELCOME_CREDIT, welcomeEligible } from '@slgh/shared/src/promo';
import { formatLeones } from '@slgh/shared/src/wallet';
import { emailUser } from './emails';
import { welcome } from './emailTemplates';

/** The signed-in player's profile, or null. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await currentUser(ctx);
    if (!u) return null;
    return {
      id: u._id, username: u.username, full_name: u.full_name, avatar: u.avatar, role: u.role,
      age_band: u.age_band, banned: u.banned, is_public: u.is_public,
      district_id: u.district_id ?? null, created_at: new Date(u._creationTime).toISOString(),
      pro: isProActive(u.pro_until),
      email: u.email ?? null,
      email_reminders: u.email_reminders !== false,
      profile_pending: u.profile_pending === true,
    };
  },
});

/** Which "Continue with ..." buttons the sign-in pages show: only providers whose keys are set. */
export const signInOptions = query({
  args: {},
  handler: async () => ({
    google: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    facebook: !!(process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET),
  }),
});

/**
 * Sign-in by username: the account's email (password accounts are keyed by email), or null.
 * Internal only, so a username never reveals an email to the browser.
 */
export const loginEmail = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const u = await ctx.db.query('users')
      .withIndex('by_username_lower', (q) => q.eq('username_lower', username.trim().toLowerCase())).first();
    return u?.email ?? null;
  },
});

/** Finishes a Google/Facebook sign-up (/welcome): username, age band and name, once. */
export const completeProfile = mutation({
  args: { full_name: v.string(), username: v.string(), age_band: v.string() },
  handler: async (ctx, a) => {
    const me = await requireActiveUser(ctx);
    if (!me.profile_pending) throw new ConvexError('errors.generic');
    const full_name = a.full_name.trim(), username = a.username.trim();
    if (full_name.length < 2 || full_name.length > 80) throw new ConvexError('errors.fullNameRequired');
    if (!USERNAME_RE.test(username)) throw new ConvexError('errors.usernameInvalid');
    if (!isAgeBand(a.age_band)) throw new ConvexError('errors.ageRequired');

    const username_lower = username.toLowerCase();
    const taken = await ctx.db.query('users').withIndex('by_username_lower', (q) => q.eq('username_lower', username_lower)).first();
    if (taken && taken._id !== me._id) throw new ConvexError('errors.usernameTaken');

    await ctx.db.patch(me._id, {
      full_name, username, username_lower, age_band: a.age_band,
      is_public: a.age_band !== 'under_13', // under-13 profiles are never public
      profile_pending: undefined,
      updated_at: Date.now(),
    });
    const welcomeCredit = welcomeEligible(Date.now()) ? formatLeones(WELCOME_CREDIT.amount) : undefined;
    await emailUser(ctx, me._id, (who) => welcome(who, { welcomeCredit, walletOk: a.age_band === '18_plus' }), { key: `welcome/${me._id}` });
  },
});

/** Reminder and invite emails on or off. Account and money emails always go. */
export const setEmailPrefs = mutation({
  args: { reminders: v.boolean() },
  handler: async (ctx, { reminders }) => {
    const me = await requireActiveUser(ctx);
    await ctx.db.patch(me._id, { email_reminders: reminders, updated_at: Date.now() });
  },
});

export const usernameAvailable = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const taken = await ctx.db.query('users')
      .withIndex('by_username_lower', (q) => q.eq('username_lower', username.trim().toLowerCase())).first();
    return !taken;
  },
});

export const updateProfile = mutation({
  args: {
    full_name: v.string(), username: v.string(), avatar: v.string(),
    district_id: v.union(v.string(), v.null()), is_public: v.boolean(),
  },
  handler: async (ctx, a) => {
    const me = await requireActiveUser(ctx);
    const full_name = a.full_name.trim(), username = a.username.trim();
    if (full_name.length < 2 || full_name.length > 80) throw new ConvexError('errors.fullNameRequired');
    if (!USERNAME_RE.test(username)) throw new ConvexError('errors.usernameInvalid');
    if (!isAvatarId(a.avatar)) throw new ConvexError('errors.generic');
    const district_id = a.district_id === null ? undefined : ctx.db.normalizeId('districts', a.district_id) ?? null;
    if (district_id === null) throw new ConvexError('errors.generic');

    const username_lower = username.toLowerCase();
    const taken = await ctx.db.query('users').withIndex('by_username_lower', (q) => q.eq('username_lower', username_lower)).first();
    if (taken && taken._id !== me._id) throw new ConvexError('errors.usernameTaken');

    await ctx.db.patch(me._id, {
      full_name, username, username_lower, avatar: a.avatar, district_id,
      is_public: me.age_band === 'under_13' ? false : a.is_public, // under-13 profiles are never public
      updated_at: Date.now(),
    });
  },
});

// ---------- Admin ----------
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query('users').order('desc').take(100);
    return users.map((u) => ({
      id: u._id, username: u.username, full_name: u.full_name, avatar: u.avatar, role: u.role,
      age_band: u.age_band, banned: u.banned, created_at: new Date(u._creationTime).toISOString(),
    }));
  },
});

export const setBanned = mutation({
  args: { id: v.id('users'), banned: v.boolean() },
  handler: async (ctx, { id, banned }) => {
    const admin = await requireAdmin(ctx);
    if (id === admin._id) throw new ConvexError("You can't suspend your own account.");
    await ctx.db.patch(id, { banned, updated_at: Date.now() });
  },
});
