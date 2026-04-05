import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { MAX_TICKS } from '../../src/engine/constants.js';
import {
  INPUT_BOMB,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST
} from '../../src/engine/constants.js';
import { createRng } from '../../src/engine/rng.js';
import { encodeReplay } from '../../src/replay/replay.js';
import { runHeadlessReplayFromFrames } from '../../src/replay/verify-runner.js';
import { sha256 } from '../../../../platform/sanitize.mjs';

const INPUT_BITS = [INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST, INPUT_SHOOT, INPUT_BOMB];

function resolveLabRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseArgs(argv) {
  const options = {
    count: 20,
    seed: 0,
    prefix: 'candidate'
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--count' && next) {
      options.count = Math.max(1, Number.parseInt(next, 10) || options.count);
      i += 1;
      continue;
    }
    if (token === '--seed' && next) {
      options.seed = Number.parseInt(next, 10) || 0;
      i += 1;
      continue;
    }
    if (token === '--prefix' && next) {
      options.prefix = String(next);
      i += 1;
    }
  }

  return options;
}

function buildRandomReplay(rng) {
  const replay = new Uint8Array(MAX_TICKS);
  let currentMask = 0;

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    if (rng() < 0.16) {
      currentMask ^= INPUT_BITS[Math.floor(rng() * INPUT_BITS.length)];
    }

    if ((currentMask & INPUT_LEFT) && (currentMask & INPUT_RIGHT)) {
      currentMask &= rng() < 0.5 ? ~INPUT_LEFT : ~INPUT_RIGHT;
    }

    if ((currentMask & INPUT_BOMB) !== 0) {
      replay[tick] = currentMask;
      currentMask &= ~INPUT_BOMB;
      continue;
    }

    replay[tick] = currentMask;
  }

  return replay;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendLog(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`, 'utf8');
}

function main() {
  const { count, seed, prefix } = parseArgs(process.argv);
  const labRoot = resolveLabRoot();
  const candidatesDir = path.join(labRoot, 'candidates');
  const bestDir = path.join(labRoot, 'best');
  const logsDir = path.join(labRoot, 'logs');
  ensureDir(candidatesDir);
  ensureDir(bestDir);
  ensureDir(logsDir);

  const rng = createRng(seed >>> 0);
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(logsDir, `${runStamp}-${prefix}.csv`);
  appendLog(csvPath, 'label,seed,score,replayDigest,finalStateHash');

  let bestCandidate = null;

  for (let index = 0; index < count; index += 1) {
    const replayBytes = buildRandomReplay(rng);
    const replayData = encodeReplay(replayBytes);
    const result = runHeadlessReplayFromFrames(replayBytes, { seed });
    const replayDigest = sha256(replayData);
    const finalStateHash = sha256(result.finalStateHashMaterial);
    const label = `${prefix}-${String(index + 1).padStart(4, '0')}`;
    const candidate = {
      label,
      seed,
      score: result.summary.score,
      replayDigest,
      finalStateHash,
      replayData
    };

    writeJson(path.join(candidatesDir, `${label}.json`), candidate);
    appendLog(csvPath, [label, seed, candidate.score, replayDigest, finalStateHash].join(','));

    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    writeJson(path.join(bestDir, `${prefix}-best.json`), bestCandidate);
    console.log(
      JSON.stringify(
        {
          count,
          seed,
          bestLabel: bestCandidate.label,
          bestScore: bestCandidate.score,
          replayDigest: bestCandidate.replayDigest,
          finalStateHash: bestCandidate.finalStateHash
        },
        null,
        2
      )
    );
  }
}

main();
