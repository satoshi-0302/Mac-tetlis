import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ASTEROID_TYPES,
  BULLET_LIFE_TICKS,
  BULLET_RADIUS,
  BULLET_SPEED,
  CLOSE_KILL_BONUS_RATE,
  CLOSE_KILL_RANGE,
  COMBO_STEP_BONUS,
  COMBO_WINDOW_TICKS,
  FIXED_STEP_SECONDS,
  INPUT_BOMB,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST,
  MAX_COMBO_BONUS,
  MAX_TICKS,
  SHIP_DRAG_PER_TICK,
  SHIP_INVULN_TICKS,
  SHIP_MAX_SPEED,
  SHIP_RADIUS,
  SHIP_ROTATE_SPEED,
  SHIP_THRUST_ACCEL,
  SHOT_COOLDOWN_TICKS,
} from '../engine/constants.js';
import { createSpawnSchedule } from './spawn-schedule.js';

const COLLISION_CELL_SIZE = 96;
const COLLISION_GRID_COLS = Math.ceil(ARENA_WIDTH / COLLISION_CELL_SIZE);
const COLLISION_GRID_ROWS = Math.ceil(ARENA_HEIGHT / COLLISION_CELL_SIZE);
const COLLISION_GRID_SIZE = COLLISION_GRID_COLS * COLLISION_GRID_ROWS;
const MAX_ASTEROID_RADIUS = Object.values(ASTEROID_TYPES).reduce(
  (maxRadius, asteroidType) => Math.max(maxRadius, asteroidType.radius),
  0
);
const COLLISION_QUERY_RADIUS_CELLS = Math.ceil(
  (MAX_ASTEROID_RADIUS + BULLET_RADIUS) / COLLISION_CELL_SIZE
);

function wrapX(x) {
  if (x < 0) {
    return x + ARENA_WIDTH;
  }
  if (x >= ARENA_WIDTH) {
    return x - ARENA_WIDTH;
  }
  return x;
}

function wrapY(y) {
  if (y < 0) {
    return y + ARENA_HEIGHT;
  }
  if (y >= ARENA_HEIGHT) {
    return y - ARENA_HEIGHT;
  }
  return y;
}

function wrapEntity(entity) {
  entity.x = wrapX(entity.x);
  entity.y = wrapY(entity.y);
}

function wrapGridCoord(value, max) {
  let wrapped = value % max;
  if (wrapped < 0) {
    wrapped += max;
  }
  return wrapped;
}

function toGridCellX(x) {
  return wrapGridCoord(Math.floor(x / COLLISION_CELL_SIZE), COLLISION_GRID_COLS);
}

function toGridCellY(y) {
  return wrapGridCoord(Math.floor(y / COLLISION_CELL_SIZE), COLLISION_GRID_ROWS);
}

function toGridIndex(cellX, cellY) {
  return cellY * COLLISION_GRID_COLS + cellX;
}

function clearCollisionGrid(state) {
  for (let i = 0; i < COLLISION_GRID_SIZE; i += 1) {
    state.collisionGrid[i].length = 0;
  }
}

function addAsteroidToCollisionGrid(state, asteroidIndex) {
  const asteroid = state.asteroids[asteroidIndex];
  if (!asteroid || asteroid._removed || asteroid.hitPoints <= 0) {
    return;
  }

  const cellX = toGridCellX(asteroid.x);
  const cellY = toGridCellY(asteroid.y);
  state.collisionGrid[toGridIndex(cellX, cellY)].push(asteroidIndex);
}

function rebuildCollisionGrid(state) {
  clearCollisionGrid(state);
  for (let asteroidIndex = 0; asteroidIndex < state.asteroids.length; asteroidIndex += 1) {
    addAsteroidToCollisionGrid(state, asteroidIndex);
  }
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

function wrappedDistance(ax, ay, bx, by) {
  return Math.sqrt(wrappedDistanceSquared(ax, ay, bx, by));
}

function createShipState() {
  return {
    x: ARENA_WIDTH * 0.5,
    y: ARENA_HEIGHT * 0.5,
    vx: 0,
    vy: 0,
    angle: -Math.PI * 0.5,
    radius: SHIP_RADIUS,
    cooldownTicks: 0,
    invulnTicks: SHIP_INVULN_TICKS,
    destroyed: false
  };
}

function resolveAsteroidType(config) {
  if (config.type && ASTEROID_TYPES[config.type]) {
    return config.type;
  }
  if (config.size >= 5) {
    return 'tier5';
  }
  if (config.size >= 4) {
    return 'tier4';
  }
  if (config.size >= 3) {
    return 'tier3';
  }
  if (config.size >= 2) {
    return 'tier2';
  }
  return 'tier1';
}

function createAsteroid(state, config) {
  const type = resolveAsteroidType(config);
  const typeStats = ASTEROID_TYPES[type];
  return {
    id: state.nextAsteroidId++,
    type,
    sizeClass: typeStats.sizeClass,
    radius: typeStats.radius,
    hitPoints: typeStats.hitPoints,
    maxHitPoints: typeStats.hitPoints,
    x: config.x,
    y: config.y,
    vx: config.vx,
    vy: config.vy
  };
}

function spawnDeathChildren(state, asteroid, onSpawned) {
  const sourceStats = ASTEROID_TYPES[asteroid.type];
  if (!sourceStats.deathSpawns || sourceStats.deathSpawns.length === 0) {
    return;
  }

  const sourceAngle = Math.atan2(asteroid.vy, asteroid.vx);
  const sourceSpeed = Math.hypot(asteroid.vx, asteroid.vy);

  for (let groupIndex = 0; groupIndex < sourceStats.deathSpawns.length; groupIndex += 1) {
    const spawnGroup = sourceStats.deathSpawns[groupIndex];
    const orbitShift = groupIndex * 0.5;

    for (let i = 0; i < spawnGroup.count; i += 1) {
      const t = spawnGroup.count === 1 ? 0 : i / (spawnGroup.count - 1) - 0.5;
      const splitAngle = sourceAngle + orbitShift + t * spawnGroup.spread;
      const offsetAngle = splitAngle + Math.PI * 0.5;
      const childSpeed = Math.max(
        80,
        sourceSpeed * spawnGroup.speedScale + spawnGroup.speedBonus
      );

      const child = createAsteroid(state, {
        type: spawnGroup.type,
        x: wrapX(asteroid.x + Math.cos(offsetAngle) * asteroid.radius * 0.36),
        y: wrapY(asteroid.y + Math.sin(offsetAngle) * asteroid.radius * 0.36),
        vx: Math.cos(splitAngle) * childSpeed,
        vy: Math.sin(splitAngle) * childSpeed
      });
      state.asteroids.push(child);
      if (typeof onSpawned === 'function') {
        onSpawned(state.asteroids.length - 1);
      }
    }
  }
}

function computeCloseBonus(state, asteroid) {
  const shipDistance = wrappedDistance(state.ship.x, state.ship.y, asteroid.x, asteroid.y);
  const edgeDistance = Math.max(0, shipDistance - asteroid.radius);
  if (edgeDistance >= CLOSE_KILL_RANGE) {
    return 0;
  }
  return Math.floor((CLOSE_KILL_RANGE - edgeDistance) * CLOSE_KILL_BONUS_RATE);
}

function registerKillScore(state, asteroid) {
  const closeBonus = computeCloseBonus(state, asteroid);
  const baseScore = ASTEROID_TYPES[asteroid.type].baseScore;

  state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
  state.comboTimer = COMBO_WINDOW_TICKS;
  state.maxCombo = Math.max(state.maxCombo, state.combo);

  const comboBonus = Math.min(MAX_COMBO_BONUS, (state.combo - 1) * COMBO_STEP_BONUS);
  const multiplier = 1 + comboBonus;
  const points = Math.floor((baseScore + closeBonus) * multiplier);

  state.score += points;
  state.kills += 1;

  return { points, closeBonus, multiplier };
}

function spawnScheduledAsteroids(state) {
  while (
    state.spawnCursor < state.spawnSchedule.length &&
    state.spawnSchedule[state.spawnCursor].tick === state.tick
  ) {
    const scheduleEntry = state.spawnSchedule[state.spawnCursor];
    state.asteroids.push(createAsteroid(state, scheduleEntry));
    state.events.push({
      type: 'spawn',
      x: scheduleEntry.x,
      y: scheduleEntry.y,
      asteroidType: scheduleEntry.type
    });
    state.spawnCursor += 1;
  }
}

function detonateBomb(state) {
  state.events.push({ type: 'bomb', x: state.ship.x, y: state.ship.y });
  if (state.asteroids.length === 0) {
    return;
  }

  for (const asteroid of state.asteroids) {
    state.events.push({
      type: 'bomb-destroy',
      x: asteroid.x,
      y: asteroid.y,
      size: asteroid.sizeClass,
      asteroidType: asteroid.type
    });
  }
  state.asteroids.length = 0;
}

function moveShip(state, inputMask) {
  const ship = state.ship;
  const left = (inputMask & INPUT_LEFT) !== 0;
  const right = (inputMask & INPUT_RIGHT) !== 0;

  if (left !== right) {
    ship.angle += (left ? -1 : 1) * SHIP_ROTATE_SPEED * FIXED_STEP_SECONDS;
  }

  if ((inputMask & INPUT_THRUST) !== 0) {
    ship.vx += Math.cos(ship.angle) * SHIP_THRUST_ACCEL * FIXED_STEP_SECONDS;
    ship.vy += Math.sin(ship.angle) * SHIP_THRUST_ACCEL * FIXED_STEP_SECONDS;
  }

  ship.vx *= SHIP_DRAG_PER_TICK;
  ship.vy *= SHIP_DRAG_PER_TICK;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > SHIP_MAX_SPEED) {
    const scale = SHIP_MAX_SPEED / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  ship.x += ship.vx * FIXED_STEP_SECONDS;
  ship.y += ship.vy * FIXED_STEP_SECONDS;
  wrapEntity(ship);
}

function tryShoot(state, inputMask) {
  const ship = state.ship;
  if ((inputMask & INPUT_SHOOT) === 0 || ship.cooldownTicks > 0) {
    return;
  }

  const spreadAngles = [-0.24, 0, 0.24];
  const laneOffsets = [-2.5, 2.5];
  const muzzleBaseX = ship.x + Math.cos(ship.angle) * (ship.radius + 5);
  const muzzleBaseY = ship.y + Math.sin(ship.angle) * (ship.radius + 5);

  let firedBullets = 0;
  for (const spread of spreadAngles) {
    const bulletAngle = ship.angle + spread;
    const perpAngle = bulletAngle + Math.PI * 0.5;

    for (const laneOffset of laneOffsets) {
      state.bullets.push({
        x: wrapX(muzzleBaseX + Math.cos(perpAngle) * laneOffset),
        y: wrapY(muzzleBaseY + Math.sin(perpAngle) * laneOffset),
        vx: ship.vx * 0.25 + Math.cos(bulletAngle) * BULLET_SPEED,
        vy: ship.vy * 0.25 + Math.sin(bulletAngle) * BULLET_SPEED,
        lifeTicks: BULLET_LIFE_TICKS
      });
      firedBullets += 1;
    }
  }

  ship.cooldownTicks = SHOT_COOLDOWN_TICKS;
  state.shotsFired += firedBullets;

  state.events.push({ type: 'shot', x: muzzleBaseX, y: muzzleBaseY, angle: ship.angle });
}

function compactBullets(state) {
  let writeIndex = 0;
  for (let i = 0; i < state.bullets.length; i += 1) {
    const bullet = state.bullets[i];
    if (bullet._removed) {
      continue;
    }
    if (writeIndex !== i) {
      state.bullets[writeIndex] = bullet;
    }
    writeIndex += 1;
  }
  state.bullets.length = writeIndex;
}

function updateBullets(state) {
  let writeIndex = 0;
  for (let i = 0; i < state.bullets.length; i += 1) {
    const bullet = state.bullets[i];
    bullet.x += bullet.vx * FIXED_STEP_SECONDS;
    bullet.y += bullet.vy * FIXED_STEP_SECONDS;
    bullet.lifeTicks -= 1;

    const outOfBounds =
      bullet.x < 0 ||
      bullet.x > ARENA_WIDTH ||
      bullet.y < 0 ||
      bullet.y > ARENA_HEIGHT;

    if (bullet.lifeTicks <= 0 || outOfBounds || bullet._removed) {
      continue;
    }

    if (writeIndex !== i) {
      state.bullets[writeIndex] = bullet;
    }
    writeIndex += 1;
  }
  state.bullets.length = writeIndex;
}

function updateAsteroids(state) {
  for (const asteroid of state.asteroids) {
    asteroid.x += asteroid.vx * FIXED_STEP_SECONDS;
    asteroid.y += asteroid.vy * FIXED_STEP_SECONDS;
    wrapEntity(asteroid);
  }
}

function compactAsteroids(state) {
  let writeIndex = 0;
  for (let i = 0; i < state.asteroids.length; i += 1) {
    const asteroid = state.asteroids[i];
    if (asteroid._removed || asteroid.hitPoints <= 0) {
      continue;
    }
    if (writeIndex !== i) {
      state.asteroids[writeIndex] = asteroid;
    }
    writeIndex += 1;
  }
  state.asteroids.length = writeIndex;
}

function resolveBulletHits(state) {
  if (state.bullets.length === 0 || state.asteroids.length === 0) {
    return;
  }

  rebuildCollisionGrid(state);

  for (let bulletIndex = state.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
    const bullet = state.bullets[bulletIndex];
    if (bullet._removed) {
      continue;
    }

    const bulletCellX = toGridCellX(bullet.x);
    const bulletCellY = toGridCellY(bullet.y);
    let hitAsteroidIndex = -1;

    for (
      let cellOffsetY = -COLLISION_QUERY_RADIUS_CELLS;
      cellOffsetY <= COLLISION_QUERY_RADIUS_CELLS;
      cellOffsetY += 1
    ) {
      const cellY = wrapGridCoord(bulletCellY + cellOffsetY, COLLISION_GRID_ROWS);
      for (
        let cellOffsetX = -COLLISION_QUERY_RADIUS_CELLS;
        cellOffsetX <= COLLISION_QUERY_RADIUS_CELLS;
        cellOffsetX += 1
      ) {
        const cellX = wrapGridCoord(bulletCellX + cellOffsetX, COLLISION_GRID_COLS);
        const cellAsteroids = state.collisionGrid[toGridIndex(cellX, cellY)];

        for (let i = cellAsteroids.length - 1; i >= 0; i -= 1) {
          const asteroidIndex = cellAsteroids[i];
          if (asteroidIndex <= hitAsteroidIndex) {
            continue;
          }

          const asteroid = state.asteroids[asteroidIndex];
          if (!asteroid || asteroid._removed || asteroid.hitPoints <= 0) {
            continue;
          }

          const hitDistance = asteroid.radius + BULLET_RADIUS;
          if (
            wrappedDistanceSquared(bullet.x, bullet.y, asteroid.x, asteroid.y) >
            hitDistance * hitDistance
          ) {
            continue;
          }

          hitAsteroidIndex = asteroidIndex;
        }
      }
    }

    if (hitAsteroidIndex < 0) {
      continue;
    }

    const asteroid = state.asteroids[hitAsteroidIndex];
    if (!asteroid || asteroid._removed || asteroid.hitPoints <= 0) {
      continue;
    }

    bullet._removed = true;
    state.hits += 1;
    asteroid.hitPoints -= 1;

    if (asteroid.hitPoints > 0) {
      state.events.push({
        type: 'armor-hit',
        x: asteroid.x,
        y: asteroid.y,
        asteroidType: asteroid.type,
        remainingHp: asteroid.hitPoints,
        maxHp: asteroid.maxHitPoints
      });
      continue;
    }

    asteroid._removed = true;
    const scoreInfo = registerKillScore(state, asteroid);

    spawnDeathChildren(state, asteroid, (childIndex) => {
      addAsteroidToCollisionGrid(state, childIndex);
    });

    state.events.push({
      type: 'kill',
      x: asteroid.x,
      y: asteroid.y,
      size: asteroid.sizeClass,
      asteroidType: asteroid.type,
      points: scoreInfo.points,
      combo: state.combo,
      multiplier: scoreInfo.multiplier,
      closeBonus: scoreInfo.closeBonus
    });
  }

  compactBullets(state);
  compactAsteroids(state);
}

function resolveShipCollision(state) {
  const ship = state.ship;
  if (ship.invulnTicks > 0 || ship.destroyed) {
    return;
  }

  for (let asteroidIndex = state.asteroids.length - 1; asteroidIndex >= 0; asteroidIndex -= 1) {
    const asteroid = state.asteroids[asteroidIndex];
    const hitDistance = ship.radius + asteroid.radius * 0.88;

    if (
      wrappedDistanceSquared(ship.x, ship.y, asteroid.x, asteroid.y) >
      hitDistance * hitDistance
    ) {
      continue;
    }

    state.crashes += 1;
    state.combo = 0;
    state.comboTimer = 0;
    state.bullets.length = 0;
    ship.destroyed = true;
    state.finished = true;
    state.endReason = 'ship-destroyed';
    state.events.push({
      type: 'ship-destroyed',
      x: ship.x,
      y: ship.y,
      asteroidType: asteroid.type,
      asteroidSize: asteroid.sizeClass
    });
    return;
  }
}

export function createInitialState(spawnSchedule = createSpawnSchedule()) {
  return {
    tick: 0,
    finished: false,
    score: 0,
    kills: 0,
    hits: 0,
    shotsFired: 0,
    crashes: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    endReason: null,
    prevInputMask: 0,
    ship: createShipState(),
    bullets: [],
    asteroids: [],
    collisionGrid: Array.from({ length: COLLISION_GRID_SIZE }, () => []),
    spawnSchedule,
    spawnCursor: 0,
    nextAsteroidId: 1,
    events: []
  };
}

export function cloneSimulationState(state) {
  if (!state) {
    return createInitialState();
  }

  return {
    tick: state.tick,
    finished: Boolean(state.finished),
    score: Number(state.score ?? 0),
    kills: Number(state.kills ?? 0),
    hits: Number(state.hits ?? 0),
    shotsFired: Number(state.shotsFired ?? 0),
    crashes: Number(state.crashes ?? 0),
    combo: Number(state.combo ?? 0),
    comboTimer: Number(state.comboTimer ?? 0),
    maxCombo: Number(state.maxCombo ?? 0),
    endReason: state.endReason ?? null,
    prevInputMask: Number(state.prevInputMask ?? 0) & 0x1f,
    ship: {
      ...state.ship
    },
    bullets: Array.isArray(state.bullets) ? state.bullets.map((bullet) => ({ ...bullet })) : [],
    asteroids: Array.isArray(state.asteroids) ? state.asteroids.map((asteroid) => ({ ...asteroid })) : [],
    collisionGrid: Array.from(
      { length: Array.isArray(state.collisionGrid) ? state.collisionGrid.length : COLLISION_GRID_SIZE },
      () => []
    ),
    spawnSchedule: Array.isArray(state.spawnSchedule) ? state.spawnSchedule : createSpawnSchedule(),
    spawnCursor: Number(state.spawnCursor ?? 0),
    nextAsteroidId: Number(state.nextAsteroidId ?? 1),
    events: []
  };
}

export function stepSimulation(state, inputMask) {
  state.events = [];
  if (state.finished) {
    return state.events;
  }

  if (state.comboTimer > 0) {
    state.comboTimer -= 1;
    if (state.comboTimer === 0) {
      state.combo = 0;
    }
  }

  spawnScheduledAsteroids(state);
  tryShoot(state, inputMask);
  moveShip(state, inputMask);

  const bombPressed = (inputMask & INPUT_BOMB) !== 0;
  const bombPressedPrev = (state.prevInputMask & INPUT_BOMB) !== 0;
  if (bombPressed && !bombPressedPrev) {
    detonateBomb(state);
  }

  if (state.ship.cooldownTicks > 0) {
    state.ship.cooldownTicks -= 1;
  }
  if (state.ship.invulnTicks > 0) {
    state.ship.invulnTicks -= 1;
  }

  updateBullets(state);
  updateAsteroids(state);

  resolveBulletHits(state);
  resolveShipCollision(state);

  if (!state.finished) {
    state.tick += 1;
  }

  if (!state.finished && state.tick >= MAX_TICKS) {
    state.finished = true;
    state.endReason = 'time-up';
    state.events.push({ type: 'run-end', score: state.score });
  }

  state.prevInputMask = inputMask & 0x1f;

  return state.events;
}

export function summarizeRun(state) {
  return {
    score: state.score,
    kills: state.kills,
    crashes: state.crashes,
    shotsFired: state.shotsFired,
    hits: state.hits,
    accuracy: state.shotsFired > 0 ? state.hits / state.shotsFired : 0,
    maxCombo: state.maxCombo
  };
}

export function runReplay(inputFrames, spawnSchedule = createSpawnSchedule()) {
  const state = createInitialState(spawnSchedule);

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    const inputMask = tick < inputFrames.length ? inputFrames[tick] & 0x1f : 0;
    stepSimulation(state, inputMask);
  }

  return {
    state,
    summary: summarizeRun(state)
  };
}
