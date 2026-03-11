import { ENEMY_TYPES, PLAYER_BALANCE, WORLD, randomRange } from "./balance.js";
import { Explosion, Particle } from "./entities.js";

function clampIntensity(value) {
  return Math.max(0.6, Math.min(1, value));
}

function getEffectIntensity(game) {
  return clampIntensity(game.effectIntensity ?? 1);
}

function spawnParticles(target, x, y, options, intensity = 1) {
  const {
    count,
    palette,
    speedMin,
    speedMax,
    sizeMin,
    sizeMax,
    lifeMin,
    lifeMax,
    gravity = 120,
    drag = 0.92,
    glow = 0,
    yBias = 0,
  } = options;

  const scaledCount = Math.max(1, Math.round(count * clampIntensity(intensity)));

  for (let index = 0; index < scaledCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(speedMin, speedMax);
    const color = palette[index % palette.length];

    target.push(
      new Particle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + yBias,
        life: randomRange(lifeMin, lifeMax),
        size: randomRange(sizeMin, sizeMax),
        color,
        gravity,
        drag,
        glow,
      }),
    );
  }
}

export function addExplosion(game, options) {
  const explosion = new Explosion(options);
  game.explosions.push(explosion);
  game.screenShake = Math.min(14, game.screenShake + (options.secondary ? 2.4 : 4.4));
  return explosion;
}

export function addPlayerExplosion(game, x, y) {
  const comboId = game.allocateComboId();
  game.comboCounts.set(comboId, 0);
  const intensity = getEffectIntensity(game);

  addExplosion(game, {
    x,
    y,
    maxRadius: PLAYER_BALANCE.explosionRadius,
    coreColor: PLAYER_BALANCE.explosionColor,
    edgeColor: PLAYER_BALANCE.explosionEdge,
    comboId,
    chainDepth: 0,
    secondary: false,
    damaging: true,
  });

  spawnParticles(game.particles, x, y, {
    count: 26,
    palette: ["#ffffff", "#7ef8ff", "#60d5ff", "#bdfdff"],
    speedMin: 50,
    speedMax: 240,
    sizeMin: 2,
    sizeMax: 6,
    lifeMin: 0.22,
    lifeMax: 0.65,
    gravity: 84,
    drag: 0.93,
    glow: 10,
  }, intensity);
}

export function addSecondaryExplosion(game, missile, comboId, chainDepth) {
  const intensity = getEffectIntensity(game);

  addExplosion(game, {
    x: missile.x,
    y: missile.y,
    maxRadius: missile.definition.secondaryRadius,
    coreColor: missile.definition.color,
    edgeColor: missile.definition.edgeColor,
    comboId,
    chainDepth,
    secondary: true,
    damaging: true,
  });

  spawnParticles(game.particles, missile.x, missile.y, {
    count: 18,
    palette: [
      missile.definition.edgeColor,
      missile.definition.color,
      "#ffffff",
      missile.definition.color,
    ],
    speedMin: 40,
    speedMax: 220,
    sizeMin: 2,
    sizeMax: 5,
    lifeMin: 0.16,
    lifeMax: 0.54,
    gravity: 72,
    drag: 0.94,
    glow: 8,
  }, intensity);
}

export function addArmorSparks(game, x, y) {
  spawnParticles(game.particles, x, y, {
    count: 12,
    palette: ["#fff7cb", "#ffd36c", "#ffad49"],
    speedMin: 60,
    speedMax: 260,
    sizeMin: 1.8,
    sizeMax: 4.6,
    lifeMin: 0.14,
    lifeMax: 0.4,
    gravity: 110,
    drag: 0.9,
    glow: 6,
  }, getEffectIntensity(game));
}

export function addSplitFlash(game, x, y) {
  const intensity = getEffectIntensity(game);

  addExplosion(game, {
    x,
    y,
    maxRadius: 42,
    coreColor: "#78f0ff",
    edgeColor: "#d5ffff",
    damaging: false,
    secondary: true,
  });

  spawnParticles(game.particles, x, y, {
    count: 14,
    palette: ["#78f0ff", "#d5ffff", "#ffffff"],
    speedMin: 32,
    speedMax: 160,
    sizeMin: 2,
    sizeMax: 4.8,
    lifeMin: 0.18,
    lifeMax: 0.44,
    gravity: 52,
    drag: 0.94,
    glow: 8,
  }, intensity);
}

export function addGroundImpact(game, x, y) {
  const intensity = getEffectIntensity(game);

  addExplosion(game, {
    x,
    y,
    maxRadius: 54,
    coreColor: "#ff986e",
    edgeColor: "#ffd2a8",
    damaging: false,
    secondary: true,
  });

  spawnParticles(game.particles, x, y, {
    count: 22,
    palette: ["#ffb27a", "#d97d59", "#f6d5aa", "#8e5d42"],
    speedMin: 40,
    speedMax: 220,
    sizeMin: 2,
    sizeMax: 6.4,
    lifeMin: 0.22,
    lifeMax: 0.72,
    gravity: 150,
    drag: 0.9,
    glow: 4,
    yBias: -24,
  }, intensity);
}

export function addBarrierIntercept(game, x, y, missileType = "normal") {
  const definition = ENEMY_TYPES[missileType] ?? ENEMY_TYPES.normal;
  const intensity = getEffectIntensity(game);

  addExplosion(game, {
    x,
    y,
    maxRadius: 34,
    coreColor: "#9ffcff",
    edgeColor: definition.edgeColor,
    damaging: false,
    secondary: true,
  });

  spawnParticles(game.particles, x, y, {
    count: 20,
    palette: ["#ffffff", "#9ffcff", definition.edgeColor, definition.color],
    speedMin: 36,
    speedMax: 220,
    sizeMin: 1.8,
    sizeMax: 5.4,
    lifeMin: 0.18,
    lifeMax: 0.56,
    gravity: 34,
    drag: 0.93,
    glow: 8,
    yBias: -18,
  }, intensity);
}

export function addBarrierDeployWave(game) {
  const intensity = getEffectIntensity(game);
  const segments = Math.max(10, Math.round(16 * intensity));

  for (let index = 0; index < segments; index += 1) {
    const ratio = segments <= 1 ? 0.5 : index / (segments - 1);
    const x = WORLD.width * (0.08 + ratio * 0.84);
    const y =
      typeof game.getBarrierSurfaceY === "function" ? game.getBarrierSurfaceY(x) : WORLD.groundY - 180;

    spawnParticles(game.particles, x, y, {
      count: 2,
      palette: ["#ffffff", "#9ffcff", "#7ef8ff", "#60d5ff"],
      speedMin: 18,
      speedMax: 96,
      sizeMin: 1.8,
      sizeMax: 4.2,
      lifeMin: 0.2,
      lifeMax: 0.5,
      gravity: 24,
      drag: 0.94,
      glow: 10,
      yBias: -26,
    }, intensity);
  }
}

export function addReplayBarrierInterceptBurst(game, x, y, missileType = "normal") {
  const definition = ENEMY_TYPES[missileType] ?? ENEMY_TYPES.normal;

  spawnParticles(game.particles, x, y, {
    count: 14,
    palette: ["#ffffff", "#9ffcff", definition.edgeColor, definition.color],
    speedMin: 32,
    speedMax: 180,
    sizeMin: 1.8,
    sizeMax: 4.6,
    lifeMin: 0.16,
    lifeMax: 0.46,
    gravity: 28,
    drag: 0.93,
    glow: 7,
    yBias: -14,
  }, getEffectIntensity(game));
}

export function addCityCollapse(game, city) {
  spawnParticles(game.particles, city.x, city.top + 8, {
    count: 28,
    palette: ["#ffad78", "#ffe1ac", "#c66f48", "#8b4d38"],
    speedMin: 50,
    speedMax: 240,
    sizeMin: 2,
    sizeMax: 7,
    lifeMin: 0.26,
    lifeMax: 0.9,
    gravity: 180,
    drag: 0.88,
    glow: 6,
    yBias: -40,
  }, getEffectIntensity(game));
}

export function addCelebrationFirework(game, x, y) {
  const paletteIndex = Math.floor(Math.random() * 4);
  const palettes = [
    ["#ffffff", "#7ef8ff", "#60d5ff"],
    ["#ffffff", "#ffd36c", "#ff9c43"],
    ["#ffffff", "#9effb0", "#52db92"],
    ["#ffffff", "#ff8d6a", "#ff6d6d"],
  ];
  const palette = palettes[paletteIndex];
  const intensity = getEffectIntensity(game);

  addExplosion(game, {
    x,
    y,
    maxRadius: randomRange(58, 88),
    coreColor: palette[1],
    edgeColor: palette[2],
    damaging: false,
    secondary: false,
  });

  spawnParticles(game.particles, x, y, {
    count: 30,
    palette,
    speedMin: 55,
    speedMax: 250,
    sizeMin: 2,
    sizeMax: 6,
    lifeMin: 0.22,
    lifeMax: 0.7,
    gravity: 66,
    drag: 0.94,
    glow: 10,
  }, intensity);
}

export function addAmbientEmbers(game) {
  const x = randomRange(40, WORLD.width - 40);
  const y = randomRange(WORLD.groundY + 18, WORLD.height - 24);
  const palette = ["#ffd8af", "#ffb07f", "#ff8b6f"];

  spawnParticles(game.particles, x, y, {
    count: 4,
    palette,
    speedMin: 8,
    speedMax: 24,
    sizeMin: 1.4,
    sizeMax: 3.2,
    lifeMin: 0.45,
    lifeMax: 0.9,
    gravity: -18,
    drag: 0.97,
    glow: 3,
    yBias: -18,
  }, getEffectIntensity(game));
}

export function getScoreGain(type, chainCount) {
  const base = ENEMY_TYPES[type].score;
  const multiplier = 1 + Math.min(1.8, (chainCount - 1) * 0.18);
  return Math.round(base * multiplier);
}
