export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 640;

export const RUN_SECONDS = 60;
export const LEGACY_REFERENCE_TICK_RATE = 120;
export const TICK_RATE = 60;
export const FIXED_STEP_SECONDS = 1 / TICK_RATE;
export const MAX_TICKS = RUN_SECONDS * TICK_RATE;
export const GAME_VERSION = 'sim-60tick-v2';

export const GAMEPLAY_SEED = 0x5a17c9ef;

export function legacyTicksToCurrentTicks(legacyTicks) {
  return Math.round((legacyTicks * TICK_RATE) / LEGACY_REFERENCE_TICK_RATE);
}

export const INPUT_LEFT = 1 << 0;
export const INPUT_RIGHT = 1 << 1;
export const INPUT_THRUST = 1 << 2;
export const INPUT_SHOOT = 1 << 3;
export const INPUT_BOMB = 1 << 4;

export const SHIP_RADIUS = 14;
export const SHIP_ROTATE_SPEED = 3.9;
export const SHIP_THRUST_ACCEL = 460;
export const SHIP_DRAG_PER_TICK = 0.993 ** (LEGACY_REFERENCE_TICK_RATE / TICK_RATE);
export const SHIP_MAX_SPEED = 460;
export const SHIP_INVULN_TICKS = legacyTicksToCurrentTicks(96);

export const SHOT_COOLDOWN_TICKS = legacyTicksToCurrentTicks(10);
export const BULLET_SPEED = 720;
export const BULLET_LIFE_TICKS = legacyTicksToCurrentTicks(90);
export const BULLET_RADIUS = 2.5;

export const COMBO_WINDOW_TICKS = legacyTicksToCurrentTicks(150);
export const COMBO_STEP_BONUS = 0.1;
export const MAX_COMBO_BONUS = 1.8;

export const CLOSE_KILL_RANGE = 120;
export const CLOSE_KILL_BONUS_RATE = 1.8;

export const ASTEROID_TYPES = {
  tier1: {
    sizeClass: 1,
    radius: 14,
    baseScore: 100,
    hitPoints: 2,
    spawnSpeedBias: 76,
    deathSpawns: []
  },
  tier2: {
    sizeClass: 2,
    radius: 21,
    baseScore: 220,
    hitPoints: 4,
    spawnSpeedBias: 48,
    deathSpawns: [{ type: 'tier1', count: 4, spread: 2.8, speedScale: 1.18, speedBonus: 44 }]
  },
  tier3: {
    sizeClass: 3,
    radius: 31.5,
    baseScore: 460,
    hitPoints: 8,
    spawnSpeedBias: 20,
    deathSpawns: [{ type: 'tier2', count: 4, spread: 2.5, speedScale: 1.14, speedBonus: 36 }]
  },
  tier4: {
    sizeClass: 4,
    radius: 47.25,
    baseScore: 920,
    hitPoints: 16,
    spawnSpeedBias: -8,
    deathSpawns: [{ type: 'tier3', count: 4, spread: 2.2, speedScale: 1.1, speedBonus: 28 }]
  },
  tier5: {
    sizeClass: 5,
    radius: 70.875,
    baseScore: 1840,
    hitPoints: 32,
    spawnSpeedBias: -30,
    deathSpawns: [{ type: 'tier4', count: 4, spread: 1.9, speedScale: 1.06, speedBonus: 22 }]
  }
};
