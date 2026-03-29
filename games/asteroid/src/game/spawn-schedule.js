import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ASTEROID_TYPES,
  GAMEPLAY_SEED,
  LEGACY_REFERENCE_TICK_RATE,
  legacyTicksToCurrentTicks,
  MAX_TICKS
} from '../engine/constants.js';
import { chooseWeighted, createRng, randFloat, randInt } from '../engine/rng.js';

const PHASE_SECONDS = 10;

const LEGACY_PHASE_CONFIG = [
  {
    interval: 84,
    burstChance: 0.05,
    speed: 76,
    tierWeights: [0.62, 0.38, 0, 0, 0]
  },
  {
    interval: 72,
    burstChance: 0.08,
    speed: 90,
    tierWeights: [0.56, 0.44, 0, 0, 0]
  },
  {
    interval: 58,
    burstChance: 0.12,
    speed: 106,
    tierWeights: [0.44, 0.33, 0.23, 0, 0]
  },
  {
    interval: 46,
    burstChance: 0.18,
    speed: 124,
    tierWeights: [0.31, 0.31, 0.23, 0.15, 0]
  },
  {
    interval: 36,
    burstChance: 0.24,
    speed: 144,
    tierWeights: [0.22, 0.27, 0.24, 0.17, 0.1]
  },
  {
    interval: 28,
    burstChance: 0.32,
    speed: 166,
    tierWeights: [0.16, 0.22, 0.24, 0.2, 0.18]
  }
];

const ASTEROID_TIER_ORDER = ['tier1', 'tier2', 'tier3', 'tier4', 'tier5'];
const UNLOCK_TICK_TIER3 = 15 * LEGACY_REFERENCE_TICK_RATE;
const UNLOCK_TICK_TIER4 = 30 * LEGACY_REFERENCE_TICK_RATE;
// Temporarily freeze the 45s tier-5 spike while training a more stable endgame policy.
const UNLOCK_TICK_TIER5 = Number.POSITIVE_INFINITY;

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function toCurrentScheduleTick(legacyTick) {
  return Math.max(0, Math.min(MAX_TICKS - 1, legacyTicksToCurrentTicks(legacyTick)));
}

function getMaxUnlockedTier(legacyTick) {
  if (legacyTick >= UNLOCK_TICK_TIER5) {
    return 5;
  }
  if (legacyTick >= UNLOCK_TICK_TIER4) {
    return 4;
  }
  if (legacyTick >= UNLOCK_TICK_TIER3) {
    return 3;
  }
  return 2;
}

function chooseType(rng, phaseIndex, legacyTick) {
  const config = LEGACY_PHASE_CONFIG[phaseIndex];
  const maxTier = getMaxUnlockedTier(legacyTick);
  const weighted = [];

  for (let tierIndex = 0; tierIndex < maxTier; tierIndex += 1) {
    const weight = config.tierWeights[tierIndex] ?? 0;
    if (weight <= 0) {
      continue;
    }
    weighted.push({ value: ASTEROID_TIER_ORDER[tierIndex], weight });
  }

  if (weighted.length === 0) {
    return 'tier1';
  }
  return chooseWeighted(rng, weighted);
}

function createSpawnEvent(rng, phaseIndex, legacyTick, serial) {
  const config = LEGACY_PHASE_CONFIG[phaseIndex];
  const type = chooseType(rng, phaseIndex, legacyTick);
  const typeStats = ASTEROID_TYPES[type];
  const radius = typeStats.radius;
  const margin = radius + 8;

  const edge = randInt(rng, 0, 4);
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = randFloat(rng, 0, ARENA_WIDTH);
    y = -margin;
  } else if (edge === 1) {
    x = ARENA_WIDTH + margin;
    y = randFloat(rng, 0, ARENA_HEIGHT);
  } else if (edge === 2) {
    x = randFloat(rng, 0, ARENA_WIDTH);
    y = ARENA_HEIGHT + margin;
  } else {
    x = -margin;
    y = randFloat(rng, 0, ARENA_HEIGHT);
  }

  const targetX = ARENA_WIDTH * 0.5 + randFloat(rng, -180, 180);
  const targetY = ARENA_HEIGHT * 0.5 + randFloat(rng, -140, 140);

  const angle = Math.atan2(targetY - y, targetX - x) + randFloat(rng, -0.48, 0.48);
  const speed =
    config.speed +
    typeStats.spawnSpeedBias +
    randFloat(rng, -14, 14);

  return {
    tick: toCurrentScheduleTick(legacyTick),
    serial,
    type,
    x: round3(x),
    y: round3(y),
    vx: round3(Math.cos(angle) * speed),
    vy: round3(Math.sin(angle) * speed)
  };
}

export function createSpawnSchedule(seed = GAMEPLAY_SEED) {
  const rng = createRng(seed);
  const schedule = [];
  const phaseTickSpan = PHASE_SECONDS * LEGACY_REFERENCE_TICK_RATE;
  let serial = 0;

  for (let phaseIndex = 0; phaseIndex < LEGACY_PHASE_CONFIG.length; phaseIndex += 1) {
    const config = LEGACY_PHASE_CONFIG[phaseIndex];
    const phaseStart = phaseIndex * phaseTickSpan;
    const phaseEnd = phaseStart + phaseTickSpan;

    let legacyTick = phaseStart + 20;
    while (legacyTick < phaseEnd) {
      const spawnLegacyTick = Math.max(
        phaseStart,
        Math.min(phaseEnd - 1, legacyTick + randInt(rng, -6, 7))
      );

      schedule.push(createSpawnEvent(rng, phaseIndex, spawnLegacyTick, serial));
      serial += 1;

      if (randFloat(rng, 0, 1) < config.burstChance && spawnLegacyTick + 8 < phaseEnd) {
        const burstLegacyTick = Math.min(phaseEnd - 1, spawnLegacyTick + randInt(rng, 6, 13));
        schedule.push(createSpawnEvent(rng, phaseIndex, burstLegacyTick, serial));
        serial += 1;
      }

      legacyTick += config.interval + randInt(rng, -8, 9);
    }
  }

  schedule.sort((a, b) => a.tick - b.tick || a.serial - b.serial);
  return schedule;
}
