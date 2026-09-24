import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './pagination.js';

describe('pagination cursor', () => {
  it('round-trips createdAt and id through encode/decode', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const cursor = encodeCursor(createdAt, '507f1f77bcf86cd799439011');

    const decoded = decodeCursor(cursor);

    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded?.id).toBe('507f1f77bcf86cd799439011');
  });

  it('returns null for garbage input instead of throwing', () => {
    expect(decodeCursor('not-a-real-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null when the encoded payload has the wrong shape', () => {
    const malformed = Buffer.from(JSON.stringify({ createdAt: 123, id: null }), 'utf8').toString('base64url');
    expect(decodeCursor(malformed)).toBeNull();
  });

  it('returns null when createdAt is not a valid date string', () => {
    const malformed = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'abc' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(malformed)).toBeNull();
  });
});
