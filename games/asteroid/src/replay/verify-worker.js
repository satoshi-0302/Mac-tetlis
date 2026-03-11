import { MAX_TICKS } from '../engine/constants.js';
import { runReplay } from '../game/sim-core.js';
import { createSpawnSchedule } from '../game/spawn-schedule.js';
import {
  decodeReplay,
  digestReplayBase64,
  validateReplayBytes
} from './replay.js';

const spawnSchedule = createSpawnSchedule();

self.addEventListener('message', async (event) => {
  const payload = event.data ?? {};
  const requestId = payload.requestId;
  const replayData = typeof payload.replayData === 'string' ? payload.replayData : '';

  if (!replayData) {
    self.postMessage({
      requestId,
      ok: false,
      error: 'Missing replayData'
    });
    return;
  }

  try {
    const replayBytes = decodeReplay(replayData);
    if (!validateReplayBytes(replayBytes) || replayBytes.length !== MAX_TICKS) {
      throw new Error(`Invalid replay frame count (expected ${MAX_TICKS})`);
    }

    const replayResult = runReplay(replayBytes, spawnSchedule);
    const replayDigest = await digestReplayBase64(replayData);

    self.postMessage({
      requestId,
      ok: true,
      replayDigest,
      score: replayResult.summary.score,
      summary: replayResult.summary
    });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown replay worker error'
    });
  }
});
