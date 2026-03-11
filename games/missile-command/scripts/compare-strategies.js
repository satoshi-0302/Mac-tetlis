import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_BOTTOM_PRIORITY_CONFIG,
  DEFAULT_EDGE_PREDICTION_CONFIG,
  DEFAULT_HEURISTIC_CONFIG,
  createBottomPriorityDemoAgent,
  createEdgePredictionDemoAgent,
  createHeuristicDemoAgent,
} from "../rl/demo-agent.js";
import { buildObservation, OBSERVATION_DIM } from "../rl/observation.js";
import {
  DEFAULT_HIDDEN_SIZE,
  createPolicyRuntime,
  getPolicyParameterCount,
} from "../rl/policy.js";
import { evaluateAgentAcrossSeeds } from "../server/rl/heuristic-trainer.js";

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

function pickSeeds(setName) {
  switch (String(setName || "holdout")) {
    case "train":
      return { label: "train-6", seeds: TRAIN_SEEDS };
    case "all":
      return { label: "all-12", seeds: [...TRAIN_SEEDS, ...HOLDOUT_SEEDS] };
    default:
      return { label: "holdout-6", seeds: HOLDOUT_SEEDS };
  }
}

class PolicyAgentAdapter {
  constructor({ policy }) {
    this.policy = policy;
    this.runtime = createPolicyRuntime({
      observationDim: Number(policy?.config?.observationDim ?? OBSERVATION_DIM),
      hiddenSize: Number(policy?.config?.hiddenSize ?? DEFAULT_HIDDEN_SIZE),
      actionMode: policy?.config?.actionMode,
    });
    this.expectedParameters = getPolicyParameterCount(
      this.runtime.observationDim,
      this.runtime.hiddenSize,
      this.runtime.actionMode,
    );
    this.parameters = Float64Array.from((policy?.parameters ?? []).map((value) => Number(value)));
    this.observation = new Float32Array(OBSERVATION_DIM);
    this.tickCounter = 0;
    this.decisionTicks = Math.max(1, Math.min(12, Math.round(Number(policy?.config?.decisionTicks ?? 1))));

    if (this.parameters.length !== this.expectedParameters) {
      throw new Error(`Policy parameter mismatch: expected ${this.expectedParameters}`);
    }
  }

  reset() {
    this.tickCounter = 0;
  }

  nextAction(snapshot) {
    if (Number(snapshot?.shotCooldownSeconds ?? 0) > 0.001) {
      this.tickCounter += 1;
      return 0;
    }

    if (this.tickCounter % this.decisionTicks !== 0) {
      this.tickCounter += 1;
      return 0;
    }

    buildObservation(snapshot, this.observation);
    const action = this.runtime.selectAction(this.observation, this.parameters);
    this.tickCounter += 1;
    return action;
  }
}

function evaluateTopModel(policyPath, seeds) {
  const raw = JSON.parse(readFileSync(policyPath, "utf8"));

  if (raw?.config?.type === "heuristic-weights" || raw?.meta?.trainer === "heuristic-cem") {
    return {
      label: raw?.meta?.name ?? "Top AI",
      trainer: raw?.meta?.trainer ?? "heuristic",
      evaluation: evaluateAgentAcrossSeeds({
        seeds,
        createAgent: () =>
          createHeuristicDemoAgent({
            ...(raw?.heuristic?.params ?? {}),
            policyName: raw?.meta?.name ?? "Top AI",
          }),
      }),
    };
  }

  return {
    label: raw?.meta?.name ?? "Top AI",
    trainer: raw?.meta?.trainer ?? "policy",
    evaluation: evaluateAgentAcrossSeeds({
      seeds,
      createAgent: () => new PolicyAgentAdapter({ policy: raw }),
    }),
  };
}

function summarizeEntry(entry, topEvaluation) {
  return {
    strategy: entry.label,
    trainer: entry.trainer,
    clearRate: Number((entry.evaluation.clearRate * 100).toFixed(1)),
    meanScore: Number(entry.evaluation.meanScore.toFixed(1)),
    bestScore: Number(entry.evaluation.bestScore.toFixed(1)),
    meanAliveCities: Number(entry.evaluation.meanAliveCities.toFixed(2)),
    objective: Number(entry.evaluation.objective.toFixed(2)),
    deltaVsTopScore: Number((entry.evaluation.meanScore - topEvaluation.meanScore).toFixed(1)),
    deltaVsTopClear: Number(((entry.evaluation.clearRate - topEvaluation.clearRate) * 100).toFixed(1)),
  };
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2));
  const policyPath = resolve(process.cwd(), String(args.model || "./public/rl/demo-policy.json"));
  const picked = pickSeeds(args.set);
  const top = evaluateTopModel(policyPath, picked.seeds);
  const defaultHeuristic = {
    label: "Default Heuristic",
    trainer: "heuristic-baseline",
    evaluation: evaluateAgentAcrossSeeds({
      seeds: picked.seeds,
      createAgent: () => createHeuristicDemoAgent(DEFAULT_HEURISTIC_CONFIG),
    }),
  };
  const bottomPriority = {
    label: "Bottom Priority",
    trainer: "rule-based",
    evaluation: evaluateAgentAcrossSeeds({
      seeds: picked.seeds,
      createAgent: () =>
        createBottomPriorityDemoAgent({
          ...DEFAULT_BOTTOM_PRIORITY_CONFIG,
          policyName: "Bottom Priority",
        }),
    }),
  };
  const edgePrediction = {
    label: "Edge Prediction",
    trainer: "rule-based",
    evaluation: evaluateAgentAcrossSeeds({
      seeds: picked.seeds,
      createAgent: () =>
        createEdgePredictionDemoAgent({
          ...DEFAULT_EDGE_PREDICTION_CONFIG,
          policyName: "Edge Prediction",
        }),
    }),
  };

  const entries = [top, defaultHeuristic, bottomPriority, edgePrediction];
  const topEvaluation = top.evaluation;
  const ranked = entries
    .map((entry) => summarizeEntry(entry, topEvaluation))
    .sort((left, right) => right.objective - left.objective);

  console.log("");
  console.log(`=== Strategy Compare (${picked.label}) ===`);
  console.log(`Model : ${policyPath}`);
  for (const [index, entry] of ranked.entries()) {
    console.log(
      `${index + 1}. ${entry.strategy} | clear ${entry.clearRate.toFixed(1)}% | mean ${entry.meanScore.toLocaleString("ja-JP")} | best ${entry.bestScore.toLocaleString("ja-JP")} | alive ${entry.meanAliveCities.toFixed(2)} | dScore ${entry.deltaVsTopScore.toLocaleString("ja-JP")} | dClear ${entry.deltaVsTopClear.toFixed(1)}pt`,
    );
  }

  console.log("");
  console.log(JSON.stringify({ set: picked.label, ranked }, null, 2));
}
