import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../../core/config/env.js';

/**
 * Push subscriptions contain an endpoint URL + keys that let anyone send
 * notifications to that browser, so they are encrypted at rest (AES-256-GCM).
 * The endpoint is also stored as a SHA-256 hash, for the unique index/lookup.
 */
const key: Buffer = (() => {
  if (env.PUSH_ENCRYPTION_KEY) {
    const decoded = Buffer.from(env.PUSH_ENCRYPTION_KEY, 'base64');
    if (decoded.length !== 32) throw new Error('PUSH_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    return decoded;
  }
  return Buffer.from(hkdfSync('sha256', env.SESSION_SECRET, 'chat-backend', 'push-subscription-encryption', 32));
})();

export const encrypt = (plaintext: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
};

export const decrypt = (payload: string): string => {
  const data = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
};

export const hashEndpoint = (endpoint: string): string => createHash('sha256').update(endpoint).digest('hex');
