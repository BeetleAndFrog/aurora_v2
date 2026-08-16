// BYOK model connect (2026-08-13 design doc): encrypt/decrypt for
// ModelConfig.apiKeyCiphertext. AES-256-GCM with a key derived from
// NEXTAUTH_SECRET via @panva/hkdf — the same derivation next-auth's own JWT
// encoding uses internally (node_modules/next-auth/jwt/index.js's
// getDerivedEncryptionKey), reused conceptually here, not imported from
// next-auth internals. Unlike lib/betaAccess.ts's one-way hashInviteToken,
// this must be reversible: outbound provider calls need the plaintext key.
//
// ponytail: ships without prisma/model-config route wiring — ModelConfig
// (prisma/schema.prisma) already exists from a parallel change; the
// GET/POST /api/model-config route is a separate agent's task. This file
// only provides the encrypt/decrypt primitives app/api/chat/route.ts needs
// to decrypt a saved key before calling the user's model.

import { hkdf } from '@panva/hkdf';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_INFO = 'Astryon ModelConfig API Key Encryption';
const IV_LENGTH = 12; // recommended nonce size for GCM
const AUTH_TAG_LENGTH = 16;

async function deriveKey(): Promise<Buffer> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not configured');
  const key = await hkdf('sha256', secret, '', KEY_INFO, 32);
  return Buffer.from(key);
}

/** Encrypt a plaintext API key. Returns base64 ciphertext (with appended auth tag) + base64 iv. */
export async function encryptApiKey(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

/** Decrypt a ciphertext produced by encryptApiKey back to the plaintext API key. */
export async function decryptApiKey(ciphertext: string, iv: string): Promise<string> {
  const key = await deriveKey();
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < AUTH_TAG_LENGTH) throw new Error('Malformed ciphertext');
  const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(0, raw.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
