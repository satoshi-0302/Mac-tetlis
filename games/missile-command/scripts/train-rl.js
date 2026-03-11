import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

import { trainWithCem } from "../server/rl/cem-trainer.js";

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

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
const outFilePath = resolve(process.cwd(), String(args.out || "./output/rl/policy-cem.json"));
const promoteDemo = String(args["promote-demo"] ?? "true") !== "false";

const result = await trainWithCem({
  seed: toNumber(args.seed, 0x3d93fa2a),
  iterations: toNumber(args.iterations, 28),
  populationSize: toNumber(args.population, 24),
  eliteFraction: toNumber(args.elite, 0.25),
  hiddenSize: toNumber(args.hidden, 24),
  initialStd: toNumber(args.std, 0.22),
  minStd: toNumber(args["min-std"], 0.025),
  decisionTicks: toNumber(args["decision-ticks"], 1),
  seeds: toSeedList(args.seeds),
  warmStartPath: typeof args["warm-start"] === "string" ? resolve(process.cwd(), args["warm-start"]) : null,
  outFilePath,
});

if (promoteDemo) {
  const demoPath = resolve(process.cwd(), "./public/rl/demo-policy.json");
  copyFileSync(outFilePath, demoPath);
  console.log(`Promoted demo policy: ${demoPath}`);
}

console.log("");
console.log("=== RL Training Completed ===");
console.log(`Policy file : ${outFilePath}`);
console.log(`Best score  : ${result.summary.score}`);
console.log(`Mean score  : ${result.summary.meanScore.toFixed(1)}`);
console.log(`Objective   : ${result.summary.objective.toFixed(2)}`);
console.log(`Clear rate  : ${(result.summary.clearRate * 100).toFixed(1)}%`);
