import { ACTION_COUNT } from "../sim/action-map.js";
import { OBS_TIME_REMAINING_INDEX } from "./observation.js";

export const MACRO_POLICY_ACTION_MODE = "macro-v1";
export const PHASE_MACRO_POLICY_ACTION_MODE = "phase-macro-v1";
export const FIRE_TARGET_POLICY_ACTION_MODE = "fire-target-v1";
export const DEFAULT_HIDDEN_SIZE = 40;

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

export function getPolicyOutputCount(actionMode = MACRO_POLICY_ACTION_MODE) {
  return normalizeActionMode(actionMode) === FIRE_TARGET_POLICY_ACTION_MODE
    ? ACTION_COUNT
    : ACTION_COUNT * getHeadCount(actionMode);
}

export function getPolicyParameterCount(
  observationDim,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  actionMode = MACRO_POLICY_ACTION_MODE,
) {
  const outputCount = getPolicyOutputCount(actionMode);
  return observationDim * hiddenSize + hiddenSize + hiddenSize * outputCount + outputCount;
}

export function createPolicyRuntime({
  observationDim,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  actionMode = MACRO_POLICY_ACTION_MODE,
} = {}) {
  if (!Number.isInteger(observationDim) || observationDim <= 0) {
    throw new Error("observationDim must be a positive integer");
  }

  if (!Number.isInteger(hiddenSize) || hiddenSize <= 0) {
    throw new Error("hiddenSize must be a positive integer");
  }

  const finalActionMode = normalizeActionMode(actionMode);
  const outputCount = getPolicyOutputCount(finalActionMode);
  const parameterCount = getPolicyParameterCount(observationDim, hiddenSize, finalActionMode);
  const hidden = new Float64Array(hiddenSize);
  const logits = new Float64Array(outputCount);

  function ensureParameterLength(parameters) {
    if (!parameters || parameters.length !== parameterCount) {
      throw new Error(`Policy parameters length mismatch: expected ${parameterCount}`);
    }
  }

  function forward(observation, parameters) {
    ensureParameterLength(parameters);

    if (!observation || observation.length !== observationDim) {
      throw new Error(`Observation length mismatch: expected ${observationDim}`);
    }

    let offset = 0;

    for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
      let sum = 0;
      for (let featureIndex = 0; featureIndex < observationDim; featureIndex += 1) {
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
    }

    return logits;
  }

  function selectAction(observation, parameters) {
    forward(observation, parameters);

    if (finalActionMode === FIRE_TARGET_POLICY_ACTION_MODE) {
      if (logits[0] <= 0) {
        return 0;
      }

      let bestIndex = 1;
      let bestValue = logits[1];
      for (let index = 2; index < ACTION_COUNT; index += 1) {
        if (logits[index] > bestValue) {
          bestValue = logits[index];
          bestIndex = index;
        }
      }

      return bestIndex;
    }

    const headIndex = getHeadIndex(observation, finalActionMode);
    const start = headIndex * ACTION_COUNT;
    const end = start + ACTION_COUNT;
    let bestIndex = start;
    let bestValue = logits[start];

    for (let index = start + 1; index < end; index += 1) {
      if (logits[index] > bestValue) {
        bestValue = logits[index];
        bestIndex = index;
      }
    }

    return bestIndex - start;
  }

  return {
    observationDim,
    hiddenSize,
    actionMode: finalActionMode,
    outputCount,
    parameterCount,
    selectAction,
    forward,
  };
}
