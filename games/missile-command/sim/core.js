import {
  AI_BALANCE,
  CITY_LAYOUT,
  ENEMY_TYPES,
  PLAYER_BALANCE,
  WORLD,
  clamp,
  getClearCityBonus,
  getBurstChance,
  getEnemySpeed,
  getSpawnRate,
  pickEnemyType,
} from "../balance.js";
import { resolveActionTarget } from "./action-map.js";
import { createRng } from "./rng.js";

export const SIM_TICK_RATE = 60;
export const SIM_STEP_SECONDS = 1 / SIM_TICK_RATE;
export const SIM_MAX_TICKS = Math.round(WORLD.gameDuration * SIM_TICK_RATE);
export const SIM_INTERCEPTOR_TICKS = Math.max(
  1,
  Math.round(WORLD.interceptorTravelTime * SIM_TICK_RATE),
);
export const SIM_INTERCEPTOR_COOLDOWN_TICKS = Math.max(
  1,
  Math.round(AI_BALANCE.cooldownSeconds * SIM_TICK_RATE),
);
export const SIM_GAME_VERSION = "orbital-shield-rl-poc-v3";

const SCORE_SCALE = 0.055;
const CITY_STEP_REWARD = 0.04;
const CITY_LOSS_PENALTY = 180;
const CLEAR_BONUS = 650;
const GAMEOVER_PENALTY = 320;
const THREAT_STEP_SCALE = 0.08;

function createCityState(layout, index) {
  return {
    id: index + 1,
    index,
    x: layout.x,
    y: WORLD.groundY,
    width: layout.width,
    height: layout.height,
    alive: true,
  };
}

function allocateId(state) {
  const value = state.nextEntityId;
  state.nextEntityId += 1;
  return value;
}

function allocateComboId(state) {
  const value = state.nextComboId;
  state.nextComboId += 1;
  return value;
}

function queueStepEvent(state, event) {
  if (!state || !Array.isArray(state.stepEvents) || !event || typeof event !== "object") {
    return;
  }

  state.stepEvents.push({ ...event });
}

function getEnemyTypeIndex(type) {
  switch (type) {
    case "normal":
      return 0;
    case "split":
      return 1;
    case "fast":
      return 2;
    case "armored":
      return 3;
    default:
      return 0;
  }
}

function getThreatWeight(type) {
  switch (type) {
    case "split":
      return 1.25;
    case "fast":
      return 1.18;
    case "armored":
      return 1.42;
    default:
      return 1;
  }
}

function createEnemyMissile(state, {
  type,
  startX,
  startY = -48,
  targetX,
  targetY = WORLD.groundY - 6,
  targetCityId = null,
  speed,
  splitProgress = 0.42,
}) {
  const definition = ENEMY_TYPES[type];
  const dx = targetX - startX;
  const dy = targetY - startY;
  const distance = Math.hypot(dx, dy) || 1;

  return {
    id: allocateId(state),
    type,
    typeIndex: getEnemyTypeIndex(type),
    definition,
    x: startX,
    y: startY,
    startX,
    startY,
    targetX,
    targetY,
    targetCityId,
    dirX: dx / distance,
    dirY: dy / distance,
    speed,
    totalDistance: distance,
    distanceTravelled: 0,
    splitProgress,
    splitTriggered: false,
    visibleTicks: startY >= 0 ? 0 : -1,
    hitPoints: definition.armor,
    radius: definition.radius,
    active: true,
  };
}

function createInterceptor(state, target) {
  return {
    id: allocateId(state),
    targetX: target.x,
    targetY: target.y,
    elapsedTicks: 0,
    totalTicks: SIM_INTERCEPTOR_TICKS,
  };
}

function createExplosion(state, {
  x,
  y,
  maxRadius,
  comboId = 0,
  chainDepth = 0,
  damaging = true,
  secondary = false,
}) {
  return {
    id: allocateId(state),
    x,
    y,
    maxRadius,
    comboId,
    chainDepth,
    damaging,
    secondary,
    hitIds: new Set(),
    age: 0,
    currentRadius: 0,
    alpha: 1,
    active: true,
    growDuration: secondary ? 0.09 : 0.13,
    holdDuration: secondary ? 0.04 : 0.07,
    fadeDuration: secondary ? 0.28 : 0.4,
    totalDuration: (secondary ? 0.09 : 0.13) + (secondary ? 0.04 : 0.07) + (secondary ? 0.28 : 0.4),
  };
}

function updateExplosion(explosion, dt) {
  explosion.age += dt;

  if (explosion.age <= explosion.growDuration) {
    const ratio = explosion.age / explosion.growDuration;
    explosion.currentRadius = explosion.maxRadius * (1 - Math.pow(1 - ratio, 2));
    explosion.alpha = 1;
    return true;
  }

  if (explosion.age <= explosion.growDuration + explosion.holdDuration) {
    explosion.currentRadius = explosion.maxRadius;
    explosion.alpha = 0.95;
    return true;
  }

  if (explosion.age <= explosion.totalDuration) {
    const ratio =
      (explosion.age - explosion.growDuration - explosion.holdDuration) / explosion.fadeDuration;
    explosion.currentRadius = explosion.maxRadius + explosion.maxRadius * 0.16 * ratio;
    explosion.alpha = 1 - ratio;
    return true;
  }

  explosion.active = false;
  explosion.alpha = 0;
  return false;
}

function getAliveCities(state) {
  return state.cities.filter((city) => city.alive);
}

function findCityById(state, cityId) {
  return state.cities.find((city) => city.id === cityId) ?? null;
}

function findImpactCity(state, impactX) {
  return (
    state.cities.find(
      (city) =>
        city.alive &&
        impactX >= city.x - city.width * 0.5 &&
        impactX <= city.x + city.width * 0.5,
    ) ?? null
  );
}

function pickRandomImpactTarget(state, { preferredX = null, spread = null } = {}) {
  const minX = 28;
  const maxX = WORLD.width - 28;
  const targetX =
    Number.isFinite(preferredX) && Number.isFinite(spread)
      ? clamp(preferredX + state.rng.nextRange(-spread, spread), minX, maxX)
      : state.rng.nextRange(minX, maxX);
  const targetCity = findImpactCity(state, targetX);
  return {
    targetX,
    targetCityId: targetCity?.id ?? null,
  };
}

function computeMissileEta(missile) {
  const remainingDistance = Math.max(0, missile.totalDistance - missile.distanceTravelled);
  return remainingDistance / Math.max(1, missile.speed);
}

function syncVisibleTicks(missile) {
  if (missile.y < 0) {
    return;
  }

  if (missile.visibleTicks < 0) {
    missile.visibleTicks = 0;
    return;
  }

  missile.visibleTicks += 1;
}

function computeThreatLevel(state) {
  let threat = 0;

  for (const missile of state.enemyMissiles) {
    if (!missile.active) {
      continue;
    }

    const eta = computeMissileEta(missile);
    const urgency = 1 - clamp(eta / 5, 0, 1);
    const city = findCityById(state, missile.targetCityId);
    const cityFactor = city?.alive ? 1 : 0.08;
    threat += getThreatWeight(missile.type) * (0.35 + urgency * 1.15) * cityFactor;
  }

  return threat;
}

function resolveLaunchTarget(action) {
  if (action && typeof action === "object" && Number.isFinite(action.x) && Number.isFinite(action.y)) {
    return {
      x: clamp(Number(action.x), 28, WORLD.width - 28),
      y: clamp(Number(action.y), 36, WORLD.groundY - 28),
    };
  }

  return resolveActionTarget(action);
}

function launchAction(state, action) {
  const target = resolveLaunchTarget(action);
  if (!target || state.result || state.interceptorCooldownTicks > 0) {
    return false;
  }

  state.interceptors.push(createInterceptor(state, target));
  state.metrics.shotsFired += 1;
  state.interceptorCooldownTicks = SIM_INTERCEPTOR_COOLDOWN_TICKS;
  queueStepEvent(state, { type: "launch", x: target.x, y: target.y });
  return true;
}

function spawnEnemy(state, forcedType = null) {
  const aliveCities = getAliveCities(state);
  if (aliveCities.length === 0) {
    return;
  }

  const progress = state.tick / SIM_MAX_TICKS;
  const type = forcedType ?? pickEnemyType(progress, () => state.rng.nextFloat());
  const startX = state.rng.nextRange(60, WORLD.width - 60);
  const { targetX, targetCityId } = pickRandomImpactTarget(state);

  state.enemyMissiles.push(
    createEnemyMissile(state, {
      type,
      startX,
      targetX,
      targetCityId,
      speed: getEnemySpeed(type, () => state.rng.nextFloat()),
      splitProgress: state.rng.nextRange(0.34, 0.62),
    }),
  );
}

function spawnSplitChildren(state, missile) {
  queueStepEvent(state, { type: "split", x: missile.x, y: missile.y });

  for (let index = 0; index < 2; index += 1) {
    const direction = index === 0 ? -1 : 1;
    const childType = state.rng.nextFloat() < 0.62 ? "normal" : "fast";
    const preferredX = missile.x + direction * state.rng.nextRange(180, 340);
    const { targetX, targetCityId } = pickRandomImpactTarget(state, {
      preferredX,
      spread: 180,
    });

    state.enemyMissiles.push(
      createEnemyMissile(state, {
        type: childType,
        startX: missile.x,
        startY: missile.y,
        targetX,
        targetCityId,
        speed: getEnemySpeed(childType, () => state.rng.nextFloat()) * 0.96,
        splitProgress: 1,
      }),
    );
  }

  state.explosions.push(
    createExplosion(state, {
      x: missile.x,
      y: missile.y,
      maxRadius: 42,
      damaging: false,
      secondary: true,
    }),
  );
}

function destroyCity(state, city) {
  if (!city || !city.alive) {
    return false;
  }

  city.alive = false;
  state.metrics.cityLosses += 1;
  queueStepEvent(state, {
    type: "city-lost",
    cityId: city.id,
    x: city.x,
    y: WORLD.groundY - 4,
  });
  return true;
}

function handleEnemyDestroyed(state, missile, explosion) {
  const previousCount = state.comboCounts.get(explosion.comboId) ?? 0;
  const chainCount = previousCount + 1;
  state.comboCounts.set(explosion.comboId, chainCount);
  state.maxChain = Math.max(state.maxChain, chainCount);
  state.score += Math.round(missile.definition.score * (1 + Math.min(1.8, (chainCount - 1) * 0.18)));
  state.metrics.kills += 1;
  queueStepEvent(state, {
    type: "enemy-destroyed",
    x: missile.x,
    y: missile.y,
    missileType: missile.type,
    chainCount,
  });

  state.explosions.push(
    createExplosion(state, {
      x: missile.x,
      y: missile.y,
      maxRadius: missile.definition.secondaryRadius,
      comboId: explosion.comboId,
      chainDepth: explosion.chainDepth + 1,
      secondary: true,
      damaging: true,
    }),
  );
}

function updateEnemyMissiles(state, dt) {
  const survivors = [];

  for (const missile of state.enemyMissiles) {
    if (!missile.active) {
      continue;
    }

    missile.distanceTravelled += missile.speed * dt;
    if (missile.distanceTravelled >= missile.totalDistance) {
      missile.x = missile.targetX;
      missile.y = missile.targetY;
      syncVisibleTicks(missile);
      const targetCity = findImpactCity(state, missile.x);
      destroyCity(state, targetCity);
      state.explosions.push(
        createExplosion(state, {
          x: missile.x,
          y: WORLD.groundY - 4,
          maxRadius: 54,
          damaging: false,
          secondary: true,
        }),
      );
      continue;
    }

    missile.x += missile.dirX * missile.speed * dt;
    missile.y += missile.dirY * missile.speed * dt;
    syncVisibleTicks(missile);

    if (missile.type === "split" && !missile.splitTriggered) {
      const progress = missile.distanceTravelled / missile.totalDistance;
      if (progress >= missile.splitProgress) {
        missile.splitTriggered = true;
        spawnSplitChildren(state, missile);
        continue;
      }
    }

    survivors.push(missile);
  }

  state.enemyMissiles = survivors;
}

function updateInterceptors(state) {
  const survivors = [];

  for (const interceptor of state.interceptors) {
    interceptor.elapsedTicks += 1;
    if (interceptor.elapsedTicks >= interceptor.totalTicks) {
      queueStepEvent(state, {
        type: "player-explosion",
        x: interceptor.targetX,
        y: interceptor.targetY,
      });
      const comboId = allocateComboId(state);
      state.comboCounts.set(comboId, 0);
      state.explosions.push(
        createExplosion(state, {
          x: interceptor.targetX,
          y: interceptor.targetY,
          maxRadius: PLAYER_BALANCE.explosionRadius,
          comboId,
          chainDepth: 0,
          secondary: false,
          damaging: true,
        }),
      );
    } else {
      survivors.push(interceptor);
    }
  }

  state.interceptors = survivors;
}

function updateExplosions(state, dt) {
  const activeExplosions = [];

  for (const explosion of state.explosions) {
    if (updateExplosion(explosion, dt)) {
      activeExplosions.push(explosion);
    }
  }

  const destroyedIds = new Set();

  for (const explosion of activeExplosions) {
    if (!explosion.damaging) {
      continue;
    }

    for (const missile of state.enemyMissiles) {
      if (!missile.active || destroyedIds.has(missile.id) || explosion.hitIds.has(missile.id)) {
        continue;
      }

      const distance = Math.hypot(missile.x - explosion.x, missile.y - explosion.y);
      if (distance > explosion.currentRadius + missile.radius) {
        continue;
      }

      explosion.hitIds.add(missile.id);
      missile.hitPoints -= 1;

      if (missile.hitPoints <= 0) {
        missile.active = false;
        destroyedIds.add(missile.id);
        handleEnemyDestroyed(state, missile, explosion);
      } else {
        queueStepEvent(state, {
          type: "armor-hit",
          x: missile.x,
          y: missile.y,
        });
      }
    }
  }

  state.explosions = activeExplosions;
  if (destroyedIds.size > 0) {
    state.enemyMissiles = state.enemyMissiles.filter((missile) => !destroyedIds.has(missile.id));
  }
}

function finalizeState(state) {
  const aliveCities = getAliveCities(state).length;
  if (aliveCities === 0) {
    state.result = "gameover";
  } else if (state.tick >= SIM_MAX_TICKS) {
    const cityBonus = getClearCityBonus(aliveCities);
    if (cityBonus > 0) {
      state.score += cityBonus;
      state.metrics.survivalBonus = cityBonus;
    }
    state.result = "clear";
  }
}

function updateSpawn(state) {
  const elapsedSeconds = state.tick * SIM_STEP_SECONDS;
  state.spawnAccumulator += SIM_STEP_SECONDS * getSpawnRate(elapsedSeconds);

  while (state.spawnAccumulator >= 1 && !state.result) {
    state.spawnAccumulator -= 1;
    spawnEnemy(state);

    if (state.rng.nextFloat() < getBurstChance(elapsedSeconds)) {
      spawnEnemy(state);
    }
  }
}

function computeStepReward(state, before) {
  const aliveCities = getAliveCities(state).length;
  const scoreDelta = state.score - before.score;
  const cityLosses = before.aliveCities - aliveCities;
  const threat = computeThreatLevel(state);
  let reward = scoreDelta * SCORE_SCALE;
  reward += aliveCities * CITY_STEP_REWARD;
  reward -= threat * THREAT_STEP_SCALE;

  if (cityLosses > 0) {
    reward -= cityLosses * CITY_LOSS_PENALTY;
  }

  if (state.result === "clear" && before.result === null) {
    reward += CLEAR_BONUS + aliveCities * 50;
  }

  if (state.result === "gameover" && before.result === null) {
    reward -= GAMEOVER_PENALTY;
  }

  state.metrics.threatIntegral += threat;
  state.metrics.reward += reward;
  return reward;
}

export function createInitialState({
  seed = 0x3d93fa2a,
  playerName = "ACE",
  initialSpawnAccumulator = 0.35,
} = {}) {
  return {
    version: SIM_GAME_VERSION,
    seed: seed >>> 0,
    playerName,
    rng: createRng(seed),
    tick: 0,
    tickRate: SIM_TICK_RATE,
    stepSeconds: SIM_STEP_SECONDS,
    maxTicks: SIM_MAX_TICKS,
    nextEntityId: 1,
    nextComboId: 1,
    score: 0,
    maxChain: 0,
    result: null,
    spawnAccumulator: initialSpawnAccumulator,
    interceptorCooldownTicks: 0,
    comboCounts: new Map(),
    cities: CITY_LAYOUT.map((layout, index) => createCityState(layout, index)),
    enemyMissiles: [],
    interceptors: [],
    explosions: [],
    stepEvents: [],
    metrics: {
      reward: 0,
      kills: 0,
      cityLosses: 0,
      shotsFired: 0,
      threatIntegral: 0,
      survivalBonus: 0,
    },
  };
}

export function getSnapshot(state) {
  const aliveCities = getAliveCities(state).length;
  const enemyMissiles = state.enemyMissiles
    .filter((missile) => missile.active)
    .map((missile) => ({
      id: missile.id,
      type: missile.type,
      x: missile.x,
      y: missile.y,
      targetX: missile.targetX,
      targetY: missile.targetY,
      targetCityId: missile.targetCityId,
      velocityX: missile.dirX * missile.speed,
      velocityY: missile.dirY * missile.speed,
      speed: missile.speed,
      progress: clamp(missile.distanceTravelled / missile.totalDistance, 0, 1),
      splitProgress: missile.splitProgress,
      visibleTicks: missile.visibleTicks,
      hitPoints: missile.hitPoints,
      radius: missile.radius,
      eta: computeMissileEta(missile),
    }));

  return {
    version: state.version,
    tick: state.tick,
    tickRate: state.tickRate,
    stepSeconds: state.stepSeconds,
    width: WORLD.width,
    height: WORLD.height,
    groundY: WORLD.groundY,
    cityCount: WORLD.cityCount,
    timeLeft: Math.max(0, WORLD.gameDuration - state.tick * SIM_STEP_SECONDS),
    score: state.score,
    maxChain: state.maxChain,
    aliveCities,
    result: state.result,
    shotCooldownSeconds: state.interceptorCooldownTicks * SIM_STEP_SECONDS,
    cities: state.cities.map((city) => ({
      id: city.id,
      index: city.index,
      x: city.x,
      y: city.y,
      width: city.width,
      height: city.height,
      alive: city.alive,
    })),
    enemyMissiles,
    explosions: state.explosions.map((explosion) => ({
      x: explosion.x,
      y: explosion.y,
      currentRadius: explosion.currentRadius,
      damaging: explosion.damaging,
      secondary: explosion.secondary,
    })),
    interceptors: state.interceptors.map((interceptor) => ({
      targetX: interceptor.targetX,
      targetY: interceptor.targetY,
      progress: clamp(interceptor.elapsedTicks / interceptor.totalTicks, 0, 1),
    })),
  };
}

export function stepSimulation(state, action = 0) {
  if (state.result) {
    return {
      reward: 0,
      done: true,
      events: [],
      snapshot: getSnapshot(state),
    };
  }

  state.stepEvents = [];

  const before = {
    score: state.score,
    aliveCities: getAliveCities(state).length,
    result: state.result,
  };

  launchAction(state, action);
  updateSpawn(state);
  updateEnemyMissiles(state, SIM_STEP_SECONDS);
  updateInterceptors(state);
  updateExplosions(state, SIM_STEP_SECONDS);
  state.interceptorCooldownTicks = Math.max(0, state.interceptorCooldownTicks - 1);
  state.tick += 1;
  finalizeState(state);

  const reward = computeStepReward(state, before);
  return {
    reward,
    done: Boolean(state.result),
    events: state.stepEvents.map((event) => ({ ...event })),
    snapshot: getSnapshot(state),
  };
}

export function runEpisode({ agent, seed = 0x3d93fa2a, maxTicks = SIM_MAX_TICKS } = {}) {
  const state = createInitialState({ seed });
  let totalReward = 0;

  if (typeof agent?.reset === "function") {
    agent.reset();
  }

  for (let tick = 0; tick < maxTicks && !state.result; tick += 1) {
    const snapshot = getSnapshot(state);
    const action = typeof agent?.nextAction === "function" ? agent.nextAction(snapshot) : 0;
    const result = stepSimulation(state, action);
    totalReward += result.reward;
  }

  const finalSnapshot = getSnapshot(state);
  return {
    state,
    snapshot: finalSnapshot,
    reward: totalReward,
    score: state.score,
    maxChain: state.maxChain,
    aliveCities: finalSnapshot.aliveCities,
    clear: state.result === "clear",
  };
}
