import type { DbRow, GameAdapter, LeaderboardEntry } from '../types.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.js';

const CURRENT_RULE_VERSION = 'chick-flap-phaser-v2-leaderboard-mobile';

function createSubmissionError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export const chickFlapAdapter = {
  gameId: 'chick-flap',

  loadSeedEntries(): LeaderboardEntry[] {
    return [];
  },

  validateSubmission(payload: unknown): LeaderboardEntry {
    const p = (payload ?? {}) as Record<string, unknown>;
    const score = Math.max(0, Math.floor(Number(p.score ?? p.claimedScore) || 0));
    const replayData = typeof p.replayData === 'string' ? p.replayData : '';
    const replayDigest = typeof p.replayDigest === 'string' ? p.replayDigest : '';

    if (!Number.isFinite(score) || score <= 0) {
      throw createSubmissionError('score must be a positive number');
    }

    // Minimum verification for now
    if (replayData && sha256(replayData) !== replayDigest) {
      throw createSubmissionError('replayDigest mismatch');
    }

    return {
      id: createEntryId('chick'),
      kind: 'human',
      name: sanitizePlayerName(p.name, 'PLAYER'),
      comment: sanitizeRequiredComment(p.message ?? p.comment ?? ''),
      score,
      summary: {},
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: replayData ? 'chick-input-v1' : 'none',
      replayData,
      replayDigest
    };
  },

  toReplayResponse(row: DbRow): unknown {
    const summary = parseStoredJson<Record<string, unknown>>(row.summaryJson, {});
    return {
      kind: row.kind,
      id: String(row.id),
      name: row.name,
      message: row.comment,
      score: row.score,
      replayDigest: row.replayDigest,
      replayData: row.replayData,
      summary
    };
  }
} satisfies GameAdapter;
