const baseUrl = String(process.argv[2] || 'https://codex-web-platform.yqs01140.workers.dev').replace(/\/+$/, '');

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log(`Smoke test target: ${baseUrl}`);

  const health = await requestJson('/api/health');
  assert(health.ok, `health check failed: ${health.status}`);
  assert(health.payload?.ok === true, 'health payload did not return ok=true');
  console.log('PASS /api/health');

  const games = await requestJson('/api/games');
  assert(games.ok, `games API failed: ${games.status}`);
  assert(Array.isArray(games.payload?.games), 'games payload is not an array');
  assert(games.payload.games.length >= 4, 'games payload has fewer than 4 entries');
  console.log('PASS /api/games');

  const slotLeaderboardBefore = await requestJson('/api/leaderboard?gameId=slot60');
  assert(slotLeaderboardBefore.ok, `slot leaderboard failed: ${slotLeaderboardBefore.status}`);
  console.log('PASS /api/leaderboard?gameId=slot60');

  const smokeName = `SMOKE${Date.now().toString().slice(-4)}`;
  const submit = await requestJson('/api/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      gameId: 'slot60',
      name: smokeName,
      score: 1111
    })
  });
  assert(submit.ok, `slot submit failed: ${submit.status}`);
  assert(submit.payload?.entry?.name === smokeName, 'slot submit response does not contain the smoke entry');
  console.log('PASS /api/submit (slot60)');

  const slotLeaderboardAfter = await requestJson('/api/leaderboard?gameId=slot60');
  assert(slotLeaderboardAfter.ok, `slot leaderboard after submit failed: ${slotLeaderboardAfter.status}`);
  const names = Array.isArray(slotLeaderboardAfter.payload?.entries)
    ? slotLeaderboardAfter.payload.entries.map((entry) => entry?.name)
    : [];
  assert(names.includes(smokeName), 'smoke entry was not found in the slot60 leaderboard');
  console.log('PASS leaderboard refresh after submit');

  console.log('Smoke test completed successfully.');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
