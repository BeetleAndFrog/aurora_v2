import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireUser } from '@/lib/authz';
import { parseBoundedJson } from '@/lib/requestBound';
import { encryptApiKey } from '@/lib/modelConfigCrypto';
import { isSafeBaseUrl } from '@/lib/modelConfigValidation';
import prisma from '@/lib/prisma';

/**
 * Map a session user id to a DB user id. (Mirrors app/api/upload/route.ts's
 * userIdForSession.)
 */
async function userIdForSession(
  sessionUserId: string | null | undefined,
  sessionEmail: string | null | undefined
): Promise<string | null> {
  if (sessionUserId) {
    const byId = await prisma.user.findUnique({ where: { id: sessionUserId } });
    if (byId) return byId.id;
  }
  if (sessionEmail) {
    const byEmail = await prisma.user.findUnique({ where: { email: sessionEmail } });
    if (byEmail) return byEmail.id;
  }
  return null;
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const dbUserId = await userIdForSession(user.id, user.email);
  const row = dbUserId
    ? await prisma.modelConfig.findUnique({ where: { userId: dbUserId } })
    : null;

  if (!row) {
    return NextResponse.json({ hasConfig: false });
  }

  // Never return apiKeyCiphertext/apiKeyIv — write-only from the client's
  // perspective once saved.
  return NextResponse.json({
    hasConfig: true,
    label: row.label,
    baseUrl: row.baseUrl,
    model: row.model,
    verifiedAt: row.verifiedAt,
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const dbUserId = await userIdForSession(user.id, user.email);
  if (!dbUserId) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
  }

  const parsed = await parseBoundedJson(request);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }

  const { label, baseUrl, model, apiKey } = parsed.body as Record<string, unknown>;

  if (typeof baseUrl !== 'string' || typeof model !== 'string' || typeof apiKey !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'baseUrl, model, and apiKey are required' },
      { status: 400 }
    );
  }
  if (!isSafeBaseUrl(baseUrl)) {
    return NextResponse.json({ ok: false, error: 'Invalid or disallowed base URL' }, { status: 400 });
  }
  if (apiKey.length === 0 || apiKey.length > 2000) {
    return NextResponse.json({ ok: false, error: 'Invalid API key' }, { status: 400 });
  }

  // Test live before persisting anything — a bad key/URL/model surfaces
  // immediately here, not on first real chat use.
  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey });
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });
  } catch (err: any) {
    const message =
      err?.error?.message || err?.message || 'Could not connect with this configuration.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const { ciphertext, iv } = await encryptApiKey(apiKey);
  const now = new Date();

  await prisma.modelConfig.upsert({
    where: { userId: dbUserId },
    create: {
      userId: dbUserId,
      label: typeof label === 'string' ? label : null,
      baseUrl,
      model,
      apiKeyCiphertext: ciphertext,
      apiKeyIv: iv,
      verifiedAt: now,
    },
    update: {
      label: typeof label === 'string' ? label : null,
      baseUrl,
      model,
      apiKeyCiphertext: ciphertext,
      apiKeyIv: iv,
      verifiedAt: now,
    },
  });

  return NextResponse.json({ ok: true });
}
