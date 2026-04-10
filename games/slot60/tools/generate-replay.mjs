#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { slot60Adapter } from '../../../platform/adapters/slot60.mjs';

const DEFAULT_OUTPUT = resolve(process.cwd(), 'generated', 'slot60-replay.json');
const DEFAULT_PAYLOAD_OUTPUT = resolve(process.cwd(), 'generated', 'slot60-submit-payload.json');
const TOTAL_TICKS = 3600;
const SYMBOLS = {
  seven: 0,
  bar: 1,
  bell: 2,
  cherry: 3
};
const CONFIG = {
  FEVER_TURNS: 5,
  FEVER_MULTIPLIER: 5,
  REEL_BASE_SPEED: 28,
  REEL_SPEED_STEP: 8,
  REEL_SPEED_MULTIPLIERS: [0.33, 0.5, 0.5],
  REEL_STOP_EXTRA_SYMBOLS: 0.8,
  COMBO_STEP: 0.25,
  COMBO_MAX_STACK: 8,
  COMBO_CHAIN_WINDOW_MS: 3800,
  COMBO_CHAIN_FEVER_BONUS_MS: 1400,
  LAST_SPURT_MS: 10000,
  LAST_SPURT_MULTIPLIER: 1.5,
  SYMBOL_SIZE: 100,
  TICK_MS: 1000 / 60,
  TOTAL_TICKS
};

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    payloadOut: DEFAULT_PAYLOAD_OUTPUT,
    name: 'PLAYER',
    message: 'AUTO REPLAY',
    seed: 777777,
    pattern: [18, 12, 12, 18],
    search: false
  };

  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, value = 'true'] = raw.slice(2).split('=');
    switch (key) {
      case 'output':
        args.output = resolve(process.cwd(), value);
        break;
      case 'payload-out':
        args.payloadOut = resolve(process.cwd(), value);
        break;
      case 'name':
        args.name = value;
        break;
      case 'message':
        args.message = value;
        break;
      case 'seed':
        args.seed = toInt(value, 'seed');
        break;
      case 'pattern':
        args.pattern = String(value).split(',').map((item) => toInt(item.trim(), 'pattern')).slice(0, 4);
        if (args.pattern.length !== 4) throw new Error('pattern must be four comma-separated integers');
        break;
      case 'search':
        args.search = value !== 'false';
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return args;
}

function toInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

function buildStrip(length, offset) {
  const base = [SYMBOLS.seven, SYMBOLS.bar, SYMBOLS.bell, SYMBOLS.cherry];
  const strip = [];
  for (let index = 0; index < length; index += 1) {
    strip.push(base[(index + offset) % base.length]);
  }
  return strip;
}

function createReel(id, symbols) {
  return {
    id,
    symbols: [...symbols],
    offset: 0,
    speed: 0,
    isSpinning: false,
    isStopping: false,
    targetOffset: 0
  };
}

function startReel(reel) {
  reel.isSpinning = true;
  reel.isStopping = false;
  const speedStepIndex = Math.min(reel.id, 1);
  const baseSpeed = CONFIG.REEL_BASE_SPEED + (speedStepIndex * CONFIG.REEL_SPEED_STEP);
  const speedRate = CONFIG.REEL_SPEED_MULTIPLIERS[reel.id] || 1;
  reel.speed = baseSpeed * speedRate;
}

function stopReel(reel) {
  if (!reel.isSpinning) return;
  reel.isStopping = true;
  const extraDistance = CONFIG.SYMBOL_SIZE * CONFIG.REEL_STOP_EXTRA_SYMBOLS;
  reel.targetOffset = Math.floor((reel.offset - extraDistance) / CONFIG.SYMBOL_SIZE) * CONFIG.SYMBOL_SIZE;
}

function updateReel(reel) {
  if (!reel.isSpinning) return true;
  if (reel.isStopping) {
    if (reel.offset > reel.targetOffset) {
      reel.offset -= reel.speed * 1.2;
      if (reel.offset <= reel.targetOffset) {
        reel.offset = reel.targetOffset;
        reel.isSpinning = false;
        reel.isStopping = false;
        reel.speed = 0;
        return true;
      }
    }
  } else {
    reel.offset -= reel.speed;
  }
  return false;
}

function getReelResult(reel) {
  const totalSymbols = reel.symbols.length;
  const totalHeight = totalSymbols * CONFIG.SYMBOL_SIZE;
  const normalizedOffset = ((reel.offset % totalHeight) + totalHeight) % totalHeight;
  const startIdx = Math.floor(normalizedOffset / CONFIG.SYMBOL_SIZE) % totalSymbols;
  return reel.symbols[(startIdx + 1) % totalSymbols];
}

function createSimulation(strips) {
  return {
    reels: strips.map((strip, index) => createReel(index, strip)),
    gameState: 'IDLE',
    score: 0,
    currentTick: 0,
    feverMode: false,
    feverTurns: 0,
    comboCount: 0,
    comboChainTimer: 0,
    currentComboWindowMs: CONFIG.COMBO_CHAIN_WINDOW_MS,
    stopIndex: 0,
    isTimeAttackRunning: true,
    timeLeftMs: CONFIG.TOTAL_TICKS * CONFIG.TICK_MS,
    actions: []
  };
}

function syncTime(sim) {
  sim.timeLeftMs = Math.round(Math.max(0, CONFIG.TOTAL_TICKS - sim.currentTick) * CONFIG.TICK_MS);
}

function processPrimary(sim, fromReplay = false) {
  if (!fromReplay) {
    sim.actions.push({ tick: sim.currentTick, action: 'primary' });
  }

  switch (sim.gameState) {
    case 'IDLE':
    case 'RESULT':
      if (!sim.isTimeAttackRunning || sim.timeLeftMs <= 0) return;
      sim.stopIndex = 0;
      sim.gameState = 'SPINNING';
      if (sim.feverMode) {
        sim.feverTurns -= 1;
        if (sim.feverTurns < 0) sim.feverMode = false;
      }
      sim.reels.forEach((reel) => startReel(reel));
      break;
    case 'SPINNING':
    case 'STOPPING':
      if (sim.stopIndex < sim.reels.length) {
        stopReel(sim.reels[sim.stopIndex]);
        sim.stopIndex += 1;
        if (sim.stopIndex >= sim.reels.length) {
          sim.gameState = 'STOPPING';
        }
      }
      break;
    default:
      break;
  }
}

function evaluateResult(sim) {
  const results = sim.reels.map((reel) => getReelResult(reel));
  const [r1, r2, r3] = results;

  let payout = 0;
  let basePayout = 0;
  let isWin = false;
  let isJackpot = false;

  if (r1 === r2 && r2 === r3) {
    basePayout = [100, 50, 20, 10][r1] || 0;
    isWin = true;
    if (r1 === SYMBOLS.seven) {
      isJackpot = true;
      sim.feverMode = true;
      sim.feverTurns = CONFIG.FEVER_TURNS;
    }
  } else if (r1 === r2 || r2 === r3 || r1 === r3) {
    basePayout = 5;
    isWin = true;
  }

  if (isWin) {
    sim.comboCount += 1;
    const comboMultiplier = 1 + (Math.min(sim.comboCount - 1, CONFIG.COMBO_MAX_STACK) * CONFIG.COMBO_STEP);
    payout = basePayout;
    if (sim.feverMode) payout *= CONFIG.FEVER_MULTIPLIER;
    payout = Math.floor(payout * comboMultiplier);
    if (sim.timeLeftMs <= CONFIG.LAST_SPURT_MS) {
      payout = Math.floor(payout * CONFIG.LAST_SPURT_MULTIPLIER);
    }
    sim.score += payout;
    sim.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS + (sim.feverMode ? CONFIG.COMBO_CHAIN_FEVER_BONUS_MS : 0);
    sim.comboChainTimer = sim.currentComboWindowMs;
    sim.gameState = 'RESULT';
  } else {
    sim.comboCount = 0;
    sim.comboChainTimer = 0;
    sim.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
    sim.gameState = 'IDLE';
  }

  if (isJackpot && sim.feverTurns < 0) {
    sim.feverMode = false;
  }
}

function stepSimulation(sim) {
  if (sim.comboCount > 0 && sim.isTimeAttackRunning && sim.gameState !== 'TIMEUP') {
    sim.comboChainTimer = Math.max(0, sim.comboChainTimer - CONFIG.TICK_MS);
    if (sim.comboChainTimer <= 0) {
      sim.comboCount = 0;
      sim.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
    }
  }

  let allStopped = true;
  for (const reel of sim.reels) {
    const stopped = updateReel(reel);
    if (!stopped && reel.isSpinning) allStopped = false;
  }

  if (sim.gameState === 'STOPPING' && allStopped) {
    evaluateResult(sim);
  }

  if (sim.isTimeAttackRunning && sim.gameState !== 'TIMEUP') {
    sim.currentTick = Math.min(CONFIG.TOTAL_TICKS, sim.currentTick + 1);
    syncTime(sim);
    if (sim.currentTick >= CONFIG.TOTAL_TICKS) {
      sim.isTimeAttackRunning = false;
      sim.gameState = 'TIMEUP';
      sim.reels.forEach((reel) => {
        reel.isSpinning = false;
        reel.isStopping = false;
        reel.speed = 0;
      });
    }
  }
}

function buildReplayFromPattern(pattern) {
  const strips = [
    buildStrip(20, 0),
    buildStrip(20, 1),
    buildStrip(20, 2)
  ];
  const sim = createSimulation(strips);
  const [spinLead, stopGap1, stopGap2, roundGap] = pattern;
  let nextStartTick = 0;
  let pendingStops = [];

  while (sim.currentTick < CONFIG.TOTAL_TICKS) {
    if (sim.currentTick === nextStartTick && (sim.gameState === 'IDLE' || sim.gameState === 'RESULT')) {
      processPrimary(sim);
      pendingStops = [
        sim.currentTick + spinLead,
        sim.currentTick + spinLead + stopGap1,
        sim.currentTick + spinLead + stopGap1 + stopGap2
      ];
    }

    while (pendingStops.length > 0 && pendingStops[0] === sim.currentTick && (sim.gameState === 'SPINNING' || sim.gameState === 'STOPPING')) {
      processPrimary(sim);
      pendingStops.shift();
      if (pendingStops.length === 0) {
        nextStartTick = sim.currentTick + roundGap;
      }
    }

    stepSimulation(sim);
  }

  return {
    version: 'slot60-replay-v2',
    seed: 777777,
    totalTicks: CONFIG.TOTAL_TICKS,
    finalScore: sim.score,
    strips,
    actions: sim.actions
  };
}

function searchBestPattern() {
  const candidates = [];
  for (let spinLead = 12; spinLead <= 28; spinLead += 2) {
    for (let stopGap1 = 8; stopGap1 <= 20; stopGap1 += 2) {
      for (let stopGap2 = 8; stopGap2 <= 20; stopGap2 += 2) {
        for (let roundGap = 8; roundGap <= 18; roundGap += 2) {
          const pattern = [spinLead, stopGap1, stopGap2, roundGap];
          const replay = buildReplayFromPattern(pattern);
          candidates.push({ pattern, replay });
        }
      }
    }
  }
  candidates.sort((left, right) => right.replay.finalScore - left.replay.finalScore);
  return candidates[0];
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.search ? searchBestPattern() : { pattern: args.pattern, replay: buildReplayFromPattern(args.pattern) };
  const replay = {
    ...selected.replay,
    seed: args.seed
  };
  const replayData = JSON.stringify(replay, null, 2);
  const score = Number(replay.finalScore || 0);
  const replayDigest = sha256(replayData);
  const payload = {
    gameId: 'slot60',
    name: args.name,
    message: args.message,
    score,
    replayData,
    replayDigest
  };

  slot60Adapter.validateSubmission(payload);

  ensureParent(args.output);
  writeFileSync(args.output, replayData);

  ensureParent(args.payloadOut);
  writeFileSync(args.payloadOut, JSON.stringify(payload, null, 2));

  console.log(`Replay written: ${args.output}`);
  console.log(`Payload written: ${args.payloadOut}`);
  console.log(`Pattern: ${selected.pattern.join(',')}`);
  console.log(`Actions: ${replay.actions.length}`);
  console.log(`Score: ${score}`);
  console.log(`Digest: ${replayDigest}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
