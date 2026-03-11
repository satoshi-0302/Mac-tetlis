import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const leaderboardPath = resolve(ROOT, 'games', 'missile-command', 'data', 'leaderboard.json');

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function buildEntries(source) {
  return [
    ...(Array.isArray(source?.humanEntries) ? source.humanEntries : []),
    ...(Array.isArray(source?.aiEntries) ? source.aiEntries : []),
  ]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, 10);
}

async function main() {
  const leaderboard = JSON.parse(await readFile(leaderboardPath, 'utf8'));
  const gameVersion = String(leaderboard?.gameVersion ?? 'orbital-shield-rl-poc-v3');
  const entries = buildEntries(leaderboard);

  const statements = [
    `DELETE FROM leaderboard_entries WHERE game_id = 'missile-command';`,
    ...entries.map((entry) => {
      const summary = JSON.stringify({
        maxChain: Number(entry.maxChain ?? 0),
        survivingCities: Number(entry.survivingCities ?? 0),
        clear: Boolean(entry.clear),
      });

      return `INSERT OR REPLACE INTO leaderboard_entries
        (id, game_id, game_version, kind, name, comment, score, created_at, replay_format, replay_digest, replay_data, summary_json, verified)
        VALUES (
          ${sqlString(entry.id)},
          'missile-command',
          ${sqlString(gameVersion)},
          ${sqlString(entry.kind === 'ai' ? 'ai' : 'human')},
          ${sqlString(entry.name ?? 'PILOT')},
          ${sqlString(entry.comment ?? '')},
          ${Math.max(0, Math.round(Number(entry.score) || 0))},
          ${sqlString(entry.createdAt ?? new Date().toISOString())},
          'none',
          '',
          '',
          ${sqlString(summary)},
          1
        );`;
    }),
  ];

  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'codex-web-platform', '--remote', '--command', statements.join('\n')],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );

  console.log(`Seeded ${entries.length} missile-command summary entries into remote D1.`);
}

await main();
