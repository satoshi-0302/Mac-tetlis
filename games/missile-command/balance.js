export const WORLD = Object.freeze({
  width: 1280,
  height: 720,
  groundY: 620,
  cityCount: 4,
  gameDuration: 60,
  interceptorTravelTime: 0.25,
});

export const STORAGE_KEYS = Object.freeze({
  highScore: "orbital-shield-60-high-score-v3",
  playerName: "orbital-shield-60-player-name",
  playerComment: "orbital-shield-60-player-comment",
});

export const BATTERY = Object.freeze({
  x: WORLD.width / 2,
  y: WORLD.groundY + 18,
  barrelHeight: 34,
});

export const CITY_LAYOUT = Object.freeze([
  Object.freeze({ x: 180, width: 110, height: 52 }),
  Object.freeze({ x: 430, width: 116, height: 56 }),
  Object.freeze({ x: 850, width: 116, height: 54 }),
  Object.freeze({ x: 1100, width: 110, height: 52 }),
]);

export const PLAYER_BALANCE = Object.freeze({
  explosionRadius: 82,
  explosionColor: "#7ef8ff",
  explosionEdge: "#60d5ff",
});

export const AI_BALANCE = Object.freeze({
  shotsPerSecond: 3,
  cooldownSeconds: 1 / 3,
});

export const BARRIER_BALANCE = Object.freeze({
  countdownStart: 10,
  deployDuration: 1.5,
  sustainDuration: 4.2,
  blockStartProgress: 0.14,
  postDeploySpawnRate: 5.2,
  stormBurstChance: 0.52,
  maxStormMissiles: 14,
  edgeY: WORLD.groundY - 18,
  apexLift: 228,
  revealGlow: 1.15,
});

export const CLEAR_SURVIVAL_BONUS = Object.freeze({
  0: 0,
  1: 0,
  2: 1000,
  3: 3000,
  4: 5000,
});

export const ENEMY_TYPES = Object.freeze({
  normal: Object.freeze({
    label: "NORMAL",
    score: 100,
    speedMin: 125,
    speedMax: 175,
    secondaryRadius: 68,
    radius: 7,
    armor: 1,
    color: "#ff6d6d",
    edgeColor: "#ffc4b0",
  }),
  split: Object.freeze({
    label: "SPLIT",
    score: 180,
    speedMin: 105,
    speedMax: 145,
    secondaryRadius: 74,
    radius: 8,
    armor: 1,
    color: "#78f0ff",
    edgeColor: "#c4fdff",
  }),
  fast: Object.freeze({
    label: "FAST",
    score: 150,
    speedMin: 210,
    speedMax: 300,
    secondaryRadius: 62,
    radius: 6,
    armor: 1,
    color: "#ff9c43",
    edgeColor: "#ffd28f",
  }),
  armored: Object.freeze({
    label: "ARMORED",
    score: 260,
    speedMin: 115,
    speedMax: 160,
    secondaryRadius: 88,
    radius: 10,
    armor: 2,
    color: "#ffd36c",
    edgeColor: "#fff1a8",
  }),
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function randomRange(min, max, rng = Math.random) {
  return min + (max - min) * rng();
}

export function pickWeighted(weights, rng = Math.random) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);

  if (total <= 0) {
    return "normal";
  }

  let roll = rng() * total;

  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      return key;
    }
  }

  return entries[entries.length - 1][0];
}

export function getEnemyWeights(progress) {
  const ratio = clamp(progress, 0, 1);

  return {
    normal: 1.65 - ratio * 0.9,
    split: 0.22 + ratio * 0.9,
    fast: 0.18 + ratio * 1.15,
    armored: Math.max(0, ratio * 1.25 - 0.28),
  };
}

export function pickEnemyType(progress, rng = Math.random) {
  return pickWeighted(getEnemyWeights(progress), rng);
}

export function getEnemySpeed(type, rng = Math.random) {
  const definition = ENEMY_TYPES[type];
  return randomRange(definition.speedMin, definition.speedMax, rng);
}

export function getSpawnRate(elapsedSeconds) {
  const ratio = clamp(elapsedSeconds / WORLD.gameDuration, 0, 1);
  return 1.56 + 2.87 * Math.pow(ratio, 1.28);
}

export function getBurstChance(elapsedSeconds) {
  const ratio = clamp(elapsedSeconds / WORLD.gameDuration, 0, 1);
  return 0.105 + ratio * 0.26;
}

export function getClearCityBonus(aliveCities) {
  const key = Math.max(0, Math.min(WORLD.cityCount, Math.round(Number(aliveCities) || 0)));
  return CLEAR_SURVIVAL_BONUS[key] ?? 0;
}
