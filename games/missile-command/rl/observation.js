import { AI_BALANCE, WORLD, clamp } from "../balance.js";

export const MAX_OBS_MISSILES = 10;
export const MISSILE_FEATURES = 11;
export const GLOBAL_FEATURES = 15;
export const OBS_TIME_REMAINING_INDEX = 0;
export const OBSERVATION_DIM = GLOBAL_FEATURES + MAX_OBS_MISSILES * MISSILE_FEATURES;

function normalize(value, scale, min = 0, max = 1) {
  return clamp(value / scale, min, max);
}

function normalizeSigned(value, scale) {
  return clamp(value / scale, -1, 1);
}

function getAliveCityFlags(snapshot) {
  const flags = [0, 0, 0, 0];
  const danger = [0, 0, 0, 0];

  for (const city of snapshot.cities ?? []) {
    if (city.index >= 0 && city.index < 4) {
      flags[city.index] = city.alive ? 1 : 0;
    }
  }

  for (const missile of snapshot.enemyMissiles ?? []) {
    const city = snapshot.cities?.find((item) => item.id === missile.targetCityId) ?? null;
    if (!city || !city.alive || city.index < 0 || city.index >= 4) {
      continue;
    }

    const urgency = 1 - clamp((missile.eta ?? 6) / 6, 0, 1);
    danger[city.index] = Math.max(danger[city.index], urgency);
  }

  return { flags, danger };
}

export function buildObservation(snapshot, out = new Float32Array(OBSERVATION_DIM)) {
  out.fill(0);

  const aliveCities = Number(snapshot?.aliveCities ?? 0);
  const enemyMissiles = Array.isArray(snapshot?.enemyMissiles)
    ? snapshot.enemyMissiles
        .slice()
        .sort((left, right) => (left.eta ?? 999) - (right.eta ?? 999) || left.y - right.y)
    : [];
  const explosions = Array.isArray(snapshot?.explosions) ? snapshot.explosions : [];
  const soonest = enemyMissiles[0] ?? null;
  const strongest = enemyMissiles
    .slice()
    .sort((left, right) => {
      const leftScore = (1 - clamp((left.eta ?? 6) / 6, 0, 1)) * (1 + (left.hitPoints ?? 1) * 0.2);
      const rightScore =
        (1 - clamp((right.eta ?? 6) / 6, 0, 1)) * (1 + (right.hitPoints ?? 1) * 0.2);
      return rightScore - leftScore;
    })[0] ?? null;

  const { flags, danger } = getAliveCityFlags(snapshot ?? {});
  let cursor = 0;

  out[cursor++] = normalize(snapshot?.timeLeft ?? 0, WORLD.gameDuration);
  out[cursor++] = normalize(aliveCities, WORLD.cityCount);
  out[cursor++] = normalize(snapshot?.score ?? 0, 80000);
  out[cursor++] = normalize(snapshot?.maxChain ?? 0, 12);
  out[cursor++] = normalize(enemyMissiles.length, 24);
  out[cursor++] = normalize(explosions.length, 12);
  out[cursor++] = normalize(snapshot?.shotCooldownSeconds ?? 0, AI_BALANCE.cooldownSeconds);
  out[cursor++] = soonest ? normalize(soonest.eta ?? 6, 6) : 1;
  out[cursor++] = strongest ? normalize(strongest.x ?? 0, WORLD.width) : 0.5;
  out[cursor++] = strongest ? normalize(strongest.y ?? 0, WORLD.groundY) : 0.5;

  for (const value of flags) {
    out[cursor++] = value;
  }

  for (const value of danger) {
    out[cursor++] = value;
  }

  for (let index = 0; index < MAX_OBS_MISSILES; index += 1) {
    const missile = enemyMissiles[index];
    if (!missile) {
      cursor += MISSILE_FEATURES;
      continue;
    }

    out[cursor++] = normalize(missile.x ?? 0, WORLD.width);
    out[cursor++] = normalize(missile.y ?? 0, WORLD.groundY);
    out[cursor++] = normalize(missile.targetX ?? 0, WORLD.width);
    out[cursor++] = normalize(missile.speed ?? 0, 320);
    out[cursor++] = clamp(missile.progress ?? 0, 0, 1);
    out[cursor++] = normalize(missile.eta ?? 6, 6);
    out[cursor++] = normalize(missile.hitPoints ?? 1, 2);
    out[cursor++] = normalizeSigned(missile.velocityX ?? 0, 280);
    out[cursor++] = normalizeSigned(missile.velocityY ?? 0, 280);
    out[cursor++] = normalize(missile.type === "armored" ? 3 : missile.type === "fast" ? 2 : missile.type === "split" ? 1 : 0, 3);
    out[cursor++] = normalize(
      typeof missile.targetCityId === "number" ? missile.targetCityId : 0,
      WORLD.cityCount + 1,
    );
  }

  return out;
}
