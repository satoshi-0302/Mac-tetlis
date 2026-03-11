import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ASTEROID_TYPES,
  COMBO_WINDOW_TICKS,
  MAX_TICKS,
  SHIP_INVULN_TICKS,
  SHIP_MAX_SPEED,
  SHOT_COOLDOWN_TICKS
} from '../engine/constants.js';

export const MAX_OBS_ASTEROIDS = 12;
export const ASTEROID_FEATURES = 8;
export const SHIP_FEATURES = 8;
export const LEGACY_GLOBAL_FEATURES = 6;
export const EXTRA_GLOBAL_FEATURES = 10;
export const GLOBAL_FEATURES = LEGACY_GLOBAL_FEATURES + EXTRA_GLOBAL_FEATURES;
export const OBS_TIME_REMAINING_INDEX = 6;
export const LEGACY_OBSERVATION_DIM =
  SHIP_FEATURES + MAX_OBS_ASTEROIDS * ASTEROID_FEATURES + LEGACY_GLOBAL_FEATURES;
export const OBSERVATION_DIM = LEGACY_OBSERVATION_DIM + EXTRA_GLOBAL_FEATURES;

const MAX_ASTEROID_RADIUS = Object.values(ASTEROID_TYPES).reduce(
  (maxRadius, asteroidType) => Math.max(maxRadius, asteroidType.radius),
  0
);

const POS_SCALE = Math.hypot(ARENA_WIDTH, ARENA_HEIGHT) * 0.5;
const VEL_SCALE = 320;
const HP_SCALE = ASTEROID_TYPES.tier5.hitPoints;
const MAX_ASTEROID_COUNT_NORM = 120;
const THREAT_LOOKAHEAD_SECONDS = 1.6;
const THREAT_RADIUS_MARGIN = 1.32;
const THREAT_EXTRA_MARGIN = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrappedDelta(target, origin, span) {
  let delta = target - origin;
  if (delta > span * 0.5) {
    delta -= span;
  } else if (delta < -span * 0.5) {
    delta += span;
  }
  return delta;
}

function worldToLocal(x, y, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    forward: x * cos + y * sin,
    lateral: -x * sin + y * cos
  };
}

function asteroidTierToNorm(sizeClass) {
  return clamp((sizeClass - 1) / 4, 0, 1);
}

function writeFeature(out, cursor, value) {
  if (cursor < out.length) {
    out[cursor] = value;
  }
  return cursor + 1;
}

export function buildObservation(state, out = new Float32Array(OBSERVATION_DIM)) {
  out.fill(0);

  const ship = state.ship;
  let cursor = 0;

  const shipVelLocal = worldToLocal(ship.vx, ship.vy, ship.angle);
  cursor = writeFeature(out, cursor, Math.sin(ship.angle));
  cursor = writeFeature(out, cursor, Math.cos(ship.angle));
  cursor = writeFeature(out, cursor, clamp(shipVelLocal.forward / SHIP_MAX_SPEED, -1, 1));
  cursor = writeFeature(out, cursor, clamp(shipVelLocal.lateral / SHIP_MAX_SPEED, -1, 1));
  cursor = writeFeature(out, cursor, clamp(ship.cooldownTicks / SHOT_COOLDOWN_TICKS, 0, 1));
  cursor = writeFeature(out, cursor, clamp(ship.invulnTicks / SHIP_INVULN_TICKS, 0, 1));
  cursor = writeFeature(out, cursor, clamp((MAX_TICKS - state.tick) / MAX_TICKS, 0, 1));
  cursor = writeFeature(out, cursor, clamp(state.comboTimer / COMBO_WINDOW_TICKS, 0, 1));

  const nearestAsteroids = [];
  const tierCounts = [0, 0, 0, 0, 0];
  const sectorThreat = [0, 0, 0, 0];
  let closestTimeToThreat = THREAT_LOOKAHEAD_SECONDS;
  let closestThreatPressure = 0;
  let closingThreatCount = 0;
  let largeAsteroidCount = 0;
  let tier3PlusCount = 0;

  for (const asteroid of state.asteroids) {
    if (asteroid.hitPoints <= 0 || asteroid._removed) {
      continue;
    }

    if (asteroid.sizeClass >= 1 && asteroid.sizeClass <= 5) {
      tierCounts[asteroid.sizeClass - 1] += 1;
    }
    if (asteroid.sizeClass >= 4) {
      largeAsteroidCount += 1;
    }
    if (asteroid.sizeClass >= 3) {
      tier3PlusCount += 1;
    }

    const dx = wrappedDelta(asteroid.x, ship.x, ARENA_WIDTH);
    const dy = wrappedDelta(asteroid.y, ship.y, ARENA_HEIGHT);
    const distSq = dx * dx + dy * dy;
    const localPos = worldToLocal(dx, dy, ship.angle);
    const relVx = asteroid.vx - ship.vx;
    const relVy = asteroid.vy - ship.vy;
    const relativeSpeedSq = relVx * relVx + relVy * relVy;
    const lookaheadSeconds =
      relativeSpeedSq <= 1e-6
        ? 0
        : clamp(
            -((dx * relVx + dy * relVy) / relativeSpeedSq),
            0,
            THREAT_LOOKAHEAD_SECONDS
          );
    const closestDx = dx + relVx * lookaheadSeconds;
    const closestDy = dy + relVy * lookaheadSeconds;
    const closestDistance = Math.hypot(closestDx, closestDy);
    const hitRadius = ship.radius + asteroid.radius * 0.88;
    const threatRadius = hitRadius * THREAT_RADIUS_MARGIN + THREAT_EXTRA_MARGIN;
    const threatSpan = Math.max(1, threatRadius - hitRadius);
    const distancePressure = 1 - clamp((closestDistance - hitRadius) / threatSpan, 0, 1);
    const timePressure = 1 - clamp(lookaheadSeconds / THREAT_LOOKAHEAD_SECONDS, 0, 1);
    const severity = distancePressure * (0.7 + timePressure * 0.6) * (1 + (asteroid.sizeClass - 1) * 0.2);

    if (severity > 0) {
      closestTimeToThreat = Math.min(closestTimeToThreat, lookaheadSeconds);
      closestThreatPressure = Math.max(closestThreatPressure, distancePressure);
      if (lookaheadSeconds <= 1.0) {
        closingThreatCount += 1;
      }

      if (localPos.forward >= Math.abs(localPos.lateral) * 0.75) {
        sectorThreat[0] += severity;
      } else if (localPos.forward <= -Math.abs(localPos.lateral) * 0.75) {
        sectorThreat[3] += severity;
      } else if (localPos.lateral < 0) {
        sectorThreat[1] += severity;
      } else {
        sectorThreat[2] += severity;
      }
    }

    nearestAsteroids.push({
      asteroid,
      dx,
      dy,
      distSq,
      localPos,
      relVx,
      relVy
    });
  }

  nearestAsteroids.sort((a, b) => a.distSq - b.distSq);
  const count = Math.min(MAX_OBS_ASTEROIDS, nearestAsteroids.length);

  for (let i = 0; i < count; i += 1) {
    const item = nearestAsteroids[i];
    const asteroid = item.asteroid;
    const localVel = worldToLocal(item.relVx, item.relVy, ship.angle);

    cursor = writeFeature(out, cursor, clamp(item.localPos.forward / POS_SCALE, -1, 1));
    cursor = writeFeature(out, cursor, clamp(item.localPos.lateral / POS_SCALE, -1, 1));
    cursor = writeFeature(out, cursor, clamp(localVel.forward / VEL_SCALE, -1, 1));
    cursor = writeFeature(out, cursor, clamp(localVel.lateral / VEL_SCALE, -1, 1));
    cursor = writeFeature(out, cursor, asteroidTierToNorm(asteroid.sizeClass));
    cursor = writeFeature(out, cursor, clamp(asteroid.hitPoints / HP_SCALE, 0, 1));
    cursor = writeFeature(out, cursor, clamp(asteroid.radius / MAX_ASTEROID_RADIUS, 0, 1));
    cursor = writeFeature(out, cursor, clamp(Math.sqrt(item.distSq) / POS_SCALE, 0, 1));
  }

  for (; cursor < SHIP_FEATURES + MAX_OBS_ASTEROIDS * ASTEROID_FEATURES; cursor += 1) {
    if (cursor < out.length) {
      out[cursor] = 0;
    }
  }

  const aliveAsteroidCount = nearestAsteroids.length;
  cursor = writeFeature(out, cursor, clamp(aliveAsteroidCount / MAX_ASTEROID_COUNT_NORM, 0, 1));
  cursor = writeFeature(out, cursor, clamp(tierCounts[0] / MAX_ASTEROID_COUNT_NORM, 0, 1));
  cursor = writeFeature(out, cursor, clamp(tierCounts[1] / MAX_ASTEROID_COUNT_NORM, 0, 1));
  cursor = writeFeature(out, cursor, clamp(tierCounts[2] / MAX_ASTEROID_COUNT_NORM, 0, 1));
  cursor = writeFeature(out, cursor, clamp(tierCounts[3] / MAX_ASTEROID_COUNT_NORM, 0, 1));
  cursor = writeFeature(out, cursor, clamp(tierCounts[4] / MAX_ASTEROID_COUNT_NORM, 0, 1));

  if (out.length > LEGACY_OBSERVATION_DIM) {
    const forwardThreat = clamp(sectorThreat[0] / 12, 0, 1);
    const leftThreat = clamp(sectorThreat[1] / 12, 0, 1);
    const rightThreat = clamp(sectorThreat[2] / 12, 0, 1);
    const rearThreat = clamp(sectorThreat[3] / 12, 0, 1);
    const sideBias = clamp((rightThreat - leftThreat) / Math.max(0.25, leftThreat + rightThreat), -1, 1);

    cursor = writeFeature(
      out,
      cursor,
      closestThreatPressure > 0 ? 1 - clamp(closestTimeToThreat / THREAT_LOOKAHEAD_SECONDS, 0, 1) : 0
    );
    cursor = writeFeature(out, cursor, clamp(closestThreatPressure, 0, 1));
    cursor = writeFeature(out, cursor, forwardThreat);
    cursor = writeFeature(out, cursor, leftThreat);
    cursor = writeFeature(out, cursor, rightThreat);
    cursor = writeFeature(out, cursor, rearThreat);
    cursor = writeFeature(out, cursor, clamp(closingThreatCount / 10, 0, 1));
    cursor = writeFeature(out, cursor, clamp(largeAsteroidCount / 20, 0, 1));
    cursor = writeFeature(out, cursor, clamp(tier3PlusCount / 40, 0, 1));
    cursor = writeFeature(out, cursor, sideBias);
  }

  return out;
}
