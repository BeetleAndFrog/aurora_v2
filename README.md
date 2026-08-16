# Astryon Portal

A 3D spatial conversation and knowledge visualization platform built on **Next.js**. Next.js route handlers are the sole production backend; React Three Fiber renders the spatial canvas; Zustand drives state; Prisma + NeonDB persist data.

## Architecture

- **Backend**: Next.js route handlers (Next.js-only). No Express, no Socket.IO in production.
- **Frontend**: Next.js 15, React Three Fiber (R3F), Tailwind CSS, Zustand
- **Authentication**: NextAuth (Google OAuth, Prisma adapter), server-side session enforcement
- **Database**: NeonDB (PostgreSQL via Prisma), with Dexie (IndexedDB) + `localStorage` as local cache
- **Storage**: Vercel Blob (video uploads, optional)
- **AI**: Anthropic Claude via protected same-origin `/api/chat` route handlers (OpenAI/Gemini optional)
- **Rate limiting**: Upstash Redis (REST) for API rate limits
- **Realtime (Express/Socket.IO)**: `server/` is **local-development-only** and is NOT deployed.

> **Beta policy:** Next.js route handlers are the sole production backend. The Express/Socket.IO service in `server/` is local-development-only and never deployed. No `NEXT_PUBLIC_SERVER_URL` is used in production.

## Prerequisites

- Node.js 18+
- npm
- A NeonDB project (PostgreSQL connection string)
- Google OAuth credentials (client ID + secret)
- Anthropic API key (OpenAI/Gemini optional)
- Upstash Redis REST credentials
- Resend API key

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create `.env.local` in the project root:

```bash
# Required
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=your-neon-database-url
ANTHROPIC_API_KEY=your-anthropic-api-key
RESEND_API_KEY=your-resend-api-key
ADMIN_EMAILS=admin@astryon.com
UPSTASH_REDIS_REST_URL=your-upstash-rest-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
```

Optional (enable the corresponding feature if used):

```bash
GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=your-openai-api-key
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

> `ADMIN_EMAILS` is a comma-separated allowlist of beta operator emails, required by the production startup assertion (see `lib/auth.ts`).

### 3. Run the app

```bash
npm run dev
```

Open http://localhost:3000 and sign in with Google.

## Environment Variables Summary

| Variable | Required | Get From |
|----------|----------|----------|
| `GOOGLE_CLIENT_ID` | Yes | Google Cloud Console (OAuth) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google Cloud Console (OAuth) |
| `NEXTAUTH_SECRET` | Yes | Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | Your app URL (localhost in dev) |
| `DATABASE_URL` | Yes | NeonDB connection string |
| `ANTHROPIC_API_KEY` | Yes | Anthropic console |
| `RESEND_API_KEY` | Yes | Resend dashboard |
| `ADMIN_EMAILS` | Yes | Comma-separated beta operator emails |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash console |
| `GEMINI_API_KEY` | No | Google AI Studio |
| `OPENAI_API_KEY` | No | OpenAI platform |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob store |

## Scripts

```bash
npm run dev      # Development server (localhost:3000)
npm run build    # Production build (runs prisma generate first)
npm start        # Start the production build
npm run lint     # ESLint
npm test         # Unit tests (study guide, lifecycle, auth, rate-limit, security, etc.)
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full runbook and [QUICK_DEPLOY.md](./QUICK_DEPLOY.md) for the 7-minute quick start. Key points:

- Deploy the Next.js app to **Vercel**.
- Vercel **build** runs `prisma generate` automatically; generate before `next build`.
- Set the required environment variables in Vercel (Production/Preview/Development).
- Do **not** deploy `server/` and do **not** set `NEXT_PUBLIC_SERVER_URL` in production.
- Secret rotation: regenerate `NEXTAUTH_SECRET`, Google OAuth, Upstash, and provider keys via their dashboards; never commit secrets.

## Local Development Backend (Express/Socket.IO — optional)

The `server/` directory contains a local Express + Socket.IO service used during development only (e.g. realtime collaboration between local browser tabs).

```bash
# Terminal 1 (from app/)
npm run dev

# Terminal 2 (from app/server/)
npm run dev     # WebSocket + Express on :3001
```

Local realtime requires `NEXT_PUBLIC_SERVER_URL=http://localhost:3001` in `app/.env.local`. The production build never opens a Socket.IO connection (the realtime client in `CanvasScene.tsx` is gated off when `NODE_ENV === 'production'`).

## Tech Stack

- **Frontend**: Next.js 15, React 19, React Three Fiber, Tailwind CSS, Zustand
- **Backend**: Next.js route handlers (sole production backend)
- **Database**: NeonDB (Serverless Postgres) via Prisma
- **Auth**: NextAuth with Google OAuth (Prisma adapter)
- **Storage**: Vercel Blob
- **AI**: Anthropic Claude API (OpenAI/Gemini optional)
- **Rate limiting**: Upstash Redis (REST)