function resolveApiBase(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalHost && port !== '9090' && port !== '8787') {
    return `${protocol}//${hostname}:9090`;
  }
  return '';
}

const API_BASE = resolveApiBase();

async function requestJson(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return payload;
}

export async function fetchLeaderboard() {
  return requestJson('/api/leaderboard?gameId=chick-flap', { method: 'GET' });
}

export async function fetchReplay(kind: string, id: string) {
  const params = new URLSearchParams({
    gameId: 'chick-flap',
    kind,
    id
  });
  return requestJson(`/api/replay?${params.toString()}`, { method: 'GET' });
}

export async function submitScore(submission: { name: string; score: number; replayData: string; replayDigest: string }) {
  return requestJson('/api/submit', {
    method: 'POST',
    body: JSON.stringify({
      ...submission,
      gameId: 'chick-flap'
    })
  });
}

/**
 * Basic SHA-256 for browser-side digest
 */
export async function computeDigest(data: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
