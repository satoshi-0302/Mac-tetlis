import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DbRow, GameAdapter, LeaderboardEntry } from '../types.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.js';

const CURRENT_RULE_VERSION = 'slot60-rule-v1';
const ROOT_DIR = fileURLToPath(new URL('../../../games/slot60/', import.meta.url));
const SEED_PATH = join(ROOT_DIR, 'data', 'leaderboard-seed.json');

function createSubmissionError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function isSymbol(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3;
}

interface Slot60Round {
  tick: number;
  action: 'primary';
  [key: string]: unknown;
}

interface Slot60Replay {
  version: string;
  strips: number[][];
  totalTicks: number;
  actions: Slot60Round[];
  finalScore?: number;
  [key: string]: unknown;
}

function parseReplayPayload(replayData: string): Slot60Replay {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }

  const parsed = parseStoredJson<Slot60Replay | null>(replayData, null);
  if (!parsed || (parsed as Record<string, unknown>).version !== 'slot60-replay-v2') {
    throw createSubmissionError('replayData must be a slot60-replay-v2 JSON string');
  }

  if (!Array.isArray(parsed.strips) || parsed.strips.length !== 3) {
    throw createSubmissionError('replayData.strips must contain exactly 3 reels');
  }
  for (const strip of parsed.strips) {
    if (!Array.isArray(strip) || strip.length === 0 || strip.some((symbol) => !isSymbol(symbol))) {
      throw createSubmissionError('replayData.strips must be arrays of slot symbols');
    }
  }

  if (Math.max(0, Math.floor(Number(parsed.totalTicks) || 0)) !== 3600) {
    throw createSubmissionError('replayData.totalTicks must be exactly 3600');
  }

  if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
    throw createSubmissionError('replayData.actions must contain at least one action');
  }

  let previousTick = -1;
  for (const action of parsed.actions) {
    const tick = Math.max(0, Math.floor(Number(action?.tick) || 0));
    if (tick < previousTick) {
      throw createSubmissionError('Replay actions must be ordered by tick');
    }
    if (tick >= 3600) {
      throw createSubmissionError('Replay actions must stay within the 3600 tick window');
    }
    if (action?.action !== 'primary') {
      throw createSubmissionError('Replay actions only support primary input');
    }
    previousTick = tick;
  }

  return parsed;
}

export const slot60Adapter = {
  gameId: 'slot60',

  loadSeedEntries(): LeaderboardEntry[] {
    try {
      const parsed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { entries?: Record<string, unknown>[] };
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      const loadedEntries: LeaderboardEntry[] = [];

      for (const entry of entries) {
          const replayData = typeof entry?.replayData === 'string' ? entry.replayData : '';
          const replayDigest = typeof entry?.replayDigest === 'string' ? entry.replayDigest.toLowerCase() : '';
          if (!replayData || !/^[a-f0-9]{64}$/i.test(replayDigest) || sha256(replayData) !== replayDigest) {
            continue;
          }

          const replay = parseReplayPayload(replayData);
          const verifiedScore = Math.max(0, Math.floor(Number(replay?.finalScore ?? entry?.score) || 0));
          loadedEntries.push({
            id: String(entry?.id ?? createEntryId('slot60')),
            kind: entry?.kind === 'ai' ? 'ai' : 'human',
            name: sanitizePlayerName(entry?.name, 'PLAYER'),
            comment: sanitizeRequiredComment(entry?.comment ?? '', 'NO COMMENT'),
            score: verifiedScore,
            summary: { actions: replay.actions.length, totalTicks: replay.totalTicks },
            gameVersion: CURRENT_RULE_VERSION,
            createdAt: String(entry?.createdAt ?? new Date().toISOString()),
            replayFormat: 'slot60-action-log-v2',
            replayData,
            replayDigest
          });
      }
      return loadedEntries;
    } catch {
      return [];
    }
  },

  validateSubmission(payload: unknown): LeaderboardEntry {
    const p = (payload ?? {}) as Record<string, unknown>;
    const score = Math.max(0, Math.floor(Number(p.score) || 0));
    if (!Number.isFinite(score) || score <= 0) {
      throw createSubmissionError('score must be a positive number');
    }

    const replayData = typeof p.replayData === 'string' ? p.replayData : '';
    const replayDigest = typeof p.replayDigest === 'string' ? p.replayDigest : '';
    if (!/^[a-f0-9]{64}$/i.test(replayDigest)) {
      throw createSubmissionError('replayDigest must be a SHA-256 hex string');
    }
    if (sha256(replayData) !== replayDigest.toLowerCase()) {
      throw createSubmissionError('replayDigest mismatch');
    }

    const replay = parseReplayPayload(replayData);
    const verifiedScore = Math.max(0, Math.floor(Number(replay?.finalScore ?? 0) || 0));
    if (verifiedScore !== score) {
      throw createSubmissionError(`score mismatch after verification (submitted ${score}, verified ${verifiedScore})`);
    }

    return {
      id: createEntryId('slot60'),
      kind: 'human',
      name: sanitizePlayerName(p.name, 'PLAYER'),
      comment: sanitizeRequiredComment(p.message ?? p.comment ?? ''),
      score: verifiedScore,
      summary: { actions: replay.actions.length, totalTicks: replay.totalTicks },
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'slot60-action-log-v2',
      replayData,
      replayDigest: replayDigest.toLowerCase()
    };
  },

  toReplayResponse(row: DbRow): unknown {
    return parseStoredJson(row.replayData, null);
  }
} satisfies GameAdapter;
