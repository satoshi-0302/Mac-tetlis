import { GAME_VERSION, MAX_TICKS } from '../../games/asteroid/src/engine/constants.js';
import { runReplay } from '../../games/asteroid/src/game/sim-core.js';
import { createSpawnSchedule } from '../../games/asteroid/src/game/spawn-schedule.js';
import { decodeReplay, digestReplayBase64, validateReplayBytes } from '../../games/asteroid/src/replay/replay.js';
import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName } from './worker-sanitize.mjs';

const spawnSchedule = createSpawnSchedule();

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function verifyReplayData(replayData, claimedScore, replayDigest) {
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

  const digest = await digestReplayBase64(replayData);
  if (digest !== String(replayDigest).toLowerCase()) {
    throw createSubmissionError('replayDigest mismatch');
  }

  const replayResult = runReplay(replayBytes, spawnSchedule);
  if (replayResult.summary.score !== claimedScore) {
    throw createSubmissionError(
      `score mismatch after verification (submitted ${claimedScore}, verified ${replayResult.summary.score})`
    );
  }

  return {
    replayDigest: digest,
    summary: replayResult.summary
  };
}

export const asteroidAdapter = {
  gameId: 'asteroid',

  async validateSubmission(payload) {
    const claimedScore = Math.max(0, Math.round(Number(payload?.score ?? payload?.claimedScore) || 0));
    const verified = await verifyReplayData(payload?.replayData, claimedScore, payload?.replayDigest);

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
      replayDigest: verified.replayDigest
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
