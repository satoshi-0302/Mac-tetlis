import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveVerifiedReplaySummary,
  normalizeReplayPayload,
  readReplay
} from '../../games/missile-command/server/replay-store.js';
import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName, sha256 } from '../sanitize.mjs';

const ROOT_DIR = fileURLToPath(new URL('../../games/missile-command/', import.meta.url));
const LEADERBOARD_PATH = join(ROOT_DIR, 'data', 'leaderboard.json');
const REPLAY_DIR = join(ROOT_DIR, 'data', 'replays');
const DEFAULT_GAME_VERSION = 'orbital-shield-rl-poc-v3';

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const missileCommandAdapter = {
  gameId: 'missile-command',
  currentGameVersion: DEFAULT_GAME_VERSION,

  loadSeedEntries() {
    try {
      const parsed = JSON.parse(readFileSync(LEADERBOARD_PATH, 'utf8'));
      const sourceEntries = [
        ...(Array.isArray(parsed?.humanEntries) ? parsed.humanEntries : []),
        ...(Array.isArray(parsed?.aiEntries) ? parsed.aiEntries : [])
      ];

      return sourceEntries
        .filter((entry) => entry?.replayAvailable && entry?.replayId)
        .map((entry) => {
          const replay = readReplay(REPLAY_DIR, entry.replayId);
          const verifiedSummary = replay ? deriveVerifiedReplaySummary(replay) : null;
          if (!verifiedSummary) {
            return null;
          }

          const replayData = JSON.stringify(replay);
          return {
            id: String(entry.id ?? createEntryId('missile')),
            kind: entry.kind === 'ai' ? 'ai' : 'human',
            name: sanitizePlayerName(entry.name, entry.kind === 'ai' ? 'DEMO AI' : 'PILOT'),
            comment: sanitizeComment(entry.comment ?? ''),
            score: verifiedSummary.score,
            summary: verifiedSummary,
            gameVersion: String(replay.meta?.gameVersion ?? parsed?.gameVersion ?? DEFAULT_GAME_VERSION),
            createdAt: String(entry.createdAt ?? new Date().toISOString()),
            replayFormat: 'missile-replay-json-v1',
            replayData,
            replayDigest: sha256(replayData)
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  },

  validateSubmission(payload) {
    const kind = payload?.kind === 'ai' ? 'ai' : 'human';
    const replay = normalizeReplayPayload(payload?.replay, {
      kind,
      name: sanitizePlayerName(payload?.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
      policyName: '',
      note: '',
      source: '',
      score: Math.max(0, Math.round(Number(payload?.score) || 0)),
      maxChain: Math.max(0, Math.round(Number(payload?.maxChain) || 0)),
      survivingCities: Math.max(0, Math.round(Number(payload?.survivingCities) || 0)),
      clear: Boolean(payload?.clear)
    });
    if (!replay) {
      throw createSubmissionError('Replay is required for MissileCommand submissions');
    }

    const verifiedSummary = deriveVerifiedReplaySummary(replay);
    if (!verifiedSummary) {
      throw createSubmissionError('Replay verification failed for MissileCommand');
    }

    const replayData = JSON.stringify(replay);
    return {
      id: createEntryId('missile'),
      kind,
      name: sanitizePlayerName(payload?.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
      comment: sanitizeComment(payload?.comment ?? ''),
      score: verifiedSummary.score,
      summary: verifiedSummary,
      gameVersion: String(replay.meta?.gameVersion ?? DEFAULT_GAME_VERSION),
      createdAt: new Date().toISOString(),
      replayFormat: 'missile-replay-json-v1',
      replayData,
      replayDigest: sha256(replayData)
    };
  },

  toReplayResponse(row) {
    return parseStoredJson(row.replayData, null);
  }
};
