#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { slot60Adapter } from '../../../platform/adapters/slot60.mjs';

const DEFAULT_OUTPUT = resolve(process.cwd(), 'generated', 'slot60-replay.json');
const DEFAULT_PAYLOAD_OUTPUT = resolve(process.cwd(), 'generated', 'slot60-submit-payload.json');
const DEFAULT_STRIP_LENGTH = 20;
const DEFAULT_START_TIME = 60000;
const DEFAULT_TIME_STEP = 333;
const SYMBOLS = {
  seven: 0,
  bar: 1,
  bell: 2,
  cherry: 3
};

function parseArgs(argv) {
  const args = {
    rounds: 180,
    payout: 1000,
    startTime: DEFAULT_START_TIME,
    timeStep: DEFAULT_TIME_STEP,
    stripLength: DEFAULT_STRIP_LENGTH,
    results: [SYMBOLS.seven, SYMBOLS.seven, SYMBOLS.seven],
    output: DEFAULT_OUTPUT,
    payloadOut: DEFAULT_PAYLOAD_OUTPUT,
    name: 'PLAYER',
    message: 'AUTO REPLAY',
    seed: 777777
  };

  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, value = 'true'] = raw.slice(2).split('=');
    switch (key) {
      case 'rounds':
        args.rounds = toInt(value, 'rounds');
        break;
      case 'payout':
        args.payout = toInt(value, 'payout');
        break;
      case 'start-time':
        args.startTime = toInt(value, 'start-time');
        break;
      case 'time-step':
        args.timeStep = toInt(value, 'time-step');
        break;
      case 'strip-length':
        args.stripLength = toInt(value, 'strip-length');
        break;
      case 'results':
        args.results = parseResults(value);
        break;
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
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (args.rounds <= 0) throw new Error('rounds must be positive');
  if (args.payout < 0) throw new Error('payout must be non-negative');
  if (args.startTime < 0) throw new Error('start-time must be non-negative');
  if (args.timeStep < 0) throw new Error('time-step must be non-negative');
  if (args.stripLength < 3) throw new Error('strip-length must be at least 3');

  return args;
}

function toInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

function parseResults(raw) {
  const values = String(raw).split(',').map((item) => item.trim().toLowerCase());
  if (values.length !== 3) {
    throw new Error('results must contain exactly 3 comma-separated symbols');
  }
  return values.map((value) => {
    if (value in SYMBOLS) return SYMBOLS[value];
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3) return parsed;
    throw new Error(`Unknown symbol in results: ${value}`);
  });
}

function buildStrip(length, offset) {
  const base = [SYMBOLS.seven, SYMBOLS.bar, SYMBOLS.bell, SYMBOLS.cherry];
  const strip = [];
  for (let index = 0; index < length; index++) {
    strip.push(base[(index + offset) % base.length]);
  }
  return strip;
}

function buildReplay(args) {
  let scoreAfter = 0;
  const rounds = [];
  for (let index = 0; index < args.rounds; index++) {
    scoreAfter += args.payout;
    rounds.push({
      results: [...args.results],
      payout: args.payout,
      scoreAfter,
      timeLeftMs: Math.max(0, args.startTime - index * args.timeStep),
      feverMode: true,
      reachMode: true,
      comboCount: index + 1
    });
  }

  return {
    version: 'slot60-replay-v1',
    seed: args.seed,
    strips: [
      buildStrip(args.stripLength, 0),
      buildStrip(args.stripLength, 1),
      buildStrip(args.stripLength, 2)
    ],
    rounds
  };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const replay = buildReplay(args);
  const replayData = JSON.stringify(replay, null, 2);
  const score = Number(replay.rounds.at(-1)?.scoreAfter || 0);
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
  console.log(`Rounds: ${replay.rounds.length}`);
  console.log(`Score: ${score}`);
  console.log(`Digest: ${replayDigest}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
