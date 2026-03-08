import { BARRIER_BALANCE, BATTERY, WORLD, clamp } from "./balance.js";

export const REPLAY_VERSION = "orbital-shield-replay-v2";
export const REPLAY_CAPTURE_TICK_RATE = 60;
export const REPLAY_CAPTURE_INTERVAL = 1 / REPLAY_CAPTURE_TICK_RATE;
export const REPLAY_EXTRA_SECONDS =
  BARRIER_BALANCE.deployDuration + BARRIER_BALANCE.sustainDuration + 2.4;
export const REPLAY_MAX_DURATION = WORLD.gameDuration + REPLAY_EXTRA_SECONDS;
export const REPLAY_MAX_FRAMES = Math.ceil(REPLAY_MAX_DURATION * REPLAY_CAPTURE_TICK_RATE);

const MAX_REPLAY_CITIES = WORLD.cityCount;
const MAX_REPLAY_MISSILES = 36;
const MAX_REPLAY_INTERCEPTORS = 18;
const MAX_REPLAY_EXPLOSIONS = 20;
const MAX_REPLAY_EVENTS = 16;
const REPLAY_EVENT_TYPES = new Set([
  "launch",
  "player-explosion",
  "enemy-destroyed",
  "armor-hit",
  "split",
  "city-lost",
  "barrier-deploy",
  "barrier-intercept",
  "result",
]);

function roundNumber(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function roundPosition(value, max) {
  return roundNumber(clamp(Number(value) || 0, -120, max + 120), 1);
}

function roundUnit(value) {
  return roundNumber(clamp(Number(value) || 0, 0, 1), 3);
}

function snapshotCities(game) {
  return game.cities.slice(0, MAX_REPLAY_CITIES).map((city) => ({
    id: city.id,
    index: city.index,
    x: roundPosition(city.x, WORLD.width),
    y: roundPosition(city.y, WORLD.height),
    width: roundNumber(city.width, 1),
    height: roundNumber(city.height, 1),
    alive: Boolean(city.alive),
    flash: roundUnit(city.flash ?? 0),
    ruinHeat: roundUnit(city.ruinHeat ?? 0),
  }));
}

function snapshotMissiles(game) {
  return game.enemyMissiles.slice(0, MAX_REPLAY_MISSILES).map((missile) => ({
    id: missile.id,
    type: missile.type,
    x: roundPosition(missile.x, WORLD.width),
    y: roundPosition(missile.y, WORLD.height),
    vx: roundNumber(missile.vx ?? 0, 4),
    vy: roundNumber(missile.vy ?? 0, 4),
    targetX: roundPosition(missile.targetX, WORLD.width),
    targetY: roundPosition(missile.targetY, WORLD.height),
    targetCityId: Number.isInteger(missile.targetCityId) ? missile.targetCityId : null,
    radius: roundNumber(missile.radius ?? 0, 1),
    hitPoints: Math.max(0, Math.round(Number(missile.hitPoints) || 0)),
    armorBreakFlash: roundUnit(missile.armorBreakFlash ?? 0),
  }));
}

function snapshotInterceptors(game) {
  return game.interceptors.slice(0, MAX_REPLAY_INTERCEPTORS).map((interceptor) => ({
    id: interceptor.id,
    originX: roundPosition(interceptor.originX ?? BATTERY.x, WORLD.width),
    originY: roundPosition(interceptor.originY ?? BATTERY.y, WORLD.height),
    currentX: roundPosition(interceptor.currentX ?? interceptor.targetX, WORLD.width),
    currentY: roundPosition(interceptor.currentY ?? interceptor.targetY, WORLD.height),
  }));
}

function snapshotExplosions(game) {
  return game.explosions.slice(0, MAX_REPLAY_EXPLOSIONS).map((explosion) => ({
    id: explosion.id,
    x: roundPosition(explosion.x, WORLD.width),
    y: roundPosition(explosion.y, WORLD.height),
    currentRadius: roundNumber(Math.max(0, explosion.currentRadius ?? 0), 1),
    alpha: roundUnit(explosion.alpha ?? 0),
    ringRadius: roundNumber(Math.max(0, explosion.ringRadius ?? 0), 1),
    secondary: Boolean(explosion.secondary),
    coreColor: String(explosion.coreColor ?? "#7ef8ff"),
    edgeColor: String(explosion.edgeColor ?? "#60d5ff"),
  }));
}

function getReplayElapsed(game) {
  if (typeof game.getReplayElapsed === "function") {
    return Math.max(0, Number(game.getReplayElapsed()) || 0);
  }

  return Math.max(0, Number(game.elapsed) || 0);
}

function snapshotBarrier(game) {
  return {
    active: Boolean(game.barrier?.active),
    elapsed: roundNumber(Math.max(0, Number(game.barrier?.elapsed) || 0), 3),
    progress: roundUnit(game.barrier?.progress ?? 0),
  };
}

function sanitizeReplayEvent(event) {
  const type = String(event?.type ?? "").trim();
  if (!REPLAY_EVENT_TYPES.has(type)) {
    return null;
  }

  const replayEvent = { type };
  if (Number.isFinite(event?.x)) {
    replayEvent.x = roundPosition(event.x, WORLD.width);
  }
  if (Number.isFinite(event?.y)) {
    replayEvent.y = roundPosition(event.y, WORLD.height);
  }
  if (Number.isFinite(event?.cityId)) {
    replayEvent.cityId = Math.max(1, Math.round(Number(event.cityId)));
  }
  if (type === "enemy-destroyed" || type === "barrier-intercept") {
    const missileType = String(event?.missileType ?? "").trim();
    replayEvent.missileType =
      missileType === "split" || missileType === "fast" || missileType === "armored"
        ? missileType
        : "normal";
  }
  if (type === "enemy-destroyed") {
    replayEvent.chainCount = Math.max(1, Math.round(Number(event?.chainCount) || 1));
  }
  if (type === "result") {
    replayEvent.result = event?.result === "gameover" ? "gameover" : "clear";
  }

  return replayEvent;
}

function snapshotEvents(game, eventsOverride = null) {
  const sourceEvents =
    eventsOverride !== null
      ? eventsOverride
      : typeof game.consumeReplayFrameEvents === "function"
        ? game.consumeReplayFrameEvents()
        : [];

  return sourceEvents
    .map((event) => sanitizeReplayEvent(event))
    .filter(Boolean)
    .slice(0, MAX_REPLAY_EVENTS);
}

function buildFrame(game, elapsedOverride = null, eventsOverride = null) {
  return {
    elapsed: roundNumber(
      elapsedOverride === null ? getReplayElapsed(game) : elapsedOverride,
      4,
    ),
    score: Math.max(0, Math.round(Number(game.score) || 0)),
    maxChain: Math.max(0, Math.round(Number(game.maxChain) || 0)),
    cities: snapshotCities(game),
    enemyMissiles: snapshotMissiles(game),
    interceptors: snapshotInterceptors(game),
    explosions: snapshotExplosions(game),
    barrier: snapshotBarrier(game),
    events: snapshotEvents(game, eventsOverride),
  };
}

function cloneFrame(frame) {
  return {
    elapsed: frame.elapsed,
    score: frame.score,
    maxChain: frame.maxChain,
    cities: frame.cities.map((city) => ({ ...city })),
    enemyMissiles: frame.enemyMissiles.map((missile) => ({ ...missile })),
    interceptors: frame.interceptors.map((interceptor) => ({ ...interceptor })),
    explosions: frame.explosions.map((explosion) => ({ ...explosion })),
    barrier: { ...(frame.barrier ?? { active: false, elapsed: 0, progress: 0 }) },
    events: Array.isArray(frame.events) ? frame.events.map((event) => ({ ...event })) : [],
  };
}

function summarizeReplay(game, result) {
  const survivingCities = game.cities.filter((city) => city.alive).length;
  return {
    score: Math.max(0, Math.round(Number(game.score) || 0)),
    maxChain: Math.max(0, Math.round(Number(game.maxChain) || 0)),
    survivingCities,
    clear: result === "clear",
    duration: roundNumber(getReplayElapsed(game), 2),
  };
}

function sanitizeLabel(value, fallback) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? Array.from(normalized).slice(0, 32).join("") : fallback;
}

export class ReplayRecorder {
  constructor({ captureInterval = REPLAY_CAPTURE_INTERVAL } = {}) {
    this.captureInterval = Math.max(
      1 / REPLAY_CAPTURE_TICK_RATE,
      Math.min(0.2, Number(captureInterval) || REPLAY_CAPTURE_INTERVAL),
    );
    this.tickRate = Math.round(1 / this.captureInterval);
    this.clear();
  }

  clear() {
    this.active = false;
    this.nextFrameIndex = 0;
    this.frames = [];
    this.meta = null;
  }

  start(game, meta = {}) {
    this.active = true;
    this.nextFrameIndex = 0;
    this.frames = [];
    this.meta = {
      kind: meta.kind === "ai" ? "ai" : "human",
      name: sanitizeLabel(meta.name, meta.kind === "ai" ? "DEMO AI" : "PILOT"),
      policyName: sanitizeLabel(meta.policyName, ""),
      note: sanitizeLabel(meta.note, ""),
      source: sanitizeLabel(meta.source, ""),
      gameVersion: sanitizeLabel(meta.gameVersion, "orbital-shield-rl-poc-v3"),
      startedAt: new Date().toISOString(),
    };
    this.captureAtFrame(game, this.nextFrameIndex);
    this.nextFrameIndex += 1;
  }

  update(game) {
    if (!this.active) {
      return;
    }

    if (this.nextFrameIndex >= REPLAY_MAX_FRAMES) {
      return;
    }

    this.captureAtFrame(game, this.nextFrameIndex);
    this.nextFrameIndex += 1;
  }

  captureAtFrame(game, frameIndex) {
    this.frames.push(buildFrame(game, frameIndex * this.captureInterval));
  }

  finish(game, result) {
    if (!this.active) {
      return null;
    }

    const replayElapsed = getReplayElapsed(game);
    const pendingEvents =
      typeof game.consumeReplayFrameEvents === "function" ? game.consumeReplayFrameEvents() : [];
    if (pendingEvents.length > 0) {
      const eventFrame = buildFrame(game, replayElapsed, pendingEvents);
      const lastFrame = this.frames[this.frames.length - 1] ?? null;
      if (!lastFrame || Math.abs((lastFrame.elapsed ?? 0) - replayElapsed) > 0.0005) {
        this.frames.push(eventFrame);
      } else {
        this.frames[this.frames.length - 1] = {
          ...eventFrame,
          events: [...(lastFrame.events ?? []), ...eventFrame.events].slice(0, MAX_REPLAY_EVENTS),
        };
      }
    }
    const replay = {
      version: REPLAY_VERSION,
      captureIntervalMs: Math.round(this.captureInterval * 1000),
      recordedAt: new Date().toISOString(),
      meta: { ...this.meta },
      summary: summarizeReplay(game, result),
      frames: this.frames.map((frame) => cloneFrame(frame)),
    };

    this.clear();
    return replay;
  }
}

export class ReplayPlayer {
  constructor(replay) {
    this.replay = replay ?? null;
    this.frames = Array.isArray(replay?.frames) ? replay.frames.map((frame) => cloneFrame(frame)) : [];
    this.summary = replay?.summary ?? {};
    this.meta = replay?.meta ?? {};
    this.duration = Math.max(
      0,
      Number(this.summary?.duration) || (this.frames[this.frames.length - 1]?.elapsed ?? 0),
    );
    this.reset();
  }

  reset() {
    this.elapsed = this.frames[0]?.elapsed ?? 0;
    this.frameIndex = 0;
  }

  hasFrames() {
    return this.frames.length > 0;
  }

  getCurrentFrame() {
    return this.hasFrames() ? this.frames[this.frameIndex] : null;
  }

  advance() {
    if (!this.hasFrames()) {
      return true;
    }

    if (this.frameIndex < this.frames.length - 1) {
      this.frameIndex += 1;
      this.elapsed = this.frames[this.frameIndex]?.elapsed ?? this.elapsed;
    }

    return this.frameIndex >= this.frames.length - 1;
  }

  apply(game) {
    if (!this.hasFrames()) {
      game.elapsed = 0;
      game.score = 0;
      game.maxChain = 0;
      game.cities = [];
      game.enemyMissiles = [];
      game.interceptors = [];
      game.explosions = [];
      game.particles = [];
      return;
    }

    const frame = this.frames[this.frameIndex];
    game.elapsed = frame.elapsed;
    game.score = frame.score;
    game.maxChain = frame.maxChain;
    game.screenShake = 0;
    game.cities = frame.cities.map((city) => ({ ...city }));
    game.enemyMissiles = frame.enemyMissiles.map((missile) => ({ ...missile }));
    game.interceptors = frame.interceptors.map((interceptor) => ({ ...interceptor }));
    game.explosions = frame.explosions.map((explosion) => ({ ...explosion }));
    game.barrier = { ...(frame.barrier ?? { active: false, elapsed: 0, progress: 0, stormAccumulator: 0 }) };
    game.replayFrameEvents = Array.isArray(frame.events) ? frame.events.map((event) => ({ ...event })) : [];
    game.particles = [];
  }
}
