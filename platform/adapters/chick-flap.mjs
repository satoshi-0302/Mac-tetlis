import { createEntryId, sanitizePlayerName, sanitizeRequiredComment } from '../sanitize.mjs';

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
    const score = Math.max(0, Math.floor(Number(payload?.score) || 0));
    if (!Number.isFinite(score) || score <= 0) {
      throw createSubmissionError('score must be a positive number');
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
      replayFormat: 'none',
      replayData: '',
      replayDigest: ''
    };
  },

  toReplayResponse() {
    throw createSubmissionError('Replay is not supported for chick-flap', 404);
  }
};
