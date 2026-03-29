import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { OBSERVATION_DIM } from "../../rl/observation.js";
import {
  DEFAULT_HIDDEN_SIZE,
  PHASE_MACRO_POLICY_ACTION_MODE,
  createPolicyRuntime,
} from "../../rl/policy.js";
import { createRng } from "../../sim/rng.js";
import { evaluatePolicyAcrossSeeds } from "./env.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createNormalSampler(rng) {
  let spare = null;

  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }

    let u = 0;
    let v = 0;
    while (u <= Number.EPSILON) {
      u = rng.nextFloat();
    }
    while (v <= Number.EPSILON) {
      v = rng.nextFloat();
    }

    const radius = Math.sqrt(-2 * Math.log(u));
    const theta = Math.PI * 2 * v;
    spare = radius * Math.sin(theta);
    return radius * Math.cos(theta);
  };
}

function summarizePopulation(values) {
  if (values.length === 0) {
    return { best: 0, worst: 0, mean: 0 };
  }

  let best = -Infinity;
  let worst = Infinity;
  let sum = 0;

  for (const value of values) {
    best = Math.max(best, value);
    worst = Math.min(worst, value);
    sum += value;
  }

  return {
    best,
    worst,
    mean: sum / values.length,
  };
}

function loadWarmStart(path, { expectedCount, observationDim, hiddenSize, actionMode }) {
  if (!path) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (
      !Array.isArray(raw?.parameters) ||
      raw.parameters.length !== expectedCount ||
      Number(raw?.config?.observationDim ?? 0) !== observationDim ||
      Number(raw?.config?.hiddenSize ?? 0) !== hiddenSize ||
      String(raw?.config?.actionMode ?? "") !== String(actionMode)
    ) {
      return null;
    }

    return Float64Array.from(raw.parameters.map((value) => Number(value)));
  } catch (error) {
    return null;
  }
}

export async function trainWithCem({
  seed = 0x3d93fa2a,
  iterations = 32,
  populationSize = 28,
  eliteFraction = 0.25,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  initialStd = 0.22,
  minStd = 0.025,
  decisionTicks = 2,
  seeds = undefined,
  actionMode = PHASE_MACRO_POLICY_ACTION_MODE,
  warmStartPath = null,
  outFilePath = null,
} = {}) {
  const runtime = createPolicyRuntime({
    observationDim: OBSERVATION_DIM,
    hiddenSize,
    actionMode,
  });
  const parameterCount = runtime.parameterCount;
  const rng = createRng(seed);
  const sampleNormal = createNormalSampler(rng);
  const eliteCount = Math.max(2, Math.floor(populationSize * clamp(eliteFraction, 0.05, 0.8)));
  const mean = new Float64Array(parameterCount);
  const std = new Float64Array(parameterCount).fill(initialStd);
  const warmStart = loadWarmStart(warmStartPath, {
    expectedCount: parameterCount,
    observationDim: OBSERVATION_DIM,
    hiddenSize,
    actionMode,
  });
  if (warmStart) {
    mean.set(warmStart);
  }

  const history = [];
  let bestCandidate = null;

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const candidates = [];

    for (let index = 0; index < populationSize; index += 1) {
      const params = new Float64Array(parameterCount);
      for (let paramIndex = 0; paramIndex < parameterCount; paramIndex += 1) {
        params[paramIndex] = mean[paramIndex] + sampleNormal() * std[paramIndex];
      }

      const evaluation = evaluatePolicyAcrossSeeds({
        runtime,
        parameters: params,
        seeds,
        decisionTicks,
      });
      candidates.push({
        params,
        evaluation,
      });
    }

    candidates.sort((left, right) => right.evaluation.objective - left.evaluation.objective);
    const elites = candidates.slice(0, eliteCount);
    const top = elites[0];

    for (let paramIndex = 0; paramIndex < parameterCount; paramIndex += 1) {
      let eliteMean = 0;
      for (const elite of elites) {
        eliteMean += elite.params[paramIndex];
      }
      eliteMean /= elites.length;

      let eliteVariance = 0;
      for (const elite of elites) {
        const delta = elite.params[paramIndex] - eliteMean;
        eliteVariance += delta * delta;
      }
      eliteVariance /= elites.length;

      mean[paramIndex] = eliteMean;
      std[paramIndex] = Math.max(minStd, Math.sqrt(eliteVariance));
    }

    if (!bestCandidate || top.evaluation.objective > bestCandidate.evaluation.objective) {
      bestCandidate = top;
    }

    const rewardStats = summarizePopulation(candidates.map((candidate) => candidate.evaluation.objective));
    const scoreStats = summarizePopulation(candidates.map((candidate) => candidate.evaluation.meanScore));
    history.push({
      iteration,
      objectiveBest: top.evaluation.objective,
      objectiveMean: rewardStats.mean,
      scoreBest: top.evaluation.bestScore,
      scoreMean: scoreStats.mean,
      clearRate: top.evaluation.clearRate,
    });
  }

  const model = {
    meta: {
      name: "Orbital Shield Demo Policy",
      createdAt: new Date().toISOString(),
      trainer: "cem",
    },
    config: {
      observationDim: OBSERVATION_DIM,
      hiddenSize,
      actionMode,
      decisionTicks,
      seeds: seeds ?? null,
    },
    best: {
      objective: bestCandidate?.evaluation.objective ?? 0,
      score: bestCandidate?.evaluation.bestScore ?? 0,
      meanScore: bestCandidate?.evaluation.meanScore ?? 0,
      clearRate: bestCandidate?.evaluation.clearRate ?? 0,
      meanSurvivalSeconds: bestCandidate?.evaluation.meanSurvivalSeconds ?? 0,
    },
    parameters: Array.from(bestCandidate?.params ?? mean),
  };

  if (outFilePath) {
    mkdirSync(dirname(outFilePath), { recursive: true });
    writeFileSync(outFilePath, JSON.stringify(model, null, 2), "utf8");
  }

  return {
    model,
    history,
    evaluation: bestCandidate?.evaluation ?? null,
    summary: {
      score: bestCandidate?.evaluation.bestScore ?? 0,
      meanScore: bestCandidate?.evaluation.meanScore ?? 0,
      objective: bestCandidate?.evaluation.objective ?? 0,
      clearRate: bestCandidate?.evaluation.clearRate ?? 0,
    },
  };
}
