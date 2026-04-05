let emojiRegex = null;
try {
  emojiRegex = new RegExp('\\p{Extended_Pictographic}', 'gu');
} catch {
  emojiRegex = null;
}

function stripEmoji(text) {
  return emojiRegex ? text.replace(emojiRegex, '') : text;
}

function sanitizeText(value, maxChars) {
  const cleaned = stripEmoji(String(value ?? ''))
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, maxChars).join('');
}

export function sanitizePlayerName(value, fallback = 'ANON') {
  const cleaned = sanitizeText(value, 12);
  return cleaned || fallback;
}

export function sanitizeComment(value) {
  return sanitizeText(value, 20);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createEntryId(prefix = 'entry') {
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${Date.now()}-${suffix}`;
}

export function parseStoredJson(value, fallback = null) {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
