import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  deriveVerifiedReplaySummary,
  normalizeReplayPayload,
  readReplay,
  pruneReplayFiles,
  writeReplay,
} from "./replay-store.js";

const EMPTY_BOARD = Object.freeze({
  gameVersion: "orbital-shield-rl-poc-v3",
  humanEntries: [],
  aiEntries: [],
});

function cloneBoard(board) {
  return {
    gameVersion: board.gameVersion,
    humanEntries: [...board.humanEntries],
    aiEntries: [...board.aiEntries],
  };
}

function ensureBoardFile(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    readFileSync(filePath, "utf8");
  } catch (error) {
    writeFileSync(filePath, JSON.stringify(EMPTY_BOARD, null, 2), "utf8");
  }
}

function normalizeName(name, fallback) {
  const value = String(name ?? "").trim();
  if (!value) {
    return fallback;
  }
  return Array.from(value).slice(0, 12).join("");
}

function normalizeComment(comment) {
  const value = String(comment ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(value).slice(0, 20).join("");
}

function normalizeEntry(input, index) {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind === "ai" ? "ai" : "human",
    name: normalizeName(input.name, input.kind === "ai" ? "DEMO AI" : "PILOT"),
    score: 0,
    maxChain: 0,
    survivingCities: 0,
    clear: false,
    createdAt: new Date().toISOString(),
    policyName: normalizeName(input.policyName, ""),
    comment: normalizeComment(input.comment),
    note: normalizeName(input.note, ""),
    replayId: "",
    replayAvailable: false,
  };
}

function createSubmissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeLiveSummary(input) {
  return {
    score: Math.max(0, Math.round(Number(input?.score) || 0)),
    maxChain: Math.max(0, Math.round(Number(input?.maxChain) || 0)),
    survivingCities: Math.max(0, Math.round(Number(input?.survivingCities) || 0)),
    clear: Boolean(input?.clear),
  };
}

function applyLiveSummaryToReplay(replay, liveSummary) {
  if (!replay || !Array.isArray(replay.frames) || replay.frames.length === 0) {
    return replay;
  }

  const lastFrameIndex = replay.frames.length - 1;
  const lastFrame = replay.frames[lastFrameIndex];
  const currentCities = Array.isArray(lastFrame?.cities) ? lastFrame.cities : [];
  let aliveCitiesToKeep = liveSummary.survivingCities;

  const patchedCities = currentCities.map((city) => {
    if (aliveCitiesToKeep > 0) {
      aliveCitiesToKeep -= 1;
      return { ...city, alive: true };
    }
    return { ...city, alive: false };
  });

  const currentEvents = Array.isArray(lastFrame?.events) ? lastFrame.events : [];
  const patchedEvents = currentEvents.filter((event) => event?.type !== "result");
  patchedEvents.push({
    type: "result",
    result: liveSummary.clear ? "clear" : "gameover",
  });

  replay.frames[lastFrameIndex] = {
    ...lastFrame,
    score: liveSummary.score,
    maxChain: liveSummary.maxChain,
    cities: patchedCities,
    events: patchedEvents,
  };

  replay.summary = {
    ...(replay.summary ?? {}),
    score: liveSummary.score,
    maxChain: liveSummary.maxChain,
    survivingCities: liveSummary.survivingCities,
    clear: liveSummary.clear,
    duration: replay.summary?.duration ?? lastFrame?.elapsed ?? 0,
  };

  return replay;
}

function buildVerifiedSubmission(input, index) {
  const entry = normalizeEntry(input, index);
  const liveSummary = normalizeLiveSummary(input);
  const replay = normalizeReplayPayload(input?.replay, {
    kind: entry.kind,
    name: entry.name,
    policyName: entry.policyName,
    note: entry.note,
    source: typeof input?.source === "string" ? input.source : entry.note,
    score: liveSummary.score,
    maxChain: liveSummary.maxChain,
    survivingCities: liveSummary.survivingCities,
    clear: liveSummary.clear,
  });

  if (!replay) {
    throw createSubmissionError("Replay is required for leaderboard submissions");
  }

  const canonicalReplay = applyLiveSummaryToReplay(replay, liveSummary);
  const verifiedSummary = deriveVerifiedReplaySummary(canonicalReplay);
  if (!verifiedSummary) {
    throw createSubmissionError("Replay could not be verified");
  }

  entry.score = liveSummary.score;
  entry.maxChain = liveSummary.maxChain;
  entry.survivingCities = liveSummary.survivingCities;
  entry.clear = liveSummary.clear;

  return {
    entry,
    replay: canonicalReplay,
  };
}

function normalizeStoredEntry(input, index) {
  const normalized = normalizeEntry(input, index);
  const replayId = typeof input?.replayId === "string" ? input.replayId.trim() : "";

  return {
    ...normalized,
    id: typeof input?.id === "string" && input.id.trim() ? input.id : normalized.id,
    score: Math.max(0, Math.round(Number(input?.score) || 0)),
    maxChain: Math.max(0, Math.round(Number(input?.maxChain) || 0)),
    survivingCities: Math.max(0, Math.round(Number(input?.survivingCities) || 0)),
    clear: Boolean(input?.clear),
    createdAt:
      typeof input?.createdAt === "string" && input.createdAt.trim()
        ? input.createdAt
        : normalized.createdAt,
    comment: normalizeComment(input?.comment ?? normalized.comment),
    replayId,
    replayAvailable: Boolean(input?.replayAvailable && replayId),
  };
}

function sortEntries(entries) {
  entries.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.clear !== left.clear) {
      return Number(right.clear) - Number(left.clear);
    }
    if (right.maxChain !== left.maxChain) {
      return right.maxChain - left.maxChain;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

const DUMMY_SCORES = [3000, 2600, 2200, 1900, 1700, 1500, 1400, 1300, 1200];

function buildCombinedEntries(board) {
  const combined = [...board.aiEntries, ...board.humanEntries];
  sortEntries(combined);
  const entries = combined.slice(0, 10);
  let nextDummyIndex = 0;
  while (entries.length < 10) {
    const placeholderScore = DUMMY_SCORES[nextDummyIndex] ?? 1000;
    entries.push({
      id: `placeholder-${entries.length + 1}`,
      kind: "placeholder",
      name: "OPEN SLOT",
      score: placeholderScore,
      maxChain: 0,
      survivingCities: 0,
      clear: false,
      createdAt: new Date(0).toISOString(),
      policyName: "",
      comment: "",
      note: "",
      replayId: "",
      replayAvailable: false,
    });
    nextDummyIndex += 1;
  }
  return entries;
}

export function readLeaderboard(filePath) {
  ensureBoardFile(filePath);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const replayDir = join(dirname(filePath), "replays");
    const repairEntries = (entries = []) =>
      entries
        .map((entry, index) => normalizeStoredEntry(entry, index))
        .map((entry) => {
          if (!entry.replayId) {
            return null;
          }

          const replay = readReplay(replayDir, entry.replayId);
          const verifiedSummary = replay ? deriveVerifiedReplaySummary(replay) : null;
          if (!verifiedSummary) {
            return null;
          }

          return {
            ...entry,
            score: verifiedSummary.score,
            maxChain: verifiedSummary.maxChain,
            survivingCities: verifiedSummary.survivingCities,
            clear: verifiedSummary.clear,
            replayAvailable: true,
          };
        })
        .filter(Boolean);

    const humanEntries = Array.isArray(parsed?.humanEntries) ? repairEntries(parsed.humanEntries) : [];
    const aiEntries = Array.isArray(parsed?.aiEntries) ? repairEntries(parsed.aiEntries) : [];
    const board = {
      gameVersion: parsed?.gameVersion ?? EMPTY_BOARD.gameVersion,
      humanEntries,
      aiEntries,
    };

    return {
      ...board,
      combinedEntries: buildCombinedEntries(board),
    };
  } catch (error) {
    const fallback = cloneBoard(EMPTY_BOARD);
    return {
      ...fallback,
      combinedEntries: buildCombinedEntries(fallback),
    };
  }
}

export function writeLeaderboard(filePath, board) {
  ensureBoardFile(filePath);
  const persistedBoard = cloneBoard(board);
  writeFileSync(filePath, JSON.stringify(persistedBoard, null, 2), "utf8");
}

function getRetainedReplayIds(board) {
  return [
    ...board.humanEntries.map((entry) => entry.replayId).filter(Boolean),
    ...board.aiEntries.map((entry) => entry.replayId).filter(Boolean),
  ];
}

export function submitEntry(filePath, replayDir, input) {
  const board = readLeaderboard(filePath);
  const { entry, replay } = buildVerifiedSubmission(
    input,
    board.humanEntries.length + board.aiEntries.length + 1,
  );
  entry.replayId = entry.id;
  entry.replayAvailable = writeReplay(replayDir, entry.replayId, replay);
  const targetKey = entry.kind === "ai" ? "aiEntries" : "humanEntries";
  board[targetKey].push(entry);
  sortEntries(board[targetKey]);
  board[targetKey] = board[targetKey].slice(0, 10);
  const keptInTop10 = board[targetKey].some((item) => item.id === entry.id);
  pruneReplayFiles(replayDir, getRetainedReplayIds(board));
  writeLeaderboard(filePath, board);
  const refreshedBoard = readLeaderboard(filePath);
  return {
    entry,
    board: refreshedBoard,
    keptInTop10,
  };
}
