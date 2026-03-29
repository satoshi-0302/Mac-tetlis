import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { sha256 } from '../../../../platform/sanitize.mjs';
import { runHeadlessReplayFromBase64 } from '../../src/replay/verify-runner.js';

function resolveLabRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const candidatePath = process.argv[2];
  if (!candidatePath) {
    console.error('Usage: node evaluate-replay.mjs <candidate.json>');
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), candidatePath);
  const labRoot = resolveLabRoot();
  if (!absolutePath.startsWith(labRoot)) {
    console.error('Candidate file must live inside replay-lab/');
    process.exit(1);
  }

  const candidate = readJson(absolutePath);
  const replayData = String(candidate.replayData ?? '');
  const seed = Number(candidate.seed ?? 0);
  if (!replayData) {
    console.error('candidate.replayData is required');
    process.exit(1);
  }

  const result = runHeadlessReplayFromBase64(replayData, { seed });
  const replayDigest = sha256(replayData);
  const finalStateHash = sha256(result.finalStateHashMaterial);

  const output = {
    file: absolutePath,
    label: String(candidate.label ?? path.basename(absolutePath, '.json')),
    seed,
    score: result.summary.score,
    replayDigest,
    finalStateHash,
    summary: result.summary
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
