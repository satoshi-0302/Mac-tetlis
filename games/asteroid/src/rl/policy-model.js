import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  INPUT_BOMB,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST,
  LEGACY_REFERENCE_TICK_RATE,
  TICK_RATE
} from '../engine/constants.js';
import { cloneSimulationState, stepSimulation } from '../game/sim-core.js';
import { OBSERVATION_DIM, buildObservation } from './observation.js';
import {
  DEFAULT_THRESHOLDS,
  LEGACY_POLICY_ACTION_MODE,
  createPolicyRuntime,
  getPolicyParameterCount
} from './policy.js';

export const SINGLE_POLICY_KIND = 'single-v1';
export const PHASE_SWITCH_POLICY_KIND = 'phase-switch-v1';
const LOOKAHEAD_CANDIDATE_MASKS = Object.freeze([
  0,
  INPUT_THRUST,
  INPUT_LEFT,
  INPUT_LEFT | INPUT_THRUST,
  INPUT_RIGHT,
  INPUT_RIGHT | INPUT_THRUST
]);

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampDecisionTicks(value) {
  if (!Number.isInteger(value)) {
    return 1;
  }
  return Math.max(1, Math.min(8, value));
}

export function scaleDecisionTicks(value, sourceTickRate = LEGACY_REFERENCE_TICK_RATE) {
  const safeSourceTickRate =
    Number.isFinite(sourceTickRate) && sourceTickRate > 0 ? sourceTickRate : LEGACY_REFERENCE_TICK_RATE;
  return clampDecisionTicks(Math.round((value * TICK_RATE) / safeSourceTickRate));
}

export function detectPolicyModelKind(model) {
  const kind = model?.config?.kind ?? model?.kind;
  if (kind === PHASE_SWITCH_POLICY_KIND || Array.isArray(model?.phases)) {
    return PHASE_SWITCH_POLICY_KIND;
  }
  return SINGLE_POLICY_KIND;
}

export function getPolicyActionModeLabel(model) {
  if (detectPolicyModelKind(model) === PHASE_SWITCH_POLICY_KIND) {
    return PHASE_SWITCH_POLICY_KIND;
  }
  return model?.config?.actionMode ?? LEGACY_POLICY_ACTION_MODE;
}

export function extractPrimaryTrainablePolicy(model) {
  if (detectPolicyModelKind(model) !== PHASE_SWITCH_POLICY_KIND) {
    return model;
  }

  const phases = Array.isArray(model?.phases) ? model.phases : [];
  if (phases.length === 0) {
    throw new Error('Composite policy is missing phases');
  }

  const preferredName =
    typeof model?.training?.primaryPhaseName === 'string' && model.training.primaryPhaseName.length > 0
      ? model.training.primaryPhaseName
      : null;
  if (preferredName) {
    const named = phases.find((phase) => phase?.name === preferredName && phase?.policy);
    if (named?.policy) {
      return named.policy;
    }
  }

  const preferredIndex = Number(model?.training?.primaryPhaseIndex);
  if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < phases.length) {
    if (phases[preferredIndex]?.policy) {
      return phases[preferredIndex].policy;
    }
  }

  const firstPolicyPhase = phases.find((phase) => phase?.policy);
  if (firstPolicyPhase?.policy) {
    return firstPolicyPhase.policy;
  }

  throw new Error('Composite policy does not contain a trainable phase');
}

function wrappedDelta(a, b, span) {
  let delta = a - b;
  if (delta > span * 0.5) {
    delta -= span;
  }
  if (delta < -span * 0.5) {
    delta += span;
  }
  return delta;
}

function wrappedDistanceSquared(ax, ay, bx, by) {
  const dx = wrappedDelta(ax, bx, ARENA_WIDTH);
  const dy = wrappedDelta(ay, by, ARENA_HEIGHT);
  return dx * dx + dy * dy;
}

function computeClosestShipMargin(state) {
  const ship = state?.ship;
  if (!ship || ship.destroyed) {
    return -1_000;
  }

  let closestMargin = Number.POSITIVE_INFINITY;
  const asteroids = Array.isArray(state?.asteroids) ? state.asteroids : [];
  for (const asteroid of asteroids) {
    if (!asteroid || asteroid._removed || asteroid.hitPoints <= 0) {
      continue;
    }

    const hitDistance = ship.radius + asteroid.radius * 0.88;
    const distance = Math.sqrt(wrappedDistanceSquared(ship.x, ship.y, asteroid.x, asteroid.y));
    closestMargin = Math.min(closestMargin, distance - hitDistance);
  }

  return Number.isFinite(closestMargin) ? closestMargin : Math.max(ARENA_WIDTH, ARENA_HEIGHT);
}

function cloneLookaheadShieldConfig(config) {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const enabled = Boolean(config.enabled);
  if (!enabled) {
    return null;
  }

  return {
    enabled: true,
    startTick: Math.max(0, Math.floor(Number(config.startTick ?? 0) || 0)),
    horizonTicks: Math.max(1, Math.min(240, Math.floor(Number(config.horizonTicks ?? 60) || 60))),
    commitTicks: Math.max(1, Math.min(60, Math.floor(Number(config.commitTicks ?? 8) || 8))),
    planSteps: Math.max(1, Math.min(4, Math.floor(Number(config.planSteps ?? 2) || 2))),
    beamWidth: Math.max(1, Math.min(32, Math.floor(Number(config.beamWidth ?? 8) || 8))),
    activationMargin: Number.isFinite(Number(config.activationMargin)) ? Number(config.activationMargin) : 28,
    safeMargin: Number.isFinite(Number(config.safeMargin)) ? Number(config.safeMargin) : 12,
    minImprovement: Number.isFinite(Number(config.minImprovement)) ? Number(config.minImprovement) : 4,
    maxCandidates: Math.max(1, Math.min(12, Math.floor(Number(config.maxCandidates ?? 6) || 6)))
  };
}

function resolveLookaheadShieldConfig(model, options = {}) {
  if (options?.lookaheadShield === false) {
    return null;
  }

  const optionConfig =
    options?.lookaheadShield && typeof options.lookaheadShield === 'object'
      ? options.lookaheadShield
      : null;
  const modelConfig = model?.config?.lookaheadShield;
  const merged = {
    ...(modelConfig && typeof modelConfig === 'object' ? modelConfig : {}),
    ...(optionConfig && typeof optionConfig === 'object' ? optionConfig : {})
  };
  const enabled =
    optionConfig?.enabled === true ||
    (optionConfig == null && modelConfig?.enabled === true);

  return cloneLookaheadShieldConfig({ ...merged, enabled });
}

function buildSingleSegment(model, name, options = {}) {
  const decisionTicksOverride =
    Number.isInteger(options?.decisionTicksOverride) && options.decisionTicksOverride > 0
      ? clampDecisionTicks(options.decisionTicksOverride)
      : null;
  const observationDim = toFiniteNumber(model?.config?.observationDim, OBSERVATION_DIM);
  const hiddenSize = toFiniteNumber(model?.config?.hiddenSize, 48);
  const thresholds = Array.isArray(model?.config?.thresholds) ? model.config.thresholds : DEFAULT_THRESHOLDS;
  const actionMode = model?.config?.actionMode ?? LEGACY_POLICY_ACTION_MODE;
  const runtime = createPolicyRuntime({
    observationDim,
    hiddenSize,
    thresholds,
    actionMode
  });
  const parameterCount = getPolicyParameterCount(observationDim, hiddenSize, actionMode);
  if (!Array.isArray(model?.parameters) || model.parameters.length !== parameterCount) {
    throw new Error(
      `${name} parameter mismatch (expected ${parameterCount}, got ${model?.parameters?.length ?? 'unknown'})`
    );
  }

  const decisionTicks = Number.isInteger(decisionTicksOverride)
    ? clampDecisionTicks(decisionTicksOverride)
    : scaleDecisionTicks(
        toFiniteNumber(model?.config?.decisionTicks, 1),
        toFiniteNumber(model?.config?.tickRate, LEGACY_REFERENCE_TICK_RATE)
      );

  return {
    kind: SINGLE_POLICY_KIND,
    name,
    startTick: 0,
    observation: new Float32Array(observationDim),
    runtime,
    parameters: Float64Array.from(model.parameters.map((value) => Number(value))),
    decisionTicks,
    allowBomb:
      typeof options?.allowBombOverride === 'boolean'
        ? options.allowBombOverride
        : Boolean(model?.config?.allowBomb ?? false),
    alwaysShoot:
      typeof options?.alwaysShootOverride === 'boolean'
        ? options.alwaysShootOverride
        : Boolean(model?.config?.alwaysShoot ?? true),
    actionMode,
    currentMask: 0
  };
}

function buildCompositeSegments(model, options = {}) {
  const phases = Array.isArray(model?.phases) ? model.phases : [];
  if (phases.length === 0) {
    throw new Error('Composite policy is missing phases');
  }

  const segments = phases
    .map((phase, index) => {
      if (!phase?.policy) {
        return null;
      }
      const segment = buildSingleSegment(phase.policy, phase?.name ?? `phase-${index + 1}`, options);
      segment.startTick = Math.max(0, Math.floor(toFiniteNumber(phase?.startTick, 0)));
      return segment;
    })
    .filter(Boolean)
    .sort((left, right) => left.startTick - right.startTick);

  if (segments.length === 0) {
    throw new Error('Composite policy does not contain runnable phases');
  }
  if (segments[0].startTick !== 0) {
    throw new Error('Composite policy must start at tick 0');
  }

  return segments;
}

function createRawPolicyControllerFromModel(model, options = {}) {
  const kind = detectPolicyModelKind(model);
  const segments =
    kind === PHASE_SWITCH_POLICY_KIND ? buildCompositeSegments(model, options) : [buildSingleSegment(model, 'single', options)];

  let activeSegmentIndex = -1;

  return {
    kind,
    actionMode: kind === PHASE_SWITCH_POLICY_KIND ? PHASE_SWITCH_POLICY_KIND : segments[0].actionMode,
    segments,
    reset() {
      activeSegmentIndex = -1;
      for (const segment of segments) {
        segment.currentMask = 0;
      }
    },
    nextMask(state) {
      const tick = Math.max(0, Math.floor(toFiniteNumber(state?.tick, 0)));
      let nextSegmentIndex = 0;
      for (let index = 1; index < segments.length; index += 1) {
        if (tick >= segments[index].startTick) {
          nextSegmentIndex = index;
        } else {
          break;
        }
      }

      const segment = segments[nextSegmentIndex];
      const switched = nextSegmentIndex !== activeSegmentIndex;
      if (switched) {
        activeSegmentIndex = nextSegmentIndex;
      }

      if (switched || tick % segment.decisionTicks === 0) {
        buildObservation(state, segment.observation);
        segment.currentMask = segment.runtime.actionMask(segment.observation, segment.parameters) & 0x1f;
        if (!segment.allowBomb) {
          segment.currentMask &= ~INPUT_BOMB;
        }
        if (segment.alwaysShoot) {
          segment.currentMask |= INPUT_SHOOT;
        }
      }

      return segment.currentMask;
    }
  };
}

function buildLookaheadCandidateMasks(proposedMask, controller, lookaheadConfig, includeProposed = true) {
  const preserveShoot =
    (proposedMask & INPUT_SHOOT) !== 0 || controller.segments.some((segment) => segment.alwaysShoot);
  const shootMask = preserveShoot ? INPUT_SHOOT : 0;
  const unique = new Set();
  const candidates = [];

  function push(mask) {
    const finalMask = (mask | shootMask) & ~INPUT_BOMB;
    if (unique.has(finalMask)) {
      return;
    }
    unique.add(finalMask);
    candidates.push(finalMask);
  }

  if (includeProposed) {
    push(proposedMask & ~INPUT_BOMB);
  }
  for (const mask of LOOKAHEAD_CANDIDATE_MASKS) {
    push(mask);
    if (candidates.length >= lookaheadConfig.maxCandidates) {
      break;
    }
  }
  return candidates;
}

function compareLookaheadPlans(left, right) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  if (left.destroyed !== right.destroyed) {
    return left.destroyed ? -1 : 1;
  }
  if (left.survivedTicks !== right.survivedTicks) {
    return left.survivedTicks - right.survivedTicks;
  }
  if (left.minMargin !== right.minMargin) {
    return left.minMargin - right.minMargin;
  }
  if (left.finalMargin !== right.finalMargin) {
    return left.finalMargin - right.finalMargin;
  }
  return left.score - right.score;
}

function evaluateLookaheadPlan(plannerController, state, sequenceMasks, lookaheadConfig) {
  const simState = cloneSimulationState(state);
  plannerController.reset();

  let minMargin = computeClosestShipMargin(simState);
  let marginIntegral = Math.max(-128, Math.min(128, minMargin));
  let survivedTicks = 0;
  let destroyed = false;
  const scriptedTicks = Math.min(
    lookaheadConfig.horizonTicks,
    Math.max(1, sequenceMasks.length) * lookaheadConfig.commitTicks
  );

  for (let horizonTick = 0; horizonTick < lookaheadConfig.horizonTicks; horizonTick += 1) {
    const actionMask =
      horizonTick < scriptedTicks
        ? sequenceMasks[Math.min(sequenceMasks.length - 1, Math.floor(horizonTick / lookaheadConfig.commitTicks))]
        : plannerController.nextMask(simState) & 0x1f;
    stepSimulation(simState, actionMask);
    survivedTicks = horizonTick + 1;

    const margin = computeClosestShipMargin(simState);
    minMargin = Math.min(minMargin, margin);
    marginIntegral += Math.max(-128, Math.min(128, margin));

    if (simState.finished && simState.endReason === 'ship-destroyed') {
      destroyed = true;
      break;
    }
  }

  const finalMargin = computeClosestShipMargin(simState);
  const score = destroyed
    ? -1_000_000 + survivedTicks * 500 + minMargin * 40
    : minMargin * 220 + finalMargin * 60 + marginIntegral + survivedTicks * 3;

  return {
    firstMask: sequenceMasks[0] ?? 0,
    sequenceMasks: sequenceMasks.slice(),
    destroyed,
    survivedTicks,
    minMargin,
    finalMargin,
    score
  };
}

function searchLookaheadPlan(plannerController, liveController, state, proposedMask, lookaheadConfig, anchorMask = null) {
  const primitiveMasks = buildLookaheadCandidateMasks(proposedMask, liveController, lookaheadConfig, anchorMask == null);
  const seeds = anchorMask == null ? primitiveMasks : [anchorMask & ~INPUT_BOMB];
  let beam = seeds.map((mask) => evaluateLookaheadPlan(plannerController, state, [mask], lookaheadConfig));
  beam.sort((left, right) => compareLookaheadPlans(right, left));
  beam = beam.slice(0, lookaheadConfig.beamWidth);

  if (lookaheadConfig.planSteps <= 1 || beam.length === 0) {
    return beam[0] ?? null;
  }

  for (let depth = 2; depth <= lookaheadConfig.planSteps; depth += 1) {
    const nextBeam = [];
    for (const partialPlan of beam) {
      for (const mask of primitiveMasks) {
        const extendedPlan = evaluateLookaheadPlan(
          plannerController,
          state,
          [...partialPlan.sequenceMasks, mask],
          lookaheadConfig
        );
        nextBeam.push(extendedPlan);
      }
    }
    nextBeam.sort((left, right) => compareLookaheadPlans(right, left));
    beam = nextBeam.slice(0, lookaheadConfig.beamWidth);
    if (beam.length === 0) {
      break;
    }
  }

  return beam[0] ?? null;
}

function createLookaheadShieldController(model, options = {}, baseController = null) {
  const lookaheadConfig = resolveLookaheadShieldConfig(model, options);
  if (!lookaheadConfig) {
    return baseController ?? createRawPolicyControllerFromModel(model, options);
  }

  const liveController = baseController ?? createRawPolicyControllerFromModel(model, options);
  const plannerController = createRawPolicyControllerFromModel(model, {
    ...options,
    lookaheadShield: false
  });
  let overrideMask = 0;
  let overrideUntilTick = -1;

  return {
    kind: liveController.kind,
    actionMode: liveController.actionMode,
    segments: liveController.segments,
    lookaheadShield: lookaheadConfig,
    reset() {
      overrideMask = 0;
      overrideUntilTick = -1;
      liveController.reset();
      plannerController.reset();
    },
    nextMask(state) {
      const proposedMask = liveController.nextMask(state) & 0x1f;
      const tick = Math.max(0, Math.floor(toFiniteNumber(state?.tick, 0)));
      if (tick < lookaheadConfig.startTick || state?.finished) {
        overrideUntilTick = -1;
        return proposedMask;
      }

      if (overrideUntilTick > tick) {
        return overrideMask;
      }

      const currentMargin = computeClosestShipMargin(state);
      if (currentMargin >= lookaheadConfig.activationMargin) {
        return proposedMask;
      }

      const proposedBaseMask = proposedMask & ~INPUT_BOMB;
      const best = searchLookaheadPlan(plannerController, liveController, state, proposedMask, lookaheadConfig, null);
      const proposed = searchLookaheadPlan(
        plannerController,
        liveController,
        state,
        proposedMask,
        lookaheadConfig,
        proposedBaseMask
      );

      if (!best || !proposed || best.firstMask === proposed.firstMask) {
        return proposedMask;
      }

      const shouldOverride =
        proposed.destroyed ||
        proposed.minMargin < lookaheadConfig.safeMargin ||
        best.minMargin - proposed.minMargin >= lookaheadConfig.minImprovement ||
        best.survivedTicks > proposed.survivedTicks;

      if (!shouldOverride) {
        return proposedMask;
      }

      overrideMask = best.firstMask & 0x1f;
      overrideUntilTick = tick + lookaheadConfig.commitTicks;
      return overrideMask;
    }
  };
}

export function createPolicyControllerFromModel(model, options = {}) {
  const baseController = createRawPolicyControllerFromModel(model, options);
  return createLookaheadShieldController(model, options, baseController);
}
