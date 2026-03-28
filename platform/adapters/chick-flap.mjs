import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.mjs';

const CURRENT_RULE_VERSION = 'chick-flap-phaser-v2-leaderboard-mobile';

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const chickFlapAdapter = {
  gameId: 'chick-flap',
  currentGameVersion: CURRENT_RULE_VERSION,

  loadSeedEntries() {
    return [];
  },

  validateSubmission(payload) {
    const score = Math.max(0, Math.floor(Number(payload?.score ?? payload?.claimedScore) || 0));
    const replayData = typeof payload?.replayData === 'string' ? payload.replayData : '';
    const replayDigest = typeof payload?.replayDigest === 'string' ? payload.replayDigest : '';

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
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: sanitizeRequiredComment(payload?.message ?? payload?.comment ?? ''),
      score,
      summary: {},
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: replayData ? 'chick-input-v1' : 'none',
      replayData,
      replayDigest
    };
  },

  toReplayResponse(row) {
    const summary = parseStoredJson(row.summaryJson, {});
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
};
