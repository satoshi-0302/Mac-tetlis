import { createHash, randomBytes } from 'node:crypto';

let emojiRegex: RegExp | null = null;
try {
  emojiRegex = new RegExp('\\p{Extended_Pictographic}', 'gu');
} catch {
  emojiRegex = null;
}

function stripEmoji(text: string): string {
  return emojiRegex ? text.replace(emojiRegex, '') : text;
}

function sanitizeText(value: unknown, maxChars: number): string {
  const cleaned = stripEmoji(String(value ?? ''))
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, maxChars).join('');
}

export function sanitizePlayerName(value: unknown, fallback = 'ANON'): string {
  const cleaned = sanitizeText(value, 12);
  return cleaned || fallback;
}

export function sanitizeComment(value: unknown): string {
  return sanitizeText(value, 20);
}

export function sanitizeRequiredComment(value: unknown, fallback = 'NO COMMENT'): string {
  const cleaned = sanitizeComment(value);
  return cleaned || fallback;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function createEntryId(prefix = 'entry'): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

export function parseStoredJson<T = unknown>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
