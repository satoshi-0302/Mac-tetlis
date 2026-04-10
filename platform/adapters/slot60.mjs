import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.mjs';

const CURRENT_RULE_VERSION = 'slot60-rule-v1';
const ROOT_DIR = fileURLToPath(new URL('../../games/slot60/', import.meta.url));
const SEED_PATH = join(ROOT_DIR, 'data', 'leaderboard-seed.json');

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isSymbol(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3;
}

function parseReplayPayload(replayData) {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }

  const parsed = parseStoredJson(replayData, null);
  if (!parsed || parsed.version !== 'slot60-replay-v2') {
    throw createSubmissionError('replayData must be a slot60-replay-v2 JSON string');
  }

  if (!Array.isArray(parsed.strips) || parsed.strips.length !== 3) {
    throw createSubmissionError('replayData.strips must contain exactly 3 reels');
  }
  for (const strip of parsed.strips) {
    if (!Array.isArray(strip) || strip.length === 0 || strip.some((symbol) => !isSymbol(symbol))) {
      throw createSubmissionError('replayData.strips must be arrays of slot symbols');
    }
  }

  if (Math.max(0, Math.floor(Number(parsed.totalTicks) || 0)) !== 3600) {
    throw createSubmissionError('replayData.totalTicks must be exactly 3600');
  }

  if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
    throw createSubmissionError('replayData.actions must contain at least one action');
  }

  let previousTick = -1;
  for (const action of parsed.actions) {
    const tick = Math.max(0, Math.floor(Number(action?.tick) || 0));
    if (tick < previousTick) {
      throw createSubmissionError('Replay actions must be ordered by tick');
    }
    if (tick >= 3600) {
      throw createSubmissionError('Replay actions must stay within the 3600 tick window');
    }
    if (action?.action !== 'primary') {
      throw createSubmissionError('Replay actions only support primary input');
    }
    previousTick = tick;
  }

  return parsed;
}

export const slot60Adapter = {
  gameId: 'slot60',
  currentGameVersion: CURRENT_RULE_VERSION,

  loadSeedEntries() {
    try {
      const parsed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      return entries
        .map((entry) => {
          const replayData = typeof entry?.replayData === 'string' ? entry.replayData : '';
          const replayDigest = typeof entry?.replayDigest === 'string' ? entry.replayDigest.toLowerCase() : '';
          if (!replayData || !/^[a-f0-9]{64}$/i.test(replayDigest) || sha256(replayData) !== replayDigest) {
            return null;
          }

          const replay = parseReplayPayload(replayData);
          const verifiedScore = Math.max(0, Math.floor(Number(replay?.finalScore ?? entry?.score) || 0));
          return {
            id: String(entry?.id || createEntryId('slot60')),
            kind: entry?.kind === 'ai' ? 'ai' : 'human',
            name: sanitizePlayerName(entry?.name, 'PLAYER'),
            comment: sanitizeRequiredComment(entry?.comment ?? '', 'NO COMMENT'),
            score: verifiedScore,
            summary: {
              actions: replay.actions.length,
              totalTicks: replay.totalTicks
            },
            gameVersion: CURRENT_RULE_VERSION,
            createdAt: String(entry?.createdAt || new Date().toISOString()),
            replayFormat: 'slot60-action-log-v2',
            replayData,
            replayDigest
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
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

    const replay = parseReplayPayload(replayData);
    const verifiedScore = Math.max(0, Math.floor(Number(replay?.finalScore ?? 0) || 0));
    if (verifiedScore !== score) {
      throw createSubmissionError(`score mismatch after verification (submitted ${score}, verified ${verifiedScore})`);
    }

    return {
      id: createEntryId('slot60'),
      kind: 'human',
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: sanitizeRequiredComment(payload?.message ?? payload?.comment ?? ''),
      score: verifiedScore,
      summary: {
        actions: replay.actions.length,
        totalTicks: replay.totalTicks
      },
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'slot60-action-log-v2',
      replayData,
      replayDigest: replayDigest.toLowerCase()
    };
  },

  toReplayResponse(row) {
    return parseStoredJson(row.replayData, null);
  }
};
