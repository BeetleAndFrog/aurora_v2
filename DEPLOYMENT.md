# Astryon Portal - Deployment Guide

This guide covers deploying Astryon Portal for the private beta.

## Architecture

- **Frontend (Next.js)**: Deployed on Vercel — the sole production backend
- **AI (Next.js route handlers)**: Protected same-origin `/api/chat` route handlers call Anthropic/OpenAI server-side. No browser keys.
- **Authentication**: NextAuth (Prisma adapter) with server-side session enforcement
- **Data Storage**: NeonDB (PostgreSQL via Prisma) for cloud persistence, Dexie (IndexedDB) + `localStorage` for local cache
- **Realtime (Express/Socket.IO)**: `server/` is **local-development-only** and is NOT deployed in the production beta path. See "Local Development Backend" below.

> **Beta policy:** the Express/Socket.IO service in `server/` is excluded from production. No browser code in the production build connects to it, no `NEXT_PUBLIC_SERVER_URL` is required, and nothing in this guide deploys it.

---

## Prerequisites

1. GitHub account
2. Vercel account (free tier): https://vercel.com/signup
3. Anthropic API key (OpenAI and Gemini keys optional)
4. NeonDB project (PostgreSQL connection string)

---

## Local Development Backend (Express/Socket.IO — optional)

The `server/` directory contains a local Express + Socket.IO service used during development only (e.g. realtime collaboration between local browser tabs).

```bash
# Terminal 1 (from app/)
npm run dev

# Terminal 2 (from app/server/)
npm run dev     # WebSocket + Express on :3001
```

Notes:

- Local realtime requires `NEXT_PUBLIC_SERVER_URL=http://localhost:3001` in `app/.env.local` (already present by default).
- The production build **never** opens a Socket.IO connection: the realtime client in `CanvasScene.tsx` is gated off when `NODE_ENV === 'production'`.
- Do **not** deploy `server/` for the beta. If a future separate collaboration authorization scope is approved, this may change; until then `server/` stays out of the production path.

---

## Part 1: Deploy Frontend (Vercel)

### Step 1: Set Environment Variables Locally

Create a `.env.local` file in the app root:

```bash
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXTAUTH_SECRET=<generate-a-secret>
NEXTAUTH_URL=https://your-app-name.vercel.app
DATABASE_URL=your-neondb-connection-string
ANTHROPIC_API_KEY=your-anthropic-api-key-here
RESEND_API_KEY=your-resend-api-key
UPSTASH_REDIS_REST_URL=your-upstash-rest-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
ADMIN_EMAILS=admin@astryon.com
```

`ADMIN_EMAILS` is a comma-separated allowlist of beta operator emails, required by the production startup assertion (see `lib/auth.ts`). The operator email must also be an **approved BetaSignup row** server-side; otherwise the beta operator control surface (BETA-14) can never approve applicants.

Optional (enable if the corresponding feature is used):

```bash
GEMINI_API_KEY=your-gemini-api-key-here
OPENAI_API_KEY=your-openai-api-key-here
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

Do **not** set `NEXT_PUBLIC_SERVER_URL` for production. The beta path has no external server; removing the variable prevents any browser bundle from containing an Express/Socket.IO URL.

### Step 2: Deploy to Vercel

1. Push your code to GitHub
2. Go to https://vercel.com and sign in
3. Click "Add New..." → "Project"
4. Import your GitHub repository
5. Vercel will auto-detect Next.js settings
6. Click "Deploy"

### Step 3: Set Environment Variables in Vercel

1. Go to your project → "Settings" → "Environment Variables"
2. Add the same variables from `.env.local` (non-secret names; keep secrets out of git)
3. Select "Production", "Preview", and "Development" as appropriate
4. Click "Save"

### Step 4: Redeploy

After adding environment variables:

1. Go to "Deployments" tab
2. Click the three dots on the latest deployment
3. Click "Redeploy"

---

## Part 2: Test Your Deployment

1. Visit your Vercel URL (e.g., `https://your-app-name.vercel.app`)
2. Sign in with the provider configured through NextAuth
3. Create a universe or nexus and verify the app loads
4. Open the browser console and confirm **no** WebSocket/Socket.IO connection attempts and **no** calls to an external server URL. All AI traffic should hit the same-origin `/api/chat`.

Note: realtime collaboration is intentionally unavailable in production for the beta. Neither debug logs nor network traces should show any connection to `localhost:3001` or any external Express host.

---

## Part 3: Share Access with Users

### Sharing Instructions

Send your users:

1. **URL**: `https://your-app-name.vercel.app`
2. Sign-in instructions (per your configured auth provider)
3. **Notes**:
   - Data is stored per user (NeonDB) and cached locally in the browser
   - Realtime multi-user collaboration is not part of this beta

---

## Troubleshooting

### Login page doesn't appear
- Check that `middleware.ts` is in the root directory
- Verify NextAuth environment variables are set in Vercel
- Check browser console for errors

### "Invalid password" error
- Legacy `AURORA_PASSWORD` login is deprecated; modern deployments use NextAuth
- If a legacy route still expects it, remove that route or set the variable only where that legacy flow runs

### AI responses fail
- Verify `ANTHROPIC_API_KEY` is set in Vercel environment variables
- Confirm you are signed in — `/api/chat` requires a session (401 otherwise)
- Check Vercel function logs for provider errors

### Data not persisting to cloud
- Verify `DATABASE_URL` is set and reachable from Vercel serverless functions
- Run `npx prisma generate` after schema changes (the build script does this automatically)

### Browser tries to reach an external server
- Remove `NEXT_PUBLIC_SERVER_URL` from Vercel environment variables and redeploy
- Confirm the production bundle has no Socket.IO connection (see `CanvasScene.tsx` — gated by `NODE_ENV === 'production'`)

---

## Monitoring

### Vercel Logs
- Go to Vercel → your project → "Deployments" → click on a deployment
- View function logs and errors (including `/api/chat`)

---

## Cost Estimates

### Free Tier Limits

**Vercel**:
- 100 GB bandwidth/month
- Unlimited deployments
- Serverless function executions: 100 GB-hours

**NeonDB**:
- Free tier includes a small Postgres instance (check Neon's current limits)

### Scaling Considerations

If you exceed free tier limits, upgrade the relevant service (Vercel Pro, Neon paid tier). No separate Express host is billed because `server/` is not deployed.

---

## Security Notes

1. **Session auth**: NextAuth protects app routes and `/api/chat`; no unauthenticated AI calls
2. **HTTPS**: Vercel provides HTTPS by default
3. **HTTP-only Cookies**: Auth cookies are secure and can't be accessed by JavaScript
4. **Environment Variables**: Never commit `.env.local` or `.env` to git
5. **No external backend**: All AI and persistence traffic stays same-origin; `NEXT_PUBLIC_SERVER_URL` is intentionally absent from production

---

## Next Steps

### For Production Use

Consider implementing:
1. **Realtime collaboration** (separate approved authorization scope; `server/` code is retained for this)
2. **Rate limiting** (Upstash Redis REST limiter is provisioned for the beta)
3. **Analytics** to monitor usage
4. **Backup system** for user data

---

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Vercel logs
3. Check browser console for errors
4. Verify all environment variables are set correctly

---

## Quick Reference

### Environment Variables

**Frontend (Vercel)**:
```
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXTAUTH_SECRET=<generate-a-secret>
NEXTAUTH_URL=https://your-app-name.vercel.app
DATABASE_URL=your-neondb-connection-string
ANTHROPIC_API_KEY=your-api-key
RESEND_API_KEY=your-resend-api-key
UPSTASH_REDIS_REST_URL=your-upstash-rest-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
ADMIN_EMAILS=admin@astryon.com
```

`ADMIN_EMAILS` is a comma-separated allowlist of beta operator emails (required by the production startup assertion). The operator email must also be an approved BetaSignup row.

**Local development only (never in production)**:
```
NEXT_PUBLIC_SERVER_URL=http://localhost:3001
```

### Useful Commands

```bash
# Test locally
npm run dev                    # Frontend (port 3000)

# Local realtime service (optional, development only)
cd server && npm run dev       # Express/Socket.IO (port 3001)

# Build for production
npm run build                  # Test production build locally
```
