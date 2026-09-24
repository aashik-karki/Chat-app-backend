/**
 * Opaque cursor helpers for keyset pagination ordered by `createdAt desc, _id desc`.
 */
interface CursorPayload {
  createdAt: string;
  id: string;
}

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id } satisfies CursorPayload), 'utf8').toString('base64url');

export const decodeCursor = (cursor: string): DecodedCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    if (!/^[a-f\d]{24}$/i.test(parsed.id)) return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
};