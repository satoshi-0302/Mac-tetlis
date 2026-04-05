import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  DEFAULT_HEURISTIC_CONFIG,
  createHeuristicDemoAgent,
  normalizeHeuristicConfig,
} from "../../rl/demo-agent.js";
import { createInitialState, getSnapshot, stepSimulation, SIM_MAX_TICKS } from "../../sim/core.js";
import { createRng } from "../../sim/rng.js";

const PARAM_KEYS = Object.freeze([
  "fireThreshold",
  "interceptLead",
  "urgencyWindow",
  "baseBlastReach",
  "urgencyBlastBonus",
  "baseUrgencyWeight",
  "cityBonus",
  "fastWeight",
  "splitWeight",
  "armoredWeight",
]);

const DEFAULT_STD = Object.freeze([0.08, 0.05, 0.7, 10, 10, 0.12, 0.08, 0.12, 0.12, 0.14]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

export function encodeHeuristicConfig(config) {
  const normalized = normalizeHeuristicConfig(config);
  return PARAM_KEYS.map((key) => normalized[key]);
}

export function decodeHeuristicVector(vector) {
  return normalizeHeuristicConfig(
    Object.fromEntries(PARAM_KEYS.map((key, index) => [key, Number(vector[index] ?? DEFAULT_HEURISTIC_CONFIG[key])])),
  );
}

export function evaluateHeuristicConfigAcrossSeeds({
  config = DEFAULT_HEURISTIC_CONFIG,
  seeds = [],
} = {}) {
  const normalized = normalizeHeuristicConfig(config);
  return evaluateAgentAcrossSeeds({
    seeds,
    createAgent: () => createHeuristicDemoAgent(normalized),
  });
}

export function evaluateAgentAcrossSeeds({
  seeds = [],
  createAgent,
} = {}) {
  const runs = [];

  for (const seed of seeds) {
    const agent = createAgent();
    const state = createInitialState({ seed });
    agent.reset();

    for (let tick = 0; tick < SIM_MAX_TICKS && !state.result; tick += 1) {
      const action = agent.nextAction(getSnapshot(state));
      stepSimulation(state, action);
    }

    const snapshot = getSnapshot(state);
    runs.push({
      reward: state.metrics.reward,
      score: state.score,
      maxChain: state.maxChain,
      aliveCities: snapshot.aliveCities,
      clear: state.result === "clear",
      survivalSeconds: state.tick / state.tickRate,
      shotsFired: state.metrics.shotsFired,
      kills: state.metrics.kills,
      threatIntegral: state.metrics.threatIntegral,
    });
  }

  const rewards = runs.map((run) => run.reward);
  const scores = runs.map((run) => run.score);
  const survivals = runs.map((run) => run.survivalSeconds);
  const aliveCities = runs.map((run) => run.aliveCities);
  const clearRate = runs.filter((run) => run.clear).length / Math.max(1, runs.length);
  const meanScore = mean(scores);
  const bestScore = Math.max(...scores);
  const meanSurvivalSeconds = mean(survivals);
  const worstSurvivalSeconds = Math.min(...survivals);
  const meanAliveCities = mean(aliveCities);
  const worstAliveCities = Math.min(...aliveCities);
  const meanReward = mean(rewards);
  const worstReward = Math.min(...rewards);
  const objective =
    clearRate * 120000 +
    meanScore * 3 +
    bestScore * 0.25 +
    meanAliveCities * 3000 +
    worstAliveCities * 1200 +
    meanSurvivalSeconds * 140 +
    worstSurvivalSeconds * 70 +
    meanReward * 6 +
    worstReward * 2;

  return {
    objective,
    runs,
    meanReward,
    worstReward,
    meanScore,
    bestScore,
    clearRate,
    meanAliveCities,
    worstAliveCities,
    meanSurvivalSeconds,
    worstSurvivalSeconds,
  };
}

export function buildHeuristicModel({
  config,
  evaluation,
  history = [],
  seeds = null,
  trainer = "heuristic-cem",
  name = "Orbital Shield Heuristic Policy",
} = {}) {
  const normalized = normalizeHeuristicConfig(config);
  return {
    meta: {
      name,
      createdAt: new Date().toISOString(),
      trainer,
    },
    config: {
      type: "heuristic-weights",
      decisionTicks: 1,
      seeds,
    },
    best: {
      objective: evaluation?.objective ?? 0,
      score: evaluation?.bestScore ?? 0,
      meanScore: evaluation?.meanScore ?? 0,
      clearRate: evaluation?.clearRate ?? 0,
      meanAliveCities: evaluation?.meanAliveCities ?? 0,
      meanSurvivalSeconds: evaluation?.meanSurvivalSeconds ?? 0,
    },
    heuristic: {
      params: normalized,
      parameterKeys: PARAM_KEYS,
      history,
    },
    parameters: encodeHeuristicConfig(normalized),
  };
}

function loadWarmStart(path) {
  if (!path) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw?.config?.type !== "heuristic-weights") {
      return null;
    }

    return Float64Array.from(encodeHeuristicConfig(raw?.heuristic?.params ?? {}));
  } catch (error) {
    return null;
  }
}

export async function trainHeuristicWithCem({
  seed = 0x71c4a90d,
  iterations = 24,
  populationSize = 28,
  eliteFraction = 0.25,
  initialConfig = DEFAULT_HEURISTIC_CONFIG,
  initialStd = DEFAULT_STD,
  minStdScale = 0.1,
  seeds = [],
  warmStartPath = null,
  outFilePath = null,
} = {}) {
  const dimension = PARAM_KEYS.length;
  const rng = createRng(seed);
  const sampleNormal = createNormalSampler(rng);
  const eliteCount = Math.max(2, Math.floor(populationSize * clamp(eliteFraction, 0.05, 0.8)));
  const meanVector = Float64Array.from(encodeHeuristicConfig(initialConfig));
  const stdVector = Float64Array.from(
    Array.from({ length: dimension }, (_, index) => Number(initialStd[index] ?? DEFAULT_STD[index])),
  );
  const warmStart = loadWarmStart(warmStartPath);
  if (warmStart && warmStart.length === dimension) {
    meanVector.set(warmStart);
  }

  const minStd = DEFAULT_STD.map((value) => value * clamp(minStdScale, 0.02, 1));
  const history = [];
  let bestCandidate = null;

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const candidates = [];

    for (let index = 0; index < populationSize; index += 1) {
      const vector = new Float64Array(dimension);
      for (let paramIndex = 0; paramIndex < dimension; paramIndex += 1) {
        vector[paramIndex] = meanVector[paramIndex] + sampleNormal() * stdVector[paramIndex];
      }

      const config = decodeHeuristicVector(vector);
      const evaluation = evaluateHeuristicConfigAcrossSeeds({
        config,
        seeds,
      });
      candidates.push({
        vector,
        config,
        evaluation,
      });
    }

    candidates.sort((left, right) => right.evaluation.objective - left.evaluation.objective);
    const elites = candidates.slice(0, eliteCount);
    const top = elites[0];

    for (let paramIndex = 0; paramIndex < dimension; paramIndex += 1) {
      let eliteMean = 0;
      for (const elite of elites) {
        eliteMean += elite.vector[paramIndex];
      }
      eliteMean /= elites.length;

      let eliteVariance = 0;
      for (const elite of elites) {
        const delta = elite.vector[paramIndex] - eliteMean;
        eliteVariance += delta * delta;
      }
      eliteVariance /= elites.length;

      meanVector[paramIndex] = eliteMean;
      stdVector[paramIndex] = Math.max(minStd[paramIndex], Math.sqrt(eliteVariance));
    }

    if (!bestCandidate || top.evaluation.objective > bestCandidate.evaluation.objective) {
      bestCandidate = top;
    }

    const objectiveStats = summarizePopulation(candidates.map((candidate) => candidate.evaluation.objective));
    const scoreStats = summarizePopulation(candidates.map((candidate) => candidate.evaluation.meanScore));
    history.push({
      iteration,
      objectiveBest: top.evaluation.objective,
      objectiveMean: objectiveStats.mean,
      scoreBest: top.evaluation.bestScore,
      scoreMean: scoreStats.mean,
      clearRate: top.evaluation.clearRate,
      meanAliveCities: top.evaluation.meanAliveCities,
    });
  }

  const model = buildHeuristicModel({
    config: bestCandidate?.config ?? initialConfig,
    evaluation: bestCandidate?.evaluation ?? null,
    history,
    seeds,
  });

  if (outFilePath) {
    mkdirSync(dirname(outFilePath), { recursive: true });
    writeFileSync(outFilePath, JSON.stringify(model, null, 2), "utf8");
  }

  return {
    model,
    evaluation: bestCandidate?.evaluation ?? null,
    config: bestCandidate?.config ?? normalizeHeuristicConfig(initialConfig),
    history,
    summary: {
      score: bestCandidate?.evaluation?.bestScore ?? 0,
      meanScore: bestCandidate?.evaluation?.meanScore ?? 0,
      objective: bestCandidate?.evaluation?.objective ?? 0,
      clearRate: bestCandidate?.evaluation?.clearRate ?? 0,
      meanAliveCities: bestCandidate?.evaluation?.meanAliveCities ?? 0,
    },
  };
}
