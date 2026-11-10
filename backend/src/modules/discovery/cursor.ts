import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/api-error';

/**
 * Keyset cursor for the ranked feed. `anchor` fixes "now" for the whole
 * session, so scores (which depend on time) stay stable from page to page;
 * (score, id) is the position after which the next page starts.
 */
export interface FeedCursor {
  anchor: number; // epoch ms
  score: number;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ANCHOR_AGE_MS = 6 * 60 * 60 * 1000;

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify([c.anchor, c.score, c.id])).toString('base64url');
}

export function decodeCursor(raw: string, now = Date.now()): FeedCursor {
  try {
    const [anchor, score, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (
      typeof anchor === 'number' &&
      typeof score === 'number' &&
      Number.isFinite(score) &&
      typeof id === 'string' &&
      UUID.test(id) &&
      anchor <= now + 60_000 &&
      now - anchor <= MAX_ANCHOR_AGE_MS
    ) {
      return { anchor, score, id };
    }
  } catch {
    // fall through
  }
  throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'This list has expired. Pull to refresh.', {
    fields: [{ path: 'cursor', message: 'Invalid or expired cursor' }],
  });
}
