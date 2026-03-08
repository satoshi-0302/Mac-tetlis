const FALLBACK_API_BASE = "http://127.0.0.1:8787";
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
  return requestJson("/api/leaderboard", {
    method: "GET",
  });
}

export async function fetchReplay(replayId) {
  return requestJson(`/api/replay/${encodeURIComponent(String(replayId ?? ""))}`, {
    method: "GET",
  });
}

export async function submitLeaderboardEntry(payload) {
  return requestJson("/api/submit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
