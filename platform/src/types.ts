/**
 * Shared platform types.
 * All game adapters and the server import from here.
 */

/** Game registration entry as defined in games.ts */
export interface GameConfig {
  id: string;
  slug: string;
  title: string;
  description: string;
  route: string;
  desktopRoute: string;
  mobileRoute: string;
  supportsTouch: boolean;
  supportsReplay: boolean;
  sortOrder: number;
  currentGameVersion: string;
}

/** A verified leaderboard entry that an adapter returns. */
export interface LeaderboardEntry {
  id: string;
  kind: 'human' | 'ai';
  name: string;
  comment: string;
  score: number;
  summary?: Record<string, unknown>;
  gameVersion: string;
  createdAt: string;
  replayFormat: string;
  replayData: string;
  replayDigest: string;
}

/**
 * A raw row as returned by SQLite SELECT statements.
 * Column aliases in queries map snake_case → camelCase.
 */
export interface DbRow {
  id: string;
  gameId: string;
  gameVersion: string;
  kind: string;
  name: string;
  comment: string;
  score: number;
  createdAt: string;
  replayFormat: string;
  replayDigest: string;
  replayData: string;
  summaryJson: string;
  verified: number;
}

/**
 * Interface that every game adapter must implement.
 * Adding a new game = create one file that satisfies this interface.
 */
export interface GameAdapter {
  /** Must match the id key used in GAMES and the adapters Map. */
  readonly gameId: string;

  /**
   * Load seed / legacy entries from game-local data files.
   * Called once at server start. Returns [] if no seeds exist.
   */
  loadSeedEntries(): LeaderboardEntry[];

  /**
   * Validate and normalise a raw submission payload.
   * Throws an Error with .statusCode set on failure.
   */
  validateSubmission(payload: unknown): LeaderboardEntry;

  /**
   * Convert a DB row into the JSON object returned by GET /api/replay.
   */
  toReplayResponse(row: DbRow): unknown;
}

/** Error with an HTTP status code, thrown by adapters and server handlers. */
export interface RequestError extends Error {
  statusCode: number;
}
