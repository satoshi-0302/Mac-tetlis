import { GAMES, getGameById } from './lib/games.mjs';
import { asteroidAdapter } from './lib/asteroid-adapter.mjs';
import { missileAdapter } from './lib/missile-adapter.mjs';
import { slotAdapter } from './lib/slot-adapter.mjs';
import { snakeAdapter } from './lib/snake-adapter.mjs';
import { chickFlapAdapter } from './lib/chick-flap-adapter.mjs';
import { parseStoredJson } from './lib/worker-sanitize.mjs';
import { RateLimiterDO } from './rate-limiter-do.mjs';

const MAX_REQUEST_BYTES = 25_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const GAMES_CACHE_TTL_SECONDS = 60;

const adapters = new Map([
  ['snake60', snakeAdapter],
  ['missile-command', missileAdapter],
  ['asteroid', asteroidAdapter],
  ['slot60', slotAdapter],
  ['chick-flap', chickFlapAdapter]
]);

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function buildCacheHeaders(ttlSeconds) {
  return {
    'Cache-Control': `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`
  };
}

function cacheKeyFor(request, suffix = '') {
  const url = new URL(request.url);
  if (suffix) {
    url.searchParams.set('__cache', suffix);
  }
  return new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
}

async function getCachedJson(request, ttlSeconds, producer) {
  const cache = caches.default;
  const key = cacheKeyFor(request, String(ttlSeconds));
  const cached = await cache.match(key);
  if (cached) {
    return cached;
  }

  const payload = await producer();
  const response = jsonResponse(200, payload, buildCacheHeaders(ttlSeconds));
  await cache.put(key, response.clone());
  return response;
}

async function purgeApiCache(request, gameId = null) {
  const cache = caches.default;
  await cache.delete(cacheKeyFor(request, String(GAMES_CACHE_TTL_SECONDS)));
}

async function ensureGames(db) {
  for (const game of GAMES) {
    await db
      .prepare(
        `INSERT INTO games (id, slug, title, description, route, supports_touch, supports_replay, sort_order, current_game_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           slug = excluded.slug,
           title = excluded.title,
           description = excluded.description,
           route = excluded.route,
           supports_touch = excluded.supports_touch,
           supports_replay = excluded.supports_replay,
           sort_order = excluded.sort_order,
           current_game_version = excluded.current_game_version`
      )
      .bind(
        game.id,
        game.slug,
        game.title,
        game.description,
        game.route,
        game.supportsTouch ? 1 : 0,
        game.supportsReplay ? 1 : 0,
        game.sortOrder,
        game.currentGameVersion
      )
      .run();

    const countRow = await db
      .prepare('SELECT count(*) AS total FROM leaderboard_entries WHERE game_id = ?')
      .bind(game.id)
      .first();

    if (Number(countRow?.total ?? 0) > 0) {
      continue;
    }

    const adapter = adapters.get(game.id);
    if (!adapter || typeof adapter.loadSeedEntries !== 'function') {
      continue;
    }

    for (const entry of adapter.loadSeedEntries()) {
      await insertVerifiedEntry(db, game.id, entry);
    }

    await pruneEntriesToTopTen(db, game.id);
  }
}

function formatEntry(row) {
  const summary = parseStoredJson(row.summary_json, {});
  return {
    id: String(row.id),
    kind: row.kind,
    name: row.name,
    comment: row.comment,
    message: row.comment,
    score: Number(row.score ?? 0),
    createdAt: row.created_at,
    gameVersion: row.game_version,
    replayId: String(row.id),
    replayAvailable: typeof row.replay_data === 'string' && row.replay_data.length > 0,
    summary,
    ...summary
  };
}

async function getTopEntries(db, gameId) {
  const { results } = await db
    .prepare(
      `SELECT id, game_id, game_version, kind, name, comment, score, created_at, replay_format, replay_digest, replay_data, summary_json
       FROM leaderboard_entries
       WHERE game_id = ?
       ORDER BY score DESC, created_at ASC, id ASC
       LIMIT 10`
    )
    .bind(gameId)
    .all();
  return results ?? [];
}

async function buildLeaderboardPayload(db, gameId) {
  const rows = await getTopEntries(db, gameId);
  const entries = rows.map((row) => formatEntry(row));
  return {
    gameId,
    gameVersion: getGameById(gameId)?.currentGameVersion ?? '',
    entries,
    combinedEntries: entries,
    humanEntries: entries.filter((entry) => entry.kind === 'human'),
    aiEntries: entries.filter((entry) => entry.kind === 'ai')
  };
}

async function buildGamesPayload(db) {
  const games = [];
  for (const game of GAMES.slice().sort((left, right) => left.sortOrder - right.sortOrder)) {
    const topEntry = await db
      .prepare(
        `SELECT id, kind, name, score
         FROM leaderboard_entries
         WHERE game_id = ?
         ORDER BY score DESC, created_at ASC, id ASC
         LIMIT 1`
      )
      .bind(game.id)
      .first();

    games.push({
      ...game,
      topEntry: topEntry
        ? {
            id: String(topEntry.id),
            kind: topEntry.kind,
            name: topEntry.name,
            score: Number(topEntry.score ?? 0)
          }
        : null
    });
  }
  return { games };
}

async function pruneEntriesToTopTen(db, gameId) {
  await db
    .prepare(
      `DELETE FROM leaderboard_entries
       WHERE game_id = ?
         AND id NOT IN (
           SELECT id FROM leaderboard_entries
           WHERE game_id = ?
           ORDER BY score DESC, created_at ASC, id ASC
           LIMIT 10
         )`
    )
    .bind(gameId, gameId)
    .run();
}

async function insertVerifiedEntry(db, gameId, entry) {
  await db
    .prepare(
      `INSERT OR REPLACE INTO leaderboard_entries
       (id, game_id, game_version, kind, name, comment, score, created_at, replay_format, replay_digest, replay_data, summary_json, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(
      entry.id,
      gameId,
      entry.gameVersion,
      entry.kind,
      entry.name,
      entry.comment,
      entry.score,
      entry.createdAt,
      entry.replayFormat,
      entry.replayDigest,
      entry.replayData,
      JSON.stringify(entry.summary ?? {})
    )
    .run();
}

function createRequestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function selectEntryById(db, gameId, entryId) {
  return db
    .prepare(
      `SELECT id, game_id, game_version, kind, name, comment, score, created_at, replay_format, replay_digest, replay_data, summary_json
       FROM leaderboard_entries
       WHERE game_id = ? AND id = ?`
    )
    .bind(gameId, entryId)
    .first();
}

async function readJsonBody(request) {
  const body = await request.text();
  if (body.length > MAX_REQUEST_BYTES) {
    throw createRequestError('Request body too large', 413);
  }

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw createRequestError('Invalid JSON payload', 400);
  }
}

function isSameOriginWriteAllowed(request) {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  if (!host || !origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}

async function takeRateLimitSlot(env, request, gameId) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const shard = env.RATE_LIMITER.idFromName(`${gameId}:${ip}`);
  const stub = env.RATE_LIMITER.get(shard);
  const response = await stub.fetch('https://rate-limiter/take', {
    method: 'POST',
    body: JSON.stringify({
      key: `${gameId}:${ip}`,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS
    })
  });
  return response.json();
}

async function submitEntryForGame(env, gameId, payload) {
  const adapter = adapters.get(gameId);
  if (!adapter) {
    throw createRequestError('Unknown gameId', 404);
  }

  const verifiedEntry = await adapter.validateSubmission(payload);
  await insertVerifiedEntry(env.DB, gameId, verifiedEntry);
  await pruneEntriesToTopTen(env.DB, gameId);
  const row = await selectEntryById(env.DB, gameId, verifiedEntry.id);
  const leaderboard = await buildLeaderboardPayload(env.DB, gameId);
  return {
    entry: row ? formatEntry(row) : verifiedEntry,
    keptInTop10: Boolean(row),
    leaderboard
  };
}

async function handleApi(env, request, url) {
  await ensureGames(env.DB);

  if (request.method === 'GET' && url.pathname === '/api/games') {
    return getCachedJson(request, GAMES_CACHE_TTL_SECONDS, () => buildGamesPayload(env.DB));
  }

  if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
    const gameId = String(url.searchParams.get('gameId') ?? '').trim() || 'missile-command';
    if (!getGameById(gameId)) {
      return jsonResponse(404, { error: 'Unknown gameId' });
    }
    return jsonResponse(200, await buildLeaderboardPayload(env.DB, gameId));
  }

  if (request.method === 'GET' && url.pathname === '/api/replay') {
    const gameId = String(url.searchParams.get('gameId') ?? 'asteroid').trim();
    const entryId = String(url.searchParams.get('entryId') ?? url.searchParams.get('id') ?? '').trim();
    if (!entryId) {
      return jsonResponse(400, { error: 'entryId is required' });
    }

    const adapter = adapters.get(gameId);
    const row = await selectEntryById(env.DB, gameId, entryId);
    if (!adapter || !row || !row.replay_data) {
      return jsonResponse(404, { error: 'Replay not found' });
    }

    return jsonResponse(200, adapter.toReplayResponse(row));
  }

  const snakeReplayMatch = request.method === 'GET' ? url.pathname.match(/^\/api\/replays\/([A-Za-z0-9-]+)$/) : null;
  if (snakeReplayMatch) {
    const row = await selectEntryById(env.DB, 'snake60', snakeReplayMatch[1]);
    if (!row || !row.replay_data) {
      return jsonResponse(404, { error: 'Replay not found' });
    }
    return jsonResponse(200, snakeAdapter.toReplayResponse(row));
  }

  const missileReplayMatch = request.method === 'GET' ? url.pathname.match(/^\/api\/replay\/([A-Za-z0-9-]+)$/) : null;
  if (missileReplayMatch) {
    const row = await selectEntryById(env.DB, 'missile-command', missileReplayMatch[1]);
    if (!row || !row.replay_data) {
      return jsonResponse(404, { error: 'Replay not found' });
    }
    return jsonResponse(200, missileAdapter.toReplayResponse(row));
  }

  if (request.method === 'GET' && url.pathname === '/api/scores') {
    return jsonResponse(200, (await buildLeaderboardPayload(env.DB, 'snake60')).combinedEntries);
  }

  if (request.method === 'POST' && url.pathname === '/api/scores') {
    if (!isSameOriginWriteAllowed(request)) {
      return jsonResponse(403, { error: 'Cross-origin submissions are not allowed' });
    }

    const rateLimit = await takeRateLimitSlot(env, request, 'snake60');
    if (rateLimit.limited) {
      return jsonResponse(429, { error: 'Too many submissions', retryAfterSeconds: rateLimit.retryAfterSeconds });
    }

    const payload = await readJsonBody(request);
    const result = await submitEntryForGame(env, 'snake60', payload);
    await purgeApiCache(request);
    return jsonResponse(200, result.leaderboard.combinedEntries);
  }

  if (request.method === 'POST' && url.pathname === '/api/submit') {
    if (!isSameOriginWriteAllowed(request)) {
      return jsonResponse(403, { error: 'Cross-origin submissions are not allowed' });
    }

    const payload = await readJsonBody(request);
    const gameId = String(payload?.gameId ?? '').trim();
    if (!getGameById(gameId)) {
      return jsonResponse(404, { error: 'Unknown gameId' });
    }

    const rateLimit = await takeRateLimitSlot(env, request, gameId);
    if (rateLimit.limited) {
      return jsonResponse(429, { error: 'Too many submissions', retryAfterSeconds: rateLimit.retryAfterSeconds });
    }

    const result = await submitEntryForGame(env, gameId, payload);
    await purgeApiCache(request);
    return jsonResponse(200, result);
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return jsonResponse(200, { ok: true, runtime: 'cloudflare-workers' });
  }

  return jsonResponse(404, { error: 'Not found' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(env, request, url);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      return jsonResponse(error.statusCode ?? 500, {
        error: error.message || 'Internal Server Error'
      });
    }
  }
};

export { RateLimiterDO };
