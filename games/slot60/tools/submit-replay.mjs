#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { slot60Adapter } from '../../../platform/adapters/slot60.mjs';

function parseArgs(argv) {
  const args = {
    replay: '',
    url: '',
    name: 'PLAYER',
    message: 'AUTO REPLAY',
    dryRun: true
  };

  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, value = 'true'] = raw.slice(2).split('=');
    switch (key) {
      case 'replay':
        args.replay = resolve(process.cwd(), value);
        break;
      case 'url':
        args.url = String(value);
        break;
      case 'name':
        args.name = value;
        break;
      case 'message':
        args.message = value;
        break;
      case 'execute':
        args.dryRun = false;
        break;
      case 'dry-run':
        args.dryRun = value !== 'false';
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!args.replay) {
    throw new Error('replay is required. Example: --replay=./generated/slot60-replay.json');
  }

  return args;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const replayData = readFileSync(args.replay, 'utf8');
  const replay = JSON.parse(replayData);
  const score = Math.max(0, Math.floor(Number(replay?.rounds?.at(-1)?.scoreAfter) || 0));
  const replayDigest = sha256(replayData);
  const payload = {
    gameId: 'slot60',
    name: args.name,
    message: args.message,
    score,
    replayData,
    replayDigest
  };

  const verified = slot60Adapter.validateSubmission(payload);
  console.log(`Validated replay: score=${verified.score} rounds=${verified.summary.rounds} digest=${replayDigest}`);

  if (args.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!args.url) {
    throw new Error('url is required when using --execute');
  }

  const response = await fetch(args.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(body);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
