import { createEntryId, sanitizePlayerName } from '../sanitize.mjs';

const CURRENT_RULE_VERSION = 'slot60-rule-v1';

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const slot60Adapter = {
  gameId: 'slot60',
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
      id: createEntryId('slot60'),
      kind: 'human',
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: '',
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
    return null;
  }
};
