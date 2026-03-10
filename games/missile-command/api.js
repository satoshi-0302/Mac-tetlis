const FALLBACK_API_BASE = "http://127.0.0.1:8787";
const GAME_ID = "missile-command";
let preferredBase = null;

function unique(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function getBaseCandidates() {
  const bases = [];

  if (typeof preferredBase === "string") {
    bases.push(preferredBase);
  }

  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    bases.push(window.location.origin);
  }

  bases.push(FALLBACK_API_BASE);
  return unique(bases);
}

async function requestJson(path, init = {}) {
  let lastError = null;

  for (const base of getBaseCandidates()) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const contentType = response.headers.get("content-type") ?? "";

      if (!response.ok || !contentType.includes("application/json")) {
        lastError = new Error(`API request failed (${response.status})`);
        continue;
      }

      preferredBase = base;
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("API request failed");
}

export async function fetchLeaderboard() {
  return requestJson(`/api/leaderboard?gameId=${encodeURIComponent(GAME_ID)}`, {
    method: "GET",
  });
}

export async function fetchReplay(replayId) {
  const entryId = encodeURIComponent(String(replayId ?? ""));
  return requestJson(`/api/replay?gameId=${encodeURIComponent(GAME_ID)}&entryId=${entryId}`, {
    method: "GET",
  });
}

export async function submitLeaderboardEntry(payload) {
  return requestJson("/api/submit", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      gameId: GAME_ID,
    }),
  });
}
