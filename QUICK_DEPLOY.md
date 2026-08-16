# Quick Deployment Guide - Astryon Portal

Your code is already pushed to GitHub! Just follow these steps to deploy.

> **Beta policy:** Next.js route handlers are the sole production backend. The Express/Socket.IO service in `server/` is **local-development-only** and is **not** deployed for the production beta. There is no Railway step and no `NEXT_PUBLIC_SERVER_URL`.

---

## Step 1: Deploy Frontend to Vercel (5 minutes)

### 1.1 Import Project
1. Go to: https://vercel.com/new
2. Log in with GitHub if needed
3. Find your repository in the list
4. Click **"Import"**

### 1.2 Configure Project
On the "Configure Project" page:

1. **Framework Preset**: Should auto-detect as "Next.js" ✅
2. **Root Directory**: Leave as `./` (default)
3. **Build Command**: Leave as default
4. **Output Directory**: Leave as default

### 1.3 Add Environment Variables
Click **"Environment Variables"** and add your required variables:

| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_ID` | Your Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth client secret |
| `NEXTAUTH_SECRET` | Generate a secret (e.g., `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Your Vercel URL, e.g., `https://aurora-v2-xxx.vercel.app` |
| `DATABASE_URL` | Your NeonDB (PostgreSQL) connection string |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `RESEND_API_KEY` | Your Resend API key |
| `UPSTASH_REDIS_REST_URL` | Your Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash Redis REST token |
| `ADMIN_EMAILS` | Comma-separated beta operator emails, e.g., `admin@astryon.com` |

`ADMIN_EMAILS` is required by the production startup assertion (see `lib/auth.ts`). The operator email must also be an **approved BetaSignup row** server-side, otherwise the beta operator control surface (BETA-14) can never approve applicants.

Optional (only if the feature is used):

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | Your Gemini API key |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `BLOB_READ_WRITE_TOKEN` | Your Vercel Blob token |

Do **not** add `NEXT_PUBLIC_SERVER_URL` — the production beta has no external server, and leaving the variable out keeps any Express/Socket.IO URL out of the browser bundle.

### 1.4 Deploy
1. Click **"Deploy"**
2. Wait 2-3 minutes for deployment
3. **Copy your Vercel URL** (e.g., `https://aurora-v2-xxx.vercel.app`)
4. **Save this URL** — you'll need it for `NEXTAUTH_URL` on any redeploy

---

## Step 2: Test Your Deployment (2 minutes)

### 2.1 Visit Your App
1. Go to your Vercel URL (from Step 1.4)
2. You should see the **sign-in page** ✅
3. Sign in with the configured provider
4. You should be redirected to the **main app** ✅

### 2.2 Verify No Realtime Connection
1. Press **F12** to open browser console
2. Create a new universe or nexus
3. Confirm there are **no** WebSocket/Socket.IO connection messages and **no** network calls to an external server (`localhost:3001` or any Express host)
4. All AI traffic hits the same-origin `/api/chat` ✅

Realtime collaboration is intentionally disabled in production for the beta.

---

## Step 3: Share with Users

Send your users:

```
🌟 Welcome to Astryon Portal!

URL: https://your-vercel-url.vercel.app
Sign-in: [per your configured auth provider]

Just visit the URL, sign in, and start exploring!
```

---

## Troubleshooting

### Can't sign in
- Verify `NEXTAUTH_SECRET` and `NEXTAUTH_URL` match your deployment
- Check Vercel environment variables are saved correctly

### AI responses fail
- Verify `ANTHROPIC_API_KEY` is set in Vercel
- Confirm you are signed in — `/api/chat` requires a session (401 otherwise)

### Browser tries to reach an external server
- Remove `NEXT_PUBLIC_SERVER_URL` from Vercel environment variables and redeploy
- The production build gates the Socket.IO client off via `NODE_ENV === 'production'`; no external connection should appear in the network tab

---

## Local Development Only (not for production)

The `server/` directory runs Express + Socket.IO for local development:

```bash
# Terminal 1 (from app/)
npm run dev

# Terminal 2 (from app/server/)
npm run dev     # Express/Socket.IO on :3001
```

Local realtime needs `NEXT_PUBLIC_SERVER_URL=http://localhost:3001` in `app/.env.local` (default). Do not deploy `server/` for the beta.

---

## Quick Reference

**Your URL:**
- Frontend (Vercel): `https://your-app.vercel.app`

**Environment Variables (Vercel):**
```
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXTAUTH_SECRET=<generated-secret>
NEXTAUTH_URL=https://your-app.vercel.app
DATABASE_URL=your-neondb-connection-string
ANTHROPIC_API_KEY=your-api-key
RESEND_API_KEY=your-resend-api-key
UPSTASH_REDIS_REST_URL=your-upstash-rest-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
ADMIN_EMAILS=admin@astryon.com
```

---

**Total Time: ~7 minutes** ⏱️

Good luck! 🚀
