import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DbRow, GameAdapter, LeaderboardEntry } from '../types.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.js';

// Game engine is plain JS — use createRequire to avoid tsc trying to compile it
const require = createRequire(import.meta.url);

interface ReplayMeta {
  gameVersion?: string;
}
interface MissileReplay {
  meta?: ReplayMeta;
}
interface VerifiedSummary {
  score: number;
  [key: string]: unknown;
}

const {
  deriveVerifiedReplaySummary,
  normalizeReplayPayload,
  readReplay
} = require('../../../games/missile-command/server/replay-store.js') as {
  deriveVerifiedReplaySummary: (replay: unknown) => VerifiedSummary | null;
  normalizeReplayPayload: (replay: unknown, meta: unknown) => MissileReplay | null;
  readReplay: (dir: string, id: unknown) => MissileReplay | null;
};

const ROOT_DIR = fileURLToPath(new URL('../../../games/missile-command/', import.meta.url));
const LEADERBOARD_PATH = join(ROOT_DIR, 'data', 'leaderboard.json');
const REPLAY_DIR = join(ROOT_DIR, 'data', 'replays');
const DEFAULT_GAME_VERSION = 'orbital-shield-rl-poc-v3';

function createSubmissionError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export const missileCommandAdapter = {
  gameId: 'missile-command',

  loadSeedEntries(): LeaderboardEntry[] {
    try {
      const parsed = JSON.parse(readFileSync(LEADERBOARD_PATH, 'utf8')) as Record<string, unknown>;
      const sourceEntries = [
        ...(Array.isArray(parsed?.humanEntries) ? (parsed.humanEntries as Record<string, unknown>[]) : []),
        ...(Array.isArray(parsed?.aiEntries) ? (parsed.aiEntries as Record<string, unknown>[]) : [])
      ];

      const results: LeaderboardEntry[] = [];
      for (const entry of sourceEntries.filter((e) => e?.replayAvailable && e?.replayId)) {
        const replay = readReplay(REPLAY_DIR, entry.replayId);
        const verifiedSummary = replay ? deriveVerifiedReplaySummary(replay) : null;
        if (!verifiedSummary) continue;

        const replayData = JSON.stringify(replay);
        const kind: 'human' | 'ai' = entry.kind === 'ai' ? 'ai' : 'human';
        results.push({
          id: String(entry.id ?? createEntryId('missile')),
          kind,
          name: sanitizePlayerName(entry.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
          comment: sanitizeRequiredComment(entry.comment ?? '', kind === 'ai' ? 'AI BENCHMARK' : 'LEGACY SCORE'),
          score: verifiedSummary.score,
          summary: verifiedSummary as Record<string, unknown>,
          gameVersion: String(replay?.meta?.gameVersion ?? parsed?.gameVersion ?? DEFAULT_GAME_VERSION),
          createdAt: String(entry.createdAt ?? new Date().toISOString()),
          replayFormat: 'missile-replay-json-v1',
          replayData,
          replayDigest: sha256(replayData)
        });
      }
      return results;
    } catch {
      return [];
    }
  },

  validateSubmission(payload: unknown): LeaderboardEntry {
    const p = (payload ?? {}) as Record<string, unknown>;
    const kind: 'human' | 'ai' = p.kind === 'ai' ? 'ai' : 'human';
    const replay = normalizeReplayPayload(p.replay, {
      kind,
      name: sanitizePlayerName(p.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
      policyName: '',
      note: '',
      source: '',
      score: Math.max(0, Math.round(Number(p.score) || 0)),
      maxChain: Math.max(0, Math.round(Number(p.maxChain) || 0)),
      survivingCities: Math.max(0, Math.round(Number(p.survivingCities) || 0)),
      clear: Boolean(p.clear)
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
      name: sanitizePlayerName(p.name, kind === 'ai' ? 'DEMO AI' : 'PILOT'),
      comment: sanitizeRequiredComment(p.comment ?? p.message ?? ''),
      score: verifiedSummary.score,
      summary: verifiedSummary as Record<string, unknown>,
      gameVersion: String(replay?.meta?.gameVersion ?? DEFAULT_GAME_VERSION),
      createdAt: new Date().toISOString(),
      replayFormat: 'missile-replay-json-v1',
      replayData,
      replayDigest: sha256(replayData)
    };
  },

  toReplayResponse(row: DbRow): unknown {
    return parseStoredJson(row.replayData, null);
  }
} satisfies GameAdapter;
