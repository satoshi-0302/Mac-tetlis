import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { GAME_VERSION } from '../src/engine/constants.js';
import { runHeadlessReplayFromBase64 } from '../src/replay/verify-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configuredPort = Number(process.env.ASTEROIDS60_PORT ?? 8787);
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 8787;
const DB_DIR = join(__dirname, 'data');
const DB_PATH = join(DB_DIR, 'leaderboard.db');
const LEGACY_GAME_VERSION = 'legacy';
const AI_LEADERBOARD_PATH = join(__dirname, '..', 'public', 'rl', 'ai-top10.json');
const ALLOWED_ORIGINS = buildAllowedOrigins(process.env.ASTEROIDS60_ALLOWED_ORIGINS);
const SUBMIT_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.ASTEROIDS60_SUBMIT_WINDOW_MS,
  60_000
);
const SUBMIT_RATE_LIMIT_MAX = parsePositiveInteger(process.env.ASTEROIDS60_SUBMIT_LIMIT, 8);
const TRUST_PROXY = isTruthy(process.env.ASTEROIDS60_TRUST_PROXY);
const submitRateLimit = new Map();

mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(schemaSql);

function ensureLeaderboardSchema(dbInstance) {
  const columns = dbInstance.prepare('PRAGMA table_info(leaderboard)').all();
  const hasGameVersion = columns.some((column) => column.name === 'game_version');
  const hasReplayData = columns.some((column) => column.name === 'replay_data');

  if (!hasGameVersion) {
    dbInstance.exec(
      `ALTER TABLE leaderboard ADD COLUMN game_version TEXT NOT NULL DEFAULT '${LEGACY_GAME_VERSION}'`
    );
  }

  if (!hasReplayData) {
    dbInstance.exec("ALTER TABLE leaderboard ADD COLUMN replay_data TEXT NOT NULL DEFAULT ''");
  }

  dbInstance.exec(`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_game_version_score
      ON leaderboard(game_version, score DESC, created_at ASC, id ASC)
  `);
}

ensureLeaderboardSchema(db);

const insertScoreStatement = db.prepare(
  'INSERT INTO leaderboard (name, message, score, replay_digest, replay_data, game_version) VALUES (?, ?, ?, ?, ?, ?)'
);
const topTenListStatement = db.prepare(
  `SELECT
    id,
    name,
    message,
    score,
    created_at AS createdAt,
    game_version AS gameVersion,
    CASE WHEN length(replay_data) > 0 THEN 1 ELSE 0 END AS replayAvailable
  FROM leaderboard
  WHERE game_version = ?
  ORDER BY score DESC, created_at ASC, id ASC
  LIMIT 10`
);
const pruneStatement = db.prepare(
  'DELETE FROM leaderboard WHERE game_version = ? AND id NOT IN (SELECT id FROM leaderboard WHERE game_version = ? ORDER BY score DESC, created_at ASC, id ASC LIMIT 10)'
);
const replayByIdStatement = db.prepare(
  'SELECT id, name, message, score, replay_digest AS replayDigest, replay_data AS replayData, created_at AS createdAt, game_version AS gameVersion FROM leaderboard WHERE id = ?'
);

const baseHeaders = {
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff'
};

const corsHeaderTemplate = {
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  const corsHeaders = resolveCorsHeaders(request);
  response.writeHead(statusCode, {
    ...baseHeaders,
    ...(corsHeaders ?? {}),
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function sendOriginDenied(response) {
  response.writeHead(403, {
    ...baseHeaders,
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify({ error: 'Origin not allowed' }));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizeOrigin(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

function buildAllowedOrigins(rawValue) {
  const configured = String(rawValue ?? '')
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  return new Set(configured);
}

function isLoopbackOrigin(origin) {
  if (!origin) {
    return false;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function resolveCorsHeaders(request) {
  const origin = normalizeOrigin(request.headers.origin);
  if (!origin) {
    return { Vary: 'Origin' };
  }
  if (!ALLOWED_ORIGINS.has(origin) && !isLoopbackOrigin(origin)) {
    return null;
  }
  return {
    ...corsHeaderTemplate,
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin'
  };
}

function rejectDisallowedOrigin(request, response) {
  const origin = normalizeOrigin(request.headers.origin);
  if (!origin) {
    return false;
  }
  if (ALLOWED_ORIGINS.has(origin) || isLoopbackOrigin(origin)) {
    return false;
  }
  sendOriginDenied(response);
  return true;
}

function getClientAddress(request) {
  if (TRUST_PROXY) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }
  }

  return request.socket.remoteAddress ?? 'unknown';
}

function pruneExpiredRateLimitEntries(nowMs) {
  for (const [key, state] of submitRateLimit.entries()) {
    if (state.resetAt <= nowMs) {
      submitRateLimit.delete(key);
    }
  }
}

function takeSubmitRateLimitSlot(request) {
  const nowMs = Date.now();
  if (submitRateLimit.size > 512) {
    pruneExpiredRateLimitEntries(nowMs);
  }

  const clientAddress = getClientAddress(request);
  const current = submitRateLimit.get(clientAddress);
  if (!current || current.resetAt <= nowMs) {
    submitRateLimit.set(clientAddress, {
      count: 1,
      resetAt: nowMs + SUBMIT_RATE_LIMIT_WINDOW_MS
    });
    return { limited: false };
  }

  if (current.count >= SUBMIT_RATE_LIMIT_MAX) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000))
    };
  }

  current.count += 1;
  return { limited: false };
}

async function readJsonBody(request, maxBytes = 300_000) {
  let total = 0;
  const chunks = [];

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function mapHumanEntry(row, index) {
  return {
    kind: 'human',
    id: String(row.id),
    rank: index + 1,
    name: row.name,
    message: row.message,
    score: row.score,
    createdAt: row.createdAt,
    gameVersion: row.gameVersion,
    replayAvailable: Number(row.replayAvailable) === 1
  };
}

function mapHumanEntries(rows) {
  return rows.map((row, index) => mapHumanEntry(row, index));
}

let aiLeaderboardCache = {
  signature: '',
  generatedAt: null,
  gameVersion: GAME_VERSION,
  entries: [],
  rawEntries: [],
  replayLookup: null
};

function mapAiLeaderboardEntry(entry, index) {
  return {
    kind: 'ai',
    id: String(entry.id ?? `ai-${index + 1}`),
    rank: index + 1,
    name: String(entry.name ?? `AI ${index + 1}`),
    message: String(entry.message ?? ''),
    score: Number(entry.score ?? 0),
    replayAvailable: typeof entry.replayData === 'string' && entry.replayData.length > 0,
    summary: entry.summary ?? null,
    sourceLabel: entry.sourceLabel ?? null
  };
}

function mapAiReplayEntry(entry, index) {
  return {
    kind: 'ai',
    id: String(entry.id ?? `ai-${index + 1}`),
    rank: index + 1,
    name: String(entry.name ?? `AI ${index + 1}`),
    message: String(entry.message ?? ''),
    score: Number(entry.score ?? 0),
    seed: Number(entry.seed ?? entry.summary?.seed ?? 0),
    replayDigest: String(entry.replayDigest ?? ''),
    replayData: typeof entry.replayData === 'string' ? entry.replayData : '',
    summary: entry.summary ?? null,
    sourceLabel: entry.sourceLabel ?? null
  };
}

function readAiLeaderboardCache() {
  try {
    const stats = statSync(AI_LEADERBOARD_PATH);
    const signature = `${stats.size}:${stats.mtimeMs}`;
    if (aiLeaderboardCache.signature === signature) {
      return aiLeaderboardCache;
    }

    const raw = readFileSync(AI_LEADERBOARD_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries.slice(0, 10) : [];
    aiLeaderboardCache = {
      signature,
      generatedAt: parsed?.generatedAt ?? null,
      gameVersion: parsed?.gameVersion ?? GAME_VERSION,
      entries: rawEntries.map((entry, index) => mapAiLeaderboardEntry(entry, index)),
      rawEntries,
      replayLookup: null
    };
    return aiLeaderboardCache;
  } catch {
    aiLeaderboardCache = {
      signature: '',
      generatedAt: null,
      gameVersion: GAME_VERSION,
      entries: [],
      rawEntries: [],
      replayLookup: null
    };
    return aiLeaderboardCache;
  }
}

function loadAiLeaderboard() {
  const cache = readAiLeaderboardCache();
  return {
    generatedAt: cache.generatedAt,
    gameVersion: cache.gameVersion,
    entries: cache.entries
  };
}

function getAiReplayEntry(id) {
  const cache = readAiLeaderboardCache();
  if (!(cache.replayLookup instanceof Map)) {
    cache.replayLookup = new Map(
      cache.rawEntries.map((entry, index) => [
        String(entry.id ?? `ai-${index + 1}`),
        mapAiReplayEntry(entry, index)
      ])
    );
  }

  return {
    generatedAt: cache.generatedAt,
    gameVersion: cache.gameVersion,
    entry: cache.replayLookup.get(String(id)) ?? null
  };
}

function getVisibleHumanTopTen() {
  const currentRows = topTenListStatement.all(GAME_VERSION);
  if (currentRows.length >= 10) {
    return {
      sourceVersion: GAME_VERSION,
      sourceLabel: 'current',
      entries: mapHumanEntries(currentRows)
    };
  }

  const legacyRows = topTenListStatement.all(LEGACY_GAME_VERSION);
  if (currentRows.length > 0 && legacyRows.length > 0) {
    return {
      sourceVersion: `${GAME_VERSION}+${LEGACY_GAME_VERSION}`,
      sourceLabel: 'current-plus-legacy',
      entries: mapHumanEntries(currentRows.concat(legacyRows.slice(0, Math.max(0, 10 - currentRows.length))))
    };
  }

  if (currentRows.length > 0) {
    return {
      sourceVersion: GAME_VERSION,
      sourceLabel: 'current',
      entries: mapHumanEntries(currentRows)
    };
  }

  if (legacyRows.length > 0) {
    return {
      sourceVersion: LEGACY_GAME_VERSION,
      sourceLabel: 'legacy-archive',
      entries: mapHumanEntries(legacyRows)
    };
  }

  return {
    sourceVersion: GAME_VERSION,
    sourceLabel: 'current',
    entries: []
  };
}

function buildLeaderboardPayload() {
  const human = getVisibleHumanTopTen();
  const ai = loadAiLeaderboard();
  return {
    gameVersion: GAME_VERSION,
    humanSourceVersion: human.sourceVersion,
    humanSourceLabel: human.sourceLabel,
    humanEntries: human.entries,
    aiSourceVersion: ai.gameVersion,
    aiGeneratedAt: ai.generatedAt,
    aiEntries: ai.entries
  };
}

function sanitizeName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[^\x20-\x7E]/g, '').trim().toUpperCase();
}

function sanitizeMessage(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[^\x20-\x7E]/g, '').trim();
}

function validateSubmissionPayload(payload) {
  const name = sanitizeName(payload.name);
  const message = sanitizeMessage(payload.message ?? '');
  const score = Number(payload.score);
  const replayDigest = typeof payload.replayDigest === 'string' ? payload.replayDigest.toLowerCase() : '';
  const replayData = typeof payload.replayData === 'string' ? payload.replayData : '';
  const finalStateHash = typeof payload.finalStateHash === 'string' ? payload.finalStateHash.toLowerCase() : '';

  if (!name || name.length > 5) {
    return { error: 'name must be 1-5 printable ASCII characters' };
  }
  if (message.length > 30) {
    return { error: 'message must be <= 30 printable ASCII characters' };
  }
  if (!Number.isInteger(score) || score < 0 || score > 2_000_000_000) {
    return { error: 'score must be a non-negative integer' };
  }
  if (!/^[a-f0-9]{64}$/.test(replayDigest)) {
    return { error: 'replayDigest must be a 64-char SHA-256 hex string' };
  }
  if (!replayData) {
    return { error: 'replayData is required for anti-cheat verification' };
  }

  const calculatedDigest = createHash('sha256').update(replayData).digest('hex');
  if (calculatedDigest !== replayDigest) {
    return { error: 'replayDigest mismatch' };
  }

  let replayResult;
  try {
    replayResult = runHeadlessReplayFromBase64(replayData, { seed: 0 });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'replayData is invalid' };
  }

  const calculatedFinalStateHash = createHash('sha256')
    .update(replayResult.finalStateHashMaterial)
    .digest('hex');
  if (finalStateHash) {
    if (!/^[a-f0-9]{64}$/.test(finalStateHash)) {
      return { error: 'finalStateHash must be a 64-char SHA-256 hex string' };
    }
    if (calculatedFinalStateHash !== finalStateHash) {
      return { error: 'finalStateHash mismatch' };
    }
  }
  if (replayResult.summary.score !== score) {
    return {
      error: `score mismatch after deterministic replay (submitted ${score}, verified ${replayResult.summary.score})`
    };
  }

  return {
    name,
    message,
    score,
    replayDigest,
    replayData,
    finalStateHash: calculatedFinalStateHash
  };
}

function insertScoreAndPruneTopTen(record) {
  insertScoreStatement.run(
    record.name,
    record.message,
    record.score,
    record.replayDigest,
    record.replayData,
    GAME_VERSION
  );
  pruneStatement.run(GAME_VERSION, GAME_VERSION);
}

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendJson(request, response, 400, { error: 'Invalid request' });
    return;
  }

  const url = new URL(request.url, 'http://localhost');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    if (rejectDisallowedOrigin(request, response)) {
      return;
    }
    response.writeHead(204, {
      ...baseHeaders,
      ...(resolveCorsHeaders(request) ?? {})
    });
    response.end();
    return;
  }

  if (rejectDisallowedOrigin(request, response)) {
    return;
  }

  if (url.pathname === '/api/leaderboard' && method === 'GET') {
    sendJson(request, response, 200, buildLeaderboardPayload());
    return;
  }

  if (url.pathname === '/api/replay' && method === 'GET') {
    const kind = url.searchParams.get('kind');
    const id = url.searchParams.get('id');

    if (kind === 'human') {
      const replayId = Number(id);
      if (!Number.isInteger(replayId) || replayId <= 0) {
        sendJson(request, response, 400, { error: 'human replay id must be a positive integer' });
        return;
      }

      const row = replayByIdStatement.get(replayId);
      if (!row) {
        sendJson(request, response, 404, { error: 'Replay not found' });
        return;
      }
      if (typeof row.replayData !== 'string' || row.replayData.length === 0) {
        sendJson(request, response, 404, { error: 'Replay data is not available for this entry' });
        return;
      }

      sendJson(request, response, 200, {
        kind: 'human',
        id: String(row.id),
        name: row.name,
        message: row.message,
        score: row.score,
        createdAt: row.createdAt,
        gameVersion: row.gameVersion,
        replayDigest: row.replayDigest,
        replayData: row.replayData
      });
      return;
    }

    if (kind === 'ai') {
      if (!id) {
        sendJson(request, response, 400, { error: 'ai replay id is required' });
        return;
      }

      const ai = getAiReplayEntry(id);
      const entry = ai.entry;
      if (!entry || typeof entry.replayData !== 'string' || entry.replayData.length === 0) {
        sendJson(request, response, 404, { error: 'Replay not found' });
        return;
      }

      sendJson(request, response, 200, {
        ...entry,
        gameVersion: ai.gameVersion,
        generatedAt: ai.generatedAt
      });
      return;
    }

    sendJson(request, response, 400, { error: 'kind must be either human or ai' });
    return;
  }

  if (url.pathname === '/api/submit' && method === 'POST') {
    const submitRateLimitState = takeSubmitRateLimitSlot(request);
    if (submitRateLimitState.limited) {
      sendJson(
        request,
        response,
        429,
        { error: 'Too many submissions, please wait a moment and try again.' },
        { 'Retry-After': String(submitRateLimitState.retryAfterSeconds) }
      );
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request);
    } catch (error) {
      sendJson(request, response, 400, {
        error: error instanceof Error ? error.message : 'Malformed JSON body'
      });
      return;
    }

    const validation = validateSubmissionPayload(payload);
    if (validation.error) {
      sendJson(request, response, 400, { error: validation.error });
      return;
    }

    try {
      insertScoreAndPruneTopTen(validation);
    } catch {
      sendJson(request, response, 500, { error: 'Database write failed' });
      return;
    }

    sendJson(request, response, 201, {
      ok: true,
      leaderboard: buildLeaderboardPayload(),
      acceptedScore: validation.score,
      gameVersion: GAME_VERSION
    });
    return;
  }

  sendJson(request, response, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Asteroids 60 server listening on http://localhost:${PORT}`);
});
