import leaderboardSeed from '../../games/missile-command/data/leaderboard.json' with { type: 'json' };
import aiBenchmarkReplay from '../../games/missile-command/data/replays/ai-benchmark-01.json' with { type: 'json' };
import claudeOracleReplay from '../../games/missile-command/data/replays/claudeai-oracle-333ms-43527.json' with { type: 'json' };
import { WORLD } from '../../games/missile-command/balance.js';
import {
  REPLAY_CAPTURE_TICK_RATE,
  REPLAY_MAX_DURATION,
  REPLAY_MAX_FRAMES,
  REPLAY_VERSION
} from '../../games/missile-command/replay.js';
import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName, sha256 } from './worker-sanitize.mjs';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_REPLAY_MISSILES = 36;
const MAX_REPLAY_INTERCEPTORS = 18;
const MAX_REPLAY_EXPLOSIONS = 20;
const MAX_REPLAY_CITIES = WORLD.cityCount;
const MAX_REPLAY_EVENTS = 16;
const VALID_REPLAY_EVENT_TYPES = new Set([
  'launch',
  'player-explosion',
  'enemy-destroyed',
  'armor-hit',
  'split',
  'city-lost',
  'barrier-deploy',
  'barrier-intercept',
  'result'
]);
const DEFAULT_GAME_VERSION = 'orbital-shield-rl-poc-v3';
const STATIC_REPLAY_FORMAT = 'missile-replay-static-v1';
const SEED_REPLAYS = new Map([
  ['ai-benchmark-01', aiBenchmarkReplay],
  ['claudeai-oracle-333ms-43527', claudeOracleReplay]
]);
let seedEntriesCache = null;

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function sanitizeLabel(value, fallback = '') {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? Array.from(normalized).slice(0, 32).join('') : fallback;
}

function sanitizeColor(value, fallback) {
  const normalized = String(value ?? '').trim();
  return HEX_COLOR.test(normalized) ? normalized : fallback;
}

function sanitizeCity(city, index) {
  return {
    id: Math.max(1, Math.round(Number(city?.id) || index + 1)),
    index: clamp(Math.round(Number(city?.index) || index), 0, WORLD.cityCount - 1),
    x: roundNumber(clamp(Number(city?.x) || 0, 0, WORLD.width), 1),
    y: roundNumber(clamp(Number(city?.y) || WORLD.groundY, 0, WORLD.height), 1),
    width: roundNumber(clamp(Number(city?.width) || 0, 20, 240), 1),
    height: roundNumber(clamp(Number(city?.height) || 0, 20, 180), 1),
    alive: Boolean(city?.alive),
    flash: roundNumber(clamp(Number(city?.flash) || 0, 0, 1), 3),
    ruinHeat: roundNumber(clamp(Number(city?.ruinHeat) || 0, 0, 1), 3)
  };
}

function sanitizeMissile(missile, index) {
  return {
    id: Math.max(1, Math.round(Number(missile?.id) || index + 1)),
    type:
      missile?.type === 'split' || missile?.type === 'fast' || missile?.type === 'armored'
        ? missile.type
        : 'normal',
    x: roundNumber(clamp(Number(missile?.x) || 0, -120, WORLD.width + 120), 1),
    y: roundNumber(clamp(Number(missile?.y) || 0, -120, WORLD.height + 120), 1),
    vx: roundNumber(clamp(Number(missile?.vx) || 0, -2, 2), 4),
    vy: roundNumber(clamp(Number(missile?.vy) || 0, -2, 2), 4),
    targetX: roundNumber(clamp(Number(missile?.targetX) || 0, -120, WORLD.width + 120), 1),
    targetY: roundNumber(clamp(Number(missile?.targetY) || 0, -120, WORLD.height + 120), 1),
    targetCityId: Number.isInteger(missile?.targetCityId) ? missile.targetCityId : null,
    radius: roundNumber(clamp(Number(missile?.radius) || 0, 3, 20), 1),
    hitPoints: clamp(Math.round(Number(missile?.hitPoints) || 0), 0, 3),
    armorBreakFlash: roundNumber(clamp(Number(missile?.armorBreakFlash) || 0, 0, 1), 3)
  };
}

function sanitizeInterceptor(interceptor, index) {
  return {
    id: Math.max(1, Math.round(Number(interceptor?.id) || index + 1)),
    originX: roundNumber(clamp(Number(interceptor?.originX) || 0, -60, WORLD.width + 60), 1),
    originY: roundNumber(clamp(Number(interceptor?.originY) || 0, -60, WORLD.height + 60), 1),
    currentX: roundNumber(clamp(Number(interceptor?.currentX) || 0, -60, WORLD.width + 60), 1),
    currentY: roundNumber(clamp(Number(interceptor?.currentY) || 0, -60, WORLD.height + 60), 1)
  };
}

function sanitizeExplosion(explosion, index) {
  return {
    id: Math.max(1, Math.round(Number(explosion?.id) || index + 1)),
    x: roundNumber(clamp(Number(explosion?.x) || 0, -120, WORLD.width + 120), 1),
    y: roundNumber(clamp(Number(explosion?.y) || 0, -120, WORLD.height + 120), 1),
    currentRadius: roundNumber(clamp(Number(explosion?.currentRadius) || 0, 0, 240), 1),
    alpha: roundNumber(clamp(Number(explosion?.alpha) || 0, 0, 1), 3),
    ringRadius: roundNumber(clamp(Number(explosion?.ringRadius) || 0, 0, 280), 1),
    secondary: Boolean(explosion?.secondary),
    coreColor: sanitizeColor(explosion?.coreColor, '#7ef8ff'),
    edgeColor: sanitizeColor(explosion?.edgeColor, '#60d5ff')
  };
}

function sanitizeBarrier(barrier) {
  return {
    active: Boolean(barrier?.active),
    elapsed: roundNumber(clamp(Number(barrier?.elapsed) || 0, 0, REPLAY_MAX_DURATION), 3),
    progress: roundNumber(clamp(Number(barrier?.progress) || 0, 0, 1), 3)
  };
}

function sanitizeReplayEvent(event) {
  const type = String(event?.type ?? '').trim();
  if (!VALID_REPLAY_EVENT_TYPES.has(type)) {
    return null;
  }

  const sanitized = { type };
  if (Number.isFinite(event?.x)) {
    sanitized.x = roundNumber(clamp(Number(event.x) || 0, -120, WORLD.width + 120), 1);
  }
  if (Number.isFinite(event?.y)) {
    sanitized.y = roundNumber(clamp(Number(event.y) || 0, -120, WORLD.height + 120), 1);
  }
  if (Number.isFinite(event?.cityId)) {
    sanitized.cityId = Math.max(1, Math.round(Number(event.cityId) || 0));
  }
  if (type === 'enemy-destroyed' || type === 'barrier-intercept') {
    sanitized.missileType =
      event?.missileType === 'split' || event?.missileType === 'fast' || event?.missileType === 'armored'
        ? event.missileType
        : 'normal';
  }
  if (type === 'enemy-destroyed') {
    sanitized.chainCount = Math.max(1, Math.round(Number(event?.chainCount) || 1));
  }
  if (type === 'result') {
    sanitized.result = event?.result === 'gameover' ? 'gameover' : 'clear';
  }

  return sanitized;
}

function sanitizeFrame(frame, lastElapsed) {
  const rawElapsed = Number(frame?.elapsed);
  const elapsed = roundNumber(
    clamp(Number.isFinite(rawElapsed) ? rawElapsed : lastElapsed, lastElapsed, REPLAY_MAX_DURATION),
    2
  );

  return {
    elapsed,
    score: Math.max(0, Math.round(Number(frame?.score) || 0)),
    maxChain: Math.max(0, Math.round(Number(frame?.maxChain) || 0)),
    cities: Array.isArray(frame?.cities)
      ? frame.cities.slice(0, MAX_REPLAY_CITIES).map((city, cityIndex) => sanitizeCity(city, cityIndex))
      : [],
    enemyMissiles: Array.isArray(frame?.enemyMissiles)
      ? frame.enemyMissiles.slice(0, MAX_REPLAY_MISSILES).map((missile, missileIndex) => sanitizeMissile(missile, missileIndex))
      : [],
    interceptors: Array.isArray(frame?.interceptors)
      ? frame.interceptors
          .slice(0, MAX_REPLAY_INTERCEPTORS)
          .map((interceptor, interceptorIndex) => sanitizeInterceptor(interceptor, interceptorIndex))
      : [],
    explosions: Array.isArray(frame?.explosions)
      ? frame.explosions
          .slice(0, MAX_REPLAY_EXPLOSIONS)
          .map((explosion, explosionIndex) => sanitizeExplosion(explosion, explosionIndex))
      : [],
    barrier: sanitizeBarrier(frame?.barrier),
    events: Array.isArray(frame?.events)
      ? frame.events.slice(0, MAX_REPLAY_EVENTS).map((event) => sanitizeReplayEvent(event)).filter(Boolean)
      : []
  };
}

function normalizeReplayPayload(payload, entry) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const frames = [];
  let lastElapsed = 0;

  for (const rawFrame of Array.isArray(payload.frames) ? payload.frames.slice(0, REPLAY_MAX_FRAMES) : []) {
    const frame = sanitizeFrame(rawFrame, lastElapsed);
    if (frames.length > 0 && frame.elapsed <= lastElapsed + 0.001) {
      continue;
    }
    frames.push(frame);
    lastElapsed = frame.elapsed;
  }

  if (frames.length < 2) {
    return null;
  }

  return {
    version: REPLAY_VERSION,
    captureIntervalMs: clamp(Math.round(Number(payload.captureIntervalMs) || (1000 / REPLAY_CAPTURE_TICK_RATE)), 12, 250),
    recordedAt: new Date().toISOString(),
    meta: {
      kind: entry.kind,
      name: sanitizeLabel(payload?.meta?.name, entry.name),
      policyName: sanitizeLabel(payload?.meta?.policyName, entry.policyName ?? ''),
      note: sanitizeLabel(payload?.meta?.note, entry.note ?? ''),
      source: sanitizeLabel(payload?.meta?.source, entry.source ?? ''),
      gameVersion: sanitizeLabel(payload?.meta?.gameVersion, 'orbital-shield-rl-poc-v3'),
      startedAt:
        typeof payload?.meta?.startedAt === 'string' && payload.meta.startedAt.trim()
          ? payload.meta.startedAt
          : new Date().toISOString()
    },
    summary: {
      score: entry.score,
      maxChain: entry.maxChain,
      survivingCities: entry.survivingCities,
      clear: entry.clear,
      duration: roundNumber(
        clamp(Number(payload?.summary?.duration) || frames[frames.length - 1].elapsed, frames[0].elapsed, REPLAY_MAX_DURATION),
        2
      )
    },
    frames
  };
}

function deriveVerifiedReplaySummary(replay) {
  const frames = Array.isArray(replay?.frames) ? replay.frames : [];
  if (frames.length < 2) {
    return null;
  }

  let maxChain = 0;
  let result = null;

  for (const frame of frames) {
    maxChain = Math.max(maxChain, Math.max(0, Math.round(Number(frame?.maxChain) || 0)));
    for (const event of Array.isArray(frame?.events) ? frame.events : []) {
      if (event?.type === 'result') {
        result = event?.result === 'gameover' ? 'gameover' : 'clear';
      }
    }
  }

  const lastFrame = frames[frames.length - 1];
  const score = Math.max(0, Math.round(Number(lastFrame?.score) || 0));

  if (!result) {
    if (typeof replay?.summary?.clear === 'boolean') {
      result = replay.summary.clear ? 'clear' : 'gameover';
    } else {
      return null;
    }
  }

  const survivingCities = Array.isArray(lastFrame?.cities) ? lastFrame.cities.filter((city) => city?.alive).length : 0;
  const clear = result === 'clear';

  return {
    score,
    maxChain,
    survivingCities,
    clear,
    duration: roundNumber(lastFrame?.elapsed ?? 0, 2)
  };
}

export const missileAdapter = {
  gameId: 'missile-command',

  loadSeedEntries() {
    if (Array.isArray(seedEntriesCache)) {
      return seedEntriesCache;
    }

    const sourceEntries = [
      ...(Array.isArray(leaderboardSeed?.humanEntries) ? leaderboardSeed.humanEntries : []),
      ...(Array.isArray(leaderboardSeed?.aiEntries) ? leaderboardSeed.aiEntries : [])
    ];

    const entries = [];
    for (const entry of sourceEntries) {
      if (!entry?.replayAvailable || !entry?.replayId) {
        continue;
      }

      const replay = SEED_REPLAYS.get(String(entry.replayId));
      const verifiedSummary = replay ? deriveVerifiedReplaySummary(replay) : null;
      if (!verifiedSummary) {
        continue;
      }

      const replayKey = String(entry.replayId);
      const kind = entry.kind === 'ai' ? 'ai' : 'human';
      entries.push({
        id: String(entry.id ?? createEntryId('missile')),
        kind,
        name: sanitizePlayerName(entry.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
        comment: sanitizeComment(entry.comment ?? ''),
        score: verifiedSummary.score,
        summary: verifiedSummary,
        gameVersion: String(replay?.meta?.gameVersion ?? leaderboardSeed?.gameVersion ?? DEFAULT_GAME_VERSION),
        createdAt: String(entry.createdAt ?? new Date().toISOString()),
        replayFormat: STATIC_REPLAY_FORMAT,
        replayData: replayKey,
        replayDigest: String(entry.replayDigest ?? `seed-${entry.id ?? entry.replayId}`)
      });
    }

    seedEntriesCache = entries;
    return seedEntriesCache;
  },

  async validateSubmission(payload) {
    const kind = payload?.kind === 'ai' ? 'ai' : 'human';
    const replay = normalizeReplayPayload(payload?.replay, {
      kind,
      name: sanitizePlayerName(payload?.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
      policyName: '',
      note: '',
      source: '',
      score: Math.max(0, Math.round(Number(payload?.score) || 0)),
      maxChain: Math.max(0, Math.round(Number(payload?.maxChain) || 0)),
      survivingCities: Math.max(0, Math.round(Number(payload?.survivingCities) || 0)),
      clear: Boolean(payload?.clear)
    });
    if (!replay) {
      throw createSubmissionError('Replay is required for MissileCommand submissions');
    }

    const verifiedSummary = deriveVerifiedReplaySummary(replay);
    if (!verifiedSummary) {
      throw createSubmissionError('Replay verification failed for MissileCommand');
    }

    const replayData = JSON.stringify(replay);
    return {
      id: createEntryId('missile'),
      kind,
      name: sanitizePlayerName(payload?.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
      comment: sanitizeComment(payload?.comment ?? ''),
      score: verifiedSummary.score,
      summary: verifiedSummary,
      gameVersion: String(replay.meta?.gameVersion ?? 'orbital-shield-rl-poc-v3'),
      createdAt: new Date().toISOString(),
      replayFormat: 'missile-replay-json-v1',
      replayData,
      replayDigest: await sha256(replayData)
    };
  },

  toReplayResponse(row) {
    if (row.replay_format === STATIC_REPLAY_FORMAT) {
      return SEED_REPLAYS.get(String(row.replay_data)) ?? null;
    }
    return parseStoredJson(row.replay_data, null);
  }
};
