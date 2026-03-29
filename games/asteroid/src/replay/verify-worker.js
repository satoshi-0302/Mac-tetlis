import { digestReplayBase64, digestString } from './replay.js';
import { runHeadlessReplayFromBase64 } from './verify-runner.js';

self.addEventListener('message', async (event) => {
  const payload = event.data ?? {};
  const requestId = payload.requestId;
  const replayData = typeof payload.replayData === 'string' ? payload.replayData : '';
  const seed = Number(payload.seed ?? 0);

  if (!replayData) {
    self.postMessage({
      requestId,
      ok: false,
      error: 'Missing replayData'
    });
    return;
  }

  try {
    const replayResult = runHeadlessReplayFromBase64(replayData, { seed });
    const replayDigest = await digestReplayBase64(replayData);
    const finalStateHash = await digestString(replayResult.finalStateHashMaterial);

    self.postMessage({
      requestId,
      ok: true,
      replayDigest,
      finalStateHash,
      score: replayResult.summary.score,
      summary: {
        ...replayResult.summary,
        finalStateHash
      }
    });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown replay worker error'
    });
  }
});
