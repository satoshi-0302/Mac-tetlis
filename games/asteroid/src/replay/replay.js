import { MAX_TICKS } from '../engine/constants.js';

export function createReplayBuffer() {
  return new Uint8Array(MAX_TICKS);
}

export function encodeReplay(replayBuffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(replayBuffer).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < replayBuffer.length; offset += chunkSize) {
    const chunk = replayBuffer.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function decodeReplay(replayBase64) {
  const sanitized = String(replayBase64).replace(/[\s\n\r\t]/g, '');

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(sanitized, 'base64'));
  }

  const binary = atob(sanitized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function validateReplayBytes(bytes) {
  return bytes instanceof Uint8Array && bytes.length === MAX_TICKS;
}

function bytesToHex(uint8) {
  return Array.from(uint8, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestString(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto subtle API is unavailable in this environment');
  }
  const data = new TextEncoder().encode(String(value ?? ''));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

export async function digestReplayBase64(replayBase64) {
  const sanitized = String(replayBase64).replace(/[\s\n\r\t]/g, '');
  return digestString(sanitized);
}
