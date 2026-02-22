#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const TILE_SIZE = 32;
const WIDTH = TILE_SIZE * 8;
const HEIGHT = TILE_SIZE * 2;

const OUTPUT_PATH = path.resolve(process.cwd(), 'public/spritesheet.png');

const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 0);

function parseHex(hex) {
  const clean = hex.replace('#', '');
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
    a: 255
  };
}

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
    return;
  }
  const offset = (y * WIDTH + x) * 4;
  pixels[offset] = color.r;
  pixels[offset + 1] = color.g;
  pixels[offset + 2] = color.b;
  pixels[offset + 3] = color.a;
}

function fillRect(x, y, w, h, colorHex) {
  const color = parseHex(colorHex);
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      setPixel(px, py, color);
    }
  }
}

function paintTile(cx, cy, painter) {
  painter(cx * TILE_SIZE, cy * TILE_SIZE);
}

function drawFloorBase(x, y) {
  fillRect(x, y, 32, 32, '#1f1a16');
  fillRect(x + 1, y + 1, 30, 30, '#3a312a');
  fillRect(x + 3, y + 3, 8, 8, '#473b33');
  fillRect(x + 12, y + 2, 6, 6, '#52453b');
  fillRect(x + 20, y + 5, 9, 5, '#4a3e35');
  fillRect(x + 5, y + 14, 12, 6, '#4b3d33');
  fillRect(x + 20, y + 15, 8, 9, '#55473d');
  fillRect(x + 10, y + 23, 10, 6, '#4a3d34');
}

function drawWallTile(x, y) {
  fillRect(x, y, 32, 32, '#171a1f');
  fillRect(x + 1, y + 1, 30, 30, '#404a57');
  for (let row = 0; row < 4; row += 1) {
    const rowY = y + 3 + row * 7;
    fillRect(x + 2, rowY, 28, 1, '#2b323d');
    const offset = row % 2 === 0 ? 3 : 8;
    for (let col = offset; col < 30; col += 10) {
      fillRect(x + col, rowY - 5, 1, 6, '#2b323d');
    }
  }
  fillRect(x + 2, y + 24, 28, 6, '#2d333d');
}

function drawStairsTile(x, y) {
  drawFloorBase(x, y);
  fillRect(x + 5, y + 5, 22, 22, '#8f929a');
  for (let i = 0; i < 6; i += 1) {
    const stepY = y + 7 + i * 3;
    fillRect(x + 7 + i, stepY, 18 - i * 2, 2, i % 2 === 0 ? '#dbdee5' : '#717680');
  }
  fillRect(x + 8, y + 6, 16, 1, '#f6f7fa');
}

function drawChestClosedTile(x, y) {
  drawFloorBase(x, y);
  fillRect(x + 5, y + 14, 22, 12, '#8a4b1c');
  fillRect(x + 4, y + 10, 24, 6, '#c37b31');
  fillRect(x + 14, y + 16, 4, 6, '#f1ce89');
  fillRect(x + 6, y + 20, 20, 1, '#613410');
}

function drawChestOpenTile(x, y) {
  drawFloorBase(x, y);
  fillRect(x + 5, y + 17, 22, 9, '#8a4b1c');
  fillRect(x + 4, y + 9, 10, 4, '#c37b31');
  fillRect(x + 18, y + 9, 10, 4, '#c37b31');
  fillRect(x + 14, y + 18, 4, 4, '#f1ce89');
}

function drawPlayerSprite(x, y) {
  fillRect(x + 12, y + 3, 8, 8, '#ffd9bd');
  fillRect(x + 10, y + 11, 12, 12, '#2f89d8');
  fillRect(x + 8, y + 23, 6, 7, '#1f4f88');
  fillRect(x + 18, y + 23, 6, 7, '#1f4f88');
  fillRect(x + 5, y + 13, 4, 2, '#d7e8ff');
  fillRect(x + 23, y + 13, 4, 2, '#d7e8ff');
  fillRect(x + 21, y + 9, 2, 12, '#c8d0dd');
  fillRect(x + 23, y + 10, 4, 2, '#dfe5ef');
}

function drawGoblinSprite(x, y) {
  fillRect(x + 10, y + 5, 12, 9, '#72b857');
  fillRect(x + 9, y + 14, 14, 11, '#436f32');
  fillRect(x + 7, y + 25, 6, 5, '#304f25');
  fillRect(x + 19, y + 25, 6, 5, '#304f25');
  fillRect(x + 12, y + 8, 2, 2, '#111111');
  fillRect(x + 18, y + 8, 2, 2, '#111111');
  fillRect(x + 14, y + 12, 4, 2, '#a4d987');
}

function drawOrcSprite(x, y) {
  fillRect(x + 10, y + 4, 12, 8, '#f0be8b');
  fillRect(x + 8, y + 12, 16, 12, '#7f573b');
  fillRect(x + 7, y + 24, 6, 6, '#5b3e2b');
  fillRect(x + 19, y + 24, 6, 6, '#5b3e2b');
  fillRect(x + 6, y + 11, 2, 13, '#9ca0aa');
  fillRect(x + 5, y + 10, 4, 2, '#c7ccd5');
  fillRect(x + 12, y + 7, 2, 2, '#111111');
  fillRect(x + 18, y + 7, 2, 2, '#111111');
}

function drawSkeletonSprite(x, y) {
  fillRect(x + 10, y + 4, 12, 9, '#e0e2e8');
  fillRect(x + 9, y + 13, 14, 12, '#a6adb8');
  fillRect(x + 7, y + 25, 6, 5, '#878c95');
  fillRect(x + 19, y + 25, 6, 5, '#878c95');
  fillRect(x + 12, y + 8, 2, 2, '#111111');
  fillRect(x + 18, y + 8, 2, 2, '#111111');
  fillRect(x + 13, y + 14, 6, 2, '#d2d5dc');
}

function drawDemonSprite(x, y) {
  fillRect(x + 8, y + 3, 16, 9, '#bf2222');
  fillRect(x + 7, y + 12, 18, 12, '#731111');
  fillRect(x + 5, y + 24, 7, 6, '#4f0d0d');
  fillRect(x + 20, y + 24, 7, 6, '#4f0d0d');
  fillRect(x + 9, y + 1, 4, 3, '#f1d27c');
  fillRect(x + 19, y + 1, 4, 3, '#f1d27c');
  fillRect(x + 12, y + 7, 2, 2, '#111111');
  fillRect(x + 18, y + 7, 2, 2, '#111111');
  fillRect(x + 12, y + 16, 8, 2, '#cc4040');
}

function drawMarkerStairs(x, y) {
  fillRect(x + 14, y + 3, 4, 20, '#fff38e');
  fillRect(x + 9, y + 20, 14, 4, '#fff38e');
  fillRect(x + 11, y + 24, 10, 3, '#f8fdcf');
}

function drawMarkerChest(x, y) {
  fillRect(x + 15, y + 6, 2, 2, '#bffff8');
  fillRect(x + 13, y + 8, 6, 2, '#8cefe7');
  fillRect(x + 11, y + 10, 10, 8, '#73ddd4');
  fillRect(x + 13, y + 18, 6, 2, '#8cefe7');
  fillRect(x + 15, y + 20, 2, 2, '#bffff8');
}

function drawUiCursor(x, y) {
  fillRect(x + 3, y + 3, 26, 3, '#f5d77a');
  fillRect(x + 3, y + 26, 26, 3, '#f5d77a');
  fillRect(x + 3, y + 6, 3, 20, '#f5d77a');
  fillRect(x + 26, y + 6, 3, 20, '#f5d77a');
}

paintTile(0, 0, drawFloorBase);
paintTile(1, 0, drawWallTile);
paintTile(2, 0, drawStairsTile);
paintTile(3, 0, drawChestClosedTile);
paintTile(4, 0, drawChestOpenTile);
paintTile(5, 0, drawPlayerSprite);
paintTile(6, 0, drawGoblinSprite);
paintTile(7, 0, drawOrcSprite);

paintTile(0, 1, drawSkeletonSprite);
paintTile(1, 1, drawDemonSprite);
paintTile(2, 1, drawMarkerStairs);
paintTile(3, 1, drawMarkerChest);
paintTile(4, 1, drawUiCursor);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 1) === 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc >>>= 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }

  const idat = deflateSync(raw, { level: 9 });
  const chunks = [makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', Buffer.alloc(0))];
  return Buffer.concat([signature, ...chunks]);
}

const outputDir = path.dirname(OUTPUT_PATH);
fs.mkdirSync(outputDir, { recursive: true });
const pngBuffer = encodePng(WIDTH, HEIGHT, pixels);
fs.writeFileSync(OUTPUT_PATH, pngBuffer);
console.log(`Generated spritesheet: ${OUTPUT_PATH}`);
