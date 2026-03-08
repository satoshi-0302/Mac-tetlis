function resolveApiBase() {
  const env = import.meta.env ?? {};
  const configured = env.VITE_API_BASE;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (protocol === 'file:') {
    return 'http://127.0.0.1:8787';
  }
  if (isLocalHost && port !== '8787') {
    return `${protocol}//${hostname}:8787`;
  }

  return '';
}

const API_BASE = resolveApiBase();

async function requestJson(path, options = {}) {
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
  return requestJson('/api/leaderboard', { method: 'GET' });
}

export async function fetchReplay(kind, id) {
  const params = new URLSearchParams({
    kind: String(kind ?? ''),
    id: String(id ?? '')
  });
  return requestJson(`/api/replay?${params.toString()}`, { method: 'GET' });
}

export async function submitScore(submission) {
  return requestJson('/api/submit', {
    method: 'POST',
    body: JSON.stringify(submission)
  });
}
