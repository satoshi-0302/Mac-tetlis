/// <reference types="vite/client" />

function resolveApiBase(): string {
  const env = import.meta.env ?? {};
  const configured = env.VITE_API_BASE;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const { protocol, hostname, port, pathname } = window.location;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (protocol === 'file:') {
    return 'http://127.0.0.1:8787';
  }
  if (pathname.startsWith('/games/chick-flap/')) {
    return '';
  }
  if (isLocalHost && port !== '8787') {
    return `${protocol}//${hostname}:8787`;
  }
  return '';
}

const API_BASE = resolveApiBase();

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return payload as T;
}

export interface LeaderboardEntry {
  id?: string;
  kind?: string;
  name: string;
  message?: string;
  score: number;
  createdAt?: string;
  replayAvailable?: boolean;
  gameVersion?: string;
}

export interface LeaderboardSnapshot {
  entries?: LeaderboardEntry[];
  combinedEntries?: LeaderboardEntry[];
  leaderboard?: LeaderboardEntry[];
}

export interface SubmitPayload {
  name: string;
  message: string;
  score: number;
  gameVersion: string;
}

export async function fetchLeaderboard(): Promise<LeaderboardSnapshot> {
  return requestJson<LeaderboardSnapshot>('/api/leaderboard?gameId=chick-flap', { method: 'GET' });
}

export async function submitScore(submission: SubmitPayload): Promise<unknown> {
  return requestJson('/api/submit', {
    method: 'POST',
    body: JSON.stringify({
      ...submission,
      gameId: 'chick-flap'
    })
  });
}
