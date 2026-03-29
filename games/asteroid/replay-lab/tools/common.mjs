import fs from 'node:fs';
import path from 'node:path';

import { decodeReplayFrames, runHeadlessReplayFromBase64, runHeadlessReplayFromFrames } from '../../src/replay/verify-runner.js';
import { encodeReplay } from '../../src/replay/replay.js';
import { sha256 } from '../../../../platform/sanitize.mjs';

export function resolveLabRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sleepMs(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

export function appendLine(filePath, line) {
  const payload = `${line}\n`;
  let lastError = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.appendFileSync(filePath, payload, 'utf8');
      return;
    } catch (error) {
      lastError = error;
      const code = error?.code ?? '';
      if (code !== 'EPERM' && code !== 'EBUSY') {
        throw error;
      }
      sleepMs(20 * (attempt + 1));
    }
  }

  throw lastError;
}

export function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function evaluateReplayBytes(replayBytes, { seed = 0 } = {}) {
  const replayData = encodeReplay(replayBytes);
  const result = runHeadlessReplayFromFrames(replayBytes, { seed });
  const replayDigest = sha256(replayData);
  const finalStateHash = sha256(result.finalStateHashMaterial);

  return {
    replayData,
    replayDigest,
    finalStateHash,
    score: result.summary.score,
    summary: result.summary
  };
}

export function evaluateReplayData(replayData, { seed = 0 } = {}) {
  const result = runHeadlessReplayFromBase64(replayData, { seed });
  const replayDigest = sha256(replayData);
  const finalStateHash = sha256(result.finalStateHashMaterial);

  return {
    replayDigest,
    finalStateHash,
    score: result.summary.score,
    summary: result.summary
  };
}

export function buildCandidateRecord({
  label,
  seed,
  replayData,
  replayDigest,
  finalStateHash,
  score,
  summary,
  ...rest
}) {
  return {
    label,
    seed,
    score,
    replayDigest,
    finalStateHash,
    replayData,
    summary,
    ...rest
  };
}

export function compareCandidates(a, b) {
  const scoreDelta = Number(a?.score ?? 0) - Number(b?.score ?? 0);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const aSummary = a?.summary ?? {};
  const bSummary = b?.summary ?? {};
  const survivalDelta = Number(aSummary.survivalTicks ?? 0) - Number(bSummary.survivalTicks ?? 0);
  if (survivalDelta !== 0) {
    return survivalDelta;
  }

  const killsDelta = Number(aSummary.kills ?? 0) - Number(bSummary.kills ?? 0);
  if (killsDelta !== 0) {
    return killsDelta;
  }

  const accuracyDelta = Number(aSummary.accuracy ?? 0) - Number(bSummary.accuracy ?? 0);
  if (accuracyDelta !== 0) {
    return accuracyDelta;
  }

  return 0;
}

export function loadCandidateFromFile(candidatePath, labRoot) {
  const absolutePath = path.resolve(candidatePath);
  if (!isPathInside(labRoot, absolutePath)) {
    throw new Error('Candidate file must live inside replay-lab/');
  }

  const candidate = readJson(absolutePath);
  const replayData = String(candidate.replayData ?? '');
  const seed = Number(candidate.seed ?? 0);
  if (!replayData) {
    throw new Error('candidate.replayData is required');
  }

  return {
    path: absolutePath,
    candidate,
    replayBytes: decodeReplayFrames(replayData),
    seed
  };
}

export function loadPublicSeedCandidate({ index = 0 } = {}) {
  const root = resolveLabRoot();
  const sourcePath = path.resolve(root, '..', 'public', 'rl', 'ai-top10.json');
  const raw = readJson(sourcePath);
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const entry = entries[index];
  if (!entry?.replayData) {
    throw new Error(`No seed replay found at public/rl/ai-top10.json entry ${index}`);
  }

  const replayData = String(entry.replayData);
  const seed = Number(entry.seed ?? 0);
  const evaluated = evaluateReplayData(replayData, { seed });

  return buildCandidateRecord({
    label: String(entry.id ?? `public-seed-${index + 1}`),
    seed,
    replayData,
    replayDigest: evaluated.replayDigest,
    finalStateHash: evaluated.finalStateHash,
    score: evaluated.score,
    summary: evaluated.summary,
    source: 'public-seed'
  });
}
