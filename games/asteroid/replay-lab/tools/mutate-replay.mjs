import path from 'node:path';
import process from 'node:process';

import {
  INPUT_BOMB,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST,
  MAX_TICKS
} from '../../src/engine/constants.js';
import { createRng } from '../../src/engine/rng.js';
import {
  buildCandidateRecord,
  evaluateReplayBytes,
  loadCandidateFromFile,
  resolveLabRoot,
  writeJson
} from './common.mjs';

const INPUT_BITS = [INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST, INPUT_SHOOT, INPUT_BOMB];

function parseArgs(argv) {
  const options = {
    seed: 0,
    mutationSeed: 0,
    mutations: 12,
    label: '',
    input: '',
    output: ''
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--input' && next) {
      options.input = next;
      i += 1;
      continue;
    }
    if (token === '--output' && next) {
      options.output = next;
      i += 1;
      continue;
    }
    if (token === '--label' && next) {
      options.label = next;
      i += 1;
      continue;
    }
    if (token === '--seed' && next) {
      options.seed = Number.parseInt(next, 10) || 0;
      i += 1;
      continue;
    }
    if (token === '--mutation-seed' && next) {
      options.mutationSeed = Number.parseInt(next, 10) || 0;
      i += 1;
      continue;
    }
    if (token === '--mutations' && next) {
      options.mutations = Math.max(1, Number.parseInt(next, 10) || options.mutations);
      i += 1;
    }
  }

  return options;
}

function pickInputBit(rng) {
  return INPUT_BITS[Math.floor(rng() * INPUT_BITS.length)];
}

function normalizeReplayFrame(mask, previousMask = 0) {
  let normalized = mask & 0x1f;
  if ((normalized & INPUT_LEFT) && (normalized & INPUT_RIGHT)) {
    normalized &= previousMask & INPUT_LEFT ? ~INPUT_RIGHT : ~INPUT_LEFT;
  }
  return normalized;
}

function mutateReplay(baseReplay, rng, mutationCount) {
  const replay = new Uint8Array(baseReplay);

  for (let step = 0; step < mutationCount; step += 1) {
    const tick = Math.floor(rng() * MAX_TICKS);
    const strategy = Math.floor(rng() * 4);

    if (strategy === 0) {
      replay[tick] ^= pickInputBit(rng);
      continue;
    }

    if (strategy === 1) {
      const length = 1 + Math.floor(rng() * 18);
      const bit = pickInputBit(rng);
      for (let offset = 0; offset < length && tick + offset < MAX_TICKS; offset += 1) {
        replay[tick + offset] ^= bit;
      }
      continue;
    }

    if (strategy === 2) {
      const length = 2 + Math.floor(rng() * 24);
      const nextMask = normalizeReplayFrame(replay[tick] ^ pickInputBit(rng), tick > 0 ? replay[tick - 1] : 0);
      for (let offset = 0; offset < length && tick + offset < MAX_TICKS; offset += 1) {
        replay[tick + offset] = nextMask;
      }
      continue;
    }

    replay[tick] |= INPUT_BOMB;
  }

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    replay[tick] = normalizeReplayFrame(replay[tick], tick > 0 ? replay[tick - 1] : 0);
    if ((replay[tick] & INPUT_BOMB) !== 0 && tick + 1 < MAX_TICKS) {
      replay[tick + 1] &= ~INPUT_BOMB;
    }
  }

  return replay;
}

function main() {
  const options = parseArgs(process.argv);
  if (!options.input) {
    console.error('Usage: node mutate-replay.mjs --input <candidate.json> [--output <candidate.json>]');
    process.exit(1);
  }

  const labRoot = resolveLabRoot();
  const loaded = loadCandidateFromFile(path.resolve(process.cwd(), options.input), labRoot);
  const rng = createRng((options.mutationSeed || Date.now()) >>> 0);
  const mutatedReplay = mutateReplay(loaded.replayBytes, rng, options.mutations);
  const evaluated = evaluateReplayBytes(mutatedReplay, { seed: options.seed || loaded.seed });

  const label =
    options.label ||
    `${String(loaded.candidate.label ?? path.basename(loaded.path, '.json'))}-mut-${String(options.mutationSeed || 0).padStart(6, '0')}`;
  const outputCandidate = buildCandidateRecord({
    label,
    seed: options.seed || loaded.seed,
    replayData: evaluated.replayData,
    replayDigest: evaluated.replayDigest,
    finalStateHash: evaluated.finalStateHash,
    score: evaluated.score,
    summary: evaluated.summary,
    parentLabel: String(loaded.candidate.label ?? ''),
    mutationSeed: options.mutationSeed || 0,
    mutationCount: options.mutations
  });

  if (options.output) {
    writeJson(path.resolve(process.cwd(), options.output), outputCandidate);
  } else {
    console.log(JSON.stringify(outputCandidate, null, 2));
  }
}

main();
