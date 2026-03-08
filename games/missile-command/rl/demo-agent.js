import { ACTION_TARGETS, NOOP_ACTION_INDEX, resolveActionTarget } from "../sim/action-map.js";
import { ENEMY_TYPES } from "../balance.js";
import { buildObservation, OBSERVATION_DIM } from "./observation.js";
import {
  DEFAULT_HIDDEN_SIZE,
  MACRO_POLICY_ACTION_MODE,
  createPolicyRuntime,
  getPolicyParameterCount,
} from "./policy.js";

const DEFAULT_POLICY_URL = "./public/rl/demo-policy.json";
export const DEFAULT_HEURISTIC_CONFIG = Object.freeze({
  fireThreshold: 0.1,
  interceptLead: 0.25,
  urgencyWindow: 5,
  baseBlastReach: 120,
  urgencyBlastBonus: 40,
  baseUrgencyWeight: 0.7,
  cityBonus: 0.18,
  fastWeight: 1.12,
  splitWeight: 1.25,
  armoredWeight: 1.4,
});
export const DEFAULT_BOTTOM_PRIORITY_CONFIG = Object.freeze({
  leadSeconds: 0.3,
  extraDownPixels: 0,
});
export const DEFAULT_EDGE_PREDICTION_CONFIG = Object.freeze({
  interceptorTravelTime: 0.25,
  explosionRadius: 82,
  growDuration: 0.13,
  holdDuration: 0.07,
  fadeDuration: 0.4,
  simulationStep: 1 / 120,
  preferredDetonationAge: 0.09,
  detonationAgeSpread: 0.075,
  forwardPixels: 16,
  primaryCoreRadiusScale: 0.96,
  collateralRadiusScale: 1.02,
  minimumPrimaryMargin: 3,
  primaryWeight: 20,
  collateralWeight: 1.1,
  forwardWeight: 1.35,
  timingWeight: 1.9,
  urgencyWindow: 5,
  splitUncertaintyPenalty: 0.42,
  cityBonus: 0.22,
  fastWeight: 1.1,
  splitWeight: 1.18,
  armoredWeight: 1.34,
  speedBlendMin: 150,
  speedBlendMax: 220,
  slowDetonationAgeBonus: 0.008,
  slowDetonationAgeSpreadPenalty: 0.014,
  slowForwardPixelsPenalty: 7,
  slowCoreScalePenalty: 0.08,
  slowCollateralWeightBonus: 0.42,
  slowCollateralRadiusBonus: 0.04,
  slowForwardWeightMultiplier: 0.7,
  slowTimingWeightBonus: 0.28,
  slowMinimumPrimaryMarginBonus: 3,
  slowClusterBonus: 0.22,
  visibleResponseDelayTicks: 2,
  reservationBuffer: 0.08,
  armoredReservationBuffer: 0.16,
});

function clampDecisionTicks(value) {
  if (!Number.isInteger(value)) {
    return 2;
  }
  return Math.max(1, Math.min(12, value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function findNearestActionIndex(x, y) {
  let bestIndex = NOOP_ACTION_INDEX;
  let bestDistance = Infinity;

  for (let index = 0; index < ACTION_TARGETS.length; index += 1) {
    const target = ACTION_TARGETS[index];
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }

  return bestIndex;
}

function clampAimTarget(snapshot, x, y) {
  const width = Math.max(320, Number(snapshot?.width ?? 1280));
  const groundY = Math.max(120, Number(snapshot?.groundY ?? 620));
  return {
    x: clamp(Number(x) || 0, 28, width - 28),
    y: clamp(Number(y) || 0, 36, groundY - 28),
  };
}

export function normalizeHeuristicConfig(config = {}) {
  return {
    fireThreshold: clamp(Number(config.fireThreshold ?? DEFAULT_HEURISTIC_CONFIG.fireThreshold), 0.02, 2.5),
    interceptLead: clamp(Number(config.interceptLead ?? DEFAULT_HEURISTIC_CONFIG.interceptLead), 0.05, 0.55),
    urgencyWindow: clamp(Number(config.urgencyWindow ?? DEFAULT_HEURISTIC_CONFIG.urgencyWindow), 1.5, 9),
    baseBlastReach: clamp(Number(config.baseBlastReach ?? DEFAULT_HEURISTIC_CONFIG.baseBlastReach), 60, 220),
    urgencyBlastBonus: clamp(
      Number(config.urgencyBlastBonus ?? DEFAULT_HEURISTIC_CONFIG.urgencyBlastBonus),
      0,
      140,
    ),
    baseUrgencyWeight: clamp(
      Number(config.baseUrgencyWeight ?? DEFAULT_HEURISTIC_CONFIG.baseUrgencyWeight),
      0.2,
      2.2,
    ),
    cityBonus: clamp(Number(config.cityBonus ?? DEFAULT_HEURISTIC_CONFIG.cityBonus), 0, 1.4),
    fastWeight: clamp(Number(config.fastWeight ?? DEFAULT_HEURISTIC_CONFIG.fastWeight), 0.7, 2.2),
    splitWeight: clamp(Number(config.splitWeight ?? DEFAULT_HEURISTIC_CONFIG.splitWeight), 0.7, 2.6),
    armoredWeight: clamp(Number(config.armoredWeight ?? DEFAULT_HEURISTIC_CONFIG.armoredWeight), 0.8, 3.2),
  };
}

export function normalizeBottomPriorityConfig(config = {}) {
  return {
    leadSeconds: clamp(Number(config.leadSeconds ?? DEFAULT_BOTTOM_PRIORITY_CONFIG.leadSeconds), 0, 1),
    extraDownPixels: clamp(
      Number(config.extraDownPixels ?? DEFAULT_BOTTOM_PRIORITY_CONFIG.extraDownPixels),
      -120,
      160,
    ),
  };
}

export function normalizeEdgePredictionConfig(config = {}) {
  return {
    interceptorTravelTime: clamp(
      Number(config.interceptorTravelTime ?? DEFAULT_EDGE_PREDICTION_CONFIG.interceptorTravelTime),
      0.05,
      0.6,
    ),
    explosionRadius: clamp(Number(config.explosionRadius ?? DEFAULT_EDGE_PREDICTION_CONFIG.explosionRadius), 30, 160),
    growDuration: clamp(Number(config.growDuration ?? DEFAULT_EDGE_PREDICTION_CONFIG.growDuration), 0.04, 0.3),
    holdDuration: clamp(Number(config.holdDuration ?? DEFAULT_EDGE_PREDICTION_CONFIG.holdDuration), 0, 0.3),
    fadeDuration: clamp(Number(config.fadeDuration ?? DEFAULT_EDGE_PREDICTION_CONFIG.fadeDuration), 0.08, 0.7),
    simulationStep: clamp(Number(config.simulationStep ?? DEFAULT_EDGE_PREDICTION_CONFIG.simulationStep), 1 / 240, 0.05),
    preferredDetonationAge: clamp(
      Number(config.preferredDetonationAge ?? DEFAULT_EDGE_PREDICTION_CONFIG.preferredDetonationAge),
      0.04,
      0.28,
    ),
    detonationAgeSpread: clamp(
      Number(config.detonationAgeSpread ?? DEFAULT_EDGE_PREDICTION_CONFIG.detonationAgeSpread),
      0.03,
      0.22,
    ),
    forwardPixels: clamp(Number(config.forwardPixels ?? DEFAULT_EDGE_PREDICTION_CONFIG.forwardPixels), 0, 40),
    primaryCoreRadiusScale: clamp(
      Number(config.primaryCoreRadiusScale ?? DEFAULT_EDGE_PREDICTION_CONFIG.primaryCoreRadiusScale),
      0.55,
      1.05,
    ),
    collateralRadiusScale: clamp(
      Number(config.collateralRadiusScale ?? DEFAULT_EDGE_PREDICTION_CONFIG.collateralRadiusScale),
      0.65,
      1.15,
    ),
    minimumPrimaryMargin: clamp(
      Number(config.minimumPrimaryMargin ?? DEFAULT_EDGE_PREDICTION_CONFIG.minimumPrimaryMargin),
      0,
      28,
    ),
    primaryWeight: clamp(Number(config.primaryWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.primaryWeight), 4, 32),
    collateralWeight: clamp(
      Number(config.collateralWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.collateralWeight),
      0.3,
      8,
    ),
    forwardWeight: clamp(Number(config.forwardWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.forwardWeight), 0, 10),
    timingWeight: clamp(Number(config.timingWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.timingWeight), 0, 10),
    urgencyWindow: clamp(Number(config.urgencyWindow ?? DEFAULT_EDGE_PREDICTION_CONFIG.urgencyWindow), 1.5, 8),
    splitUncertaintyPenalty: clamp(
      Number(config.splitUncertaintyPenalty ?? DEFAULT_EDGE_PREDICTION_CONFIG.splitUncertaintyPenalty),
      0.1,
      1,
    ),
    cityBonus: clamp(Number(config.cityBonus ?? DEFAULT_EDGE_PREDICTION_CONFIG.cityBonus), 0, 1.4),
    fastWeight: clamp(Number(config.fastWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.fastWeight), 0.7, 2.2),
    splitWeight: clamp(Number(config.splitWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.splitWeight), 0.7, 2.6),
    armoredWeight: clamp(Number(config.armoredWeight ?? DEFAULT_EDGE_PREDICTION_CONFIG.armoredWeight), 0.8, 3.2),
    speedBlendMin: clamp(Number(config.speedBlendMin ?? DEFAULT_EDGE_PREDICTION_CONFIG.speedBlendMin), 80, 260),
    speedBlendMax: clamp(Number(config.speedBlendMax ?? DEFAULT_EDGE_PREDICTION_CONFIG.speedBlendMax), 120, 340),
    slowDetonationAgeBonus: clamp(
      Number(config.slowDetonationAgeBonus ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowDetonationAgeBonus),
      0,
      0.08,
    ),
    slowDetonationAgeSpreadPenalty: clamp(
      Number(
        config.slowDetonationAgeSpreadPenalty ??
          DEFAULT_EDGE_PREDICTION_CONFIG.slowDetonationAgeSpreadPenalty,
      ),
      0,
      0.08,
    ),
    slowForwardPixelsPenalty: clamp(
      Number(config.slowForwardPixelsPenalty ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowForwardPixelsPenalty),
      0,
      24,
    ),
    slowCoreScalePenalty: clamp(
      Number(config.slowCoreScalePenalty ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowCoreScalePenalty),
      0,
      0.35,
    ),
    slowCollateralWeightBonus: clamp(
      Number(config.slowCollateralWeightBonus ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowCollateralWeightBonus),
      0,
      3,
    ),
    slowCollateralRadiusBonus: clamp(
      Number(config.slowCollateralRadiusBonus ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowCollateralRadiusBonus),
      0,
      0.18,
    ),
    slowForwardWeightMultiplier: clamp(
      Number(
        config.slowForwardWeightMultiplier ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowForwardWeightMultiplier,
      ),
      0,
      1,
    ),
    slowTimingWeightBonus: clamp(
      Number(config.slowTimingWeightBonus ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowTimingWeightBonus),
      0,
      3,
    ),
    slowMinimumPrimaryMarginBonus: clamp(
      Number(
        config.slowMinimumPrimaryMarginBonus ??
          DEFAULT_EDGE_PREDICTION_CONFIG.slowMinimumPrimaryMarginBonus,
      ),
      0,
      16,
    ),
    slowClusterBonus: clamp(
      Number(config.slowClusterBonus ?? DEFAULT_EDGE_PREDICTION_CONFIG.slowClusterBonus),
      0,
      8,
    ),
    visibleResponseDelayTicks: clamp(
      Math.round(Number(config.visibleResponseDelayTicks ?? DEFAULT_EDGE_PREDICTION_CONFIG.visibleResponseDelayTicks)),
      0,
      12,
    ),
    reservationBuffer: clamp(
      Number(config.reservationBuffer ?? DEFAULT_EDGE_PREDICTION_CONFIG.reservationBuffer),
      0.02,
      0.6,
    ),
    armoredReservationBuffer: clamp(
      Number(config.armoredReservationBuffer ?? DEFAULT_EDGE_PREDICTION_CONFIG.armoredReservationBuffer),
      0.04,
      0.8,
    ),
  };
}

function getExplosionRadiusAt(deltaSeconds, config) {
  if (deltaSeconds < 0) {
    return 0;
  }

  if (deltaSeconds <= config.growDuration) {
    const ratio = deltaSeconds / config.growDuration;
    return config.explosionRadius * (1 - Math.pow(1 - ratio, 2));
  }

  if (deltaSeconds <= config.growDuration + config.holdDuration) {
    return config.explosionRadius;
  }

  if (deltaSeconds <= config.growDuration + config.holdDuration + config.fadeDuration) {
    const ratio =
      (deltaSeconds - config.growDuration - config.holdDuration) / config.fadeDuration;
    return config.explosionRadius + config.explosionRadius * 0.16 * ratio;
  }

  return 0;
}

function computeCoverage(distance, reach) {
  const safeReach = Math.max(1, reach);
  return clamp((safeReach - distance) / safeReach, 0, 1);
}

function findCity(snapshot, cityId) {
  return snapshot.cities?.find((city) => city.id === cityId) ?? null;
}

function computeSplitEta(missile) {
  if (missile?.type !== "split") {
    return Number.POSITIVE_INFINITY;
  }

  const progress = clamp(Number(missile?.progress ?? 0), 0, 0.9999);
  const splitProgress = clamp(Number(missile?.splitProgress ?? 1), 0, 1);
  if (splitProgress <= progress + 0.0001) {
    return 0;
  }

  const eta = Math.max(0, Number(missile?.eta ?? 0));
  const remainingProgress = Math.max(0.0001, 1 - progress);
  return clamp(((splitProgress - progress) / remainingProgress) * eta, 0, eta);
}

function predictMissileAtTime(missile, absoluteTime) {
  const velocityX = Number(missile?.velocityX ?? 0);
  const velocityY = Number(missile?.velocityY ?? 0);
  const speed = Math.max(1, Math.hypot(velocityX, velocityY) || Number(missile?.speed ?? 1));
  const dirX = velocityX / speed;
  const dirY = velocityY / speed;
  const eta = Math.max(0, Number(missile?.eta ?? 0));
  const radius = Number(missile?.radius ?? ENEMY_TYPES[missile?.type]?.radius ?? 7);
  let effectiveTime = clamp(Number(absoluteTime) || 0, 0, eta);
  const active = Number(absoluteTime) <= eta + 0.0001;
  let uncertain = false;

  if (missile?.type === "split") {
    const splitEta = computeSplitEta(missile);
    if (absoluteTime > splitEta + 0.0001) {
      effectiveTime = splitEta;
      uncertain = true;
    }
  }

  return {
    x: Number(missile?.x ?? 0) + velocityX * effectiveTime,
    y: Number(missile?.y ?? 0) + velocityY * effectiveTime,
    dirX,
    dirY,
    radius,
    speed,
    etaRemaining: Math.max(0, eta - effectiveTime),
    active,
    uncertain,
  };
}

function getAdaptiveInterceptProfile(missile, config) {
  const speed = Math.max(1, Number(missile?.speed ?? 0));
  const blendRange = Math.max(1, config.speedBlendMax - config.speedBlendMin);
  const fastRatio = clamp((speed - config.speedBlendMin) / blendRange, 0, 1);
  const slowRatio = 1 - fastRatio;

  return {
    preferredDetonationAge: config.preferredDetonationAge + slowRatio * config.slowDetonationAgeBonus,
    detonationAgeSpread: Math.max(
      0.03,
      config.detonationAgeSpread - slowRatio * config.slowDetonationAgeSpreadPenalty,
    ),
    forwardPixels: Math.max(0, config.forwardPixels - slowRatio * config.slowForwardPixelsPenalty),
    primaryCoreRadiusScale: Math.max(
      0.55,
      config.primaryCoreRadiusScale - slowRatio * config.slowCoreScalePenalty,
    ),
    collateralWeight: config.collateralWeight + slowRatio * config.slowCollateralWeightBonus,
    collateralRadiusScale: Math.min(
      1.15,
      config.collateralRadiusScale + slowRatio * config.slowCollateralRadiusBonus,
    ),
    forwardWeight:
      config.forwardWeight * (fastRatio + slowRatio * config.slowForwardWeightMultiplier),
    timingWeight: config.timingWeight + slowRatio * config.slowTimingWeightBonus,
    minimumPrimaryMargin: config.minimumPrimaryMargin + slowRatio * config.slowMinimumPrimaryMarginBonus,
    clusterBonus: slowRatio * config.slowClusterBonus,
    slowRatio,
  };
}

function buildContinuousAimCandidates(primaryMissile, snapshot, absoluteTime, radius, config, profile) {
  const primaryPrediction = predictMissileAtTime(primaryMissile, absoluteTime);
  if (!primaryPrediction.active || primaryPrediction.uncertain) {
    return [];
  }

  const forwardTarget = clampAimTarget(
    snapshot,
    primaryPrediction.x + primaryPrediction.dirX * profile.forwardPixels,
    primaryPrediction.y + primaryPrediction.dirY * profile.forwardPixels,
  );
  const centerTarget = clampAimTarget(snapshot, primaryPrediction.x, primaryPrediction.y);
  const candidates = [forwardTarget];
  const midTarget = clampAimTarget(
    snapshot,
    primaryPrediction.x + primaryPrediction.dirX * profile.forwardPixels * 0.45,
    primaryPrediction.y + primaryPrediction.dirY * profile.forwardPixels * 0.45,
  );

  if (
    Math.hypot(midTarget.x - forwardTarget.x, midTarget.y - forwardTarget.y) > 2 &&
    Math.hypot(midTarget.x - centerTarget.x, midTarget.y - centerTarget.y) > 2
  ) {
    candidates.push(midTarget);
  }

  if (Math.hypot(centerTarget.x - forwardTarget.x, centerTarget.y - forwardTarget.y) > 2) {
    candidates.push(centerTarget);
  }

  let sumX = primaryPrediction.x * 0.85;
  let sumY = primaryPrediction.y * 0.85;
  let totalWeight = 0.85;
  const clusterReach = radius * (1.08 + profile.slowRatio * 0.32);

  for (const missile of snapshot.enemyMissiles ?? []) {
    if (missile.id === primaryMissile.id) {
      continue;
    }

    const prediction = predictMissileAtTime(missile, absoluteTime);
    if (!prediction.active) {
      continue;
    }

    const distanceToPrimary = Math.hypot(prediction.x - primaryPrediction.x, prediction.y - primaryPrediction.y);
    if (distanceToPrimary > clusterReach + prediction.radius) {
      continue;
    }

    const urgency = 1 - clamp(prediction.etaRemaining / config.urgencyWindow, 0, 1);
    const uncertaintyPenalty = prediction.uncertain ? config.splitUncertaintyPenalty : 1;
    const missileWeight = (0.35 + urgency) * getTypeWeight(missile.type, config) * uncertaintyPenalty;
    sumX += prediction.x * missileWeight;
    sumY += prediction.y * missileWeight;
    totalWeight += missileWeight;
  }

  if (totalWeight > 1.02) {
    const clusterCenterX = sumX / totalWeight;
    const clusterCenterY = sumY / totalWeight;
    const clusterBlend = clamp(0.1 + profile.slowRatio * 0.22, 0.08, 0.34);
    const clusterTarget = clampAimTarget(
      snapshot,
      forwardTarget.x + (clusterCenterX - forwardTarget.x) * clusterBlend,
      forwardTarget.y + (clusterCenterY - forwardTarget.y) * clusterBlend,
    );
    if (
      candidates.every(
        (candidate) => Math.hypot(candidate.x - clusterTarget.x, candidate.y - clusterTarget.y) > 2,
      )
    ) {
      candidates.push(clusterTarget);
    }
  }

  return candidates;
}

function scoreInterceptWindow(primaryMissile, snapshot, target, delta, config, profile) {
  const absoluteTime = config.interceptorTravelTime + delta;
  const radius = getExplosionRadiusAt(delta, config);
  if (radius <= 0.001) {
    return null;
  }

  const primaryPrediction = predictMissileAtTime(primaryMissile, absoluteTime);
  if (!primaryPrediction.active || primaryPrediction.uncertain) {
    return null;
  }

  const primaryDistance = Math.hypot(primaryPrediction.x - target.x, primaryPrediction.y - target.y);
  const primaryMargin = radius + primaryPrediction.radius - primaryDistance;
  if (primaryMargin < profile.minimumPrimaryMargin) {
    return null;
  }

  const primaryCoreReach = radius * profile.primaryCoreRadiusScale + primaryPrediction.radius;
  const primaryCoverage = computeCoverage(primaryDistance, primaryCoreReach);
  if (primaryCoverage <= 0) {
    return null;
  }

  const desiredCenterX = primaryPrediction.x + primaryPrediction.dirX * profile.forwardPixels;
  const desiredCenterY = primaryPrediction.y + primaryPrediction.dirY * profile.forwardPixels;
  const forwardDistance = Math.hypot(desiredCenterX - target.x, desiredCenterY - target.y);
  const forwardReach = Math.max(30, radius + profile.forwardPixels + primaryPrediction.radius);
  const forwardScore = 1 - clamp(forwardDistance / forwardReach, 0, 1);
  const timingScore =
    1 -
    clamp(
      Math.abs(delta - profile.preferredDetonationAge) / Math.max(0.0001, profile.detonationAgeSpread),
      0,
      1,
    );

  let collateralScore = 0;
  let collateralHits = 0;
  for (const missile of snapshot.enemyMissiles ?? []) {
    if (missile.id === primaryMissile.id) {
      continue;
    }

    const prediction = predictMissileAtTime(missile, absoluteTime);
    if (!prediction.active) {
      continue;
    }

    const distance = Math.hypot(prediction.x - target.x, prediction.y - target.y);
    if (distance > radius + prediction.radius) {
      continue;
    }

    collateralHits += 1;
    const collateralReach = radius * profile.collateralRadiusScale + prediction.radius;
    const coverage = computeCoverage(distance, collateralReach);
    const urgency = 1 - clamp(prediction.etaRemaining / config.urgencyWindow, 0, 1);
    const city = findCity(snapshot, missile.targetCityId);
    const uncertaintyPenalty = prediction.uncertain ? config.splitUncertaintyPenalty : 1;
    collateralScore +=
      ((0.35 + coverage) * (0.55 + urgency) * getTypeWeight(missile.type, config) +
        (city?.alive ? config.cityBonus : 0)) *
      uncertaintyPenalty;
  }

  const city = findCity(snapshot, primaryMissile.targetCityId);
  const primaryScore =
    primaryCoverage * config.primaryWeight * getTypeWeight(primaryMissile.type, config) +
    Math.max(0, primaryMargin / Math.max(8, radius)) * 2.2 +
    (city?.alive ? config.cityBonus * 2.2 : 0);
  const clusterScore = Math.max(0, collateralHits - 1) * profile.clusterBonus;

  return {
    score:
      primaryScore +
      collateralScore * profile.collateralWeight +
      clusterScore +
      forwardScore * profile.forwardWeight +
      timingScore * profile.timingWeight,
    absoluteTime,
    primaryMargin,
  };
}

function findForwardInterceptTarget(missile, snapshot, config) {
  const searchWindow = config.growDuration + config.holdDuration + Math.min(0.08, config.fadeDuration * 0.2);
  const maxLeadTime = Math.max(0, Number(missile?.eta ?? 0) + 0.02);
  const profile = getAdaptiveInterceptProfile(missile, config);
  let bestCandidate = null;

  for (let delta = 0; delta <= searchWindow + 0.0001; delta += config.simulationStep) {
    const absoluteTime = config.interceptorTravelTime + delta;
    if (absoluteTime > maxLeadTime) {
      break;
    }

    const radius = getExplosionRadiusAt(delta, config);
    const targets = buildContinuousAimCandidates(missile, snapshot, absoluteTime, radius, config, profile);
    for (const target of targets) {
      const candidate = scoreInterceptWindow(missile, snapshot, target, delta, config, profile);
      if (!candidate) {
        continue;
      }

      const rankedCandidate = {
        x: target.x,
        y: target.y,
        score: candidate.score,
        absoluteTime: candidate.absoluteTime,
        releaseDelay:
          candidate.absoluteTime +
          (missile.type === "armored" ? config.armoredReservationBuffer : config.reservationBuffer),
      };

      if (
        !bestCandidate ||
        rankedCandidate.score > bestCandidate.score + 0.001 ||
        (Math.abs(rankedCandidate.score - bestCandidate.score) <= 0.001 &&
          rankedCandidate.absoluteTime < bestCandidate.absoluteTime)
      ) {
        bestCandidate = rankedCandidate;
      }
    }
  }

  return bestCandidate;
}

function getTypeWeight(type, config) {
  switch (type) {
    case "armored":
      return config.armoredWeight;
    case "split":
      return config.splitWeight;
    case "fast":
      return config.fastWeight;
    default:
      return 1;
  }
}

function scoreTarget(snapshot, target, config) {
  let score = 0;
  const interceptLead = config.interceptLead;

  for (const missile of snapshot.enemyMissiles ?? []) {
    const predictedX = missile.x + (missile.velocityX ?? 0) * interceptLead;
    const predictedY = missile.y + (missile.velocityY ?? 0) * interceptLead;
    const distance = Math.hypot(predictedX - target.x, predictedY - target.y);
    const eta = missile.eta ?? 6;
    const urgency = 1 - Math.max(0, Math.min(1, eta / config.urgencyWindow));
    const blastReach = config.baseBlastReach + urgency * config.urgencyBlastBonus;
    if (distance > blastReach) {
      continue;
    }

    const city = snapshot.cities?.find((item) => item.id === missile.targetCityId) ?? null;
    const cityBonus = city?.alive ? config.cityBonus : 0;
    score +=
      getTypeWeight(missile.type, config) *
      (1 - distance / blastReach) *
      (config.baseUrgencyWeight + urgency) +
      cityBonus;
  }

  return score;
}

function hasShotCooldown(snapshot) {
  return Number(snapshot?.shotCooldownSeconds ?? 0) > 0.001;
}

function hasSatisfiedVisibleDelay(missile, config) {
  return Number(missile?.visibleTicks ?? -1) >= Number(config?.visibleResponseDelayTicks ?? 0);
}

class PolicyDemoAgent {
  constructor({ runtime, parameters, decisionTicks = 2, policyName = "Demo Policy" }) {
    this.runtime = runtime;
    this.parameters = parameters;
    this.decisionTicks = clampDecisionTicks(decisionTicks);
    this.policyName = policyName;
    this.observation = new Float32Array(OBSERVATION_DIM);
    this.tickCounter = 0;
  }

  reset() {
    this.tickCounter = 0;
  }

  nextAction(snapshot) {
    let actionIndex = NOOP_ACTION_INDEX;

    if (hasShotCooldown(snapshot)) {
      this.tickCounter += 1;
      return NOOP_ACTION_INDEX;
    }

    if (this.tickCounter % this.decisionTicks === 0) {
      buildObservation(snapshot, this.observation);
      actionIndex = this.runtime.selectAction(this.observation, this.parameters);
    }

    this.tickCounter += 1;
    return actionIndex;
  }
}

class HeuristicDemoAgent {
  constructor(config = {}) {
    this.config = normalizeHeuristicConfig(config);
    this.policyName = config?.policyName ?? "Heuristic Guard";
  }

  reset() {}

  nextAction(snapshot) {
    if (hasShotCooldown(snapshot)) {
      return NOOP_ACTION_INDEX;
    }

    let bestScore = this.config.fireThreshold;
    let bestIndex = NOOP_ACTION_INDEX;

    for (let index = 0; index < ACTION_TARGETS.length; index += 1) {
      const score = scoreTarget(snapshot, ACTION_TARGETS[index], this.config);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index + 1;
      }
    }

    return bestIndex;
  }
}

export function createHeuristicDemoAgent(config = {}) {
  return new HeuristicDemoAgent(config);
}

class BottomPriorityDemoAgent {
  constructor(config = {}) {
    this.config = normalizeBottomPriorityConfig(config);
    this.policyName = config?.policyName ?? "Bottom Priority Guard";
  }

  reset() {}

  nextAction(snapshot) {
    if (hasShotCooldown(snapshot)) {
      return NOOP_ACTION_INDEX;
    }

    const missiles = snapshot.enemyMissiles ?? [];
    if (!missiles.length) {
      return NOOP_ACTION_INDEX;
    }

    const targetMissile = missiles
      .slice()
      .sort((left, right) => {
        if (Math.abs(right.y - left.y) > 0.001) {
          return right.y - left.y;
        }

        return (left.eta ?? Number.POSITIVE_INFINITY) - (right.eta ?? Number.POSITIVE_INFINITY);
      })[0];

    const aimX = clamp(
      targetMissile.x + (targetMissile.velocityX ?? 0) * this.config.leadSeconds,
      50,
      (snapshot.width ?? 1280) - 50,
    );
    const aimY = clamp(
      targetMissile.y +
        (targetMissile.velocityY ?? 0) * this.config.leadSeconds +
        this.config.extraDownPixels,
      60,
      (snapshot.groundY ?? 640) - 40,
    );

    return findNearestActionIndex(aimX, aimY);
  }
}

export function createBottomPriorityDemoAgent(config = {}) {
  return new BottomPriorityDemoAgent(config);
}

class EdgePredictionDemoAgent {
  constructor(config = {}) {
    this.config = normalizeEdgePredictionConfig(config);
    this.policyName = config?.policyName ?? "Forward Prediction Guard";
    this.reservations = new Map();
  }

  reset() {
    this.reservations.clear();
  }

  pruneReservations(snapshot) {
    const now = 60 - Number(snapshot?.timeLeft ?? 60);
    const activeMissileIds = new Set((snapshot.enemyMissiles ?? []).map((missile) => missile.id));

    for (const [missileId, reservation] of this.reservations) {
      if (!activeMissileIds.has(missileId) || reservation.releaseAt <= now) {
        this.reservations.delete(missileId);
      }
    }

    return now;
  }

  nextAction(snapshot) {
    if (hasShotCooldown(snapshot)) {
      return NOOP_ACTION_INDEX;
    }

    const missiles = snapshot.enemyMissiles ?? [];
    if (!missiles.length) {
      return NOOP_ACTION_INDEX;
    }

    const now = this.pruneReservations(snapshot);
    const candidates = missiles
      .filter(
        (missile) => !this.reservations.has(missile.id) && hasSatisfiedVisibleDelay(missile, this.config),
      )
      .sort((left, right) => {
        if (Math.abs(right.y - left.y) > 0.001) {
          return right.y - left.y;
        }

        return (left.eta ?? Number.POSITIVE_INFINITY) - (right.eta ?? Number.POSITIVE_INFINITY);
      });

    const primaryMissile = candidates[0] ?? null;
    if (!primaryMissile) {
      return NOOP_ACTION_INDEX;
    }

    const intercept = findForwardInterceptTarget(primaryMissile, snapshot, this.config);
    if (!intercept) {
      return NOOP_ACTION_INDEX;
    }

    this.reservations.set(primaryMissile.id, {
      releaseAt: now + intercept.releaseDelay,
    });
    return {
      x: intercept.x,
      y: intercept.y,
    };
  }
}

export function createEdgePredictionDemoAgent(config = {}) {
  return new EdgePredictionDemoAgent(config);
}

export function createPresetDemoAgent(preset = "") {
  switch (String(preset).trim()) {
    case "heuristic":
      return {
        policy: {
          meta: {
            name: "Default Heuristic Guard",
            trainer: "builtin-demo",
          },
          config: {
            type: "builtin-demo",
            preset: "heuristic",
            decisionTicks: 1,
          },
        },
        agent: createHeuristicDemoAgent({
          ...DEFAULT_HEURISTIC_CONFIG,
          policyName: "Default Heuristic Guard",
        }),
        source: "heuristic",
      };
    case "bottom-priority":
      return {
        policy: {
          meta: {
            name: "Bottom Priority Guard",
            trainer: "builtin-demo",
          },
          config: {
            type: "builtin-demo",
            preset: "bottom-priority",
            decisionTicks: 1,
          },
        },
        agent: createBottomPriorityDemoAgent({
          ...DEFAULT_BOTTOM_PRIORITY_CONFIG,
          policyName: "Bottom Priority Guard",
        }),
        source: "bottom-priority",
      };
    case "edge-prediction":
      return {
        policy: {
          meta: {
            name: "Forward Prediction Guard",
            trainer: "builtin-demo",
          },
          config: {
            type: "builtin-demo",
            preset: "edge-prediction",
            decisionTicks: 1,
          },
        },
        agent: createEdgePredictionDemoAgent({
          ...DEFAULT_EDGE_PREDICTION_CONFIG,
          policyName: "Forward Prediction Guard",
        }),
        source: "edge-prediction",
      };
    default:
      return null;
  }
}

export async function loadDemoAgent(policyUrl = DEFAULT_POLICY_URL) {
  try {
    const response = await fetch(policyUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Demo policy request failed (${response.status})`);
    }

    const policy = await response.json();
    if (policy?.config?.type === "heuristic-weights" || policy?.meta?.trainer === "heuristic-cem") {
      return {
        policy,
        agent: createHeuristicDemoAgent({
          ...(policy?.heuristic?.params ?? {}),
          policyName: policy?.meta?.name ?? "Heuristic Guard",
        }),
        source: "heuristic-policy",
      };
    }

    const observationDim = Number(policy?.config?.observationDim ?? OBSERVATION_DIM);
    const hiddenSize = Number(policy?.config?.hiddenSize ?? DEFAULT_HIDDEN_SIZE);
    const actionMode = policy?.config?.actionMode ?? MACRO_POLICY_ACTION_MODE;
    const decisionTicks = clampDecisionTicks(Number(policy?.config?.decisionTicks ?? 2));

    if (observationDim !== OBSERVATION_DIM) {
      throw new Error(`Observation mismatch: expected ${OBSERVATION_DIM}, got ${observationDim}`);
    }

    const runtime = createPolicyRuntime({
      observationDim,
      hiddenSize,
      actionMode,
    });
    const expected = getPolicyParameterCount(observationDim, hiddenSize, actionMode);
    if (!Array.isArray(policy?.parameters) || policy.parameters.length !== expected) {
      throw new Error(`Policy parameter mismatch: expected ${expected}`);
    }

    return {
      policy,
      agent: new PolicyDemoAgent({
        runtime,
        parameters: Float64Array.from(policy.parameters.map((value) => Number(value))),
        decisionTicks,
        policyName: policy?.meta?.name ?? "Demo Policy",
      }),
      source: "policy",
    };
  } catch (error) {
    return {
      policy: null,
      agent: createHeuristicDemoAgent(),
      source: "heuristic",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveAgentActionTarget(action) {
  if (action && typeof action === "object" && Number.isFinite(action.x) && Number.isFinite(action.y)) {
    return {
      x: Number(action.x),
      y: Number(action.y),
    };
  }

  return resolveActionTarget(action);
}

export function actionIndexToTarget(actionIndex) {
  return resolveAgentActionTarget(actionIndex);
}
