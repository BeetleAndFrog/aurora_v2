# Bring-Your-Own-Model (BYOK) — Design

Status: approved for planning
Date: 2026-08-13
Branch: `feature/byok-model-connect`

## Problem

Aurora's AI features (`app/api/chat/route.ts`, ~15 `mode` branches: spatial universe generation, quizzes, essay grading, Socratic dialogue, etc.) run entirely on app-provided `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`. Every user's usage is billed to the app owner with no per-user isolation beyond an existing daily request quota (`AI_DAILY_LIMIT`, `app/api/chat/route.ts:142-164`). We want users to bring their own model access instead — via OpenRouter, Vercel AI Gateway, or any OpenAI-compatible endpoint — and make this mandatory: the app stops using its own keys for regular users entirely.

## Decisions

- **One generic integration, not three.** OpenRouter, Vercel AI Gateway, and "any OpenAI-compatible API" are the same shape: `baseUrl` + `apiKey` + `model` ID, called via the OpenAI SDK's `chat.completions` interface. The Settings UI offers a provider dropdown that pre-fills known `baseUrl`s (OpenRouter, Vercel AI Gateway, Custom); underneath, it's a single code path.
- **Mandatory, not optional.** No fallback to app-provided keys for regular users. A user with no valid model config cannot use any AI feature until they configure one. This applies to *existing* users too (see Access Gate) — everyone gets funneled through setup, not just new signups.
- **Free-tier default via the user's own key, not a shared app-hosted key.** A shared free-tier key concentrates every user's traffic onto one rate limit, which is exactly the capping problem this feature is meant to avoid. Instead, onboarding defaults the provider dropdown to OpenRouter with a known free model slug pre-filled, plus a "get a free key in ~30 seconds" link to OpenRouter's signup. Each user's free usage is rate-limited under their own key, not pooled.
- **Test-on-save.** Saving a model config runs one live minimal call through the real call path before persisting. A bad key/URL/model is caught immediately, not on first real use.
- **`server/server.js`'s duplicate Anthropic/OpenAI chat code is commented out, not deleted.** The frontend only ever calls `/api/chat` (confirmed: every chat call site — `store.ts`, `UnifiedNodeModal.tsx`, `ReplyModal.tsx`, `ApplicationLabScene.tsx`, `ApplicationEssaySection.tsx`, `useNexusEvolution.ts`, `useNexusApplicationLabEvolution.ts` — fetches same-origin `/api/chat`; `server.js`'s own AI/chat code is unreferenced dead weight). Its Socket.IO realtime-collaboration server (used by `CanvasScene.tsx:1782`) is untouched — separate concern. Comment block explains why it's kept (in case it needs reinstating) rather than deleted outright.

## Out of scope

- `lib/gemini.ts`'s `callGeminiFlash` (Smart Paste structured-input preprocessing, invoked from `app/api/chat/route.ts`'s spatial mode) stays on the app-provided `GEMINI_API_KEY`. It's invisible background plumbing, not a user-facing "connect your model" choice, and swapping it per-user would add complexity with no user-visible benefit.
- No change to the existing per-user daily rate limiter (`AI_DAILY_LIMIT`/`evalRateLimit`) — it stays as a defense against runaway usage regardless of whose key is being spent.
- No provider-specific feature support (e.g. OpenRouter's own routing/fallback params, Vercel AI Gateway's own observability hooks) — treated as a plain OpenAI-compatible endpoint, nothing more.

## Data model

New Prisma model, 1:1 with `User`:

```prisma
model ModelConfig {
  id               String   @id @default(cuid())
  userId           String   @unique
  label            String?  // e.g. "OpenRouter" — display only
  baseUrl          String
  model            String
  apiKeyCiphertext String   @db.Text
  apiKeyIv         String
  verifiedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Add `modelConfig ModelConfig?` to `User` (`prisma/schema.prisma:13-29`).

## Encryption

New `lib/modelConfigCrypto.ts`: AES-256-GCM, key derived from `NEXTAUTH_SECRET` via `@panva/hkdf` (the same derivation mechanism `next-auth`'s own JWT encoding already uses internally — see `node_modules/next-auth/src/jwt/index.ts`'s `getDerivedEncryptionKey`, reused conceptually, not imported from `next-auth` internals). `encrypt(plaintext): { ciphertext, iv }` / `decrypt(ciphertext, iv): plaintext`. This is a new capability — the only existing secret-handling pattern in the codebase (`hashInviteToken` in `lib/betaAccess.ts`) is one-way hashing, unsuitable for a value that must be recovered to make outbound calls.

The API key is write-only from the client's perspective: Settings/Onboarding never re-render a saved key, only "•••• saved on `<date>`" plus the option to replace it.

## Provider call path

New `lib/callUserModel.ts` (or inlined near the top of `app/api/chat/route.ts`, TBD at implementation time): given a decrypted `ModelConfig` and the existing `params` shape (`system`, `messages`, `max_tokens`, etc. — unchanged across all ~15 modes), constructs an `OpenAI` client pointed at `baseUrl`/`apiKey` and calls `chat.completions.create(...)`, streaming or not per the existing `stream` param. Replaces `safeAICall`/`streamAICall`'s Anthropic-then-OpenAI-fallback logic (`app/api/chat/route.ts:18-140`) — there is now exactly one configured endpoint per user, so a failure surfaces directly as an error ("check your API key/model in Settings") rather than silently retrying a different provider.

`POST()` loads the requesting user's `ModelConfig` once (via `requireUser()`'s user id), decrypts the key, and reuses it for whichever mode-branch the request matches.

## Settings page (new)

`/settings` doesn't exist today — this is the first dedicated settings surface in the app (only `/admin` and `/onboard` exist currently). "Model" section:
- Provider dropdown: OpenRouter / Vercel AI Gateway / Custom (Custom leaves `baseUrl` freely editable; the other two pre-fill a known `baseUrl`)
- API key field (password-masked, write-only as above)
- Model ID text field (free text — e.g. `anthropic/claude-3.5-sonnet` for OpenRouter)
- "Test & Save" button — runs the live test call through the real `callUserModel` path; on success, persists (encrypted) and sets `verifiedAt`; on failure, shows the provider's actual error, nothing saved.

## Onboarding changes

`app/onboard/page.tsx` gains a required Model step alongside existing profile fields (name/school/role/goal). Defaults: provider = OpenRouter, model = a known free slug, with a "get a free API key (30 sec)" link to OpenRouter's signup. `onboardingCompleted` cannot flip to `true` without a passing "Test & Save" on the model config (mirrors the existing profile-completion gate, extended to also require this).

## Access gate (mandatory enforcement)

No existing mechanism redirects an incomplete user *into* `/onboard` — the current check (`app/onboard/page.tsx:12`) only redirects *away* from it once `onboardingCompleted` is true. This feature adds the first real forced gate:

- New `jwt` callback in `lib/auth.ts` (none exists today — `authOptions.callbacks` currently only has `signIn` and `session`) sets a `hasModelConfig` boolean claim from the DB at sign-in/token refresh.
- `proxy.ts` gains a second check alongside its existing `getToken()` gate (`proxy.ts:39-58`): authenticated but `hasModelConfig: false` → redirect to `/onboard` (if profile also incomplete) or `/settings` (if profile is done but the model config was later removed/invalidated) — same redirect shape as the existing unauthenticated-user case (`proxy.ts:66-69`).
- `/api/chat` independently re-checks server-side before making any call (JWT claims can go stale between a save and token refresh) — no valid `ModelConfig` → 400 with an actionable message, never a null-key crash.
- Saving from `/settings` calls NextAuth's client-side `useSession().update()` immediately after a successful test, forcing the `jwt` callback to re-run so the gate clears without waiting for natural token refresh.
- This gate applies to **existing** users too — on their next request after this ships, anyone without a `ModelConfig` row gets funneled through the same setup flow as a new signup.

## `server/server.js` cleanup

Comment out the Anthropic/OpenAI client setup and its chat-handling route, with a header comment: superseded by `app/api/chat`'s mandatory BYOK model, kept commented (not deleted) in case it needs reinstating. Socket.IO realtime sync (`server.js`'s other responsibility) is untouched.

## Testing

New `lib/__tests__/modelConfig.test.ts` (matching the existing no-framework `tsx`-run pattern in `lib/__tests__/`):
- Encrypt/decrypt round-trip (including empty/large key edge cases)
- Access-gate logic: has-config vs. not, in isolation from the DB/HTTP layer
- `baseUrl` validation: reject non-`http(s)` schemes and other malformed input — this is a user-supplied URL the server will make outbound requests to, a real SSRF surface worth a bounded allowlist-style check (reject private/link-local IP literals, require http/https)

## Aurora → Astryon rename (folded into this branch)

The app is branded Astryon; "Aurora" is legacy naming still present throughout the codebase and should be updated wherever it appears, scoped to **code and user-facing text only** — not infrastructure or stored data:

- In scope: UI copy (e.g. `app/auth/signin/page.tsx`'s "Welcome to Aurora"), code comments, CLAUDE.md/AGENTS.md docs, variable/function names where reasonable to change without churn for its own sake, README content.
- Out of scope (unchanged, to avoid touching live infra or breaking existing user data): the GitHub repo name (`aurora_v2`), the Vercel project name (`aurora-v2`), the `aurora-portal-data` `localStorage` key, and `window.auroraDebug` — renaming any of these needs its own migration/infra-change discussion and isn't part of this pass.
- Done as part of `feature/byok-model-connect` per your call, even though it's a separate concern from BYOK itself — keep the rename as its own commit(s) within the branch so it stays easy to review independently of the BYOK changes.

## Open questions for implementation time

- Exact wording/UX for the "check your API key/model in Settings" error surfaced to users mid-lesson when a call fails.
- Whether `label` is user-editable free text or locked to the selected provider name.
