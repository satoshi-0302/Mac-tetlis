import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName, sha256 } from '../sanitize.mjs';

const ROOT_DIR = fileURLToPath(new URL('../../games/snake60/', import.meta.url));
const SCORES_PATH = join(ROOT_DIR, 'scores.json');
const REPLAY_DIR = join(ROOT_DIR, 'replays');

const CURRENT_RULE_VERSION = 'snake60-rule-v2';
const LEGACY_REPLAY_VERSION = 'snake60-replay-v1';
const REPLAY_VERSION = 'snake60-replay-v2';
const REPLAY_TICK_RATE = 60;
const MAX_REPLAY_TICKS = 60 * 60;
const REPLAY_TICK_MS = 1000 / REPLAY_TICK_RATE;
const INITIAL_SPEED = 120;
const SPEED_INC = 2;
const START_TIME = 60;
const MIN_STRAIGHT_MOVES = 4;
const GRID_SIZE = 20;
const TILE_COUNT_X = 800 / GRID_SIZE;
const TILE_COUNT_Y = 600 / GRID_SIZE;
const INITIAL_SNAKE = [
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
  { x: 7, y: 10 },
  { x: 6, y: 10 },
  { x: 5, y: 10 }
];
const VALID_DIRECTION_CODES = new Set(['U', 'D', 'L', 'R']);
const DIRECTION_VECTORS = {
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 }
};

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function seededRandom(state) {
  let t = (state.gameSeed + 0x6d2b79f5) >>> 0;
  state.gameSeed = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function createInitialState(minStraightMoves) {
  const state = {
    snake: INITIAL_SNAKE.map((part) => ({ ...part })),
    velocity: { x: 1, y: 0 },
    lastInput: { x: 1, y: 0 },
    apples: [],
    score: 0,
    speed: INITIAL_SPEED,
    timeLeft: START_TIME,
    gameSeed: 12345,
    moveAccumulator: 0,
    frameCount: 0,
    minStraightMoves: Math.max(0, Math.min(MIN_STRAIGHT_MOVES, Number(minStraightMoves) || 0)),
    straightMovesSinceTurn: 0,
    gameOver: false,
    endReason: ''
  };
  placeApples(state);
  return state;
}

function placeApples(state) {
  const targetAppleCount = 5 + Math.floor(state.score / 10);
  while (state.apples.length < targetAppleCount) {
    let valid = false;
    let candidate = null;

    while (!valid) {
      candidate = {
        x: Math.floor(seededRandom(state) * TILE_COUNT_X),
        y: Math.floor(seededRandom(state) * TILE_COUNT_Y)
      };
      valid = !state.snake.some((segment) => segment.x === candidate.x && segment.y === candidate.y);
      if (valid) {
        valid = !state.apples.some((apple) => apple.x === candidate.x && apple.y === candidate.y);
      }
    }

    state.apples.push(candidate);
  }
}

function applyDirectionCode(state, code) {
  const vector = DIRECTION_VECTORS[code];
  if (!vector) {
    return;
  }

  if (state.lastInput.x === -vector.x && state.lastInput.y === -vector.y) {
    return;
  }

  const sameDirection = state.velocity.x === vector.x && state.velocity.y === vector.y;
  if (!sameDirection && state.straightMovesSinceTurn < state.minStraightMoves) {
    return;
  }

  state.velocity = { ...vector };
  if (!sameDirection) {
    state.straightMovesSinceTurn = 0;
  }
}

function updateLogic(state) {
  state.lastInput = { ...state.velocity };

  const nextHead = {
    x: state.snake[0].x + state.velocity.x,
    y: state.snake[0].y + state.velocity.y
  };

  if (nextHead.x < 0) nextHead.x = TILE_COUNT_X - 1;
  if (nextHead.x >= TILE_COUNT_X) nextHead.x = 0;
  if (nextHead.y < 0) nextHead.y = TILE_COUNT_Y - 1;
  if (nextHead.y >= TILE_COUNT_Y) nextHead.y = 0;

  if (state.snake.some((segment) => segment.x === nextHead.x && segment.y === nextHead.y)) {
    state.gameOver = true;
    state.endReason = 'collision';
    return;
  }

  state.snake.unshift(nextHead);

  let ateApple = false;
  for (let index = 0; index < state.apples.length; index += 1) {
    const apple = state.apples[index];
    if (apple.x === nextHead.x && apple.y === nextHead.y) {
      ateApple = true;
      state.score += 10;
      state.speed = Math.max(30, state.speed - SPEED_INC);
      state.apples.splice(index, 1);
      break;
    }
  }

  if (ateApple) {
    placeApples(state);
  } else {
    state.snake.pop();
  }

  state.straightMovesSinceTurn += 1;
}

function simulateReplay(directions, minStraightMoves) {
  const state = createInitialState(minStraightMoves);

  for (const code of directions) {
    applyDirectionCode(state, code);

    state.frameCount += 1;
    if (state.frameCount % REPLAY_TICK_RATE === 0) {
      state.timeLeft -= 1;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        state.gameOver = true;
        state.endReason = 'timeout';
      }
    }

    if (!state.gameOver) {
      state.moveAccumulator += REPLAY_TICK_MS;
      if (state.moveAccumulator >= state.speed) {
        updateLogic(state);
        state.moveAccumulator = 0;
      }
    }

    if (state.gameOver) {
      break;
    }
  }

  if (!state.gameOver) {
    return null;
  }

  return {
    score: state.score,
    timeLeft: state.timeLeft,
    durationTicks: directions.length,
    endReason: state.endReason
  };
}

function normalizeReplayPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const version = String(payload.version ?? '').trim();
  const tickRate = Number(payload.tickRate ?? 0);
  const directions = String(payload.directions ?? '').trim().toUpperCase();
  const minStraightMoves =
    version === LEGACY_REPLAY_VERSION
      ? 0
      : Math.max(0, Math.min(MIN_STRAIGHT_MOVES, Math.round(Number(payload.minStraightMoves) || 0)));

  if (!new Set([LEGACY_REPLAY_VERSION, REPLAY_VERSION]).has(version)) {
    return null;
  }
  if (tickRate !== REPLAY_TICK_RATE || directions.length === 0 || directions.length > MAX_REPLAY_TICKS) {
    return null;
  }
  if (Array.from(directions).some((code) => !VALID_DIRECTION_CODES.has(code))) {
    return null;
  }

  const summary = simulateReplay(directions, minStraightMoves);
  if (!summary) {
    return null;
  }

  return {
    version,
    tickRate: REPLAY_TICK_RATE,
    minStraightMoves,
    durationTicks: directions.length,
    directions,
    summary
  };
}

function determineSeedKind(entry) {
  return String(entry?.name ?? '').trim().toUpperCase() === 'AIBOT' ? 'ai' : 'human';
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export const snake60Adapter = {
  gameId: 'snake60',
  currentGameVersion: CURRENT_RULE_VERSION,

  loadSeedEntries() {
    let entries = [];
    try {
      const parsed = loadJson(SCORES_PATH);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry?.replayAvailable && entry?.replayId)
      .map((entry) => {
        try {
          const replayPath = join(REPLAY_DIR, `${entry.replayId}.json`);
          const replay = normalizeReplayPayload(loadJson(replayPath));
          if (!replay) {
            return null;
          }
          const replayData = JSON.stringify(replay);
          return {
            id: String(entry.id ?? entry.replayId ?? createEntryId('snake')),
            kind: determineSeedKind(entry),
            name: sanitizePlayerName(entry.name, 'ANON'),
            comment: sanitizeComment(entry.message ?? ''),
            score: replay.summary.score,
            summary: replay.summary,
            gameVersion: String(entry.ruleVersion ?? CURRENT_RULE_VERSION),
            createdAt: String(entry.createdAt ?? new Date().toISOString()),
            replayFormat: REPLAY_VERSION,
            replayData,
            replayDigest: sha256(replayData)
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  },

  validateSubmission(payload) {
    const replay = normalizeReplayPayload(payload?.replay);
    if (!replay) {
      throw createSubmissionError('Replay is required for Snake60 submissions');
    }

    const replayData = JSON.stringify(replay);
    return {
      id: createEntryId('snake'),
      kind: 'human',
      name: sanitizePlayerName(payload?.name, 'ANON'),
      comment: sanitizeComment(payload?.message ?? payload?.comment ?? ''),
      score: replay.summary.score,
      summary: replay.summary,
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: REPLAY_VERSION,
      replayData,
      replayDigest: sha256(replayData)
    };
  },

  toReplayResponse(row) {
    return parseStoredJson(row.replayData, null);
  }
};
