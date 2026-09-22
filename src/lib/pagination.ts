/**
 * Opaque cursor helpers for keyset ("seek") pagination over Mongo documents
 * ordered by `createdAt desc, _id desc`. Using (createdAt, _id) together keeps
 * pagination stable even when multiple documents share the same timestamp.
 */

interface CursorPayload {
  createdAt: string;
  id: string;
}

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export const encodeCursor = (createdAt: Date, id: string): string => {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

export const decodeCursor = (cursor: string): DecodedCursor | null => {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<CursorPayload>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;

    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
};
