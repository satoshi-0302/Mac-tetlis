import leaderboardSeed from '../../games/slot60/data/leaderboard-seed.json' with { type: 'json' };
import { createEntryId, parseStoredJson, sanitizeComment, sanitizePlayerName, sha256 } from './worker-sanitize.mjs';

const CURRENT_RULE_VERSION = 'slot60-rule-v1';
const REPLAY_VERSION = 'slot60-replay-v1';
let seedEntriesCache = null;

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeRequiredComment(value, fallback = 'NO COMMENT') {
  const cleaned = sanitizeComment(value);
  return cleaned || fallback;
}

function isSymbol(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3;
}

function parseReplayPayload(replayData) {
  if (typeof replayData !== 'string' || replayData.length === 0) {
    throw createSubmissionError('replayData is required');
  }

  const parsed = parseStoredJson(replayData, null);
  if (!parsed || parsed.version !== REPLAY_VERSION) {
    throw createSubmissionError(`replayData must be a ${REPLAY_VERSION} JSON string`);
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

export const slotAdapter = {
  gameId: 'slot60',

  loadSeedEntries() {
    if (Array.isArray(seedEntriesCache)) {
      return seedEntriesCache;
    }

    const sourceEntries = Array.isArray(leaderboardSeed?.entries) ? leaderboardSeed.entries : [];
    const entries = [];

    for (const entry of sourceEntries) {
      const replayData = typeof entry?.replayData === 'string' ? entry.replayData : '';
      const replayDigest = typeof entry?.replayDigest === 'string' ? entry.replayDigest.toLowerCase() : '';
      if (!replayData || !/^[a-f0-9]{64}$/i.test(replayDigest)) {
        continue;
      }

      const parsedReplay = parseReplayPayload(replayData);

      const verifiedScore = Math.max(0, Math.floor(Number(parsedReplay?.rounds?.at(-1)?.scoreAfter) || 0));
      entries.push({
        id: String(entry?.id ?? createEntryId('slot60')),
        kind: entry?.kind === 'ai' ? 'ai' : 'human',
        name: sanitizePlayerName(entry?.name, 'PLAYER'),
        comment: sanitizeRequiredComment(entry?.comment ?? '', 'NO COMMENT'),
        score: verifiedScore,
        summary: {
          rounds: Array.isArray(parsedReplay?.rounds) ? parsedReplay.rounds.length : 0
        },
        gameVersion: CURRENT_RULE_VERSION,
        createdAt: String(entry?.createdAt ?? new Date().toISOString()),
        replayFormat: 'slot60-round-log-v1',
        replayData,
        replayDigest
      });
    }

    seedEntriesCache = entries;
    return seedEntriesCache;
  },

  async validateSubmission(payload) {
    const score = Math.max(0, Math.floor(Number(payload?.score) || 0));
    if (!Number.isFinite(score) || score <= 0) {
      throw createSubmissionError('score must be a positive number');
    }

    const replayData = typeof payload?.replayData === 'string' ? payload.replayData : '';
    const replayDigest = typeof payload?.replayDigest === 'string' ? payload.replayDigest.toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/i.test(replayDigest)) {
      throw createSubmissionError('replayDigest must be a SHA-256 hex string');
    }

    const actualDigest = await sha256(replayData);
    if (actualDigest !== replayDigest) {
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
      name: sanitizePlayerName(payload?.name, 'PLAYER'),
      comment: sanitizeRequiredComment(payload?.message ?? payload?.comment ?? '', 'NO COMMENT'),
      score: verifiedScore,
      summary: {
        rounds: replay.rounds.length
      },
      gameVersion: CURRENT_RULE_VERSION,
      createdAt: new Date().toISOString(),
      replayFormat: 'slot60-round-log-v1',
      replayData,
      replayDigest
    };
  },

  toReplayResponse(row) {
    return parseStoredJson(row.replay_data, null);
  }
};
