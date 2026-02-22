// Room-and-corridor dungeon generation for a fixed 40x24 grid.

import { RNG } from './rng';
import type { DungeonFloor, Position, Rect, TileType } from './types';

const MIN_ROOM_W = 5;
const MAX_ROOM_W = 10;
const MIN_ROOM_H = 4;
const MAX_ROOM_H = 8;
const MIN_ROOMS = 4;
const MAX_ROOMS = 6;
const ROOM_PADDING = 3;
const ROOM_PLACE_ATTEMPTS = 280;
const ROOM_EDGE_PADDING = 1;

function createWallGrid(width: number, height: number): TileType[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => 'wall' as TileType));
}

function centerOfRect(rect: Rect): Position {
  return {
    x: Math.floor(rect.x + rect.w / 2),
    y: Math.floor(rect.y + rect.h / 2)
  };
}

function carveRoom(tiles: TileType[][], room: Rect): void {
  for (let y = room.y; y < room.y + room.h; y += 1) {
    for (let x = room.x; x < room.x + room.w; x += 1) {
      tiles[y][x] = 'floor';
    }
  }
}

function carveFloorTile(tiles: TileType[][], x: number, y: number): void {
  if (y < 0 || y >= tiles.length || x < 0 || x >= tiles[0].length) {
    return;
  }
  tiles[y][x] = 'floor';
}

function carveHorizontalTunnel(tiles: TileType[][], x1: number, x2: number, y: number): void {
  const from = Math.min(x1, x2);
  const to = Math.max(x1, x2);
  for (let x = from; x <= to; x += 1) {
    carveFloorTile(tiles, x, y);
  }
}

function carveVerticalTunnel(tiles: TileType[][], y1: number, y2: number, x: number): void {
  const from = Math.min(y1, y2);
  const to = Math.max(y1, y2);
  for (let y = from; y <= to; y += 1) {
    carveFloorTile(tiles, x, y);
  }
}

function isOverlappingWithPadding(a: Rect, b: Rect, padding: number): boolean {
  return (
    a.x - padding < b.x + b.w &&
    a.x + a.w + padding > b.x &&
    a.y - padding < b.y + b.h &&
    a.y + a.h + padding > b.y
  );
}

function randomRoom(width: number, height: number, rng: RNG): Rect {
  const roomW = rng.int(MIN_ROOM_W, Math.min(MAX_ROOM_W, width - 2 - ROOM_EDGE_PADDING));
  const roomH = rng.int(MIN_ROOM_H, Math.min(MAX_ROOM_H, height - 2 - ROOM_EDGE_PADDING));

  const minX = ROOM_EDGE_PADDING + 1;
  const minY = ROOM_EDGE_PADDING + 1;
  const maxX = Math.max(minX, width - roomW - ROOM_EDGE_PADDING - 1);
  const maxY = Math.max(minY, height - roomH - ROOM_EDGE_PADDING - 1);

  return {
    x: rng.int(minX, maxX),
    y: rng.int(minY, maxY),
    w: roomW,
    h: roomH
  };
}

function placeNonOverlappingRooms(width: number, height: number, rng: RNG): Rect[] {
  const rooms: Rect[] = [];
  const targetCount = rng.int(MIN_ROOMS, MAX_ROOMS);

  for (let attempt = 0; attempt < ROOM_PLACE_ATTEMPTS && rooms.length < targetCount; attempt += 1) {
    const candidate = randomRoom(width, height, rng);
    const intersects = rooms.some((room) => isOverlappingWithPadding(candidate, room, ROOM_PADDING));
    if (!intersects) {
      rooms.push(candidate);
    }
  }

  return rooms;
}

function buildFallbackRooms(width: number, height: number): Rect[] {
  const roomW = Math.min(10, Math.max(MIN_ROOM_W, Math.floor(width * 0.24)));
  const roomH = Math.min(7, Math.max(MIN_ROOM_H, Math.floor(height * 0.25)));

  const candidates: Rect[] = [
    { x: 2, y: 2, w: roomW, h: roomH },
    { x: width - roomW - 3, y: 2, w: roomW, h: roomH },
    { x: 2, y: height - roomH - 3, w: roomW, h: roomH },
    { x: width - roomW - 3, y: height - roomH - 3, w: roomW, h: roomH }
  ];

  return candidates.filter(
    (room) =>
      room.x >= 1 &&
      room.y >= 1 &&
      room.x + room.w < width - 1 &&
      room.y + room.h < height - 1
  );
}

function connectRoomsWithCorridors(rooms: Rect[], tiles: TileType[][], rng: RNG): void {
  if (rooms.length <= 1) {
    return;
  }

  const centers = rooms.map((room) => centerOfRect(room));
  const connected = new Set<number>([0]);
  const connectedPairs = new Set<string>();

  const connectPair = (fromIndex: number, toIndex: number, preferLong: boolean): void => {
    const from = centers[fromIndex];
    const to = centers[toIndex];

    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);

    const useDetour = preferLong && rng.chance(0.7);
    if (useDetour) {
      if (rng.chance(0.5)) {
        const leftSpace = minX - 1;
        const rightSpace = tiles[0].length - 2 - maxX;
        let pivotX = from.x;
        if (rightSpace >= 2 && (rightSpace >= leftSpace || leftSpace < 2)) {
          pivotX = maxX + rng.int(1, rightSpace);
        } else if (leftSpace >= 2) {
          pivotX = minX - rng.int(1, leftSpace);
        }
        carveHorizontalTunnel(tiles, from.x, pivotX, from.y);
        carveVerticalTunnel(tiles, from.y, to.y, pivotX);
        carveHorizontalTunnel(tiles, pivotX, to.x, to.y);
      } else {
        const topSpace = minY - 1;
        const bottomSpace = tiles.length - 2 - maxY;
        let pivotY = from.y;
        if (bottomSpace >= 2 && (bottomSpace >= topSpace || topSpace < 2)) {
          pivotY = maxY + rng.int(1, bottomSpace);
        } else if (topSpace >= 2) {
          pivotY = minY - rng.int(1, topSpace);
        }
        carveVerticalTunnel(tiles, from.y, pivotY, from.x);
        carveHorizontalTunnel(tiles, from.x, to.x, pivotY);
        carveVerticalTunnel(tiles, pivotY, to.y, to.x);
      }
    } else if (rng.chance(0.5)) {
      carveHorizontalTunnel(tiles, from.x, to.x, from.y);
      carveVerticalTunnel(tiles, from.y, to.y, to.x);
    } else {
      carveVerticalTunnel(tiles, from.y, to.y, from.x);
      carveHorizontalTunnel(tiles, from.x, to.x, to.y);
    }

    const low = Math.min(fromIndex, toIndex);
    const high = Math.max(fromIndex, toIndex);
    connectedPairs.add(`${low}:${high}`);
  };

  while (connected.size < rooms.length) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDistance = -1;

    for (const fromIndex of connected) {
      const from = centers[fromIndex];
      for (let toIndex = 0; toIndex < centers.length; toIndex += 1) {
        if (connected.has(toIndex)) {
          continue;
        }
        const to = centers[toIndex];
        const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        if (distance > bestDistance) {
          bestDistance = distance;
          bestFrom = fromIndex;
          bestTo = toIndex;
        }
      }
    }

    if (bestFrom === -1 || bestTo === -1) {
      break;
    }

    connectPair(bestFrom, bestTo, true);
    connected.add(bestTo);
  }

  const allPairs: Array<{ fromIndex: number; toIndex: number; distance: number }> = [];
  for (let fromIndex = 0; fromIndex < centers.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < centers.length; toIndex += 1) {
      const from = centers[fromIndex];
      const to = centers[toIndex];
      allPairs.push({
        fromIndex,
        toIndex,
        distance: Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
      });
    }
  }
  allPairs.sort((a, b) => b.distance - a.distance);

  // Add far-distance links to emphasize long corridors.
  const extraLinks = Math.min(rooms.length, 3);
  let linked = 0;
  for (const pair of allPairs) {
    if (linked >= extraLinks) {
      break;
    }
    const key = `${pair.fromIndex}:${pair.toIndex}`;
    if (connectedPairs.has(key)) {
      continue;
    }
    connectPair(pair.fromIndex, pair.toIndex, true);
    linked += 1;
  }

  const isInRoom = (x: number, y: number): boolean =>
    rooms.some((room) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h);

  const corridorTiles: Position[] = [];
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[0].length; x += 1) {
      if (tiles[y][x] === 'floor' && !isInRoom(x, y)) {
        corridorTiles.push({ x, y });
      }
    }
  }

  // Add branch links from rooms into existing corridors to create T-junctions.
  const branchCount = Math.min(2, rooms.length - 1);
  for (let i = 0; i < branchCount; i += 1) {
    if (corridorTiles.length === 0) {
      break;
    }
    const roomCenter = centers[rng.int(0, centers.length - 1)];
    const distantCorridors = corridorTiles.filter(
      (pos) => Math.abs(pos.x - roomCenter.x) + Math.abs(pos.y - roomCenter.y) >= 6
    );
    const branchTarget = distantCorridors.length > 0 ? rng.pick(distantCorridors) : rng.pick(corridorTiles);
    if (rng.chance(0.5)) {
      carveHorizontalTunnel(tiles, roomCenter.x, branchTarget.x, roomCenter.y);
      carveVerticalTunnel(tiles, roomCenter.y, branchTarget.y, branchTarget.x);
    } else {
      carveVerticalTunnel(tiles, roomCenter.y, branchTarget.y, roomCenter.x);
      carveHorizontalTunnel(tiles, roomCenter.x, branchTarget.x, branchTarget.y);
    }
  }
}

function randomPointInRoom(room: Rect, rng: RNG): Position {
  return {
    x: rng.int(room.x, room.x + room.w - 1),
    y: rng.int(room.y, room.y + room.h - 1)
  };
}

function findFarthestRoomIndex(rooms: Rect[], baseIndex: number): number {
  const base = centerOfRect(rooms[baseIndex]);
  let farthestIndex = baseIndex;
  let farthestDistance = -1;
  for (let i = 0; i < rooms.length; i += 1) {
    if (i === baseIndex) {
      continue;
    }
    const center = centerOfRect(rooms[i]);
    const distance = Math.abs(center.x - base.x) + Math.abs(center.y - base.y);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = i;
    }
  }
  return farthestIndex;
}

function findChestRoomIndex(rooms: Rect[], startIndex: number, stairsIndex: number): number {
  let bestIndex = startIndex;
  let bestScore = -1;
  const startCenter = centerOfRect(rooms[startIndex]);
  const stairsCenter = centerOfRect(rooms[stairsIndex]);

  for (let i = 0; i < rooms.length; i += 1) {
    if (i === startIndex || i === stairsIndex) {
      continue;
    }
    const center = centerOfRect(rooms[i]);
    const distanceFromStart = Math.abs(center.x - startCenter.x) + Math.abs(center.y - startCenter.y);
    const distanceFromStairs = Math.abs(center.x - stairsCenter.x) + Math.abs(center.y - stairsCenter.y);
    const score = Math.min(distanceFromStart, distanceFromStairs);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function getAllWalkablePositions(tiles: TileType[][]): Position[] {
  const positions: Position[] = [];
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[0].length; x += 1) {
      if (tiles[y][x] === 'floor') {
        positions.push({ x, y });
      }
    }
  }
  return positions;
}

function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function pickDistinctPosition(
  candidates: Position[],
  exclusions: Position[],
  rng: RNG,
  fallback: Position
): Position {
  const allowed = candidates.filter(
    (candidate) => !exclusions.some((excluded) => positionsEqual(candidate, excluded))
  );
  if (allowed.length === 0) {
    return fallback;
  }
  return rng.pick(allowed);
}

export function isWithinMap(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function isWalkableTile(tile: TileType): boolean {
  return tile !== 'wall';
}

export function generateDungeonFloor(width: number, height: number, rng: RNG): DungeonFloor {
  const tiles = createWallGrid(width, height);
  let rooms = placeNonOverlappingRooms(width, height, rng);

  if (rooms.length < 2) {
    rooms = buildFallbackRooms(width, height);
  }
  if (rooms.length < 2) {
    throw new Error('Dungeon generation failed: room placement fallback also failed.');
  }

  for (const room of rooms) {
    carveRoom(tiles, room);
  }
  connectRoomsWithCorridors(rooms, tiles, rng);

  const startRoomIndex = rng.int(0, rooms.length - 1);
  const stairsRoomIndex = findFarthestRoomIndex(rooms, startRoomIndex);
  const chestRoomIndex = findChestRoomIndex(rooms, startRoomIndex, stairsRoomIndex);

  const playerStart = randomPointInRoom(rooms[startRoomIndex], rng);
  const stairsSeed = randomPointInRoom(rooms[stairsRoomIndex], rng);
  const chestSeed = randomPointInRoom(rooms[chestRoomIndex], rng);

  const walkables = getAllWalkablePositions(tiles);
  const stairsPos = pickDistinctPosition(walkables, [playerStart], rng, stairsSeed);
  const chestPos = pickDistinctPosition(walkables, [playerStart, stairsPos], rng, chestSeed);

  tiles[stairsPos.y][stairsPos.x] = 'stairs';
  tiles[chestPos.y][chestPos.x] = 'chest_closed';

  return {
    tiles,
    rooms,
    playerStart,
    stairsPos,
    chestPos
  };
}

export function cloneTiles(tiles: TileType[][]): TileType[][] {
  return tiles.map((row) => [...row]);
}

export function getWalkablePositions(tiles: TileType[][]): Position[] {
  const positions: Position[] = [];
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[0].length; x += 1) {
      if (isWalkableTile(tiles[y][x])) {
        positions.push({ x, y });
      }
    }
  }
  return positions;
}
