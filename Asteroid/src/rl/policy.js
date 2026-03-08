import {
  INPUT_BOMB,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST
} from '../engine/constants.js';
import { OBS_TIME_REMAINING_INDEX } from './observation.js';

export const LEGACY_POLICY_ACTION_MODE = 'bitmask-v1';
export const MACRO_POLICY_ACTION_MODE = 'macro-move-v1';
export const PHASE_MACRO_POLICY_ACTION_MODE = 'phase-macro-v1';
export const POLICY_ACTION_BITS = [INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST, INPUT_SHOOT, INPUT_BOMB];
export const POLICY_OUTPUTS = POLICY_ACTION_BITS.length;
export const DEFAULT_HIDDEN_SIZE = 48;
export const DEFAULT_THRESHOLDS = [0.5, 0.5, 0.5, 0.5, 0.62];
export const MACRO_POLICY_MASKS = [
  0,
  INPUT_THRUST,
  INPUT_LEFT,
  INPUT_LEFT | INPUT_THRUST,
  INPUT_RIGHT,
  INPUT_RIGHT | INPUT_THRUST
];

function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function normalizePolicyActionMode(actionMode) {
  if (actionMode === PHASE_MACRO_POLICY_ACTION_MODE) {
    return PHASE_MACRO_POLICY_ACTION_MODE;
  }
  if (actionMode === MACRO_POLICY_ACTION_MODE) {
    return MACRO_POLICY_ACTION_MODE;
  }
  return LEGACY_POLICY_ACTION_MODE;
}

function getMacroHeadCount(actionMode) {
  return normalizePolicyActionMode(actionMode) === PHASE_MACRO_POLICY_ACTION_MODE ? 4 : 1;
}

function resolvePhaseHeadIndex(observation) {
  const remainingRatio = Number(observation?.[OBS_TIME_REMAINING_INDEX] ?? 1);
  if (remainingRatio > 0.75) {
    return 0;
  }
  if (remainingRatio > 0.5) {
    return 1;
  }
  if (remainingRatio > 0.25) {
    return 2;
  }
  return 3;
}

export function getPolicyOutputCount(actionMode = LEGACY_POLICY_ACTION_MODE) {
  const finalActionMode = normalizePolicyActionMode(actionMode);
  if (finalActionMode === LEGACY_POLICY_ACTION_MODE) {
    return POLICY_OUTPUTS;
  }
  return MACRO_POLICY_MASKS.length * getMacroHeadCount(finalActionMode);
}

export function getPolicyParameterCount(
  observationDim,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  actionMode = LEGACY_POLICY_ACTION_MODE
) {
  const outputCount = getPolicyOutputCount(actionMode);
  return observationDim * hiddenSize + hiddenSize + hiddenSize * outputCount + outputCount;
}

export function createPolicyRuntime({
  observationDim,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  thresholds = DEFAULT_THRESHOLDS,
  actionMode = LEGACY_POLICY_ACTION_MODE
} = {}) {
  if (!Number.isInteger(observationDim) || observationDim <= 0) {
    throw new Error('observationDim must be a positive integer');
  }
  if (!Number.isInteger(hiddenSize) || hiddenSize <= 0) {
    throw new Error('hiddenSize must be a positive integer');
  }

  const finalActionMode = normalizePolicyActionMode(actionMode);
  const outputCount = getPolicyOutputCount(finalActionMode);
  const finalThresholds =
    finalActionMode === LEGACY_POLICY_ACTION_MODE &&
    Array.isArray(thresholds) &&
    thresholds.length === POLICY_OUTPUTS
      ? thresholds.map((value) => Number(value))
      : DEFAULT_THRESHOLDS.slice();

  const hidden = new Float64Array(hiddenSize);
  const logits = new Float64Array(outputCount);
  const probabilities =
    finalActionMode === LEGACY_POLICY_ACTION_MODE ? new Float64Array(POLICY_OUTPUTS) : null;
  const parameterCount = getPolicyParameterCount(observationDim, hiddenSize, finalActionMode);

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
      if (probabilities) {
        probabilities[outputIndex] = sigmoid(logits[outputIndex]);
      }
    }

    return { logits, probabilities };
  }

  function actionMask(observation, parameters) {
    forward(observation, parameters);

    if (finalActionMode !== LEGACY_POLICY_ACTION_MODE) {
      const headOffset =
        finalActionMode === PHASE_MACRO_POLICY_ACTION_MODE
          ? resolvePhaseHeadIndex(observation) * MACRO_POLICY_MASKS.length
          : 0;
      let bestIndex = headOffset;
      let bestLogit = logits[headOffset];
      const endIndex = headOffset + MACRO_POLICY_MASKS.length;
      for (let index = headOffset + 1; index < endIndex; index += 1) {
        if (logits[index] > bestLogit) {
          bestLogit = logits[index];
          bestIndex = index;
        }
      }
      return MACRO_POLICY_MASKS[bestIndex - headOffset];
    }

    let mask = 0;
    const leftOn = probabilities[0] >= finalThresholds[0];
    const rightOn = probabilities[1] >= finalThresholds[1];
    const thrustOn = probabilities[2] >= finalThresholds[2];
    const shootOn = probabilities[3] >= finalThresholds[3];
    const bombOn = probabilities[4] >= finalThresholds[4];

    if (leftOn && rightOn) {
      if (logits[0] >= logits[1]) {
        mask |= INPUT_LEFT;
      } else {
        mask |= INPUT_RIGHT;
      }
    } else if (leftOn) {
      mask |= INPUT_LEFT;
    } else if (rightOn) {
      mask |= INPUT_RIGHT;
    }

    if (thrustOn) {
      mask |= INPUT_THRUST;
    }
    if (shootOn) {
      mask |= INPUT_SHOOT;
    }
    if (bombOn) {
      mask |= INPUT_BOMB;
    }

    return mask;
  }

  return {
    observationDim,
    hiddenSize,
    actionMode: finalActionMode,
    parameterCount,
    thresholds: finalActionMode === LEGACY_POLICY_ACTION_MODE ? finalThresholds : null,
    forward,
    actionMask
  };
}
