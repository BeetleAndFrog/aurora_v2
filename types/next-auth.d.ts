import { DefaultSession } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

/**
 * The NextAuth `session` callback (lib/auth.ts) sets `session.user.id` from the
 * JWT subject. Augment the default Session type so client code can read the
 * authenticated account id (used to namespace browser persistence in BETA-06).
 *
 * `hasModelConfig` mirrors the `jwt` callback's DB-backed claim (BYOK access
 * gate) so both client session reads and the `proxy.ts` middleware redirect
 * are typed instead of relying on `any`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id?: string | null;
      hasModelConfig?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    hasModelConfig?: boolean;
  }
}