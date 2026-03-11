import { buildObservation, OBSERVATION_DIM } from "../../rl/observation.js";
import { SIM_MAX_TICKS, createInitialState, getSnapshot, stepSimulation } from "../../sim/core.js";

export const DEFAULT_EVAL_SEEDS = Object.freeze([
  0x3d93fa2a,
  0x27d4eb2d,
  0x91e10dab,
  0x11111111,
  0x22222222,
  0x33333333,
]);

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function rolloutPolicy({
  runtime,
  parameters,
  seed,
  decisionTicks = 2,
}) {
  const state = createInitialState({ seed });
  const observation = new Float32Array(OBSERVATION_DIM);
  const safeDecisionTicks = Math.max(1, Math.min(12, Math.round(decisionTicks)));
  let actionIndex = 0;

  for (let tick = 0; tick < SIM_MAX_TICKS && !state.result; tick += 1) {
    const snapshot = getSnapshot(state);

    if (tick % safeDecisionTicks === 0) {
      buildObservation(snapshot, observation);
      actionIndex = snapshot.shotCooldownSeconds > 0.001 ? 0 : runtime.selectAction(observation, parameters);
    }

    stepSimulation(state, actionIndex);
  }

  const snapshot = getSnapshot(state);
  return {
    reward: state.metrics.reward,
    score: state.score,
    maxChain: state.maxChain,
    aliveCities: snapshot.aliveCities,
    clear: state.result === "clear",
    survivalSeconds: (state.tick / state.tickRate),
    shotsFired: state.metrics.shotsFired,
    kills: state.metrics.kills,
    threatIntegral: state.metrics.threatIntegral,
  };
}

export function evaluatePolicyAcrossSeeds({
  runtime,
  parameters,
  seeds = DEFAULT_EVAL_SEEDS,
  decisionTicks = 2,
}) {
  const runs = seeds.map((seed) =>
    rolloutPolicy({
      runtime,
      parameters,
      seed,
      decisionTicks,
    }),
  );

  const rewards = runs.map((run) => run.reward);
  const scores = runs.map((run) => run.score);
  const survivals = runs.map((run) => run.survivalSeconds);
  const clears = runs.filter((run) => run.clear).length;
  const meanReward = mean(rewards);
  const worstReward = Math.min(...rewards);
  const meanScore = mean(scores);
  const bestScore = Math.max(...scores);
  const clearRate = clears / runs.length;
  const objective =
    clearRate * 100000 +
    meanScore * 2 +
    bestScore * 0.18 +
    meanReward * 12 +
    worstReward * 4 +
    mean(survivals) * 180 +
    Math.min(...survivals) * 90;

  return {
    objective,
    runs,
    meanReward,
    worstReward,
    meanScore,
    bestScore,
    clearRate,
    meanSurvivalSeconds: mean(survivals),
    worstSurvivalSeconds: Math.min(...survivals),
  };
}
