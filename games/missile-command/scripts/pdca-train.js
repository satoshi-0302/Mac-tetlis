import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { createHeuristicDemoAgent } from "../rl/demo-agent.js";
import {
  FIRE_TARGET_POLICY_ACTION_MODE,
  PHASE_MACRO_POLICY_ACTION_MODE,
  createPolicyRuntime,
  getPolicyParameterCount,
} from "../rl/policy.js";
import { OBSERVATION_DIM } from "../rl/observation.js";
import { trainWithCem } from "../server/rl/cem-trainer.js";
import { trainByImitation } from "../server/rl/imitation-trainer.js";
import { evaluatePolicyAcrossSeeds } from "../server/rl/env.js";
import { createInitialState, getSnapshot, stepSimulation, SIM_MAX_TICKS } from "../sim/core.js";

const TRAIN_SEEDS = Object.freeze([
  0x3d93fa2a,
  0x27d4eb2d,
  0x91e10dab,
  0x11111111,
  0x22222222,
  0x33333333,
]);

const HOLDOUT_SEEDS = Object.freeze([
  0x44444444,
  0x55555555,
  0x66666666,
  0x77777777,
  0x88888888,
  0x99999999,
]);

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

function timestampTag(date = new Date()) {
  return date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\..+$/, "");
}

function toRepoPath(filePath) {
  if (!filePath) {
    return null;
  }

  const relativePath = relative(process.cwd(), filePath);
  return relativePath || ".";
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function writeJson(filePath, value) {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendLine(filePath, line) {
  const previous = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileSync(filePath, `${previous}${line}\n`, "utf8");
}

function loadModel(path) {
  if (!path || !existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return null;
  }
}

function isModelCompatible(model) {
  if (!model) {
    return false;
  }

  const observationDim = Number(model?.config?.observationDim ?? 0);
  const hiddenSize = Number(model?.config?.hiddenSize ?? 0);
  const actionMode = model?.config?.actionMode ?? PHASE_MACRO_POLICY_ACTION_MODE;
  const parameters = Array.isArray(model?.parameters) ? model.parameters : null;
  if (observationDim !== OBSERVATION_DIM || !parameters) {
    return false;
  }

  const expected = getPolicyParameterCount(observationDim, hiddenSize, actionMode);
  return parameters.length === expected;
}

function evaluateModel(model, seeds) {
  const runtime = createPolicyRuntime({
    observationDim: Number(model.config.observationDim),
    hiddenSize: Number(model.config.hiddenSize),
    actionMode: model.config.actionMode,
  });

  return evaluatePolicyAcrossSeeds({
    runtime,
    parameters: Float64Array.from(model.parameters.map((value) => Number(value))),
    seeds,
    decisionTicks: Number(model?.config?.decisionTicks ?? 1),
  });
}

function evaluateHeuristic(seeds) {
  const runs = [];

  for (const seed of seeds) {
    const agent = createHeuristicDemoAgent();
    const state = createInitialState({ seed });
    agent.reset();

    for (let tick = 0; tick < SIM_MAX_TICKS && !state.result; tick += 1) {
      const action = agent.nextAction(getSnapshot(state));
      stepSimulation(state, action);
    }

    const snapshot = getSnapshot(state);
    runs.push({
      score: state.score,
      clear: state.result === "clear",
      survivalSeconds: state.tick / state.tickRate,
      aliveCities: snapshot.aliveCities,
    });
  }

  return {
    meanScore: mean(runs.map((run) => run.score)),
    bestScore: Math.max(...runs.map((run) => run.score)),
    clearRate: mean(runs.map((run) => (run.clear ? 1 : 0))),
    meanSurvivalSeconds: mean(runs.map((run) => run.survivalSeconds)),
    meanAliveCities: mean(runs.map((run) => run.aliveCities)),
  };
}

function rankEvaluation(evaluation) {
  return (
    evaluation.clearRate * 1_000_000_000 +
    evaluation.meanScore * 10_000 +
    evaluation.bestScore * 100 +
    evaluation.meanSurvivalSeconds * 1_000 +
    evaluation.objective
  );
}

function chooseCandidate(cycle, bestSummary, stagnation) {
  const bootstrap = [
    {
      label: "bootstrap-macro",
      hiddenSize: 16,
      actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
      iterations: 16,
      populationSize: 18,
      eliteFraction: 0.28,
      initialStd: 0.18,
      minStd: 0.03,
      decisionTicks: 1,
      seeds: TRAIN_SEEDS,
    },
    {
      label: "bootstrap-macro-wide",
      hiddenSize: 16,
      actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
      iterations: 14,
      populationSize: 24,
      eliteFraction: 0.22,
      initialStd: 0.24,
      minStd: 0.04,
      decisionTicks: 1,
      seeds: TRAIN_SEEDS.slice(0, 4),
    },
  ];

  const stabilizers = [
    {
      label: "stability-macro",
      hiddenSize: 16,
      actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
      iterations: 20,
      populationSize: 20,
      eliteFraction: 0.25,
      initialStd: 0.14,
      minStd: 0.02,
      decisionTicks: 1,
      seeds: TRAIN_SEEDS,
    },
    {
      label: "score-macro",
      hiddenSize: 16,
      actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
      iterations: 22,
      populationSize: 24,
      eliteFraction: 0.22,
      initialStd: 0.12,
      minStd: 0.018,
      decisionTicks: 1,
      seeds: TRAIN_SEEDS,
    },
  ];

  const explorers = [
    {
      label: "explore-wide",
      hiddenSize: 16,
      actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
      iterations: 16,
      populationSize: 28,
      eliteFraction: 0.2,
      initialStd: 0.28,
      minStd: 0.05,
      decisionTicks: 1,
      seeds: TRAIN_SEEDS.slice(0, 4),
    },
    {
      label: "explore-elite",
      hiddenSize: 16,
      actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
      iterations: 18,
      populationSize: 22,
      eliteFraction: 0.18,
      initialStd: 0.2,
      minStd: 0.03,
      decisionTicks: 1,
      seeds: TRAIN_SEEDS,
    },
  ];

  if (!bestSummary || bestSummary.clearRate < 0.1) {
    return stagnation >= 2 ? explorers[cycle % explorers.length] : bootstrap[cycle % bootstrap.length];
  }

  if (bestSummary.clearRate < 0.8) {
    return stagnation >= 2 ? explorers[(cycle + 1) % explorers.length] : stabilizers[cycle % stabilizers.length];
  }

  return stagnation >= 2 ? stabilizers[(cycle + 1) % stabilizers.length] : stabilizers[1];
}

function toMdPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function writeSummaryMarkdown(filePath, state) {
  const lines = [
    "# RL PDCA Summary",
    "",
    `- Started: ${state.startedAt}`,
    `- Updated: ${new Date().toISOString()}`,
    `- Time Budget Hours: ${state.timeBudgetHours.toFixed(2)}`,
    `- Cycle: ${state.cycle}`,
    `- Stagnation: ${state.stagnation}`,
    "",
    "## Plan",
    state.planLine,
    "",
    "## Baseline",
    `- Heuristic clear rate: ${toMdPercent(state.heuristic.clearRate)}`,
    `- Heuristic mean score: ${state.heuristic.meanScore.toFixed(1)}`,
    `- Heuristic best score: ${state.heuristic.bestScore.toFixed(1)}`,
    "",
    "## Best",
    `- Clear rate: ${toMdPercent(state.bestEvaluation?.clearRate ?? 0)}`,
    `- Mean score: ${(state.bestEvaluation?.meanScore ?? 0).toFixed(1)}`,
    `- Best score: ${(state.bestEvaluation?.bestScore ?? 0).toFixed(1)}`,
    `- Mean survival: ${(state.bestEvaluation?.meanSurvivalSeconds ?? 0).toFixed(1)}s`,
    `- Objective: ${(state.bestEvaluation?.objective ?? 0).toFixed(2)}`,
    "",
    "## Last Check",
    `- Candidate: ${state.lastCandidate?.label ?? "-"}`,
    `- Improved: ${state.lastImproved ? "yes" : "no"}`,
    `- Candidate clear rate: ${toMdPercent(state.lastEvaluation?.clearRate ?? 0)}`,
    `- Candidate mean score: ${(state.lastEvaluation?.meanScore ?? 0).toFixed(1)}`,
    `- Candidate best score: ${(state.lastEvaluation?.bestScore ?? 0).toFixed(1)}`,
    "",
    "## Act",
    state.actLine,
    "",
    "## Artifacts",
    `- Run Dir: ${state.runDir}`,
    `- Best Model: ${state.bestModelPath ?? "-"}`,
    `- Demo Policy: ${state.demoPolicyPath}`,
    `- History: ${state.historyPath}`,
  ];

  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
const args = parseArgs(process.argv.slice(2));
const requestedHours = toNumber(args.hours, 8);
const minutes = toNumber(args.minutes, requestedHours * 60);
const timeBudgetHours = minutes / 60;
const maxCycles = Math.max(1, Math.round(toNumber(args["max-cycles"], 9999)));
const baseSeed = Math.round(toNumber(args.seed, 0x5a17b10c));
const rootDir = resolve(process.cwd(), "./output/rl/pdca");
const runDir = resolve(rootDir, timestampTag());
const historyPath = resolve(runDir, "history.jsonl");
const summaryJsonPath = resolve(runDir, "latest-summary.json");
const summaryMdPath = resolve(runDir, "latest-summary.md");
const bestPolicyPath = resolve(runDir, "best-policy.json");
const demoPolicyPath = resolve(process.cwd(), "./public/rl/demo-policy.json");
const timeBudgetMs = minutes * 60 * 1000;
const deadline = Date.now() + timeBudgetMs;
const runStartedAt = new Date().toISOString();

mkdirSync(runDir, { recursive: true });

const heuristic = evaluateHeuristic(HOLDOUT_SEEDS);
const existingDemoModel = loadModel(demoPolicyPath);
let bestModel = isModelCompatible(existingDemoModel) ? existingDemoModel : null;
let bestModelPath = bestModel ? demoPolicyPath : null;
let bestEvaluation = bestModel ? evaluateModel(bestModel, HOLDOUT_SEEDS) : null;
let bestRank = bestEvaluation ? rankEvaluation(bestEvaluation) : -Infinity;
let stagnation = 0;
let cycle = 0;
let lastCandidate = null;
let lastEvaluation = null;
let lastImproved = false;

if (bestModel) {
  copyFileSync(demoPolicyPath, bestPolicyPath);
  bestModelPath = bestPolicyPath;
}

if (!bestModel || (bestEvaluation?.clearRate ?? 0) < heuristic.clearRate) {
  const imitationPath = resolve(runDir, "bootstrap-imitation.json");
  const imitation = await trainByImitation({
    seeds: TRAIN_SEEDS,
    hiddenSize: 16,
    actionMode: FIRE_TARGET_POLICY_ACTION_MODE,
    epochs: 18,
    learningRate: 0.008,
    outFilePath: imitationPath,
  });
  const imitationModel = loadModel(imitationPath);
  const imitationEvaluation = imitationModel ? evaluateModel(imitationModel, HOLDOUT_SEEDS) : null;
  const imitationRank = imitationEvaluation ? rankEvaluation(imitationEvaluation) : -Infinity;

  if (imitationModel && imitationEvaluation && imitationRank > bestRank) {
    bestModel = imitationModel;
    bestModelPath = imitationPath;
    bestEvaluation = imitationEvaluation;
    bestRank = imitationRank;
    copyFileSync(imitationPath, bestPolicyPath);
    copyFileSync(imitationPath, demoPolicyPath);
  }

  console.log(
    `Imitation    : clear ${toMdPercent(imitationEvaluation?.clearRate ?? 0)}, mean score ${(imitationEvaluation?.meanScore ?? 0).toFixed(1)}, acc ${(imitation.finalAccuracy * 100).toFixed(1)}%`,
  );
}

console.log("");
console.log("=== RL PDCA Run ===");
console.log(`Run dir      : ${toRepoPath(runDir)}`);
console.log(`Time budget  : ${timeBudgetHours.toFixed(2)}h`);
console.log(`Heuristic    : clear ${toMdPercent(heuristic.clearRate)}, mean score ${heuristic.meanScore.toFixed(1)}`);
if (bestEvaluation) {
  console.log(
    `Current demo : clear ${toMdPercent(bestEvaluation.clearRate)}, mean score ${bestEvaluation.meanScore.toFixed(1)}`,
  );
} else {
  console.log("Current demo : incompatible or missing, cold start");
}

while (Date.now() < deadline && cycle < maxCycles) {
  const timeLeftMinutes = Math.max(0, (deadline - Date.now()) / 60000);
  const bestSummary = bestEvaluation
    ? {
        clearRate: bestEvaluation.clearRate,
        meanScore: bestEvaluation.meanScore,
        bestScore: bestEvaluation.bestScore,
      }
    : null;
  const candidate = chooseCandidate(cycle, bestSummary, stagnation);
  const modelOutPath = resolve(runDir, `cycle-${String(cycle + 1).padStart(3, "0")}-${candidate.label}.json`);
  const warmStartPath = bestModelPath && existsSync(bestModelPath) ? bestModelPath : null;

  console.log("");
  console.log(
    `[Cycle ${cycle + 1}] plan=${candidate.label} timeLeft=${timeLeftMinutes.toFixed(1)}m warmStart=${warmStartPath ? "yes" : "no"}`,
  );

  const training = await trainWithCem({
    seed: (baseSeed + cycle * 97) >>> 0,
    iterations: candidate.iterations,
    populationSize: candidate.populationSize,
    eliteFraction: candidate.eliteFraction,
    hiddenSize: candidate.hiddenSize,
    initialStd: candidate.initialStd,
    minStd: candidate.minStd,
    decisionTicks: candidate.decisionTicks,
    seeds: candidate.seeds,
    actionMode: candidate.actionMode,
    warmStartPath,
    outFilePath: modelOutPath,
  });

  const candidateModel = loadModel(modelOutPath);
  const evaluation = candidateModel ? evaluateModel(candidateModel, HOLDOUT_SEEDS) : null;
  const candidateRank = evaluation ? rankEvaluation(evaluation) : -Infinity;
  const improved = Boolean(evaluation) && candidateRank > bestRank;

  if (improved) {
    bestModel = candidateModel;
    bestModelPath = modelOutPath;
    bestEvaluation = evaluation;
    bestRank = candidateRank;
    stagnation = 0;
    copyFileSync(modelOutPath, bestPolicyPath);
    copyFileSync(modelOutPath, demoPolicyPath);
  } else {
    stagnation += 1;
  }

  cycle += 1;
  lastCandidate = candidate;
  lastEvaluation = evaluation;
  lastImproved = improved;

  const record = {
    cycle,
    timestamp: new Date().toISOString(),
    improved,
    stagnation,
    candidate,
    trainingSummary: training.summary,
    evaluation,
    bestEvaluation,
    warmStartPath: toRepoPath(warmStartPath),
    outFilePath: toRepoPath(modelOutPath),
  };
  appendLine(historyPath, JSON.stringify(record));

  const state = {
    startedAt: runStartedAt,
    timeBudgetHours,
    cycle,
    stagnation,
    heuristic,
    bestEvaluation,
    bestModelPath: toRepoPath(bestModelPath),
    lastCandidate,
    lastEvaluation,
    lastImproved,
    runDir: toRepoPath(runDir),
    demoPolicyPath: toRepoPath(demoPolicyPath),
    historyPath: toRepoPath(historyPath),
    planLine: `直近の最良 clear rate ${toMdPercent(bestEvaluation?.clearRate ?? 0)} と平均スコア ${(bestEvaluation?.meanScore ?? 0).toFixed(1)} を見て、今回は ${candidate.label} を試しました。`,
    actLine: improved
      ? `改善が出たので ${candidate.label} を採用し、デモポリシーも更新しました。`
      : `改善が弱かったため現行ベストを維持し、次サイクルでは探索幅を調整します。`,
  };

  writeJson(summaryJsonPath, state);
  writeSummaryMarkdown(summaryMdPath, state);

  console.log(
    `[Cycle ${cycle}] check clear=${toMdPercent(evaluation?.clearRate ?? 0)} mean=${(evaluation?.meanScore ?? 0).toFixed(1)} best=${(evaluation?.bestScore ?? 0).toFixed(1)} improved=${improved ? "yes" : "no"}`,
  );
}

console.log("");
console.log("=== RL PDCA Finished ===");
console.log(`Cycles       : ${cycle}`);
console.log(`Best clear   : ${toMdPercent(bestEvaluation?.clearRate ?? 0)}`);
console.log(`Best mean    : ${(bestEvaluation?.meanScore ?? 0).toFixed(1)}`);
console.log(`Best score   : ${(bestEvaluation?.bestScore ?? 0).toFixed(1)}`);
console.log(`Summary JSON : ${toRepoPath(summaryJsonPath)}`);
console.log(`Summary MD   : ${toRepoPath(summaryMdPath)}`);
}
