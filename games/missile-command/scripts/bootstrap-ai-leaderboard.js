import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BARRIER_BALANCE, BATTERY, PLAYER_BALANCE, WORLD, lerp } from "../balance.js";
import { DEFAULT_EDGE_PREDICTION_CONFIG, createEdgePredictionDemoAgent } from "../rl/demo-agent.js";
import { REPLAY_CAPTURE_INTERVAL, REPLAY_VERSION } from "../replay.js";
import { readLeaderboard, writeLeaderboard } from "../server/leaderboard-store.js";
import { pruneReplayFiles, writeReplay } from "../server/replay-store.js";
import { createInitialState, getSnapshot, stepSimulation, SIM_MAX_TICKS } from "../sim/core.js";
import { createRng } from "../sim/rng.js";

const ROOT_DIR = process.cwd();
const LEADERBOARD_PATH = join(ROOT_DIR, "data", "leaderboard.json");
const REPLAY_DIR = join(ROOT_DIR, "data", "replays");
const OUTPUT_DIR = join(ROOT_DIR, "output");
const SUMMARY_PATH = join(OUTPUT_DIR, "bootstrap-ai-leaderboard-summary.json");
const SAMPLE_SIZE = 1000;
const TOP_COUNT = 10;
const BASE_CREATED_AT = Date.UTC(2026, 2, 8, 5, 0, 0);
const GAME_VERSION = "orbital-shield-rl-poc-v3";

function round(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function formatSeed(seed) {
  return `0x${(seed >>> 0).toString(16).padStart(8, "0")}`;
}

function createSeeds(count) {
  return Array.from({ length: count }, (_, index) => ((0x9e3779b9 * (index + 1)) >>> 0));
}

function createAgent() {
  return createEdgePredictionDemoAgent({
    ...DEFAULT_EDGE_PREDICTION_CONFIG,
    policyName: "Edge Prediction",
  });
}

function buildBaseFrame(state, elapsed, scoreOverride = null, barrierOverride = null, events = []) {
  const originX = BATTERY.x;
  const originY = BATTERY.y - BATTERY.barrelHeight;
  return {
    elapsed: round(elapsed, 4),
    score: Math.max(0, Math.round(scoreOverride ?? state.score ?? 0)),
    maxChain: Math.max(0, Math.round(state.maxChain ?? 0)),
    cities: state.cities.map((city) => ({
      id: city.id,
      index: city.index,
      x: round(city.x, 1),
      y: round(city.y, 1),
      width: round(city.width, 1),
      height: round(city.height, 1),
      alive: Boolean(city.alive),
      flash: 0,
      ruinHeat: city.alive ? 0 : 0.2,
    })),
    enemyMissiles: state.enemyMissiles.map((missile) => ({
      id: missile.id,
      type: missile.type,
      x: round(missile.x, 1),
      y: round(missile.y, 1),
      vx: round(missile.dirX ?? 0, 4),
      vy: round(missile.dirY ?? 0, 4),
      targetX: round(missile.targetX, 1),
      targetY: round(missile.targetY, 1),
      targetCityId: Number.isInteger(missile.targetCityId) ? missile.targetCityId : null,
      radius: round(missile.radius, 1),
      hitPoints: Math.max(0, Math.round(missile.hitPoints ?? 0)),
      armorBreakFlash: 0,
    })),
    interceptors: state.interceptors.map((interceptor) => {
      const linear = Math.max(0, Math.min(1, interceptor.elapsedTicks / interceptor.totalTicks));
      const eased = 1 - Math.pow(1 - linear, 3);
      return {
        id: interceptor.id,
        originX: round(originX, 1),
        originY: round(originY, 1),
        currentX: round(lerp(originX, interceptor.targetX, eased), 1),
        currentY: round(lerp(originY, interceptor.targetY, eased), 1),
      };
    }),
    explosions: state.explosions.map((explosion) => ({
      id: explosion.id,
      x: round(explosion.x, 1),
      y: round(explosion.y, 1),
      currentRadius: round(explosion.currentRadius, 1),
      alpha: round(explosion.alpha, 3),
      ringRadius: round(explosion.currentRadius * (explosion.secondary ? 1.12 : 1.08), 1),
      secondary: Boolean(explosion.secondary),
      coreColor: explosion.secondary ? "#ff9c43" : PLAYER_BALANCE.explosionColor,
      edgeColor: explosion.secondary ? "#ffd28f" : PLAYER_BALANCE.explosionEdge,
    })),
    barrier: barrierOverride ?? {
      active: false,
      elapsed: 0,
      progress: 0,
    },
    events,
  };
}

function getBarrierSurfaceY(x) {
  const centerX = WORLD.width * 0.5;
  const radiusX = WORLD.width * 0.5;
  const normalized = Math.max(-1, Math.min(1, (x - centerX) / radiusX));
  const dome = Math.sqrt(Math.max(0, 1 - normalized * normalized));
  const softenedDome = Math.pow(dome, 1.06);
  return BARRIER_BALANCE.edgeY - softenedDome * BARRIER_BALANCE.apexLift;
}

function buildBarrierStormMissiles(seed, totalFrames) {
  const rng = createRng((seed ^ 0x5f3759df) >>> 0);
  const missiles = [];
  const cutoffFrame = Math.max(18, totalFrames - 30);
  const typeCycle = ["normal", "fast", "split", "armored"];
  let nextId = 9000;

  for (let frame = 6; frame < cutoffFrame; ) {
    const waveInterval = Math.max(3, Math.round(rng.nextRange(4, 9)));
    const volleyCount = rng.nextFloat() < 0.34 ? 2 : 1;

    for (let slot = 0; slot < volleyCount; slot += 1) {
      const startX = rng.nextRange(56, WORLD.width - 56);
      const targetX = Math.max(72, Math.min(WORLD.width - 72, startX + rng.nextRange(-140, 140)));
      const targetY = getBarrierSurfaceY(targetX);
      const startY = -rng.nextRange(56, 176) - slot * rng.nextRange(10, 26);
      const travelFrames = Math.max(14, Math.round(rng.nextRange(16, 30)));
      const impactFrame = Math.min(totalFrames - 3, frame + travelFrames);
      const dx = targetX - startX;
      const dy = targetY - startY;
      const distance = Math.hypot(dx, dy) || 1;
      const type = typeCycle[Math.floor(rng.nextFloat() * typeCycle.length)];

      missiles.push({
        id: nextId,
        type,
        startFrame: frame,
        impactFrame,
        startX,
        startY,
        targetX,
        targetY,
        vx: round(dx / distance, 4),
        vy: round(dy / distance, 4),
        radius: type === "armored" ? 9 : type === "fast" ? 6 : type === "split" ? 8 : 7,
        hitPoints: type === "armored" ? 2 : 1,
      });
      nextId += 1;
    }

    frame += waveInterval;
  }

  return missiles;
}

function appendBarrierSequence(frames, run) {
  if (!run.clear || run.aliveCities <= 0) {
    return frames;
  }

  const barrierFrames = Math.round((BARRIER_BALANCE.deployDuration + BARRIER_BALANCE.sustainDuration) / REPLAY_CAPTURE_INTERVAL);
  const baseState = run.finalState;
  const baseScore = run.score;
  const stormMissiles = buildBarrierStormMissiles(run.seed, barrierFrames);

  for (let index = 1; index <= barrierFrames; index += 1) {
    const barrierElapsed = index * REPLAY_CAPTURE_INTERVAL;
    const barrierProgress = Math.max(0, Math.min(1, barrierElapsed / BARRIER_BALANCE.deployDuration));
    const elapsed = WORLD.gameDuration + barrierElapsed;
    const events = [];
    const explosions = [];
    const missiles = [];

    if (index === 1) {
      events.push({ type: "barrier-deploy" });
    }

    for (const missile of stormMissiles) {
      if (index < missile.startFrame || index > missile.impactFrame) {
        continue;
      }

      const travelFrames = Math.max(1, missile.impactFrame - missile.startFrame);
      const phase = Math.max(0, Math.min(1, (index - missile.startFrame) / travelFrames));
      const x = lerp(missile.startX, missile.targetX, phase);
      const y = lerp(missile.startY, missile.targetY, phase);
      missiles.push({
        id: missile.id,
        type: missile.type,
        x: round(x, 1),
        y: round(y, 1),
        vx: missile.vx,
        vy: missile.vy,
        targetX: round(missile.targetX, 1),
        targetY: round(missile.targetY, 1),
        targetCityId: null,
        radius: missile.radius,
        hitPoints: missile.hitPoints,
        armorBreakFlash: 0,
      });

      if (index === missile.impactFrame) {
        explosions.push({
          id: 14000 + missile.id,
          x: round(missile.targetX, 1),
          y: round(missile.targetY, 1),
          currentRadius: 26,
          alpha: 0.82,
          ringRadius: 31,
          secondary: true,
          coreColor: "#9ffcff",
          edgeColor: "#60d5ff",
        });
        events.push({
          type: "barrier-intercept",
          x: round(missile.targetX, 1),
          y: round(missile.targetY, 1),
          missileType: missile.type,
        });
      }
    }

    if (index === barrierFrames) {
      events.push({ type: "result", result: "clear" });
    }

    frames.push({
      ...buildBaseFrame(
        {
          ...baseState,
          enemyMissiles: [],
          interceptors: [],
          explosions: [],
        },
        elapsed,
        baseScore,
        {
          active: true,
          elapsed: round(barrierElapsed, 3),
          progress: round(barrierProgress, 3),
        },
        events,
      ),
      enemyMissiles: missiles,
      explosions,
    });
  }

  return frames;
}

function runSeed(seed, { captureReplay = false } = {}) {
  const agent = createAgent();
  const state = createInitialState({ seed });
  const frames = captureReplay ? [buildBaseFrame(state, 0)] : null;

  agent.reset();

  while (state.tick < SIM_MAX_TICKS && !state.result) {
    const snapshot = getSnapshot(state);
    const action = agent.nextAction(snapshot);
    const result = stepSimulation(state, action);

    if (captureReplay) {
      frames.push(
        buildBaseFrame(
          state,
          state.tick * state.stepSeconds,
          state.score,
          null,
          Array.isArray(result.events) ? result.events : [],
        ),
      );
    }
  }

  const summary = {
    seed,
    score: state.score,
    maxChain: state.maxChain,
    aliveCities: state.cities.filter((city) => city.alive).length,
    clear: state.result === "clear",
    finalState: {
      cities: state.cities.map((city) => ({ ...city })),
      enemyMissiles: [],
      interceptors: [],
      explosions: [],
      maxChain: state.maxChain,
      score: state.score,
    },
  };

  if (captureReplay) {
    appendBarrierSequence(frames, summary);
  }

  return {
    ...summary,
    replay: captureReplay
      ? {
          version: REPLAY_VERSION,
          captureIntervalMs: Math.round(REPLAY_CAPTURE_INTERVAL * 1000),
          recordedAt: new Date().toISOString(),
          meta: {
            kind: "ai",
            name: "AI",
            policyName: "Edge Prediction",
            note: "Synthetic benchmark replay",
            source: "bootstrap-ai-leaderboard",
            gameVersion: GAME_VERSION,
            startedAt: new Date().toISOString(),
          },
          summary: {
            score: summary.score,
            maxChain: summary.maxChain,
            survivingCities: summary.aliveCities,
            clear: summary.clear,
            duration: round(frames[frames.length - 1]?.elapsed ?? WORLD.gameDuration, 2),
          },
          frames,
        }
      : null,
  };
}

function createAiEntry(rank, run) {
  const createdAt = new Date(BASE_CREATED_AT + rank * 60_000).toISOString();
  const name = rank === 1 ? "AI" : `AI-${String(rank).padStart(2, "0")}`;
  const comment =
    rank === 1
      ? `Best of ${SAMPLE_SIZE.toLocaleString("ja-JP")} seeded runs`
      : `Simulated benchmark slot ${rank} / seed ${formatSeed(run.seed)}`;
  const id = `ai-benchmark-${String(rank).padStart(2, "0")}`;

  return {
    id,
    kind: "ai",
    name,
    score: run.score,
    maxChain: run.maxChain,
    survivingCities: run.aliveCities,
    clear: run.clear,
    createdAt,
    policyName: "Edge Prediction",
    comment,
    note: "bootstrap-ai-leaderboard",
    replayId: id,
    replayAvailable: true,
  };
}

async function main() {
  mkdirSync(REPLAY_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const seeds = createSeeds(SAMPLE_SIZE);
  const evaluated = seeds.map((seed) => runSeed(seed));
  evaluated.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.clear !== left.clear) {
      return Number(right.clear) - Number(left.clear);
    }
    if (right.aliveCities !== left.aliveCities) {
      return right.aliveCities - left.aliveCities;
    }
    return left.seed - right.seed;
  });

  const topRuns = evaluated.slice(0, TOP_COUNT).map((run) => runSeed(run.seed, { captureReplay: true }));
  const board = readLeaderboard(LEADERBOARD_PATH);
  const aiEntries = [];

  for (const [index, run] of topRuns.entries()) {
    const rank = index + 1;
    const entry = createAiEntry(rank, run);
    run.replay.meta.name = entry.name;
    run.replay.meta.note = entry.comment;
    writeReplay(REPLAY_DIR, entry.replayId, run.replay);
    aiEntries.push(entry);
  }

  const nextBoard = {
    ...board,
    gameVersion: GAME_VERSION,
    aiEntries,
  };
  writeLeaderboard(LEADERBOARD_PATH, nextBoard);
  pruneReplayFiles(
    REPLAY_DIR,
    [
      ...nextBoard.humanEntries.map((entry) => entry.replayId).filter(Boolean),
      ...nextBoard.aiEntries.map((entry) => entry.replayId).filter(Boolean),
    ],
  );

  const summary = {
    sampleSize: SAMPLE_SIZE,
    bestSeed: formatSeed(topRuns[0].seed),
    bestScore: topRuns[0].score,
    bestAliveCities: topRuns[0].aliveCities,
    bestClear: topRuns[0].clear,
    aiTop10: aiEntries.map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      score: entry.score,
      replayId: entry.replayId,
      comment: entry.comment,
    })),
  };

  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
