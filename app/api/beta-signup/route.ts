import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { normalizeEmail } from '@/lib/betaAccess'
import { buildInviteLink, computeTransitionDeltas, sendInviteEmail } from '@/lib/betaAdmin'
import { evalRateLimit, getClientIp } from '@/lib/rateLimit'

const webOrigin = process.env.NEXT_PUBLIC_WEB_URL ?? '*'

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': webOrigin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

// BETA-09/DEC-03: public signup is guarded per-IP before any DB or email work.
// Deny-closed: limiter error or missing config denies the request (503).
const SIGNUP_LIMIT = 10;        // applications
const SIGNUP_WINDOW_SECONDS = 60 * 60; // per hour per IP

export async function POST(request: NextRequest) {
  const limit = await evalRateLimit(
    `rl:signup:ip:${getClientIp(request)}`,
    SIGNUP_LIMIT,
    SIGNUP_WINDOW_SECONDS
  );
  if (!limit.allowed) {
    // Generic response: no detail that would help an attacker retry or probe.
    const status = limit.denyClosed ? 503 : 429;
    return NextResponse.json(
      { error: status === 503 ? 'Service temporarily unavailable' : 'Too many attempts, please try again later' },
      { status, headers: { 'Access-Control-Allow-Origin': webOrigin } }
    );
  }

  const { email, learningGoal } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const normalizedEmail = normalizeEmail(email)

  const existing = await prisma.betaSignup.findUnique({
    where: { email: normalizedEmail },
  })
  if (existing) {
    // Generic response on duplicates — no 409 tell that reveals whether an
    // email already applied (BETA-09 acceptance: no email enumeration). No
    // email is sent, so a pre-existing applicant is not re-contacted either.
    return NextResponse.json({ ok: true, status: 'approved' }, {
      headers: { 'Access-Control-Allow-Origin': webOrigin },
    })
  }

  // DEC-04: moderation is reactive, not proactive — new applications are
  // auto-approved on creation instead of waiting on manual operator review
  // (superseding DEC-01). An operator can still revoke a signup after the
  // fact via /admin if it turns out to be spam/abuse. Reuse the same
  // pending->approved transition an operator's manual approve would have
  // produced, so a fresh signup is byte-for-byte what a pending row looked
  // like immediately after approval: fresh invite token/hash/expiry bound to
  // the applicant email via `invitedEmail`. The raw token is never stored:
  // only its SHA-256 hash, so a database leak cannot mint usable invite links.
  const deltas = computeTransitionDeltas('approve', {
    status: 'pending',
    email: normalizedEmail,
    invitedEmail: normalizedEmail,
  })

  await prisma.betaSignup.create({
    data: {
      email: normalizedEmail,
      learningGoal,
      ...deltas.data,
    },
  })

  // Auto-approval means there's no later manual-approve step to send the
  // invite email from, so send it here instead — same invite email the
  // admin approve action sends (lib/betaAdmin.ts sendInviteEmail). Best
  // effort: a transient send failure doesn't roll back the already-committed
  // approval; the operator can re-invite from /admin.
  if (deltas.emailToken) {
    await sendInviteEmail({
      to: normalizedEmail,
      inviteLink: buildInviteLink(deltas.emailToken),
    })
  }

  return NextResponse.json({ ok: true, status: 'approved' }, {
    headers: { 'Access-Control-Allow-Origin': webOrigin },
  })
}
