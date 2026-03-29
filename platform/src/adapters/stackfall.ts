import type { DbRow, GameAdapter, LeaderboardEntry } from '../types.js';
import { createEntryId, parseStoredJson, sanitizePlayerName, sanitizeRequiredComment, sha256 } from '../sanitize.js';

const CURRENT_RULE_VERSION = 'stackfall-rule-v1';

function createSubmissionError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

interface StackfallReplayDecoded {
  seed: number;
  events: Record<string, Record<string, unknown>>;
}

function parseReplayPayload(replayData: string): StackfallReplayDecoded {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(replayData, 'base64').toString('utf8'));
  } catch {
    throw createSubmissionError('replayData must be valid base64 JSON');
  }

  const d = decoded as Record<string, unknown>;
  const seed = Number(d?.seed);
  const events = d?.events;
  if (!Number.isInteger(seed) || seed < 0) {
    throw createSubmissionError('replayData.seed must be a non-negative integer');
  }
  if (!events || typeof events !== 'object' || Array.isArray(events)) {
    throw createSubmissionError('replayData.events must be an object');
  }

  for (const [tick, input] of Object.entries(events as Record<string, unknown>)) {
    if (!/^\d+$/.test(String(tick))) {
      throw createSubmissionError('replayData.events keys must be tick numbers');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw createSubmissionError('replayData.events values must be objects');
    }
  }

  return { seed, events: events as Record<string, Record<string, unknown>> };
}

export const stackfallAdapter = {
  gameId: 'stackfall',

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
    parseReplayPayload(replayData);

    return {
      id: createEntryId('stackfall'),
      kind: 'human',
      name: sanitizePlayerName(p.name, 'PLAYER'),
      comment: sanitizeRequiredComment(p.message ?? p.comment ?? ''),
      score,
      summary: {},
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'stackfall-events-v1',
      replayData,
      replayDigest
    };
  },

  toReplayResponse(row: DbRow): unknown {
    const replay = parseStoredJson<StackfallReplayDecoded | null>(
      Buffer.from(String(row.replayData ?? ''), 'base64').toString('utf8'),
      null
    );
    return {
      kind: row.kind,
      id: String(row.id),
      name: row.name,
      message: row.comment,
      score: row.score,
      replayDigest: row.replayDigest,
      replayData: row.replayData,
      seed: replay?.seed,
      events: replay?.events,
      summary: {}
    };
  }
} satisfies GameAdapter;
