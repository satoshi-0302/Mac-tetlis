import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGET = process.argv[2] || 'https://codex-web-platform.yqs01140.workers.dev';
const leaderboardPath = resolve(ROOT, 'games', 'missile-command', 'data', 'leaderboard.json');
const replayDir = resolve(ROOT, 'games', 'missile-command', 'data', 'replays');

function normalizeEntries(source) {
  return [
    ...(Array.isArray(source?.humanEntries) ? source.humanEntries : []),
    ...(Array.isArray(source?.aiEntries) ? source.aiEntries : []),
  ].filter((entry) => entry?.replayAvailable && entry?.replayId);
}

async function main() {
  const leaderboard = JSON.parse(await readFile(leaderboardPath, 'utf8'));
  const entries = normalizeEntries(leaderboard);

  for (const entry of entries) {
    const replayPath = resolve(replayDir, `${entry.replayId}.json`);
    const replay = JSON.parse(await readFile(replayPath, 'utf8'));

    const response = await fetch(`${TARGET}/api/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gameId: 'missile-command',
        kind: entry.kind === 'ai' ? 'ai' : 'human',
        name: entry.name,
        comment: entry.comment ?? '',
        replay,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Seed failed for ${entry.replayId}: ${response.status} ${body}`);
    }
  }

  console.log(`Seeded ${entries.length} missile-command entries to ${TARGET}`);
}

await main();
