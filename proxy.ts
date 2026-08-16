import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Explicit public-route allowlist.
 *
 * Everything NOT listed here is protected and requires a valid NextAuth
 * session (JWT). The legacy `aurora-auth` password cookie is intentionally
 * absent: it no longer grants access to any route.
 *
 * Public routes are limited to auth plumbing, the join/beta-signup flow,
 * static assets, and health checks so OAuth callbacks and onboarding are not
 * locked out.
 */
const PUBLIC_PREFIXES = [
  // NextAuth sign-in page and its assets
  '/auth/signin',
  // Public join / beta signup page
  '/join',
  // NextAuth API (login, callback, session, providers, csrf)
  '/api/auth',
  // Public beta signup API
  '/api/beta-signup',
  // Health check
  '/api/health',
] as const;

// Static assets (matched defensively; the matcher already excludes common ones)
const PUBLIC_FILE_RE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|txt)$/i;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_FILE_RE.test(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * BYOK access gate (2026-08-13 design doc): routes exempt from the
 * "must have a model config" redirect below, distinct from `isPublicPath`
 * (which controls "no auth needed at all"). `/settings` must stay exempt or a
 * user with no config could never reach the page that lets them add one;
 * `/onboard` gates on model config itself in its own UI.
 */
const MODEL_CONFIG_EXEMPT_PREFIXES = ['/settings', '/onboard'] as const;

function isModelConfigExempt(pathname: string): boolean {
  return MODEL_CONFIG_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Authenticated users pass through. Uses the same JWT session token that
  // NextAuth issues (session strategy: "jwt"). secureCookie is explicit
  // rather than left to auto-detect from NEXTAUTH_URL: a misconfigured
  // NEXTAUTH_URL (e.g. an http:// dev value) would otherwise make getToken()
  // look for the unprefixed cookie name and silently never find a session.
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: true,
  });
  if (token) {
    // BYOK mandatory access gate: an authenticated user with no model config
    // gets funneled to /settings until they add one (design doc, "Access
    // gate"). Exempt API routes — /api/chat re-checks server-side and returns
    // an actionable JSON error rather than a redirect a fetch() can't follow.
    if (
      !pathname.startsWith('/api/') &&
      !isModelConfigExempt(pathname) &&
      !token.hasModelConfig
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/settings';
      url.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Anonymous API callers are rejected with 401; anonymous pages are
  // redirected to the sign-in page.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/auth/signin';
  url.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and image optimization.
     * The public-route allowlist above still lets matching paths through.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};