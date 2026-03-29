import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OBSERVATION_DIM } from "../rl/observation.js";
import { createPolicyRuntime } from "../rl/policy.js";
import { evaluatePolicyAcrossSeeds } from "../server/rl/env.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function toSeedList(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));
}

const args = parseArgs(process.argv.slice(2));
const modelPath = resolve(process.cwd(), String(args.model || "./public/rl/demo-policy.json"));
const raw = JSON.parse(readFileSync(modelPath, "utf8"));
const runtime = createPolicyRuntime({
  observationDim: Number(raw?.config?.observationDim ?? OBSERVATION_DIM),
  hiddenSize: Number(raw?.config?.hiddenSize ?? 40),
  actionMode: raw?.config?.actionMode,
});

const evaluation = evaluatePolicyAcrossSeeds({
  runtime,
  parameters: Float64Array.from(raw.parameters.map((value) => Number(value))),
  seeds: toSeedList(args.seeds),
  decisionTicks: Number(raw?.config?.decisionTicks ?? 2),
});

console.log("");
console.log("=== RL Evaluation ===");
console.log(`Model       : ${modelPath}`);
console.log(`Objective   : ${evaluation.objective.toFixed(2)}`);
console.log(`Mean score  : ${evaluation.meanScore.toFixed(1)}`);
console.log(`Best score  : ${evaluation.bestScore.toFixed(1)}`);
console.log(`Worst reward: ${evaluation.worstReward.toFixed(2)}`);
console.log(`Clear rate  : ${(evaluation.clearRate * 100).toFixed(1)}%`);
