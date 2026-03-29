import type { DbRow, GameAdapter, LeaderboardEntry } from '../types.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.js';

const CURRENT_RULE_VERSION = 'slot60-rule-v1';

function createSubmissionError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function isSymbol(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3;
}

interface Slot60Round {
  results: number[];
  payout: number;
  scoreAfter: number;
  timeLeftMs: number;
  [key: string]: unknown;
}

interface Slot60Replay {
  version: string;
  strips: number[][];
  rounds: Slot60Round[];
  [key: string]: unknown;
}

function parseReplayPayload(replayData: string): Slot60Replay {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }

  const parsed = parseStoredJson<Slot60Replay | null>(replayData, null);
  if (!parsed || (parsed as Record<string, unknown>).version !== 'slot60-replay-v1') {
    throw createSubmissionError('replayData must be a slot60-replay-v1 JSON string');
  }

  if (!Array.isArray(parsed.strips) || parsed.strips.length !== 3) {
    throw createSubmissionError('replayData.strips must contain exactly 3 reels');
  }
  for (const strip of parsed.strips) {
    if (!Array.isArray(strip) || strip.length === 0 || strip.some((symbol) => !isSymbol(symbol))) {
      throw createSubmissionError('replayData.strips must be arrays of slot symbols');
    }
  }

  if (!Array.isArray(parsed.rounds) || parsed.rounds.length === 0) {
    throw createSubmissionError('replayData.rounds must contain at least one round');
  }

  let previousScore = 0;
  let previousTimeLeft = Number.POSITIVE_INFINITY;
  for (const round of parsed.rounds) {
    if (!Array.isArray(round?.results) || round.results.length !== 3 || round.results.some((symbol) => !isSymbol(symbol))) {
      throw createSubmissionError('Each replay round must have 3 slot results');
    }
    const payout = Math.max(0, Math.floor(Number(round?.payout) || 0));
    const scoreAfter = Math.max(0, Math.floor(Number(round?.scoreAfter) || 0));
    const timeLeftMs = Math.max(0, Math.floor(Number(round?.timeLeftMs) || 0));
    if (scoreAfter < previousScore || scoreAfter - previousScore !== payout) {
      throw createSubmissionError('Replay rounds must have consistent score progression');
    }
    if (timeLeftMs > previousTimeLeft) {
      throw createSubmissionError('Replay rounds must be ordered by time');
    }
    previousScore = scoreAfter;
    previousTimeLeft = timeLeftMs;
  }

  return parsed;
}

export const slot60Adapter = {
  gameId: 'slot60',

  loadSeedEntries(): LeaderboardEntry[] {
    return [];
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
    const verifiedScore = Math.max(0, Math.floor(Number(replay?.rounds?.at(-1)?.scoreAfter) || 0));
    if (verifiedScore !== score) {
      throw createSubmissionError(`score mismatch after verification (submitted ${score}, verified ${verifiedScore})`);
    }

    return {
      id: createEntryId('slot60'),
      kind: 'human',
      name: sanitizePlayerName(p.name, 'PLAYER'),
      comment: sanitizeRequiredComment(p.message ?? p.comment ?? ''),
      score: verifiedScore,
      summary: { rounds: replay.rounds.length },
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'slot60-round-log-v1',
      replayData,
      replayDigest: replayDigest.toLowerCase()
    };
  },

  toReplayResponse(row: DbRow): unknown {
    return parseStoredJson(row.replayData, null);
  }
} satisfies GameAdapter;
