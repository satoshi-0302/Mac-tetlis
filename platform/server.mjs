import { mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asteroidAdapter } from './adapters/asteroid.mjs';
import { chickFlapAdapter } from './adapters/chick-flap.mjs';
import { missileCommandAdapter } from './adapters/missile-command.mjs';
import { snake60Adapter } from './adapters/snake60.mjs';
import { slot60Adapter } from './adapters/slot60.mjs';
import { stackfallAdapter } from './adapters/stackfall.mjs';
import { GAMES, getGameById } from './games.mjs';
import { parseStoredJson } from './sanitize.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const PLATFORM_PUBLIC_DIR = join(__dirname, 'public');
const DATA_DIR = resolve(process.env.PLATFORM_DATA_DIR || join(__dirname, 'data'));
const DB_PATH = resolve(process.env.PLATFORM_DB_PATH || join(DATA_DIR, 'leaderboard.db'));
const PORT = Number(process.env.PORT || 9090);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_REQUEST_BYTES = 25_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const PLATFORM_ROOT_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);

const adapters = new Map([
  ['snake60', snake60Adapter],
  ['missile-command', missileCommandAdapter],
  ['asteroid', asteroidAdapter],
  ['slot60', slot60Adapter],
  ['stackfall', stackfallAdapter],
  ['chick-flap', chickFlapAdapter]
]);

const staticMounts = [
  {
    prefix: '/static/',
    rootDir: PLATFORM_PUBLIC_DIR,
    allowRootFiles: new Set(['styles.css', 'lobby.js']),
    allowDirs: new Set(['icons', 'assets'])
  },
  {
    prefix: '/games/snake60/',
    rootDir: join(ROOT_DIR, 'games', 'snake60', 'dist'),
    allowAll: true
  },
  {
    prefix: '/games/missile-command/',
    rootDir: join(ROOT_DIR, 'games', 'missile-command'),
    allowRootFiles: new Set([
      'index.html',
      'styles.css',
      'api.js',
      'audio.js',
      'balance.js',
      'effects.js',
      'entities.js',
      'game.js',
      'renderer.js',
      'replay.js',
      'ui.js'
    ]),
    allowDirs: new Set(['public', 'rl', 'sim'])
  },
  {
    prefix: '/games/asteroid/',
    rootDir: join(ROOT_DIR, 'games', 'asteroid', 'dist'),
    allowAll: true
  },
  {
    prefix: '/games/slot60/',
    rootDir: join(ROOT_DIR, 'games', 'slot60', 'dist'),
    allowAll: true
  },
  {
    prefix: '/games/stackfall/',
    rootDir: join(ROOT_DIR, 'games', 'stackfall', 'dist'),
    allowAll: true
  },
  {
    prefix: '/games/chick-flap/',
    rootDir: join(ROOT_DIR, 'games', 'chick-flap', 'dist'),
    allowAll: true
  }
];

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    route TEXT NOT NULL,
    supports_touch INTEGER NOT NULL DEFAULT 0,
    supports_replay INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    current_game_version TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    game_version TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('human', 'ai')),
    name TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL CHECK(score >= 0),
    created_at TEXT NOT NULL,
    replay_format TEXT NOT NULL,
    replay_digest TEXT NOT NULL,
    replay_data TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}',
    verified INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (game_id) REFERENCES games(id),
    PRIMARY KEY (game_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_game_score
    ON leaderboard_entries(game_id, score DESC, created_at ASC, id ASC);
`);

const insertGameStatement = db.prepare(`
  INSERT INTO games (id, slug, title, description, route, supports_touch, supports_replay, sort_order, current_game_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    slug = excluded.slug,
    title = excluded.title,
    description = excluded.description,
    route = excluded.route,
    supports_touch = excluded.supports_touch,
    supports_replay = excluded.supports_replay,
    sort_order = excluded.sort_order,
    current_game_version = excluded.current_game_version
`);
const insertEntryStatement = db.prepare(`
  INSERT OR REPLACE INTO leaderboard_entries
    (id, game_id, game_version, kind, name, comment, score, created_at, replay_format, replay_digest, replay_data, summary_json, verified)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`);
const countEntriesByGameStatement = db.prepare(
  'SELECT count(*) AS total FROM leaderboard_entries WHERE game_id = ?'
);
const selectTopEntriesStatement = db.prepare(`
  SELECT
    id,
    game_id AS gameId,
    game_version AS gameVersion,
    kind,
    name,
    comment,
    score,
    created_at AS createdAt,
    replay_format AS replayFormat,
    replay_digest AS replayDigest,
    replay_data AS replayData,
    summary_json AS summaryJson,
    verified
  FROM leaderboard_entries
  WHERE game_id = ?
  ORDER BY score DESC, created_at ASC, id ASC
  LIMIT 10
`);
const selectEntryByIdStatement = db.prepare(`
  SELECT
    id,
    game_id AS gameId,
    game_version AS gameVersion,
    kind,
    name,
    comment,
    score,
    created_at AS createdAt,
    replay_format AS replayFormat,
    replay_digest AS replayDigest,
    replay_data AS replayData,
    summary_json AS summaryJson,
    verified
  FROM leaderboard_entries
  WHERE game_id = ? AND id = ?
`);
const selectTopEntryByGameStatement = db.prepare(`
  SELECT id, kind, name, score
  FROM leaderboard_entries
  WHERE game_id = ?
  ORDER BY score DESC, created_at ASC, id ASC
  LIMIT 1
`);
const deleteReplaylessEntriesStatement = db.prepare(
  "DELETE FROM leaderboard_entries WHERE game_id = ? AND (replay_data = '' OR replay_digest = '')"
);
const normalizeBlankCommentsStatement = db.prepare(
  "UPDATE leaderboard_entries SET comment = ? WHERE game_id = ? AND trim(comment) = ''"
);
const rateLimitState = new Map();

function seedGames() {
  for (const game of GAMES) {
    insertGameStatement.run(
      game.id,
      game.slug,
      game.title,
      game.description,
      game.route,
      game.supportsTouch ? 1 : 0,
      game.supportsReplay ? 1 : 0,
      game.sortOrder,
      game.currentGameVersion
    );

    if (game.supportsReplay) {
      deleteReplaylessEntriesStatement.run(game.id);
    }

    const adapter = adapters.get(game.id);
    if (!adapter) {
      continue;
    }

    for (const entry of adapter.loadSeedEntries()) {
      insertVerifiedEntry(game.id, entry);
    }
    normalizeBlankCommentsStatement.run('LEGACY SCORE', game.id);
    pruneEntriesToTopTen(game.id);
  }
}

function insertVerifiedEntry(gameId, entry) {
  insertEntryStatement.run(
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
  );
}

function pruneEntriesToTopTen(gameId) {
  const topRows = selectTopEntriesStatement.all(gameId);
  const retainedIds = topRows.map((row) => row.id);

  if (retainedIds.length === 0) {
    return retainedIds;
  }

  const placeholders = retainedIds.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM leaderboard_entries WHERE game_id = ? AND id NOT IN (${placeholders})`
  ).run(gameId, ...retainedIds);
  return retainedIds;
}

function formatEntry(row) {
  const summary = parseStoredJson(row.summaryJson, {});
  return {
    id: String(row.id),
    kind: row.kind,
    name: row.name,
    comment: row.comment,
    message: row.comment,
    score: Number(row.score ?? 0),
    createdAt: row.createdAt,
    gameVersion: row.gameVersion,
    replayId: String(row.id),
    replayAvailable: typeof row.replayData === 'string' && row.replayData.length > 0,
    summary,
    ...summary
  };
}

function formatVerifiedEntry(entry) {
  return {
    id: String(entry.id),
    kind: entry.kind,
    name: entry.name,
    comment: entry.comment,
    message: entry.comment,
    score: entry.score,
    createdAt: entry.createdAt,
    gameVersion: entry.gameVersion,
    replayId: String(entry.id),
    replayAvailable: typeof entry.replayData === 'string' && entry.replayData.length > 0,
    summary: entry.summary ?? {},
    ...(entry.summary ?? {})
  };
}

function buildLeaderboardPayload(gameId) {
  const rows = selectTopEntriesStatement.all(gameId);
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

function buildGamesPayload() {
  return {
    games: GAMES
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((game) => {
        const topEntry = selectTopEntryByGameStatement.get(game.id);
        return {
          ...game,
          topEntry: topEntry
            ? {
                id: String(topEntry.id),
                kind: topEntry.kind,
                name: topEntry.name,
                score: Number(topEntry.score ?? 0)
              }
            : null
        };
      })
  };
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BYTES) {
        rejectBody(createRequestError('Request body too large', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(createRequestError('Invalid JSON payload', 400));
      }
    });

    request.on('error', (error) => {
      rejectBody(error);
    });
  });
}

function createRequestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function isSameOriginWriteAllowed(request) {
  const host = request.headers.host;
  const origin = request.headers.origin;
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

function getClientAddress(request) {
  return request.socket.remoteAddress ?? 'unknown';
}

function takeRateLimitSlot(request, gameId) {
  const now = Date.now();
  if (rateLimitState.size > 512) {
    for (const [key, state] of rateLimitState.entries()) {
      if (state.resetAt <= now) {
        rateLimitState.delete(key);
      }
    }
  }

  const key = `${gameId}:${getClientAddress(request)}`;
  const current = rateLimitState.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitState.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return { limited: false };
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;
  return { limited: false };
}

function submitEntryForGame(gameId, payload) {
  const adapter = adapters.get(gameId);
  if (!adapter) {
    throw createRequestError('Unknown gameId', 404);
  }

  const verifiedEntry = adapter.validateSubmission(payload);
  insertVerifiedEntry(gameId, verifiedEntry);
  const retainedIds = pruneEntriesToTopTen(gameId);
  const keptInTop10 = retainedIds.includes(verifiedEntry.id);
  const leaderboard = buildLeaderboardPayload(gameId);
  return {
    entry: keptInTop10
      ? formatEntry(selectEntryByIdStatement.get(gameId, verifiedEntry.id))
      : formatVerifiedEntry(verifiedEntry),
    keptInTop10,
    leaderboard
  };
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/games') {
    sendJson(response, 200, buildGamesPayload());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
    const gameId = String(url.searchParams.get('gameId') ?? '').trim() || 'missile-command';
    if (!getGameById(gameId)) {
      sendJson(response, 404, { error: 'Unknown gameId' });
      return;
    }
    sendJson(response, 200, buildLeaderboardPayload(gameId));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/replay') {
    const gameId = String(url.searchParams.get('gameId') ?? 'asteroid').trim();
    const entryId = String(url.searchParams.get('entryId') ?? url.searchParams.get('id') ?? '').trim();
    if (!entryId) {
      sendJson(response, 400, { error: 'entryId is required' });
      return;
    }

    const adapter = adapters.get(gameId);
    const row = selectEntryByIdStatement.get(gameId, entryId);
    if (!adapter || !row || !row.replayData) {
      sendJson(response, 404, { error: 'Replay not found' });
      return;
    }

    sendJson(response, 200, adapter.toReplayResponse(row));
    return;
  }

  const snakeReplayMatch = request.method === 'GET' ? url.pathname.match(/^\/api\/replays\/([A-Za-z0-9-]+)$/) : null;
  if (snakeReplayMatch) {
    const row = selectEntryByIdStatement.get('snake60', snakeReplayMatch[1]);
    if (!row || !row.replayData) {
      sendJson(response, 404, { error: 'Replay not found' });
      return;
    }
    sendJson(response, 200, snake60Adapter.toReplayResponse(row));
    return;
  }

  const missileReplayMatch = request.method === 'GET' ? url.pathname.match(/^\/api\/replay\/([A-Za-z0-9-]+)$/) : null;
  if (missileReplayMatch) {
    const row = selectEntryByIdStatement.get('missile-command', missileReplayMatch[1]);
    if (!row || !row.replayData) {
      sendJson(response, 404, { error: 'Replay not found' });
      return;
    }
    sendJson(response, 200, missileCommandAdapter.toReplayResponse(row));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/scores') {
    sendJson(response, 200, buildLeaderboardPayload('snake60').combinedEntries);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/scores') {
    if (!isSameOriginWriteAllowed(request)) {
      sendJson(response, 403, { error: 'Cross-origin submissions are not allowed' });
      return;
    }

    const rateLimit = takeRateLimitSlot(request, 'snake60');
    if (rateLimit.limited) {
      sendJson(response, 429, { error: 'Too many submissions', retryAfterSeconds: rateLimit.retryAfterSeconds });
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const result = submitEntryForGame('snake60', payload);
      sendJson(response, 200, {
        scores: result.leaderboard.combinedEntries,
        entry: result.entry,
        keptInTop10: result.keptInTop10,
        verifiedScore: result.entry.score
      });
      return;
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, { error: error.message ?? 'Invalid submission' });
      return;
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/submit') {
    if (!isSameOriginWriteAllowed(request)) {
      sendJson(response, 403, { error: 'Cross-origin submissions are not allowed' });
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const gameId =
        String(payload?.gameId ?? '').trim() ||
        (typeof payload?.replayData === 'string' && typeof payload?.replayDigest === 'string'
          ? 'asteroid'
          : 'missile-command');

      const rateLimit = takeRateLimitSlot(request, gameId);
      if (rateLimit.limited) {
        sendJson(response, 429, { error: 'Too many submissions', retryAfterSeconds: rateLimit.retryAfterSeconds });
        return;
      }

      const result = submitEntryForGame(gameId, payload);
      if (gameId === 'missile-command') {
        sendJson(response, 200, {
          entry: result.entry,
          board: result.leaderboard,
          leaderboard: result.leaderboard,
          keptInTop10: result.keptInTop10
        });
        return;
      }

      sendJson(response, 200, {
        entry: result.entry,
        leaderboard: result.leaderboard,
        keptInTop10: result.keptInTop10
      });
      return;
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, { error: error.message ?? 'Invalid submission' });
      return;
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, port: PORT });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

function findStaticMount(pathname) {
  return staticMounts.find((mount) => pathname.startsWith(mount.prefix)) ?? null;
}

function isAllowedStaticPath(mount, relativePath) {
  if (!relativePath || relativePath.startsWith('..')) {
    return false;
  }
  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment.startsWith('.'))) {
    return false;
  }
  if (mount.allowAll) {
    return true;
  }
  if (segments.length === 1) {
    return mount.allowRootFiles?.has(segments[0]) ?? false;
  }
  return mount.allowDirs?.has(segments[0]) ?? false;
}

async function serveFile(response, filePath) {
  const body = await readFile(filePath);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

async function handleStatic(response, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    await serveFile(response, join(PLATFORM_PUBLIC_DIR, 'index.html'));
    return;
  }

  const rootPublicFile = pathname.replace(/^\//, '');
  if (PLATFORM_ROOT_FILES.has(rootPublicFile)) {
    await serveFile(response, join(PLATFORM_PUBLIC_DIR, rootPublicFile));
    return;
  }

  for (const mount of staticMounts) {
    const exactPrefix = mount.prefix.replace(/\/$/, '');
    if (pathname === exactPrefix) {
      await handleStatic(response, `${exactPrefix}/`);
      return;
    }
  }

  const mount = findStaticMount(pathname);
  if (!mount) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const mountPath = pathname.slice(mount.prefix.length);
  const requestedRelative = mountPath.length > 0 ? mountPath : 'index.html';
  const safeRelative = normalize(requestedRelative).replace(/^(\.\.[/\\])+/, '');
  const resolved = resolve(mount.rootDir, safeRelative);
  const relativePath = relative(mount.rootDir, resolved);

  if (!isAllowedStaticPath(mount, relativePath)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(resolved);
    if (fileStat.isDirectory()) {
      await handleStatic(response, `${pathname.replace(/\/?$/, '/') }index.html`);
      return;
    }
    await serveFile(response, resolved);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

seedGames();

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendJson(response, 400, { error: 'Invalid request' });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }

  await handleStatic(response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Platform server running on http://${HOST}:${PORT}`);
  console.log(`Platform data directory: ${DATA_DIR}`);
});
