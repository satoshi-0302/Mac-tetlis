import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAME_VERSION, MAX_TICKS } from '../../games/asteroid/src/engine/constants.js';
import { runReplay } from '../../games/asteroid/src/game/sim-core.js';
import { createSpawnSchedule } from '../../games/asteroid/src/game/spawn-schedule.js';
import { decodeReplay, validateReplayBytes } from '../../games/asteroid/src/replay/replay.js';
import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName, sha256 } from '../sanitize.mjs';

const ROOT_DIR = fileURLToPath(new URL('../../games/asteroid/', import.meta.url));
const AI_LEADERBOARD_PATH = join(ROOT_DIR, 'public', 'rl', 'ai-top10.json');
function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function verifyReplayData(replayData, claimedScore, replayDigest, seed = 0) {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(replayDigest ?? ''))) {
    throw createSubmissionError('replayDigest must be a SHA-256 hex string');
  }

  let replayBytes;
  try {
    replayBytes = decodeReplay(replayData);
  } catch {
    throw createSubmissionError('replayData is not valid base64');
  }

  if (!validateReplayBytes(replayBytes) || replayBytes.length !== MAX_TICKS) {
    throw createSubmissionError(`replayData must decode to exactly ${MAX_TICKS} frames`);
  }

  const digest = sha256(replayData);
  if (digest !== String(replayDigest).toLowerCase()) {
    throw createSubmissionError('replayDigest mismatch');
  }

  const spawnSchedule = createSpawnSchedule(seed);
  const replayResult = runReplay(replayBytes, spawnSchedule);
  if (replayResult.summary.score !== claimedScore) {
    throw createSubmissionError(
      `score mismatch after verification (submitted ${claimedScore}, verified ${replayResult.summary.score}, seed ${seed})`
    );
  }

  return {
    replayDigest: digest,
    summary: {
      ...replayResult.summary,
      seed
    }
  };
}

export const asteroidAdapter = {
  gameId: 'asteroid',
  currentGameVersion: GAME_VERSION,

  loadSeedEntries() {
    try {
      const parsed = JSON.parse(readFileSync(AI_LEADERBOARD_PATH, 'utf8'));
      const generatedAt = String(parsed?.generatedAt ?? new Date().toISOString());
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];

      return entries
        .filter((entry) => typeof entry?.replayData === 'string' && entry.replayData.length > 0)
        .map((entry, index) => {
          try {
            const verified = verifyReplayData(
              entry.replayData,
              Math.max(0, Math.round(Number(entry.score) || 0)),
              entry.replayDigest,
              Number(entry.seed ?? 0)
            );
            return {
              id: String(entry.id ?? `asteroid-ai-${index + 1}`),
              kind: 'ai',
              name: sanitizePlayerName(entry.name, `AI-${index + 1}`),
              comment: sanitizeComment(entry.message ?? ''),
              score: Math.max(0, Math.round(Number(entry.score) || 0)),
              summary: verified.summary,
              gameVersion: String(parsed?.gameVersion ?? GAME_VERSION),
              createdAt: generatedAt,
              replayFormat: 'asteroid-input-base64-v1',
              replayData: entry.replayData,
              replayDigest: verified.replayDigest,
              seed: Number(entry.seed ?? 0)
            };
          } catch (e) {
            console.warn(`[AsteroidAdapter] Seed entry #${index + 1} failed verification: ${e.message}`);
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      console.error(`[AsteroidAdapter] Critical failure loading seed entries: ${err.message}`);
      return [];
    }
  },

  validateSubmission(payload) {
    const claimedScore = Math.max(0, Math.round(Number(payload?.score ?? payload?.claimedScore) || 0));
    const verified = verifyReplayData(
      payload?.replayData,
      claimedScore,
      payload?.replayDigest,
      Number(payload?.seed ?? 0)
    );

    return {
      id: createEntryId('asteroid'),
      kind: payload?.kind === 'ai' ? 'ai' : 'human',
      name: sanitizePlayerName(payload?.name, 'ANON'),
      comment: sanitizeComment(payload?.message ?? payload?.comment ?? ''),
      score: verified.summary.score,
      summary: verified.summary,
      gameVersion: GAME_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'asteroid-input-base64-v1',
      replayData: payload.replayData,
      replayDigest: verified.replayDigest,
      seed: Number(payload?.seed ?? 0)
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
      seed: Number(summary.seed ?? row.seed ?? 0),
      summary
    };
  }
};
