import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DbRow, GameAdapter, LeaderboardEntry } from '../types.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.js';

// Game engine is plain JS — use createRequire to avoid tsc trying to compile it
const require = createRequire(import.meta.url);
const { GAME_VERSION, MAX_TICKS } = require('../../../games/asteroid/src/engine/constants.js') as {
  GAME_VERSION: string;
  MAX_TICKS: number;
};
const { runReplay } = require('../../../games/asteroid/src/game/sim-core.js') as {
  runReplay: (bytes: unknown, schedule: unknown) => { summary: { score: number } & Record<string, unknown> };
};
const { createSpawnSchedule } = require('../../../games/asteroid/src/game/spawn-schedule.js') as {
  createSpawnSchedule: (seed: number) => unknown;
};
const { decodeReplay, validateReplayBytes } = require('../../../games/asteroid/src/replay/replay.js') as {
  decodeReplay: (data: string) => unknown[];
  validateReplayBytes: (bytes: unknown) => boolean;
};

const ROOT_DIR = fileURLToPath(new URL('../../../games/asteroid/', import.meta.url));
const AI_LEADERBOARD_PATH = join(ROOT_DIR, 'public', 'rl', 'ai-top10.json');

function createSubmissionError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

interface VerifyResult {
  replayDigest: string;
  summary: Record<string, unknown>;
}

function verifyReplayData(
  replayData: unknown,
  claimedScore: number,
  replayDigest: unknown,
  seed = 0,
  { requireClaimedScoreMatch = true } = {}
): VerifyResult {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(replayDigest ?? ''))) {
    throw createSubmissionError('replayDigest must be a SHA-256 hex string');
  }

  let replayBytes: unknown[];
  try {
    replayBytes = decodeReplay(replayData);
  } catch {
    throw createSubmissionError('replayData is not valid base64');
  }

  if (!validateReplayBytes(replayBytes) || replayBytes.length !== MAX_TICKS) {
    throw createSubmissionError(`replayData must decode to exactly ${MAX_TICKS} frames`);
  }

  const digest = sha256(replayData);
  if (digest !== String(replayDigest).toLowerCase()) {
    throw createSubmissionError('replayDigest mismatch');
  }

  const spawnSchedule = createSpawnSchedule(seed);
  const replayResult = runReplay(replayBytes, spawnSchedule);
  if (requireClaimedScoreMatch && replayResult.summary.score !== claimedScore) {
    throw createSubmissionError(
      `score mismatch after verification (submitted ${claimedScore}, verified ${replayResult.summary.score}, seed ${seed})`
    );
  }

  return {
    replayDigest: digest,
    summary: {
      ...replayResult.summary,
      seed
    }
  };
}

export const asteroidAdapter = {
  gameId: 'asteroid',

  loadSeedEntries(): LeaderboardEntry[] {
    try {
      const parsed = JSON.parse(readFileSync(AI_LEADERBOARD_PATH, 'utf8')) as Record<string, unknown>;
      const generatedAt = String(parsed?.generatedAt ?? new Date().toISOString());
      const entries = Array.isArray(parsed?.entries) ? (parsed.entries as Record<string, unknown>[]) : [];

      const results: LeaderboardEntry[] = [];
      entries
        .filter((entry) => typeof entry?.replayData === 'string' && (entry.replayData as string).length > 0)
        .forEach((entry, index) => {
          try {
            const verified = verifyReplayData(
              entry.replayData,
              Math.max(0, Math.round(Number(entry.score) || 0)),
              entry.replayDigest,
              Number(entry.seed ?? 0),
              { requireClaimedScoreMatch: false }
            );
            const verifiedScore = Math.max(0, Math.round(Number(verified.summary?.score) || 0));
            results.push({
              id: String(entry.id ?? `asteroid-ai-${index + 1}`),
              kind: 'ai',
              name: sanitizePlayerName(entry.name, `AI-${index + 1}`),
              comment: sanitizeRequiredComment(entry.message ?? '', `AI RUN ${index + 1}`),
              score: verifiedScore,
              summary: verified.summary,
              gameVersion: String(parsed?.gameVersion ?? GAME_VERSION),
              createdAt: generatedAt,
              replayFormat: 'asteroid-input-base64-v1',
              replayData: String(entry.replayData),
              replayDigest: verified.replayDigest
            });
          } catch (e) {
            console.warn(`[AsteroidAdapter] Seed entry #${index + 1} failed verification: ${(e as Error).message}`);
          }
        });
      return results;
    } catch (err) {
      console.error(`[AsteroidAdapter] Critical failure loading seed entries: ${(err as Error).message}`);
      return [];
    }
  },

  validateSubmission(payload: unknown): LeaderboardEntry {
    const p = (payload ?? {}) as Record<string, unknown>;
    const claimedScore = Math.max(0, Math.round(Number(p.score ?? p.claimedScore) || 0));
    const verified = verifyReplayData(
      p.replayData,
      claimedScore,
      p.replayDigest,
      Number(p.seed ?? 0)
    );

    return {
      id: createEntryId('asteroid'),
      kind: p.kind === 'ai' ? 'ai' : 'human',
      name: sanitizePlayerName(p.name, 'ANON'),
      comment: sanitizeRequiredComment(p.message ?? p.comment ?? ''),
      score: (verified.summary as { score: number }).score,
      summary: verified.summary,
      gameVersion: String(GAME_VERSION),
      createdAt: new Date().toISOString(),
      replayFormat: 'asteroid-input-base64-v1',
      replayData: String(p.replayData),
      replayDigest: verified.replayDigest
    };
  },

  toReplayResponse(row: DbRow): unknown {
    const summary = parseStoredJson<Record<string, unknown>>(row.summaryJson, {});
    return {
      kind: row.kind,
      id: String(row.id),
      name: row.name,
      message: row.comment,
      score: row.score,
      replayDigest: row.replayDigest,
      replayData: row.replayData,
      seed: Number(summary.seed ?? 0),
      summary
    };
  }
} satisfies GameAdapter;
