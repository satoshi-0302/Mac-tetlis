CREATE TABLE IF NOT EXISTS leaderboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 5),
  message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 30),
  score INTEGER NOT NULL CHECK(score >= 0),
  replay_digest TEXT NOT NULL CHECK(length(replay_digest) = 64),
  replay_data TEXT NOT NULL DEFAULT '',
  game_version TEXT NOT NULL DEFAULT 'sim-60tick-v2',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score
  ON leaderboard(score DESC, created_at ASC, id ASC);
