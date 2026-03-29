import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAMEPLAY_SEED, GAME_VERSION } from '../../games/asteroid/src/engine/constants.js';
import { runHeadlessReplayFromBase64 } from '../../games/asteroid/src/replay/verify-runner.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.mjs';

const ROOT_DIR = fileURLToPath(new URL('../../games/asteroid/', import.meta.url));
const AI_LEADERBOARD_PATH = join(ROOT_DIR, 'public', 'rl', 'ai-top10.json');
function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function verifyReplayData(
  replayData,
  claimedScore,
  replayDigest,
  seed = 0,
  { requireClaimedScoreMatch = true, expectedFinalStateHash = '' } = {}
) {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(replayDigest ?? ''))) {
    throw createSubmissionError('replayDigest must be a SHA-256 hex string');
  }

  const digest = sha256(replayData);
  if (digest !== String(replayDigest).toLowerCase()) {
    throw createSubmissionError('replayDigest mismatch');
  }

  const resolvedSeed = Number.isFinite(Number(seed)) ? Number(seed) : GAMEPLAY_SEED;
  let replayResult;
  try {
    replayResult = runHeadlessReplayFromBase64(replayData, { seed: resolvedSeed });
  } catch (error) {
    throw createSubmissionError(error instanceof Error ? error.message : 'Invalid replayData');
  }

  const finalStateHash = sha256(replayResult.finalStateHashMaterial);
  if (expectedFinalStateHash) {
    if (!/^[a-f0-9]{64}$/i.test(String(expectedFinalStateHash))) {
      throw createSubmissionError('finalStateHash must be a SHA-256 hex string');
    }
    if (finalStateHash !== String(expectedFinalStateHash).toLowerCase()) {
      throw createSubmissionError('finalStateHash mismatch');
    }
  }
  if (requireClaimedScoreMatch && replayResult.summary.score !== claimedScore) {
    throw createSubmissionError(
      `score mismatch after verification (submitted ${claimedScore}, verified ${replayResult.summary.score}, seed ${resolvedSeed})`
    );
  }

  return {
    replayDigest: digest,
    summary: {
      ...replayResult.summary,
      seed: resolvedSeed,
      finalStateHash
    },
    finalStateHash
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
              Number(entry.seed ?? 0),
              { requireClaimedScoreMatch: false }
            );
            const verifiedScore = Math.max(0, Math.round(Number(verified.summary?.score) || 0));
            return {
              id: String(entry.id ?? `asteroid-ai-${index + 1}`),
              kind: 'ai',
              name: sanitizePlayerName(entry.name, `AI-${index + 1}`),
              comment: sanitizeRequiredComment(entry.message ?? '', `AI RUN ${index + 1}`),
              score: verifiedScore,
              summary: verified.summary,
              gameVersion: String(parsed?.gameVersion ?? GAME_VERSION),
              createdAt: generatedAt,
              replayFormat: 'asteroid-input-base64-v1',
              replayData: entry.replayData,
              replayDigest: verified.replayDigest,
              finalStateHash: verified.finalStateHash,
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
      Number(payload?.seed ?? 0),
      { expectedFinalStateHash: payload?.finalStateHash }
    );

    return {
      id: createEntryId('asteroid'),
      kind: payload?.kind === 'ai' ? 'ai' : 'human',
      name: sanitizePlayerName(payload?.name, 'ANON'),
      comment: sanitizeRequiredComment(payload?.message ?? payload?.comment ?? ''),
      score: verified.summary.score,
      summary: verified.summary,
      gameVersion: GAME_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'asteroid-input-base64-v1',
      replayData: payload.replayData,
      replayDigest: verified.replayDigest,
      finalStateHash: verified.finalStateHash,
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
      finalStateHash: typeof summary.finalStateHash === 'string' ? summary.finalStateHash : '',
      seed: Number(summary.seed ?? row.seed ?? 0),
      summary
    };
  }
};
