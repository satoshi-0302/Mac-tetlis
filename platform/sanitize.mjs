import { createHash, randomBytes } from 'node:crypto';

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

export function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function createEntryId(prefix = 'entry') {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`;
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
