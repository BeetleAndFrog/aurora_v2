// BYOK model connect (2026-08-13 design doc): validates a user-supplied
// baseUrl before app/api/model-config/route.ts makes any outbound request to
// it. Not an exhaustive SSRF allowlist (DNS rebinding etc. are out of scope
// for this pass) — a bounded, deliberate check per the design spec.

const PRIVATE_HOST_RE =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|localhost$|\[::1\]$|::1$)/i;

export function isSafeBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (PRIVATE_HOST_RE.test(url.hostname)) return false;
  return true;
}
