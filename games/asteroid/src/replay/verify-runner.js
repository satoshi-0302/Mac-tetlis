import { GAMEPLAY_SEED, MAX_TICKS } from '../engine/constants.js';
import { runReplay } from '../game/sim-core.js';
import { createSpawnSchedule } from '../game/spawn-schedule.js';
import { decodeReplay, validateReplayBytes } from './replay.js';

export function decodeReplayFrames(replayData) {
  let replayBytes;
  try {
    replayBytes = decodeReplay(replayData);
  } catch {
    throw new Error('replayData is not valid base64');
  }

  if (!validateReplayBytes(replayBytes) || replayBytes.length !== MAX_TICKS) {
    throw new Error(`replayData must decode to exactly ${MAX_TICKS} frames`);
  }

  return replayBytes;
}

export function runHeadlessReplayFromFrames(inputFrames, { seed = GAMEPLAY_SEED, spawnSchedule } = {}) {
  const resolvedSeed = Number.isFinite(Number(seed)) ? Number(seed) : GAMEPLAY_SEED;
  const resolvedSchedule = spawnSchedule ?? createSpawnSchedule(resolvedSeed);
  const replayResult = runReplay(inputFrames, resolvedSchedule);

  return {
    state: replayResult.state,
    summary: {
      ...replayResult.summary,
      seed: resolvedSeed
    },
    finalStateHashMaterial: replayResult.finalStateHashMaterial
  };
}

export function runHeadlessReplayFromBase64(replayData, { seed = GAMEPLAY_SEED } = {}) {
  const replayBytes = decodeReplayFrames(replayData);
  return {
    replayBytes,
    ...runHeadlessReplayFromFrames(replayBytes, { seed })
  };
}
