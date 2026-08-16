/**
 * Unit tests for the BYOK model-connect feature (2026-08-13 design doc):
 * the encrypt/decrypt round-trip for a user's stored API key, and the
 * baseUrl SSRF guard used before app/api/model-config/route.ts makes any
 * outbound request to a user-supplied URL.
 *
 * Run with: npx tsx lib/__tests__/modelConfig.test.ts
 */

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-modelConfig-tests-only';

import { encryptApiKey, decryptApiKey } from '../modelConfigCrypto';
import { isSafeBaseUrl } from '../modelConfigValidation';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

async function main() {
  await test('encrypt/decrypt round-trip preserves a typical API key', async () => {
    const original = 'sk-or-v1-abcdef1234567890';
    const { ciphertext, iv } = await encryptApiKey(original);
    assert(ciphertext !== original, 'ciphertext must not equal plaintext');
    const decrypted = await decryptApiKey(ciphertext, iv);
    assert(decrypted === original, `decrypted key should match original, got ${decrypted}`);
  });

  await test('encrypt/decrypt round-trip handles an empty string', async () => {
    const { ciphertext, iv } = await encryptApiKey('');
    const decrypted = await decryptApiKey(ciphertext, iv);
    assert(decrypted === '', 'empty string should round-trip to empty string');
  });

  await test('encrypt/decrypt round-trip handles a long key', async () => {
    const original = 'x'.repeat(500);
    const { ciphertext, iv } = await encryptApiKey(original);
    const decrypted = await decryptApiKey(ciphertext, iv);
    assert(decrypted === original, 'long key should round-trip unchanged');
  });

  await test('two encryptions of the same key produce different ciphertexts', async () => {
    const a = await encryptApiKey('same-key');
    const b = await encryptApiKey('same-key');
    assert(a.iv !== b.iv, 'each encryption should use a fresh random IV');
    assert(a.ciphertext !== b.ciphertext, 'ciphertext should differ across encryptions (fresh IV)');
  });

  await test('decrypting with a tampered ciphertext throws (auth tag mismatch)', async () => {
    const { ciphertext, iv } = await encryptApiKey('secret-value');
    const tampered = ciphertext.slice(0, -4) + 'AAAA';
    let threw = false;
    try {
      await decryptApiKey(tampered, iv);
    } catch {
      threw = true;
    }
    assert(threw, 'tampered ciphertext must fail to decrypt, not silently return wrong plaintext');
  });

  test('isSafeBaseUrl accepts plain https URLs', () => {
    assert(isSafeBaseUrl('https://openrouter.ai/api/v1'), 'https URL should be accepted');
    assert(isSafeBaseUrl('http://api.example.com/v1'), 'http URL should be accepted');
  });

  test('isSafeBaseUrl rejects non-http(s) schemes', () => {
    assert(!isSafeBaseUrl('file:///etc/passwd'), 'file:// must be rejected');
    assert(!isSafeBaseUrl('ftp://example.com'), 'ftp:// must be rejected');
    assert(!isSafeBaseUrl('gopher://example.com'), 'gopher:// must be rejected');
  });

  test('isSafeBaseUrl rejects private/link-local hosts', () => {
    assert(!isSafeBaseUrl('http://127.0.0.1/v1'), '127.0.0.1 must be rejected');
    assert(!isSafeBaseUrl('http://localhost:11434/v1'), 'localhost must be rejected');
    assert(!isSafeBaseUrl('http://10.0.0.5/v1'), '10.x must be rejected');
    assert(!isSafeBaseUrl('http://192.168.1.1/v1'), '192.168.x must be rejected');
    assert(!isSafeBaseUrl('http://169.254.169.254/latest/meta-data'), '169.254.x (cloud metadata) must be rejected');
  });

  test('isSafeBaseUrl rejects malformed input', () => {
    assert(!isSafeBaseUrl('not a url'), 'garbage input must be rejected');
    assert(!isSafeBaseUrl(''), 'empty string must be rejected');
  });

  console.log('All modelConfig test groups passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
