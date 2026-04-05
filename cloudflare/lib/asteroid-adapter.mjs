import aiLeaderboardSeed from '../../games/asteroid/public/rl/ai-top10.json' with { type: 'json' };
import { GAMEPLAY_SEED, GAME_VERSION } from '../../games/asteroid/src/engine/constants.js';
import { digestReplayBase64, digestString } from '../../games/asteroid/src/replay/replay.js';
import { runHeadlessReplayFromBase64 } from '../../games/asteroid/src/replay/verify-runner.js';
import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName } from './worker-sanitize.mjs';

let seedEntriesCache = null;

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function verifyReplayData(
  replayData,
  claimedScore,
  replayDigest,
  seed = 0,
  { expectedFinalStateHash = '' } = {}
) {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(replayDigest ?? ''))) {
    throw createSubmissionError('replayDigest must be a SHA-256 hex string');
  }

  const digest = await digestReplayBase64(replayData);
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

  const finalStateHash = await digestString(replayResult.finalStateHashMaterial);
  if (expectedFinalStateHash) {
    if (!/^[a-f0-9]{64}$/i.test(String(expectedFinalStateHash ?? ''))) {
      throw createSubmissionError('finalStateHash must be a SHA-256 hex string');
    }
    if (finalStateHash !== String(expectedFinalStateHash).toLowerCase()) {
      throw createSubmissionError('finalStateHash mismatch');
    }
  }
  if (replayResult.summary.score !== claimedScore) {
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
    if (Array.isArray(seedEntriesCache)) {
      return seedEntriesCache;
    }

    const generatedAt = String(aiLeaderboardSeed?.generatedAt ?? new Date().toISOString());
    const gameVersion = String(aiLeaderboardSeed?.gameVersion ?? GAME_VERSION);
    const entries = Array.isArray(aiLeaderboardSeed?.entries) ? aiLeaderboardSeed.entries : [];

    seedEntriesCache = entries
      .filter((entry) => typeof entry?.replayData === 'string' && entry.replayData.length > 0)
      .map((entry, index) => {
        const seed = Number.isFinite(Number(entry.seed)) ? Number(entry.seed) : GAMEPLAY_SEED;
        return {
          id: String(entry.id ?? `asteroid-ai-${index + 1}`),
          kind: 'ai',
          name: sanitizePlayerName(entry.name, `AI-${index + 1}`),
          comment: sanitizeComment(entry.message ?? ''),
          score: Math.max(0, Math.round(Number(entry.score) || 0)),
          summary: {
            ...(entry.summary && typeof entry.summary === 'object' ? entry.summary : {}),
            seed,
            finalStateHash:
              typeof entry.finalStateHash === 'string'
                ? entry.finalStateHash
                : typeof entry.summary?.finalStateHash === 'string'
                  ? entry.summary.finalStateHash
                  : ''
          },
          gameVersion,
          createdAt: generatedAt,
          replayFormat: 'asteroid-input-base64-v1',
          replayData: entry.replayData,
          replayDigest: String(entry.replayDigest ?? ''),
          finalStateHash:
            typeof entry.finalStateHash === 'string'
              ? entry.finalStateHash
              : typeof entry.summary?.finalStateHash === 'string'
                ? entry.summary.finalStateHash
                : ''
        };
      });

    return seedEntriesCache;
  },

  async validateSubmission(payload) {
    const claimedScore = Math.max(0, Math.round(Number(payload?.score ?? payload?.claimedScore) || 0));
    const seed = Number(payload?.seed ?? 0);
    const verified = await verifyReplayData(payload?.replayData, claimedScore, payload?.replayDigest, seed, {
      expectedFinalStateHash: payload?.finalStateHash
    });

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
      finalStateHash: verified.finalStateHash
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
      finalStateHash: typeof summary.finalStateHash === 'string' ? summary.finalStateHash : '',
      seed: Number(summary.seed ?? 0),
      summary
    };
  }
};
