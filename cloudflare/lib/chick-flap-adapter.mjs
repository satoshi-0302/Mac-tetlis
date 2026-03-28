import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName, sha256 } from './worker-sanitize.mjs';

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

  async validateSubmission(payload) {
    const score = Math.max(0, Math.floor(Number(payload?.score ?? payload?.claimedScore) || 0));
    const replayData = typeof payload?.replayData === 'string' ? payload.replayData : '';
    const replayDigest = typeof payload?.replayDigest === 'string' ? payload.replayDigest : '';

    if (!Number.isFinite(score) || score <= 0) {
      throw createSubmissionError('score must be a positive number');
    }

    // Hash check for workers (uses SubtleCrypto sha256 via worker-sanitize.mjs)
    if (replayData) {
      const actualDigest = await sha256(replayData);
      if (actualDigest !== replayDigest) {
        throw createSubmissionError('replayDigest mismatch');
      }
    }

    return {
      id: createEntryId('chick'),
      kind: 'human',
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: sanitizeComment(payload?.message ?? payload?.comment ?? ''),
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
    const summary = parseStoredJson(row.summary_json, {});
    return {
      kind: row.kind,
      id: String(row.id),
      name: row.name,
      message: row.comment,
      score: row.score,
      replayDigest: row.replay_digest,
      replayData: row.replay_data,
      summary
    };
  }
};
