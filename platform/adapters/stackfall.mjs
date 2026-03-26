import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.mjs';

const CURRENT_RULE_VERSION = 'stackfall-rule-v1';

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseReplayPayload(replayData) {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(replayData, 'base64').toString('utf8'));
  } catch {
    throw createSubmissionError('replayData must be valid base64 JSON');
  }

  const seed = Number(decoded?.seed);
  const events = decoded?.events;
  if (!Number.isInteger(seed) || seed < 0) {
    throw createSubmissionError('replayData.seed must be a non-negative integer');
  }
  if (!events || typeof events !== 'object' || Array.isArray(events)) {
    throw createSubmissionError('replayData.events must be an object');
  }

  for (const [tick, input] of Object.entries(events)) {
    if (!/^\d+$/.test(String(tick))) {
      throw createSubmissionError('replayData.events keys must be tick numbers');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw createSubmissionError('replayData.events values must be objects');
    }
  }

  return { seed, events };
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
    if (!/^[a-f0-9]{64}$/i.test(replayDigest)) {
      throw createSubmissionError('replayDigest must be a SHA-256 hex string');
    }
    if (sha256(replayData) !== replayDigest.toLowerCase()) {
      throw createSubmissionError('replayDigest mismatch');
    }
    parseReplayPayload(replayData);

    return {
      id: createEntryId('stackfall'),
      kind: 'human',
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: sanitizeRequiredComment(payload?.message ?? payload?.comment ?? ''),
      score,
      summary: {},
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'stackfall-events-v1',
      replayData,
      replayDigest
    };
  },

  toReplayResponse(row) {
    const replay = parseStoredJson(Buffer.from(String(row.replayData ?? ''), 'base64').toString('utf8'), null);
    return {
      kind: row.kind,
      id: String(row.id),
      name: row.name,
      message: row.comment,
      score: row.score,
      replayDigest: row.replayDigest,
      replayData: row.replayData,
      seed: replay?.seed,
      events: replay?.events,
      summary: {}
    };
  }
};
