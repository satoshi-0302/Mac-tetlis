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
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  replay_format TEXT NOT NULL,
  replay_digest TEXT NOT NULL,
  replay_data TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  verified INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_id, id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_game_score
  ON leaderboard_entries(game_id, score DESC, created_at ASC, id ASC);
