import path from 'node:path';
import process from 'node:process';

import { createRng } from '../../src/engine/rng.js';
import {
  appendLine,
  buildCandidateRecord,
  compareCandidates,
  ensureDir,
  evaluateReplayBytes,
  loadCandidateFromFile,
  loadPublicSeedCandidate,
  resolveLabRoot,
  writeJson
} from './common.mjs';

function parseArgs(argv) {
  const options = {
    iterations: 20,
    seed: 0,
    mutationSeed: 12345,
    prefix: 'autoresearch',
    source: '',
    keepCandidates: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--iterations' && next) {
      options.iterations = Math.max(1, Number.parseInt(next, 10) || options.iterations);
      i += 1;
      continue;
    }
    if (token === '--seed' && next) {
      options.seed = Number.parseInt(next, 10) || 0;
      i += 1;
      continue;
    }
    if (token === '--mutation-seed' && next) {
      options.mutationSeed = Number.parseInt(next, 10) || options.mutationSeed;
      i += 1;
      continue;
    }
    if (token === '--prefix' && next) {
      options.prefix = String(next);
      i += 1;
      continue;
    }
    if (token === '--source' && next) {
      options.source = String(next);
      i += 1;
      continue;
    }
    if (token === '--no-keep-candidates') {
      options.keepCandidates = false;
    }
  }

  return options;
}

function normalizeReplayFrame(mask, previousMask = 0) {
  let normalized = mask & 0x1f;
  const INPUT_LEFT = 1 << 0;
  const INPUT_RIGHT = 1 << 1;
  const INPUT_BOMB = 1 << 4;
  if ((normalized & INPUT_LEFT) && (normalized & INPUT_RIGHT)) {
    normalized &= previousMask & INPUT_LEFT ? ~INPUT_RIGHT : ~INPUT_LEFT;
  }
  if ((normalized & INPUT_BOMB) !== 0) {
    return normalized;
  }
  return normalized;
}

function mutateReplay(baseReplay, rng) {
  const replay = new Uint8Array(baseReplay);
  const INPUT_BOMB = 1 << 4;
  const bits = [1 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4];
  const mutationCount = 1 + Math.floor(rng() * 24);

  for (let step = 0; step < mutationCount; step += 1) {
    const start = Math.floor(rng() * replay.length);
    const mode = Math.floor(rng() * 5);
    const length = 1 + Math.floor(rng() * 30);
    const bit = bits[Math.floor(rng() * bits.length)];

    for (let offset = 0; offset < length && start + offset < replay.length; offset += 1) {
      const tick = start + offset;
      if (mode === 0) {
        replay[tick] ^= bit;
      } else if (mode === 1) {
        replay[tick] |= bit;
      } else if (mode === 2) {
        replay[tick] &= ~bit;
      } else if (mode === 3) {
        replay[tick] = replay[Math.max(0, tick - 1)];
      } else {
        replay[tick] = replay[Math.min(replay.length - 1, tick + 1)];
      }
    }

    replay[start] = normalizeReplayFrame(replay[start], start > 0 ? replay[start - 1] : 0);
    if ((replay[start] & INPUT_BOMB) !== 0 && start + 1 < replay.length) {
      replay[start + 1] &= ~INPUT_BOMB;
    }
  }

  for (let tick = 0; tick < replay.length; tick += 1) {
    replay[tick] = normalizeReplayFrame(replay[tick], tick > 0 ? replay[tick - 1] : 0);
  }

  return replay;
}

function resolveInitialBest(options, labRoot) {
  if (options.source) {
    const loaded = loadCandidateFromFile(path.resolve(process.cwd(), options.source), labRoot);
    return {
      best: buildCandidateRecord({
        label: String(loaded.candidate.label ?? path.basename(loaded.path, '.json')),
        seed: loaded.seed,
        replayData: String(loaded.candidate.replayData),
        replayDigest: String(loaded.candidate.replayDigest ?? ''),
        finalStateHash: String(loaded.candidate.finalStateHash ?? ''),
        score: Number(loaded.candidate.score ?? 0),
        summary: loaded.candidate.summary ?? {},
        source: 'candidate-file'
      }),
      replayBytes: loaded.replayBytes
    };
  }

  const seedCandidate = loadPublicSeedCandidate({ index: 0 });
  const loaded = {
    candidate: seedCandidate,
    replayBytes: new Uint8Array(Buffer.from(seedCandidate.replayData, 'base64')),
    seed: seedCandidate.seed
  };

  return {
    best: seedCandidate,
    replayBytes: loaded.replayBytes
  };
}

function main() {
  const options = parseArgs(process.argv);
  const labRoot = resolveLabRoot();
  const candidatesDir = path.join(labRoot, 'candidates');
  const bestDir = path.join(labRoot, 'best');
  const logsDir = path.join(labRoot, 'logs');
  ensureDir(candidatesDir);
  ensureDir(bestDir);
  ensureDir(logsDir);

  const { best: initialBest, replayBytes: initialReplayBytes } = resolveInitialBest(options, labRoot);
  let bestCandidate = initialBest;
  let bestReplayBytes = initialReplayBytes;

  const rng = createRng(options.mutationSeed >>> 0);
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(logsDir, `${runStamp}-${options.prefix}-loop.csv`);
  const jsonlPath = path.join(logsDir, `${runStamp}-${options.prefix}-loop.jsonl`);
  appendLine(csvPath, 'iteration,label,parentLabel,seed,score,survivalTicks,kills,accuracy,improved,replayDigest,finalStateHash');

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const candidateReplay = mutateReplay(bestReplayBytes, rng);
    const evaluated = evaluateReplayBytes(candidateReplay, { seed: options.seed || bestCandidate.seed });
    const label = `${options.prefix}-${String(iteration).padStart(4, '0')}`;
    const candidate = buildCandidateRecord({
      label,
      seed: options.seed || bestCandidate.seed,
      replayData: evaluated.replayData,
      replayDigest: evaluated.replayDigest,
      finalStateHash: evaluated.finalStateHash,
      score: evaluated.score,
      summary: evaluated.summary,
      parentLabel: bestCandidate.label,
      iteration,
      source: 'autoresearch-loop'
    });

    const improved = compareCandidates(candidate, bestCandidate) > 0;
    const survivalTicks = Number(candidate.summary?.survivalTicks ?? 0);
    const kills = Number(candidate.summary?.kills ?? 0);
    const accuracy = Number(candidate.summary?.accuracy ?? 0);

    appendLine(
      csvPath,
      [
        iteration,
        candidate.label,
        candidate.parentLabel,
        candidate.seed,
        candidate.score,
        survivalTicks,
        kills,
        accuracy.toFixed(6),
        improved ? 1 : 0,
        candidate.replayDigest,
        candidate.finalStateHash
      ].join(',')
    );
    appendLine(jsonlPath, JSON.stringify({ ...candidate, improved }));

    if (options.keepCandidates) {
      writeJson(path.join(candidatesDir, `${candidate.label}.json`), candidate);
    }

    if (improved) {
      bestCandidate = candidate;
      bestReplayBytes = candidateReplay;
      writeJson(path.join(bestDir, `${options.prefix}-best.json`), bestCandidate);
    }
  }

  writeJson(path.join(bestDir, `${options.prefix}-best.json`), bestCandidate);
  console.log(
    JSON.stringify(
      {
        iterations: options.iterations,
        seed: options.seed || bestCandidate.seed,
        initialLabel: initialBest.label,
        bestLabel: bestCandidate.label,
        bestScore: bestCandidate.score,
        bestReplayDigest: bestCandidate.replayDigest,
        bestFinalStateHash: bestCandidate.finalStateHash
      },
      null,
      2
    )
  );
}

main();
