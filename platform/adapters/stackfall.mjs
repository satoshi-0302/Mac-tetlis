import { createEntryId, sanitizePlayerName, sanitizeComment } from '../sanitize.mjs';

const CURRENT_RULE_VERSION = 'stackfall-rule-v1';

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const stackfallAdapter = {
  gameId: 'stackfall',
  currentGameVersion: CURRENT_RULE_VERSION,

  loadSeedEntries() {
    return [];
  },

  validateSubmission(payload) {
    const score = Math.max(0, Math.floor(Number(payload?.score) || 0));
    if (!Number.isFinite(score) || score <= 0) {
      throw createSubmissionError('score must be a positive number');
    }

    const replayData = typeof payload?.replayData === 'string' ? payload.replayData : '';
    const replayDigest = typeof payload?.replayDigest === 'string' ? payload.replayDigest : '';

    return {
      id: createEntryId('stackfall'),
      kind: 'human',
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: sanitizeComment(payload?.message ?? ''),
      score,
      summary: {},
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: replayData ? 'stackfall-events-v1' : 'none',
      replayData,
      replayDigest
    };
  },

  toReplayResponse(row) {
    return {
      kind: row.kind,
      id: String(row.id),
      name: row.name,
      message: row.comment,
      score: row.score,
      replayDigest: row.replayDigest,
      replayData: row.replayData,
      summary: {}
    };
  }
};
