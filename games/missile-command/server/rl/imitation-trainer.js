import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createHeuristicDemoAgent } from "../../rl/demo-agent.js";
import { OBSERVATION_DIM, OBS_TIME_REMAINING_INDEX, buildObservation } from "../../rl/observation.js";
import {
  DEFAULT_HIDDEN_SIZE,
  FIRE_TARGET_POLICY_ACTION_MODE,
  MACRO_POLICY_ACTION_MODE,
  PHASE_MACRO_POLICY_ACTION_MODE,
  getPolicyOutputCount,
} from "../../rl/policy.js";
import { createInitialState, getSnapshot, stepSimulation, SIM_MAX_TICKS } from "../../sim/core.js";
import { createRng } from "../../sim/rng.js";
import { ACTION_COUNT, NOOP_ACTION_INDEX } from "../../sim/action-map.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeActionMode(actionMode) {
  return actionMode === PHASE_MACRO_POLICY_ACTION_MODE
    ? PHASE_MACRO_POLICY_ACTION_MODE
    : actionMode === FIRE_TARGET_POLICY_ACTION_MODE
      ? FIRE_TARGET_POLICY_ACTION_MODE
    : MACRO_POLICY_ACTION_MODE;
}

function getHeadCount(actionMode) {
  return normalizeActionMode(actionMode) === PHASE_MACRO_POLICY_ACTION_MODE ? 4 : 1;
}

function getHeadIndex(observation, actionMode) {
  if (normalizeActionMode(actionMode) !== PHASE_MACRO_POLICY_ACTION_MODE) {
    return 0;
  }

  const remaining = Number(observation?.[OBS_TIME_REMAINING_INDEX] ?? 1);
  if (remaining > 0.75) {
    return 0;
  }
  if (remaining > 0.5) {
    return 1;
  }
  if (remaining > 0.25) {
    return 2;
  }
  return 3;
}

function createDataset(seeds, actionMode) {
  const rawSamples = [];
  const observation = new Float32Array(OBSERVATION_DIM);
  const rawActionCounts = Array.from({ length: ACTION_COUNT }, () => 0);

  for (const seed of seeds) {
    const agent = createHeuristicDemoAgent();
    const state = createInitialState({ seed });
    agent.reset();

    for (let tick = 0; tick < SIM_MAX_TICKS && !state.result; tick += 1) {
      const snapshot = getSnapshot(state);
      const action = agent.nextAction(snapshot);

      if (snapshot.shotCooldownSeconds <= 0.001) {
        buildObservation(snapshot, observation);
        const safeAction = clamp(Math.round(Number(action) || 0), 0, ACTION_COUNT - 1);
        rawActionCounts[safeAction] += 1;
        rawSamples.push({
          observation: Float32Array.from(observation),
          action: safeAction,
          headIndex: getHeadIndex(observation, actionMode),
          enemyCount: snapshot.enemyMissiles.length,
          tick,
        });
      }

      stepSimulation(state, action);
    }
  }

  const samples = [];
  const actionCounts = Array.from({ length: ACTION_COUNT }, () => 0);

  for (const sample of rawSamples) {
    if (sample.action === NOOP_ACTION_INDEX) {
      const stride = sample.enemyCount === 0 ? 6 : 2;
      if (sample.tick % stride !== 0) {
        continue;
      }
    }

    actionCounts[sample.action] += 1;
    samples.push(sample);
  }

  const totalSamples = Math.max(1, samples.length);
  const classWeights = actionCounts.map((count, actionIndex) => {
    if (count <= 0) {
      return 0;
    }

    const baseWeight = clamp(Math.sqrt(totalSamples / count), 0.85, 3);
    return actionIndex === NOOP_ACTION_INDEX ? Math.min(baseWeight, 1) : Math.max(1.75, baseWeight);
  });

  const rawWeights = samples.map((sample) =>
    classWeights[sample.action] *
    (sample.action === NOOP_ACTION_INDEX
      ? sample.enemyCount > 0
        ? 0.7
        : 0.25
      : 1 + Math.min(0.8, sample.enemyCount * 0.05)),
  );
  const meanWeight = rawWeights.reduce((sum, value) => sum + value, 0) / Math.max(1, rawWeights.length);
  const weightedSamples = samples.map((sample, index) => ({
    observation: sample.observation,
    action: sample.action,
    headIndex: sample.headIndex,
    weight: rawWeights[index] / Math.max(0.0001, meanWeight),
  }));

  const shotSamples = samples.length - actionCounts[NOOP_ACTION_INDEX];

  return {
    samples: weightedSamples,
    stats: {
      rawSampleCount: rawSamples.length,
      sampleCount: weightedSamples.length,
      shotSamples,
      noopSamples: actionCounts[NOOP_ACTION_INDEX],
      shotRate: shotSamples / Math.max(1, samples.length),
      rawActionCounts,
      actionCounts,
      classWeights,
      meanWeight,
    },
  };
}

function shuffleIndices(length, rng) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.nextFloat() * (index + 1));
    const temp = indices[index];
    indices[index] = indices[swapIndex];
    indices[swapIndex] = temp;
  }
  return indices;
}

function argMax(values, start, end) {
  let bestIndex = start;
  let bestValue = values[start];
  for (let index = start + 1; index < end; index += 1) {
    if (values[index] > bestValue) {
      bestValue = values[index];
      bestIndex = index;
    }
  }
  return bestIndex;
}

export async function trainByImitation({
  seeds,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  actionMode = MACRO_POLICY_ACTION_MODE,
  epochs = 8,
  learningRate = 0.03,
  weightDecay = 0.000015,
  seed = 0x41f37a25,
  outFilePath = null,
} = {}) {
  const finalActionMode = normalizeActionMode(actionMode);
  const dataset = createDataset(seeds, finalActionMode);
  const samples = dataset.samples;
  const outputCount = getPolicyOutputCount(finalActionMode);
  const inputCount = OBSERVATION_DIM;
  const headCount = getHeadCount(finalActionMode);
  const parameterCount = inputCount * hiddenSize + hiddenSize + hiddenSize * outputCount + outputCount;
  const rng = createRng(seed);
  const parameters = new Float64Array(parameterCount);
  const hidden = new Float64Array(hiddenSize);
  const hiddenDelta = new Float64Array(hiddenSize);
  const logits = new Float64Array(outputCount);
  const headProbabilities = new Float64Array(ACTION_COUNT);
  const outputGradients = new Float64Array(outputCount);
  const epochHistory = [];

  for (let index = 0; index < parameters.length; index += 1) {
    parameters[index] = (rng.nextFloat() * 2 - 1) * 0.045;
  }

  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    const order = shuffleIndices(samples.length, rng);
    let totalLoss = 0;
    let correct = 0;
    let totalWeight = 0;
    const lr = learningRate * Math.pow(0.92, epoch - 1);

    for (const sampleIndex of order) {
      const sample = samples[sampleIndex];
      const observation = sample.observation;
      const targetAction = clamp(Math.round(Number(sample.action) || 0), 0, ACTION_COUNT - 1);
      const headIndex = clamp(sample.headIndex, 0, headCount - 1);
      const headStart = headIndex * ACTION_COUNT;
      const headEnd = headStart + ACTION_COUNT;
      const sampleWeight = Math.max(0.1, Number(sample.weight) || 1);
      totalWeight += sampleWeight;

      let offset = 0;
      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        let sum = 0;
        for (let featureIndex = 0; featureIndex < inputCount; featureIndex += 1) {
          sum += parameters[offset++] * observation[featureIndex];
        }
        hidden[hiddenIndex] = sum;
      }

      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        hidden[hiddenIndex] = Math.tanh(hidden[hiddenIndex] + parameters[offset++]);
      }

      for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
        let sum = 0;
        for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
          sum += parameters[offset++] * hidden[hiddenIndex];
        }
        logits[outputIndex] = sum + parameters[offset++];
        outputGradients[outputIndex] = 0;
      }

      let predicted = 0;
      if (finalActionMode === FIRE_TARGET_POLICY_ACTION_MODE) {
        if (logits[0] > 0) {
          predicted = argMax(logits, 1, ACTION_COUNT);
        }
      } else {
        predicted = argMax(logits, headStart, headEnd) - headStart;
      }

      if (predicted === targetAction) {
        correct += sampleWeight;
      }

      if (finalActionMode === FIRE_TARGET_POLICY_ACTION_MODE) {
        const fireTarget = targetAction === NOOP_ACTION_INDEX ? 0 : 1;
        const fireLogit = logits[0];
        const fireProbability = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, fireLogit))));
        totalLoss -= sampleWeight * (
          fireTarget * Math.log(Math.max(1e-9, fireProbability)) +
          (1 - fireTarget) * Math.log(Math.max(1e-9, 1 - fireProbability))
        );
        outputGradients[0] = sampleWeight * (fireProbability - fireTarget);

        if (fireTarget === 1) {
          let maxLogit = -Infinity;
          for (let targetIndex = 1; targetIndex < ACTION_COUNT; targetIndex += 1) {
            maxLogit = Math.max(maxLogit, logits[targetIndex]);
          }

          let probabilitySum = 0;
          for (let targetIndex = 1; targetIndex < ACTION_COUNT; targetIndex += 1) {
            const value = Math.exp(logits[targetIndex] - maxLogit);
            headProbabilities[targetIndex] = value;
            probabilitySum += value;
          }

          const normalization = Math.max(Number.EPSILON, probabilitySum);
          for (let targetIndex = 1; targetIndex < ACTION_COUNT; targetIndex += 1) {
            headProbabilities[targetIndex] /= normalization;
            totalLoss -=
              targetIndex === targetAction ? sampleWeight * Math.log(Math.max(1e-9, headProbabilities[targetIndex])) : 0;
            outputGradients[targetIndex] =
              sampleWeight * (headProbabilities[targetIndex] - (targetIndex === targetAction ? 1 : 0));
          }
        }
      } else {
        let maxLogit = -Infinity;
        for (let actionIndex = 0; actionIndex < ACTION_COUNT; actionIndex += 1) {
          maxLogit = Math.max(maxLogit, logits[headStart + actionIndex]);
        }

        let probabilitySum = 0;
        for (let actionIndex = 0; actionIndex < ACTION_COUNT; actionIndex += 1) {
          const value = Math.exp(logits[headStart + actionIndex] - maxLogit);
          headProbabilities[actionIndex] = value;
          probabilitySum += value;
        }

        const normalization = Math.max(Number.EPSILON, probabilitySum);
        for (let actionIndex = 0; actionIndex < ACTION_COUNT; actionIndex += 1) {
          headProbabilities[actionIndex] /= normalization;
        }

        totalLoss -= sampleWeight * Math.log(Math.max(1e-9, headProbabilities[targetAction]));
        for (let actionIndex = 0; actionIndex < ACTION_COUNT; actionIndex += 1) {
          outputGradients[headStart + actionIndex] =
            sampleWeight * (headProbabilities[actionIndex] - (actionIndex === targetAction ? 1 : 0));
        }
      }

      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        hiddenDelta[hiddenIndex] = 0;
      }

      const hiddenToOutputOffset = inputCount * hiddenSize + hiddenSize;
      const outputBiasOffset = hiddenToOutputOffset + hiddenSize * outputCount;

      for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
        const gradient = outputGradients[outputIndex];
        const weightOffset = hiddenToOutputOffset + outputIndex * hiddenSize;

        for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
          const parameterIndex = weightOffset + hiddenIndex;
          hiddenDelta[hiddenIndex] += gradient * parameters[parameterIndex];
          parameters[parameterIndex] -= lr * (gradient * hidden[hiddenIndex] + weightDecay * parameters[parameterIndex]);
        }

        parameters[outputBiasOffset + outputIndex] -= lr * (gradient + weightDecay * parameters[outputBiasOffset + outputIndex]);
      }

      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        hiddenDelta[hiddenIndex] *= 1 - hidden[hiddenIndex] * hidden[hiddenIndex];
      }

      const inputToHiddenOffset = 0;
      const hiddenBiasOffset = inputCount * hiddenSize;
      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        const delta = hiddenDelta[hiddenIndex];
        const baseOffset = inputToHiddenOffset + hiddenIndex * inputCount;

        for (let featureIndex = 0; featureIndex < inputCount; featureIndex += 1) {
          const parameterIndex = baseOffset + featureIndex;
          parameters[parameterIndex] -=
            lr * (delta * observation[featureIndex] + weightDecay * parameters[parameterIndex]);
        }

        parameters[hiddenBiasOffset + hiddenIndex] -=
          lr * (delta + weightDecay * parameters[hiddenBiasOffset + hiddenIndex]);
      }
    }

    epochHistory.push({
      epoch,
      loss: totalLoss / Math.max(1, totalWeight),
      accuracy: correct / Math.max(1, totalWeight),
      learningRate: lr,
    });
  }

  const model = {
    meta: {
      name: "Orbital Shield Heuristic Bootstrap",
      createdAt: new Date().toISOString(),
      trainer: "imitation",
    },
    config: {
      observationDim: OBSERVATION_DIM,
      hiddenSize,
      actionMode: finalActionMode,
      decisionTicks: 1,
      seeds: seeds ?? null,
    },
    best: {
      objective: 0,
      score: 0,
      meanScore: 0,
      clearRate: 0,
      meanSurvivalSeconds: 0,
      trainingAccuracy: epochHistory[epochHistory.length - 1]?.accuracy ?? 0,
    },
    parameters: Array.from(parameters),
    imitation: {
      datasetSize: samples.length,
      dataset: dataset.stats,
      epochs: epochHistory,
    },
  };

  if (outFilePath) {
    mkdirSync(dirname(outFilePath), { recursive: true });
    writeFileSync(outFilePath, JSON.stringify(model, null, 2), "utf8");
  }

  return {
    model,
    datasetSize: samples.length,
    dataset: dataset.stats,
    epochs: epochHistory,
    finalAccuracy: epochHistory[epochHistory.length - 1]?.accuracy ?? 0,
  };
}
