import { PHASE_PRODUCTION_BUILD } from "next/constants";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { Resend } from "resend";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  isBetaAccessGranted,
  isBetaAccessGrantedForOperator,
  normalizeEmail,
} from "@/lib/betaAccess";
import {
  redeemInvite,
  validateInviteForRedemption,
  verifyInviteTicket,
} from "@/lib/inviteRedemption";

/**
 * Shared sender address for operator-driven and magic-link email. Uses the same
 * Resend `from` as the invite email (betaAdmin.ts) unless EMAIL_FROM overrides.
 */
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "Astryon <noreply@astryon.com>";

/**
 * Send a magic-link (EmailProvider verification) email via Resend. Reuses the
 * same RESEND_API_KEY sentry as the beta invite email. Never logs the link.
 */
async function sendMagicLinkEmail(opts: { to: string; url: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      await new Resend(apiKey).emails.send({
        from: EMAIL_FROM,
        to: opts.to,
        subject: "Your Astryon sign-in link",
        html:
          `<p>Here is your secure sign-in link for Astryon.</p>` +
          `<p><a href="${opts.url}">Sign in to Astryon</a></p>` +
          `<p>This link is single-use and expires in 24 hours.</p>` +
          `<p>If you did not request this, you can ignore this email.</p>`,
      });
    } catch (err) {
      console.error(
        "[auth] magic-link email send failed:",
        (err as Error)?.constructor?.name,
      );
      // Re-throw so NextAuth surfaces a failure to the caller instead of
      // silently sending a user into a dead redirect.
      throw err;
    }
  }
}

/**
 * Name of the short-lived signed HttpOnly cookie set by POST /api/auth/invite
 * (see app/api/auth/invite/route.ts) that carries the validated invite through
 * the Google OAuth round-trip. Never contains the raw token.
 */
const INVITE_TICKET_COOKIE = "astryon_invite";

/**
 * Environment names required for NextAuth in production.
 *
 * Only names are validated and reported; secret values are never logged.
 * The set is intentionally limited to the non-secret names that the Auth
 * provider (OAuth + JWT session) and the Prisma adapter require at startup.
 */
const REQUIRED_PRODUCTION_ENV = [
  // OAuth provider credentials
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  // JWT session signing + jwt() verification in middleware
  "NEXTAUTH_SECRET",
  // Prisma adapter database
  "DATABASE_URL",
  // Absolute app URL used by NextAuth and OAuth callbacks
  "NEXTAUTH_URL",
  // Beta operator allowlist (comma-separated emails). Required so the beta
  // operator control surface (BETA-14) can never lock itself out silently.
  "ADMIN_EMAILS",
  // Magic-link (EmailProvider) delivery. Required so email-based sign-in can
  // send verification links in production; missing key fails closed at startup.
  "RESEND_API_KEY",
] as const;

/**
 * Fail-closed production startup validation.
 *
 * Throws with a redacted, name-only message (no secret values) when any
 * required environment variable is missing. In development, missing values
 * are tolerated so local auth can be exercised without a full secret set.
 *
 * Also tolerated during `next build`: Next.js imports this route module to
 * collect page data/config even though the handler never actually runs, and
 * `NODE_ENV` is "production" at that point. Runtime secrets (e.g. a
 * database URL) are not always present in the build environment, so
 * skipping here avoids failing builds for a check that only matters once
 * the function is actually invoked to serve a request.
 */
export function assertAuthEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
    return;
  }
  const missing = REQUIRED_PRODUCTION_ENV.filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(", ")}`,
    );
  }
}

/**
 * Central, typed NextAuth configuration.
 *
 * Single source of truth for the auth boundary. API routes and the App Router
 * session helper both consume this object so session, callback, and provider
 * behavior stays consistent across the codebase.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // OPS-06 round-2: magic-link (email) auth alongside Google. The same sign-in
    // gate runs for this provider (see the signIn callback). A custom
    // sendVerificationRequest sends the link via Resend, so no SMTP server
    // config is needed; the default nodemailer sender is never invoked.
    EmailProvider({
      from: EMAIL_FROM,
      sendVerificationRequest: async ({ identifier, url }) => {
        await sendMagicLinkEmail({ to: identifier, url });
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async signIn({ user, account }: any) {
      if (!user.email) return false;
      // Skip the beta-signup gate in dev so local testing does not require a
      // beta signup record or a full OAuth invite round-trip.
      if (process.env.NODE_ENV === "development") return true;

      // Production gate. The same approval requirement applies to Google and
      // email (magic-link) users: the email must resolve to an approved,
      // unrevoked, unexpired, non-expired beta access record. Imported lazily
      // (auth -> operator -> authz -> auth cycle); signatures are static.
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) return false;

      const { isOperatorEmail } = await import("@/lib/operator");
      const normalized = normalizeEmail(user.email);

      // Operator identity: env allowlist OR Admin-table membership. The table
      // lookup is wrapped so a still-pending schema migration (table not yet
      // deployed) fails open to the allowlist path rather than crashing sign-in.
      let isAdminMember = false;
      try {
        isAdminMember = Boolean(
          await prisma.admin.findUnique({ where: { email: normalized } }),
        );
      } catch {
        isAdminMember = false;
      }
      const isOperator = isOperatorEmail(normalized) || isAdminMember;

      // Load the beta access record bound to this email (by email or invitedEmail).
      const gateSignup = await prisma.betaSignup.findFirst({
        where: { OR: [{ email: normalized }, { invitedEmail: normalized }] },
      });

      // Operators (allowlist or Admin table): exempt from the single-invite-
      // redemption lockout so they can sign in repeatedly and bootstrap /admin,
      // and exempt from the invite-expiry check (OPS-06 decision-A) so a passed
      // expiry never locks them out. They must still hold an approved,
      // non-revoked beta access record (OPS-06 round-2 tightened gate / option
      // C). A guessed-allowlist email without an approved beta signup is denied.
      if (isOperator) {
        return gateSignup !== null && isBetaAccessGrantedForOperator(gateSignup);
      }

      // Email (magic-link) provider for non-operators: the link already proves
      // ownership of the inbox, so there is no OAuth round-trip ticket to
      // carry. The gate is the approved beta record bound to the email.
      if (account?.provider === "email") {
        return gateSignup !== null && isBetaAccessGranted(gateSignup);
      }

      // Google (OAuth) provider for non-operators: require an approved+invited
      // signup and the single-use invite-ticket redemption flow below.
      const cookieStore = await cookies();
      const ticket = cookieStore.get(INVITE_TICKET_COOKIE)?.value;
      if (!ticket) return false;

      const payload = verifyInviteTicket(ticket, secret);
      if (!payload) return false;

      // The ticket binds the OAuth email; verify it matches the invited email
      // before any redemption attempt.
      if (normalizeEmail(payload.invitedEmail) !== normalizeEmail(user.email)) {
        return false;
      }

      const signup = await prisma.betaSignup.findUnique({
        where: { inviteTokenHash: payload.tokenHash },
      });
      const verdict = validateInviteForRedemption(signup ?? null, user.email);
      if (!verdict.ok) return false;

      // Atomically flip approved -> redeemed exactly once. The unique
      // inviteTokenHash + redeem-guard where-clause makes reuse impossible.
      const redeemed = await redeemInvite(prisma, {
        tokenHash: payload.tokenHash,
        oauthEmail: user.email,
      });
      if (!redeemed) return false;

      // Invite spent; drop the ticket so it cannot be reused this session.
      cookieStore.delete(INVITE_TICKET_COOKIE);
      return true;
    },
    async jwt({ token, user }: any) {
      // Initial sign-in: `user` is the freshly authenticated user row.
      // Subsequent calls (session refresh / client update() trigger): re-check
      // from the DB via the JWT subject so a config added/removed after sign-in
      // is reflected without forcing a fresh login.
      const userId = user?.id ?? token.sub;
      if (userId) {
        const config = await prisma.modelConfig.findUnique({ where: { userId } });
        token.hasModelConfig = Boolean(config);
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.sub;
        session.user.hasModelConfig = Boolean(token.hasModelConfig);
      }
      return session;
    },
  },
};