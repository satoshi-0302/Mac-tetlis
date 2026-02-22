// Main gameplay loop, rendering, and turn resolution for the roguelike MVP.

import {
  buildStatsForLevel,
  calculatePxGain,
  createEnemy,
  getPlayerLevelFromPx,
  getTreasureByFloor,
  rollEnemyTypeForFloor,
  rollSpawnCount
} from './data';
import { AudioSystem } from './audio';
import { cloneTiles, generateDungeonFloor, getWalkablePositions, isWalkableTile, isWithinMap } from './map';
import { loadProgress, saveProgress } from './persistence';
import { RNG } from './rng';
import { drawSprite, loadSpriteSheet, TILE_SIZE } from './sprites';
import type {
  DungeonFloor,
  Enemy,
  PlayerBuffs,
  PlayerState,
  PlayerTurnState,
  Position,
  Rect,
  RunResult,
  TileType,
  TreasureDefinition,
  TreasureId
} from './types';

const MAP_WIDTH = 40;
const MAP_HEIGHT = 24;
const SIDE_PANEL_WIDTH = 240;
const LOG_PANEL_HEIGHT = 160;
const CANVAS_WIDTH = MAP_WIDTH * TILE_SIZE + SIDE_PANEL_WIDTH;
const CANVAS_HEIGHT = MAP_HEIGHT * TILE_SIZE + LOG_PANEL_HEIGHT;
const LOG_CAPACITY = 10;
const CHARACTER_SIZE = 32;
const CHARACTER_OFFSET = Math.floor((CHARACTER_SIZE - TILE_SIZE) / 2);
const FRAME_DELTA_CAP_MS = 100;

const DIRECTIONS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 }
];

const VISION_DIRECTIONS_8: Array<{ dx: number; dy: number }> = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 }
];

const MOVE_DIRECTIONS_8: Array<{ dx: number; dy: number }> = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 }
];

type GamePhase = 'loading' | 'playing' | 'result';

interface ActionResolution {
  consumed: boolean;
  endTurn: boolean;
  skipEnemyTurn?: boolean;
}

type MapEffectKind = 'attack' | 'hit' | 'kill' | 'death' | 'clear' | 'damage_text';

interface MapEffect {
  kind: MapEffectKind;
  x: number;
  y: number;
  durationMs: number;
  remainingMs: number;
  fromX?: number;
  fromY?: number;
  color?: string;
  text?: string;
}

type PassageAxis = 'horizontal' | 'vertical' | null;

interface EnemyChaseState {
  lastKnownX: number;
  lastKnownY: number;
  dirX: number;
  dirY: number;
  turnsLeft: number;
}

function createBuffState(): PlayerBuffs {
  return {
    farSight: false,
    regenStep: false,
    might: false,
    arcaneMastery: false,
    ironWall: false,
    counter: false,
    manaDrain: false,
    swift: false,
    demonGuard: false,
    holyBlade: false
  };
}

function posKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

export class RoguelikeGame {
  private readonly root: HTMLElement;

  private readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;

  private readonly retryButton: HTMLButtonElement;

  private readonly rng: RNG;

  private readonly audio = new AudioSystem();

  private phase: GamePhase = 'loading';

  private player: PlayerState | null = null;

  private dungeon: DungeonFloor | null = null;

  private tiles: TileType[][] = [];

  private roomIds: number[][] = [];

  private visibleTiles: boolean[][] = [];

  private exploredTiles: boolean[][] = [];

  private mapEffects: MapEffect[] = [];

  private deathFlashMs = 0;

  private clearFlashMs = 0;

  private lastFrameMs = 0;

  private enemies: Enemy[] = [];

  private enemyChase = new Map<number, EnemyChaseState>();

  private enemyIdCounter = 1;

  private floor = 1;

  private floorReached = 1;

  private runXp = 0;

  private buffs: PlayerBuffs = createBuffState();

  private treasures: TreasureDefinition[] = [];

  private treasureIds = new Set<TreasureId>();

  private turnState: PlayerTurnState = { movesLeft: 1, offenseUsed: false };

  private logs: string[] = [];

  private result: RunResult | null = null;

  private progress = loadProgress();

  private sprites: Awaited<ReturnType<typeof loadSpriteSheet>> | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.rng = new RNG(Date.now());

    const container = document.createElement('div');
    container.className = 'game-shell';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.canvas.className = 'game-canvas';

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D canvas context.');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    this.retryButton = document.createElement('button');
    this.retryButton.type = 'button';
    this.retryButton.className = 'retry-button';
    this.retryButton.textContent = '再挑戦';
    this.retryButton.addEventListener('click', () => {
      this.audio.ensureStarted();
      this.startNewRun();
    });

    container.append(this.canvas, this.retryButton);
    this.root.append(container);

    this.canvas.addEventListener('pointerdown', () => {
      this.audio.ensureStarted();
    });

    window.addEventListener('keydown', this.handleKeyDown);
  }

  async init(): Promise<void> {
    this.sprites = await loadSpriteSheet();
    this.startNewRun();
    requestAnimationFrame(this.renderLoop);
  }

  private renderLoop = (timestampMs: number): void => {
    if (this.lastFrameMs === 0) {
      this.lastFrameMs = timestampMs;
    }
    const deltaMs = Math.min(FRAME_DELTA_CAP_MS, timestampMs - this.lastFrameMs);
    this.lastFrameMs = timestampMs;
    this.updateVisualEffects(deltaMs);
    this.render();
    requestAnimationFrame(this.renderLoop);
  };

  private startNewRun(): void {
    const stats = buildStatsForLevel(this.progress.plv);
    this.player = {
      x: 0,
      y: 0,
      hp: stats.maxHp,
      mp: stats.maxMp,
      stats
    };

    this.phase = 'playing';
    this.floor = 1;
    this.floorReached = 1;
    this.runXp = 0;
    this.enemyIdCounter = 1;
    this.enemyChase.clear();
    this.buffs = createBuffState();
    this.treasures = [];
    this.treasureIds.clear();
    this.result = null;
    this.logs = [];
    this.mapEffects = [];
    this.deathFlashMs = 0;
    this.clearFlashMs = 0;

    this.buildFloor(1);
    this.beginPlayerTurn();
    this.updateRetryButton();

    this.addLog(`新しい冒険開始: PLv ${this.progress.plv}`);
    this.addLog('移動: 矢印/WASD + QEZC(斜め)  魔法: 1/2/3  待機: Space');
  }

  private updateRetryButton(): void {
    this.retryButton.style.display = this.phase === 'result' ? 'inline-flex' : 'none';
  }

  private beginPlayerTurn(): void {
    this.turnState = {
      movesLeft: this.buffs.swift ? 2 : 1,
      offenseUsed: false
    };
  }

  private createBoolGrid(): boolean[][] {
    return Array.from({ length: MAP_HEIGHT }, () => Array.from({ length: MAP_WIDTH }, () => false));
  }

  private buildRoomIdGrid(rooms: Rect[]): number[][] {
    const roomGrid = Array.from({ length: MAP_HEIGHT }, () => Array.from({ length: MAP_WIDTH }, () => -1));
    rooms.forEach((room, roomId) => {
      for (let y = room.y; y < room.y + room.h; y += 1) {
        for (let x = room.x; x < room.x + room.w; x += 1) {
          roomGrid[y][x] = roomId;
        }
      }
    });
    return roomGrid;
  }

  private roomIdAt(x: number, y: number): number {
    if (!isWithinMap(x, y, MAP_WIDTH, MAP_HEIGHT)) {
      return -1;
    }
    return this.roomIds[y]?.[x] ?? -1;
  }

  private isWalkableAt(x: number, y: number): boolean {
    if (!isWithinMap(x, y, MAP_WIDTH, MAP_HEIGHT)) {
      return false;
    }
    return isWalkableTile(this.tiles[y][x]);
  }

  private getStraightCorridorAxis(x: number, y: number): PassageAxis {
    if (!this.isWalkableAt(x, y)) {
      return null;
    }
    const northWalk = this.isWalkableAt(x, y - 1);
    const southWalk = this.isWalkableAt(x, y + 1);
    const westWalk = this.isWalkableAt(x - 1, y);
    const eastWalk = this.isWalkableAt(x + 1, y);

    if (northWalk && southWalk && !westWalk && !eastWalk) {
      return 'vertical';
    }
    if (westWalk && eastWalk && !northWalk && !southWalk) {
      return 'horizontal';
    }
    return null;
  }

  private getDoorAxis(x: number, y: number): PassageAxis {
    if (!this.isWalkableAt(x, y)) {
      return null;
    }

    const northWalk = this.isWalkableAt(x, y - 1);
    const southWalk = this.isWalkableAt(x, y + 1);
    const westWalk = this.isWalkableAt(x - 1, y);
    const eastWalk = this.isWalkableAt(x + 1, y);

    const northRoom = northWalk && this.roomIdAt(x, y - 1) !== -1;
    const southRoom = southWalk && this.roomIdAt(x, y + 1) !== -1;
    const westRoom = westWalk && this.roomIdAt(x - 1, y) !== -1;
    const eastRoom = eastWalk && this.roomIdAt(x + 1, y) !== -1;

    const northCorridor = northWalk && this.roomIdAt(x, y - 1) === -1;
    const southCorridor = southWalk && this.roomIdAt(x, y + 1) === -1;
    const westCorridor = westWalk && this.roomIdAt(x - 1, y) === -1;
    const eastCorridor = eastWalk && this.roomIdAt(x + 1, y) === -1;

    const inRoom = this.roomIdAt(x, y) !== -1;
    if (inRoom) {
      const verticalDoor = (northCorridor || southCorridor) && !westCorridor && !eastCorridor;
      if (verticalDoor) {
        return 'vertical';
      }
      const horizontalDoor = (westCorridor || eastCorridor) && !northCorridor && !southCorridor;
      if (horizontalDoor) {
        return 'horizontal';
      }
      return null;
    }

    const touchesRoom = northRoom || southRoom || westRoom || eastRoom;
    if (!touchesRoom) {
      return null;
    }
    const verticalDoor = (northRoom || southRoom) && !westRoom && !eastRoom;
    if (verticalDoor) {
      return 'vertical';
    }
    const horizontalDoor = (westRoom || eastRoom) && !northRoom && !southRoom;
    if (horizontalDoor) {
      return 'horizontal';
    }
    return null;
  }

  private getMovementAxis(x: number, y: number): PassageAxis {
    return this.getDoorAxis(x, y);
  }

  private getCombatAxis(x: number, y: number): PassageAxis {
    if (this.roomIdAt(x, y) !== -1) {
      return this.getDoorAxis(x, y);
    }
    return this.getStraightCorridorAxis(x, y) ?? this.getDoorAxis(x, y);
  }

  private canStepBetween(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (!this.isWalkableAt(toX, toY)) {
      return false;
    }

    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) {
      return false;
    }

    const axisFrom = this.getMovementAxis(fromX, fromY);
    if (axisFrom === 'vertical' && dx !== 0) {
      return false;
    }
    if (axisFrom === 'horizontal' && dy !== 0) {
      return false;
    }
    const axisTo = this.getMovementAxis(toX, toY);
    if (axisTo === 'vertical' && dx !== 0) {
      return false;
    }
    if (axisTo === 'horizontal' && dy !== 0) {
      return false;
    }

    if (dx !== 0 && dy !== 0) {
      const sideAOpen = this.isWalkableAt(fromX + dx, fromY);
      const sideBOpen = this.isWalkableAt(fromX, fromY + dy);
      if (!sideAOpen && !sideBOpen) {
        return false;
      }
    }

    return true;
  }

  private canMeleeAttack(attackerX: number, attackerY: number, targetX: number, targetY: number): boolean {
    const dx = targetX - attackerX;
    const dy = targetY - attackerY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if ((absDx === 0 && absDy === 0) || absDx > 1 || absDy > 1) {
      return false;
    }

    const attackerRoomId = this.roomIdAt(attackerX, attackerY);
    const targetRoomId = this.roomIdAt(targetX, targetY);
    if (attackerRoomId !== -1 && targetRoomId !== -1 && attackerRoomId === targetRoomId) {
      return true;
    }

    if (absDx + absDy !== 1) {
      return false;
    }

    const axisA = this.getCombatAxis(attackerX, attackerY);
    if (axisA === 'vertical' && dx !== 0) {
      return false;
    }
    if (axisA === 'horizontal' && dy !== 0) {
      return false;
    }
    const axisT = this.getCombatAxis(targetX, targetY);
    if (axisT === 'vertical' && dx !== 0) {
      return false;
    }
    if (axisT === 'horizontal' && dy !== 0) {
      return false;
    }

    return true;
  }

  private canEntitySenseTarget(observerX: number, observerY: number, targetX: number, targetY: number): boolean {
    const dx = Math.abs(observerX - targetX);
    const dy = Math.abs(observerY - targetY);
    if (dx <= 1 && dy <= 1) {
      return true;
    }
    const observerRoomId = this.roomIdAt(observerX, observerY);
    if (observerRoomId === -1) {
      return false;
    }
    return observerRoomId === this.roomIdAt(targetX, targetY);
  }

  private canEnemySensePlayer(enemyX: number, enemyY: number): boolean {
    if (!this.player) {
      return false;
    }
    if (this.isTileVisible(enemyX, enemyY)) {
      return true;
    }
    return this.canEntitySenseTarget(enemyX, enemyY, this.player.x, this.player.y);
  }

  private revealTile(x: number, y: number): void {
    if (!isWithinMap(x, y, MAP_WIDTH, MAP_HEIGHT)) {
      return;
    }
    this.visibleTiles[y][x] = true;
    this.exploredTiles[y][x] = true;
  }

  private refreshPlayerVision(): void {
    if (!this.player) {
      return;
    }

    this.visibleTiles = this.createBoolGrid();
    this.revealTile(this.player.x, this.player.y);

    for (const dir of VISION_DIRECTIONS_8) {
      this.revealTile(this.player.x + dir.dx, this.player.y + dir.dy);
    }

    const roomId = this.roomIdAt(this.player.x, this.player.y);
    if (roomId !== -1) {
      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        for (let x = 0; x < MAP_WIDTH; x += 1) {
          if (this.roomIds[y][x] === roomId) {
            this.revealTile(x, y);
          }
        }
      }

      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        for (let x = 0; x < MAP_WIDTH; x += 1) {
          if (this.roomIds[y][x] !== roomId) {
            continue;
          }
          for (const dir of VISION_DIRECTIONS_8) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (!isWithinMap(nx, ny, MAP_WIDTH, MAP_HEIGHT)) {
              continue;
            }
            if (this.roomIds[ny][nx] === roomId) {
              continue;
            }
            const tile = this.tiles[ny][nx];
            const isWall = tile === 'wall';
            const isCorridor = this.roomIds[ny][nx] === -1 && tile !== 'wall';
            if (isWall || isCorridor) {
              this.revealTile(nx, ny);
            }
          }
        }
      }
    }
  }

  private isTileVisible(x: number, y: number): boolean {
    return this.visibleTiles[y]?.[x] ?? false;
  }

  private isTileExplored(x: number, y: number): boolean {
    return this.exploredTiles[y]?.[x] ?? false;
  }

  private buildFloor(floor: number): void {
    if (!this.player) {
      return;
    }

    this.dungeon = generateDungeonFloor(MAP_WIDTH, MAP_HEIGHT, this.rng);
    this.tiles = cloneTiles(this.dungeon.tiles);
    this.roomIds = this.buildRoomIdGrid(this.dungeon.rooms);
    this.visibleTiles = this.createBoolGrid();
    this.exploredTiles = this.createBoolGrid();

    this.player.x = this.dungeon.playerStart.x;
    this.player.y = this.dungeon.playerStart.y;

    this.enemies = this.spawnEnemies(floor);
    this.enemyChase.clear();
    this.refreshPlayerVision();
    this.addLog(`${floor}F: 敵 ${this.enemies.length}体 / 宝箱1つ`);
  }

  private spawnEnemies(floor: number): Enemy[] {
    if (!this.player || !this.dungeon) {
      return [];
    }
    const player = this.player;
    const dungeon = this.dungeon;

    if (floor === 10) {
      const bossPos = this.pickBossSpawnPosition();
      return [createEnemy('demon_lord', floor, this.enemyIdCounter++, bossPos)];
    }

    const count = rollSpawnCount(floor, () => this.rng.next()) * 2;
    const walkables = getWalkablePositions(this.tiles).filter((pos) => {
      if (pos.x === player.x && pos.y === player.y) {
        return false;
      }
      if (pos.x === dungeon.stairsPos.x && pos.y === dungeon.stairsPos.y) {
        return false;
      }
      if (pos.x === dungeon.chestPos.x && pos.y === dungeon.chestPos.y) {
        return false;
      }
      return true;
    });

    if (walkables.length === 0) {
      return [];
    }
    const spawnCount = Math.min(count, walkables.length);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const positions: Position[] = [];
      const used = new Set<string>();
      while (positions.length < spawnCount) {
        const candidate = this.rng.pick(walkables);
        const key = posKey(candidate.x, candidate.y);
        if (used.has(key)) {
          continue;
        }
        used.add(key);
        positions.push(candidate);
      }

      if (spawnCount >= 3) {
        const adjacentCount = positions.filter((pos) => isAdjacent(pos, { x: player.x, y: player.y }))
          .length;
        if (adjacentCount > 1) {
          continue;
        }
      }

      return positions.map((position) => {
        const type = rollEnemyTypeForFloor(floor, () => this.rng.next());
        return createEnemy(type, floor, this.enemyIdCounter++, position);
      });
    }

    const fallback: Enemy[] = [];
    for (let i = 0; i < spawnCount; i += 1) {
      const type = rollEnemyTypeForFloor(floor, () => this.rng.next());
      fallback.push(createEnemy(type, floor, this.enemyIdCounter++, walkables[i]));
    }
    return fallback;
  }

  private pickBossSpawnPosition(): Position {
    if (!this.player || !this.dungeon) {
      return { x: 1, y: 1 };
    }
    const player = this.player;
    const dungeon = this.dungeon;

    const walkables = getWalkablePositions(this.tiles).filter((pos) => {
      if (pos.x === player.x && pos.y === player.y) {
        return false;
      }
      if (pos.x === dungeon.chestPos.x && pos.y === dungeon.chestPos.y) {
        return false;
      }
      return true;
    });

    if (walkables.length === 0) {
      const down = Math.min(MAP_HEIGHT - 1, player.y + 1);
      if (down !== player.y) {
        return { x: player.x, y: down };
      }
      return { x: player.x, y: Math.max(0, player.y - 1) };
    }

    let best = walkables[0];
    let bestDistance = -1;
    for (const candidate of walkables) {
      const distance = Math.abs(candidate.x - player.x) + Math.abs(candidate.y - player.y);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.phase !== 'playing' || !this.player || !this.dungeon) {
      return;
    }
    this.audio.ensureStarted();

    let resolution: ActionResolution | null = null;

    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        resolution = this.handleMove(0, -1);
        break;
      case 'q':
      case 'Q':
        resolution = this.handleMove(-1, -1);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        resolution = this.handleMove(1, 0);
        break;
      case 'e':
      case 'E':
        resolution = this.handleMove(1, -1);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        resolution = this.handleMove(0, 1);
        break;
      case 'z':
      case 'Z':
        resolution = this.handleMove(-1, 1);
        break;
      case 'c':
      case 'C':
        resolution = this.handleMove(1, 1);
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        resolution = this.handleMove(-1, 0);
        break;
      case '1':
        resolution = this.castStrikeSpell();
        break;
      case '2':
        resolution = this.castBurstSpell();
        break;
      case '3':
        resolution = this.castHealSpell();
        break;
      case ' ':
        resolution = this.contextActionOnSpace();
        break;
      case '.':
        resolution = this.waitAction();
        break;
      default:
        return;
    }

    event.preventDefault();

    if (!resolution.consumed || this.phase !== 'playing') {
      return;
    }

    if (resolution.endTurn) {
      if (!resolution.skipEnemyTurn && this.phase === 'playing') {
        this.runEnemyTurn();
      }
      if (this.phase === 'playing') {
        this.beginPlayerTurn();
      }
    }
  };

  private waitAction(): ActionResolution {
    this.addLog('待機した。');
    return {
      consumed: true,
      endTurn: true
    };
  }

  private contextActionOnSpace(): ActionResolution {
    if (!this.player) {
      return { consumed: false, endTurn: false };
    }

    const targets = this.getAdjacentMeleeTargets();
    if (targets.length === 0) {
      return this.waitAction();
    }

    if (this.turnState.offenseUsed) {
      this.addLog('このターンは攻撃/魔法を使い切っている。');
      return { consumed: false, endTurn: false };
    }

    const target = targets.length === 1 ? targets[0] : this.rng.pick(targets);
    this.turnState.offenseUsed = true;
    this.playerWeaponAttack(target, '間合い攻撃');
    return {
      consumed: true,
      endTurn: true
    };
  }

  private handleMove(dx: number, dy: number): ActionResolution {
    if (!this.player) {
      return { consumed: false, endTurn: false };
    }

    const targetX = this.player.x + dx;
    const targetY = this.player.y + dy;

    if (!isWithinMap(targetX, targetY, MAP_WIDTH, MAP_HEIGHT)) {
      return { consumed: false, endTurn: false };
    }

    const enemy = this.getEnemyAt(targetX, targetY);
    if (enemy) {
      if (this.turnState.offenseUsed) {
        this.addLog('このターンは攻撃/魔法を使い切っている。');
        return { consumed: false, endTurn: false };
      }
      if (!this.canMeleeAttack(this.player.x, this.player.y, targetX, targetY)) {
        this.addLog('この地形ではその方向に攻撃できない。');
        return { consumed: false, endTurn: false };
      }
      this.turnState.offenseUsed = true;
      this.playerWeaponAttack(enemy, '攻撃');
      return { consumed: true, endTurn: true };
    }

    if (this.turnState.movesLeft <= 0) {
      this.addLog('このターンはこれ以上移動できない。');
      return { consumed: false, endTurn: false };
    }

    const tile = this.tiles[targetY][targetX];
    if (!isWalkableTile(tile)) {
      return { consumed: false, endTurn: false };
    }
    if (!this.canStepBetween(this.player.x, this.player.y, targetX, targetY)) {
      return { consumed: false, endTurn: false };
    }

    this.player.x = targetX;
    this.player.y = targetY;
    this.turnState.movesLeft -= 1;
    this.refreshPlayerVision();

    this.applyStepRegeneration();

    const transition = this.resolveCurrentTile();
    if (transition === 'descend') {
      return {
        consumed: true,
        endTurn: true,
        skipEnemyTurn: true
      };
    }

    if (this.buffs.swift && this.turnState.movesLeft > 0) {
      this.addLog(`俊足: もう${this.turnState.movesLeft}回移動できる。`);
      return {
        consumed: true,
        endTurn: false
      };
    }

    return {
      consumed: true,
      endTurn: true
    };
  }

  private resolveCurrentTile(): 'none' | 'descend' {
    if (!this.player || !this.dungeon) {
      return 'none';
    }

    const currentTile = this.tiles[this.player.y][this.player.x];

    if (currentTile === 'chest_closed') {
      this.openChestAtPlayer();
    }

    if (this.player.x === this.dungeon.stairsPos.x && this.player.y === this.dungeon.stairsPos.y) {
      if (this.floor < 10) {
        this.descendFloor();
        return 'descend';
      }
      this.addLog('10Fに到達済み。魔王を倒して脱出しよう。');
    }

    return 'none';
  }

  private applyStepRegeneration(): void {
    if (!this.player || !this.buffs.regenStep) {
      return;
    }
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + 1);
    if (this.player.hp > before) {
      this.addLog(`回復の腕輪: HP +${this.player.hp - before}`);
    }
  }

  private openChestAtPlayer(): void {
    if (!this.player) {
      return;
    }

    this.tiles[this.player.y][this.player.x] = 'chest_open';
    const treasure = getTreasureByFloor(this.floor);
    if (this.treasureIds.has(treasure.id)) {
      return;
    }

    this.audio.playSfx('chest');
    this.treasureIds.add(treasure.id);
    this.treasures.push(treasure);
    this.applyTreasureEffect(treasure.id);
    this.addLog(`宝箱: ${treasure.name}を入手 - ${treasure.description}`);
  }

  private applyTreasureEffect(id: TreasureId): void {
    switch (id) {
      case 'far_sight':
        this.buffs.farSight = true;
        break;
      case 'regen_step':
        this.buffs.regenStep = true;
        break;
      case 'might':
        this.buffs.might = true;
        break;
      case 'arcane_mastery':
        this.buffs.arcaneMastery = true;
        break;
      case 'iron_wall':
        this.buffs.ironWall = true;
        break;
      case 'counter':
        this.buffs.counter = true;
        break;
      case 'mana_drain':
        this.buffs.manaDrain = true;
        break;
      case 'swift':
        this.buffs.swift = true;
        break;
      case 'demon_guard':
        this.buffs.demonGuard = true;
        break;
      case 'holy_blade':
        this.buffs.holyBlade = true;
        break;
      default:
        break;
    }
  }

  private descendFloor(): void {
    if (!this.player) {
      return;
    }

    this.floor += 1;
    this.floorReached = Math.max(this.floorReached, this.floor);

    this.player.hp = this.player.stats.maxHp;
    this.player.mp = this.player.stats.maxMp;

    this.audio.playSfx('stairs');
    this.addLog(`${this.floor}Fへ降りた。HP/MP全回復。`);
    this.buildFloor(this.floor);
  }

  private castStrikeSpell(): ActionResolution {
    return this.castDamageSpell('マジックストライク', 3, 1.0);
  }

  private castBurstSpell(): ActionResolution {
    return this.castDamageSpell('バースト', 6, 1.8);
  }

  private castDamageSpell(name: string, mpCost: number, power: number): ActionResolution {
    if (!this.player) {
      return { consumed: false, endTurn: false };
    }

    if (this.turnState.offenseUsed) {
      this.addLog('このターンは攻撃/魔法を使い切っている。');
      return { consumed: false, endTurn: false };
    }

    if (this.player.mp < mpCost) {
      this.addLog(`${name}: MP不足`);
      return { consumed: false, endTurn: false };
    }

    const target = this.pickAdjacentEnemy();
    if (!target) {
      this.addLog(`${name}: 隣接する敵がいない`);
      return { consumed: false, endTurn: false };
    }

    this.player.mp -= mpCost;
    this.audio.playSfx('magicAttack');
    this.triggerAttackEffect(this.player.x, this.player.y, target.x, target.y, '#7ad4ff');
    const damage = this.calculateMagicDamage(target, power);
    this.addLog(`${name}: ${target.name}に${damage}ダメージ`);
    this.applyDamageToEnemy(target, damage);
    this.turnState.offenseUsed = true;

    return {
      consumed: true,
      endTurn: true
    };
  }

  private castHealSpell(): ActionResolution {
    if (!this.player) {
      return { consumed: false, endTurn: false };
    }

    if (this.turnState.offenseUsed) {
      this.addLog('このターンは攻撃/魔法を使い切っている。');
      return { consumed: false, endTurn: false };
    }

    const mpCost = 6;
    if (this.player.mp < mpCost) {
      this.addLog('セルフヒール: MP不足');
      return { consumed: false, endTurn: false };
    }

    this.player.mp -= mpCost;
    let heal = Math.floor(this.player.stats.maxHp * 0.3);
    if (this.buffs.arcaneMastery) {
      heal *= 3;
    }
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + heal);
    const actual = this.player.hp - before;
    this.turnState.offenseUsed = true;

    this.audio.playSfx('heal');
    this.addLog(`セルフヒール: HP +${actual}`);

    return {
      consumed: true,
      endTurn: true
    };
  }

  private pickAdjacentEnemy(): Enemy | null {
    const targets = this.getAdjacentMeleeTargets();
    return targets[0] ?? null;
  }

  private getAdjacentMeleeTargets(): Enemy[] {
    if (!this.player) {
      return [];
    }
    const targets: Enemy[] = [];
    for (const dir of MOVE_DIRECTIONS_8) {
      const x = this.player.x + dir.dx;
      const y = this.player.y + dir.dy;
      const enemy = this.getEnemyAt(x, y);
      if (enemy && this.canMeleeAttack(this.player.x, this.player.y, x, y)) {
        targets.push(enemy);
      }
    }
    return targets;
  }

  private playerWeaponAttack(enemy: Enemy, source: string): void {
    if (this.player) {
      this.audio.playSfx('playerAttack');
      this.triggerAttackEffect(this.player.x, this.player.y, enemy.x, enemy.y, '#ffd966');
    }
    const damage = this.calculateWeaponDamage(enemy);
    this.addLog(`${source}: ${enemy.name}に${damage}ダメージ`);
    this.applyDamageToEnemy(enemy, damage);
  }

  private calculateWeaponDamage(enemy: Enemy): number {
    if (!this.player) {
      return 1;
    }
    let damage = Math.max(1, this.player.stats.atk - enemy.def);
    if (this.buffs.might) {
      damage *= 3;
    }
    if (enemy.type === 'demon_lord' && this.buffs.holyBlade) {
      damage *= 3;
    }
    return Math.max(1, Math.floor(damage));
  }

  private calculateMagicDamage(enemy: Enemy, power: number): number {
    if (!this.player) {
      return 1;
    }
    let damage = Math.max(1, Math.floor(this.player.stats.matk * power) - enemy.mdef);
    if (this.buffs.arcaneMastery) {
      damage *= 3;
    }
    return Math.max(1, Math.floor(damage));
  }

  private applyDamageToEnemy(enemy: Enemy, damage: number): void {
    enemy.hp -= damage;
    this.triggerDamageText(enemy.x, enemy.y, damage, '#58b8ff');
    this.audio.playSfx('hit');
    this.triggerHitEffect(enemy.x, enemy.y, '#ff8a8a');
    if (enemy.hp > 0) {
      return;
    }

    this.audio.playSfx('kill');
    this.triggerKillEffect(enemy.x, enemy.y);
    this.enemies = this.enemies.filter((target) => target.id !== enemy.id);
    this.enemyChase.delete(enemy.id);
    this.runXp += enemy.xp;

    this.addLog(`${enemy.name}を撃破 (+${enemy.xp}XP)`);

    if (this.player && this.buffs.manaDrain) {
      const beforeMp = this.player.mp;
      this.player.mp = Math.min(this.player.stats.maxMp, this.player.mp + 2);
      const restored = this.player.mp - beforeMp;
      if (restored > 0) {
        this.addLog(`魔力: MP +${restored}`);
      }
    }

    if (enemy.type === 'demon_lord') {
      this.triggerClearEffect(enemy.x, enemy.y);
      this.addLog('魔王を討伐した。10F制覇！');
      this.endRun(true);
    }
  }

  private runEnemyTurn(): void {
    if (!this.player || this.enemies.length === 0) {
      return;
    }

    const occupied = new Set<string>(this.enemies.map((enemy) => posKey(enemy.x, enemy.y)));

    for (const acting of [...this.enemies]) {
      if (this.phase !== 'playing') {
        return;
      }

      const enemy = this.enemies.find((entry) => entry.id === acting.id);
      if (!enemy) {
        continue;
      }

      occupied.delete(posKey(enemy.x, enemy.y));

      const sensedPlayer = this.canEnemySensePlayer(enemy.x, enemy.y);
      let chase = this.enemyChase.get(enemy.id);
      if (sensedPlayer) {
        chase = {
          lastKnownX: this.player.x,
          lastKnownY: this.player.y,
          dirX: Math.sign(this.player.x - enemy.x),
          dirY: Math.sign(this.player.y - enemy.y),
          turnsLeft: 4
        };
        this.enemyChase.set(enemy.id, chase);
      } else if (chase) {
        chase.turnsLeft -= 1;
        if (chase.turnsLeft <= 0) {
          this.enemyChase.delete(enemy.id);
          chase = undefined;
        } else {
          this.enemyChase.set(enemy.id, chase);
        }
      }

      if (sensedPlayer && this.canMeleeAttack(enemy.x, enemy.y, this.player.x, this.player.y)) {
        this.enemyAttack(enemy);
        if (this.phase !== 'playing') {
          return;
        }

        const stillAlive = this.enemies.find((entry) => entry.id === enemy.id);
        if (stillAlive) {
          occupied.add(posKey(stillAlive.x, stillAlive.y));
        }
        continue;
      }

      let step: Position | null = null;
      if (sensedPlayer) {
        step = this.findEnemyStepToward(enemy, this.player.x, this.player.y, occupied);
      } else if (chase) {
        step = this.findEnemyStepToward(enemy, chase.lastKnownX, chase.lastKnownY, occupied);
        if (!step) {
          step = this.findDirectionalStep(enemy, chase.dirX, chase.dirY, occupied);
        }
      }

      if (step) {
        const stepDx = step.x - enemy.x;
        const stepDy = step.y - enemy.y;
        enemy.x = step.x;
        enemy.y = step.y;
        if (chase) {
          if (!sensedPlayer) {
            chase.dirX = stepDx === 0 ? chase.dirX : Math.sign(stepDx);
            chase.dirY = stepDy === 0 ? chase.dirY : Math.sign(stepDy);
            if (enemy.x === chase.lastKnownX && enemy.y === chase.lastKnownY) {
              chase.turnsLeft = Math.min(chase.turnsLeft, 1);
            }
          }
          this.enemyChase.set(enemy.id, chase);
        }
      }
      occupied.add(posKey(enemy.x, enemy.y));
    }
  }

  private enemyAttack(enemy: Enemy): void {
    if (!this.player) {
      return;
    }

    this.audio.playSfx('enemyAttack');
    this.triggerAttackEffect(enemy.x, enemy.y, this.player.x, this.player.y, '#ffad66');
    let damage = Math.max(1, enemy.atk - this.player.stats.def);
    if (this.buffs.ironWall) {
      damage = Math.max(1, Math.floor(damage / 2));
    }
    if (this.buffs.demonGuard) {
      damage = Math.max(1, Math.floor(damage / 3));
    }

    this.player.hp = Math.max(0, this.player.hp - damage);
    this.triggerDamageText(this.player.x, this.player.y, damage, '#ff4d4d');
    this.audio.playSfx('hit');
    this.triggerHitEffect(this.player.x, this.player.y, '#ff4f4f');
    this.addLog(`${enemy.name}の攻撃: ${damage}ダメージ`);

    if (this.player.hp <= 0) {
      this.audio.playSfx('death');
      this.triggerDeathEffect(this.player.x, this.player.y);
      this.addLog('力尽きた...');
      this.endRun(false);
      return;
    }

    if (this.buffs.counter && this.rng.chance(0.5)) {
      const alive = this.enemies.find((entry) => entry.id === enemy.id);
      if (!alive) {
        return;
      }
      if (!this.canMeleeAttack(this.player.x, this.player.y, alive.x, alive.y)) {
        return;
      }
      this.audio.playSfx('playerAttack');
      this.triggerAttackEffect(this.player.x, this.player.y, alive.x, alive.y, '#ffe38a');
      const counterDamage = this.calculateWeaponDamage(alive);
      this.addLog(`反撃: ${alive.name}に${counterDamage}ダメージ`);
      this.applyDamageToEnemy(alive, counterDamage);
    }
  }

  private findEnemyStepToward(
    enemy: Enemy,
    targetX: number,
    targetY: number,
    occupied: Set<string>
  ): Position | null {
    interface Node {
      x: number;
      y: number;
      first: Position | null;
    }

    const queue: Node[] = [{ x: enemy.x, y: enemy.y, first: null }];
    const visited = new Set<string>([posKey(enemy.x, enemy.y)]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const dir of MOVE_DIRECTIONS_8) {
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;
        const key = posKey(nx, ny);

        if (!isWithinMap(nx, ny, MAP_WIDTH, MAP_HEIGHT) || visited.has(key)) {
          continue;
        }

        if (nx === targetX && ny === targetY) {
          return current.first;
        }

        if (!this.canStepBetween(current.x, current.y, nx, ny) || occupied.has(key)) {
          continue;
        }

        visited.add(key);
        queue.push({
          x: nx,
          y: ny,
          first: current.first ?? { x: nx, y: ny }
        });
      }
    }

    return null;
  }

  private findDirectionalStep(
    enemy: Enemy,
    dirX: number,
    dirY: number,
    occupied: Set<string>
  ): Position | null {
    const stepX = Math.sign(dirX);
    const stepY = Math.sign(dirY);
    if (stepX === 0 && stepY === 0) {
      return null;
    }
    const nx = enemy.x + stepX;
    const ny = enemy.y + stepY;
    if (!isWithinMap(nx, ny, MAP_WIDTH, MAP_HEIGHT)) {
      return null;
    }
    if (this.player && nx === this.player.x && ny === this.player.y) {
      return null;
    }
    if (occupied.has(posKey(nx, ny))) {
      return null;
    }
    if (!this.canStepBetween(enemy.x, enemy.y, nx, ny)) {
      return null;
    }
    return { x: nx, y: ny };
  }

  private getEnemyAt(x: number, y: number): Enemy | null {
    return this.enemies.find((enemy) => enemy.x === x && enemy.y === y) ?? null;
  }

  private endRun(cleared: boolean): void {
    if (this.phase !== 'playing') {
      return;
    }

    if (cleared) {
      this.audio.playSfx('victory');
      this.addLog('GAME CLEAR!');
    }

    const gainedPx = calculatePxGain(this.runXp, this.floorReached);
    this.progress = {
      px: this.progress.px + gainedPx,
      plv: getPlayerLevelFromPx(this.progress.px + gainedPx)
    };
    saveProgress(this.progress);

    this.result = {
      cleared,
      runXp: this.runXp,
      gainedPx,
      totalPx: this.progress.px,
      plv: this.progress.plv,
      floorReached: this.floorReached
    };

    this.phase = 'result';
    this.updateRetryButton();
  }

  private addLog(text: string): void {
    this.logs.push(text);
    if (this.logs.length > LOG_CAPACITY) {
      this.logs.shift();
    }
  }

  private pushMapEffect(effect: Omit<MapEffect, 'remainingMs'>): void {
    this.mapEffects.push({
      ...effect,
      remainingMs: effect.durationMs
    });
  }

  private triggerAttackEffect(
    fromX: number,
    fromY: number,
    targetX: number,
    targetY: number,
    color = '#ffd966'
  ): void {
    this.pushMapEffect({
      kind: 'attack',
      x: targetX,
      y: targetY,
      fromX,
      fromY,
      durationMs: 160,
      color
    });
  }

  private triggerHitEffect(targetX: number, targetY: number, color = '#ff6a6a'): void {
    this.pushMapEffect({
      kind: 'hit',
      x: targetX,
      y: targetY,
      durationMs: 200,
      color
    });
  }

  private triggerKillEffect(targetX: number, targetY: number): void {
    this.pushMapEffect({
      kind: 'kill',
      x: targetX,
      y: targetY,
      durationMs: 360,
      color: '#ffe066'
    });
  }

  private triggerDeathEffect(targetX: number, targetY: number): void {
    this.pushMapEffect({
      kind: 'death',
      x: targetX,
      y: targetY,
      durationMs: 620,
      color: '#ff2d2d'
    });
    this.deathFlashMs = 240;
  }

  private triggerClearEffect(targetX: number, targetY: number): void {
    this.pushMapEffect({
      kind: 'clear',
      x: targetX,
      y: targetY,
      durationMs: 1200,
      color: '#ffd866'
    });
    this.clearFlashMs = 380;
  }

  private triggerDamageText(targetX: number, targetY: number, value: number, color: string): void {
    this.pushMapEffect({
      kind: 'damage_text',
      x: targetX,
      y: targetY,
      durationMs: 620,
      color,
      text: `${Math.max(0, Math.floor(value))}`
    });
  }

  private updateVisualEffects(deltaMs: number): void {
    if (deltaMs <= 0) {
      return;
    }
    this.mapEffects = this.mapEffects
      .map((effect) => ({
        ...effect,
        remainingMs: Math.max(0, effect.remainingMs - deltaMs)
      }))
      .filter((effect) => effect.remainingMs > 0);
    this.deathFlashMs = Math.max(0, this.deathFlashMs - deltaMs);
    this.clearFlashMs = Math.max(0, this.clearFlashMs - deltaMs);
  }

  private tileCenterPx(tileX: number, tileY: number): Position {
    return {
      x: tileX * TILE_SIZE + TILE_SIZE / 2,
      y: tileY * TILE_SIZE + TILE_SIZE / 2
    };
  }

  private renderVisualEffects(): void {
    for (const effect of this.mapEffects) {
      if (!this.isTileVisible(effect.x, effect.y) && !this.isTileExplored(effect.x, effect.y)) {
        continue;
      }
      const progress = 1 - effect.remainingMs / effect.durationMs;
      const center = this.tileCenterPx(effect.x, effect.y);

      if (effect.kind === 'attack' && effect.fromX !== undefined && effect.fromY !== undefined) {
        const from = this.tileCenterPx(effect.fromX, effect.fromY);
        this.ctx.strokeStyle = effect.color ?? '#ffd966';
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.lineWidth = 2 + progress * 4;
        this.ctx.beginPath();
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(center.x, center.y);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
        continue;
      }

      if (effect.kind === 'hit') {
        this.ctx.globalAlpha = 0.8 * (1 - progress);
        this.ctx.fillStyle = effect.color ?? '#ff6a6a';
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, 6 + progress * 10, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
        continue;
      }

      if (effect.kind === 'kill') {
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.strokeStyle = effect.color ?? '#ffe066';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, 8 + progress * 16, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.fillStyle = '#fff1a8';
        this.ctx.font = 'bold 12px monospace';
        this.ctx.fillText('K.O.', center.x - 14, center.y - 12 - progress * 8);
        this.ctx.globalAlpha = 1;
        continue;
      }

      if (effect.kind === 'death') {
        this.ctx.globalAlpha = 1 - progress;
        this.ctx.strokeStyle = effect.color ?? '#ff2d2d';
        this.ctx.lineWidth = 3;
        const radius = 8 + progress * 18;
        this.ctx.beginPath();
        this.ctx.moveTo(center.x - radius, center.y - radius);
        this.ctx.lineTo(center.x + radius, center.y + radius);
        this.ctx.moveTo(center.x + radius, center.y - radius);
        this.ctx.lineTo(center.x - radius, center.y + radius);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
        continue;
      }

      if (effect.kind === 'damage_text') {
        const lift = progress * 16;
        const alpha = 1 - progress * 0.9;
        const text = effect.text ?? '0';
        this.ctx.globalAlpha = Math.max(0.1, alpha);
        this.ctx.font = 'bold 18px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.strokeText(text, center.x, center.y - TILE_SIZE * 0.6 - lift);
        this.ctx.fillStyle = effect.color ?? '#ffffff';
        this.ctx.fillText(text, center.x, center.y - TILE_SIZE * 0.6 - lift);
        this.ctx.textAlign = 'start';
        this.ctx.textBaseline = 'alphabetic';
        this.ctx.globalAlpha = 1;
        continue;
      }

      if (effect.kind === 'clear') {
        const pulse = Math.sin(progress * Math.PI * 6) * 0.16 + 0.26;
        this.ctx.globalAlpha = Math.max(0.1, pulse);
        this.ctx.strokeStyle = effect.color ?? '#ffd866';
        this.ctx.lineWidth = 4;
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, 16 + progress * 52, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.globalAlpha = Math.max(0.08, 0.32 - progress * 0.24);
        this.ctx.fillStyle = '#fff4b0';
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, 10 + progress * 26, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
      }
    }
  }

  private renderDeathFlashOverlay(): void {
    if (this.deathFlashMs <= 0) {
      return;
    }
    const alpha = Math.min(0.45, this.deathFlashMs / 240);
    this.ctx.fillStyle = `rgba(160, 10, 10, ${alpha})`;
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  private renderClearFlashOverlay(): void {
    if (this.clearFlashMs <= 0) {
      return;
    }
    const alpha = Math.min(0.38, this.clearFlashMs / 380);
    this.ctx.fillStyle = `rgba(255, 236, 140, ${alpha})`;
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#111217';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (!this.sprites) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px monospace';
      ctx.fillText('Loading...', 24, 40);
      return;
    }

    this.renderMap();
    this.renderStatusPanel();
    this.renderLogPanel();

    if (this.phase === 'result' && this.result) {
      this.renderResultOverlay();
    }
    this.renderClearFlashOverlay();
    this.renderDeathFlashOverlay();
  }

  private renderMap(): void {
    if (!this.player || !this.dungeon || !this.sprites) {
      return;
    }

    const mapPixelWidth = MAP_WIDTH * TILE_SIZE;
    const mapPixelHeight = MAP_HEIGHT * TILE_SIZE;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, mapPixelWidth, mapPixelHeight);
    this.ctx.clip();

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const drawX = x * TILE_SIZE;
        const drawY = y * TILE_SIZE;
        const visible = this.isTileVisible(x, y);
        const explored = this.isTileExplored(x, y);
        if (!visible && !explored) {
          this.ctx.fillStyle = '#040507';
          this.ctx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
          continue;
        }

        const tile = this.tiles[y][x];
        const sprite = this.tileToSprite(tile);
        drawSprite(this.ctx, this.sprites, sprite, drawX, drawY, TILE_SIZE);
      }
    }

    if (this.buffs.farSight) {
      drawSprite(
        this.ctx,
        this.sprites,
        'marker_stairs',
        this.dungeon.stairsPos.x * TILE_SIZE,
        this.dungeon.stairsPos.y * TILE_SIZE,
        TILE_SIZE
      );
    }

    if (
      this.tiles[this.dungeon.chestPos.y][this.dungeon.chestPos.x] === 'chest_closed' &&
      this.isTileVisible(this.dungeon.chestPos.x, this.dungeon.chestPos.y)
    ) {
      drawSprite(
        this.ctx,
        this.sprites,
        'marker_chest',
        this.dungeon.chestPos.x * TILE_SIZE,
        this.dungeon.chestPos.y * TILE_SIZE,
        TILE_SIZE
      );
    }

    for (const enemy of this.enemies) {
      if (!this.isTileVisible(enemy.x, enemy.y)) {
        continue;
      }
      const key = enemy.type;
      this.drawCharacterSprite(key, enemy.x, enemy.y);
    }

    this.drawCharacterSprite('player', this.player.x, this.player.y);
    this.renderVisualEffects();
    this.ctx.restore();
  }

  private drawCharacterSprite(key: Enemy['type'] | 'player', tileX: number, tileY: number): void {
    if (!this.sprites) {
      return;
    }
    const drawX = tileX * TILE_SIZE - CHARACTER_OFFSET;
    const drawY = tileY * TILE_SIZE - CHARACTER_OFFSET;

    // Ground shadow makes oversized sprites read cleanly on the tile map.
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.beginPath();
    this.ctx.ellipse(
      tileX * TILE_SIZE + TILE_SIZE / 2,
      tileY * TILE_SIZE + TILE_SIZE - 2,
      CHARACTER_SIZE * 0.22,
      CHARACTER_SIZE * 0.1,
      0,
      0,
      Math.PI * 2
    );
    this.ctx.fill();

    drawSprite(
      this.ctx,
      this.sprites,
      key,
      drawX,
      drawY,
      CHARACTER_SIZE
    );
  }

  private tileToSprite(tile: TileType):
    | 'floor'
    | 'wall'
    | 'stairs_down'
    | 'chest_closed'
    | 'chest_open' {
    switch (tile) {
      case 'wall':
        return 'wall';
      case 'stairs':
        return 'stairs_down';
      case 'chest_closed':
        return 'chest_closed';
      case 'chest_open':
        return 'chest_open';
      case 'floor':
      default:
        return 'floor';
    }
  }

  private renderStatusPanel(): void {
    const panelX = MAP_WIDTH * TILE_SIZE;
    this.ctx.fillStyle = '#181a20';
    this.ctx.fillRect(panelX, 0, SIDE_PANEL_WIDTH, MAP_HEIGHT * TILE_SIZE);

    this.ctx.fillStyle = '#ececec';
    this.ctx.font = '16px monospace';
    this.ctx.fillText('Status', panelX + 16, 24);

    if (!this.player) {
      return;
    }

    const lines = [
      `階層: ${this.floor}F`,
      `到達階: ${this.floorReached}F`,
      `PLv: ${this.progress.plv}`,
      `PX: ${this.progress.px}`,
      `RunXP: ${this.runXp}`,
      `HP: ${this.player.hp}/${this.player.stats.maxHp}`,
      `MP: ${this.player.mp}/${this.player.stats.maxMp}`,
      `ATK: ${this.player.stats.atk}`,
      `MATK: ${this.player.stats.matk}`,
      `DEF: ${this.player.stats.def}`,
      '視界: 周囲8マス + 入室部屋 + 接壁/通路'
    ];

    this.ctx.font = '14px monospace';
    let y = 50;
    for (const line of lines) {
      this.ctx.fillText(line, panelX + 16, y);
      y += 20;
    }

    y += 8;
    this.ctx.fillText('取得宝:', panelX + 16, y);
    y += 20;

    if (this.treasures.length === 0) {
      this.ctx.fillText('なし', panelX + 16, y);
      y += 20;
    } else {
      for (const treasure of this.treasures.slice(-7)) {
        this.ctx.fillText(`- ${treasure.name}`, panelX + 16, y);
        y += 18;
      }
    }

    y += 8;
    this.ctx.fillText('魔法 1/2/3:', panelX + 16, y);
    y += 18;
    this.ctx.fillText('1: ストライク', panelX + 16, y);
    y += 18;
    this.ctx.fillText('2: バースト', panelX + 16, y);
    y += 18;
    this.ctx.fillText('3: ヒール', panelX + 16, y);
  }

  private renderLogPanel(): void {
    const logY = MAP_HEIGHT * TILE_SIZE;
    this.ctx.fillStyle = '#0b0d11';
    this.ctx.fillRect(0, logY, CANVAS_WIDTH, LOG_PANEL_HEIGHT);

    this.ctx.strokeStyle = '#2a2e38';
    this.ctx.strokeRect(0.5, logY + 0.5, CANVAS_WIDTH - 1, LOG_PANEL_HEIGHT - 1);

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '14px monospace';
    this.ctx.fillText('Log', 16, logY + 22);

    const visibleLogs = this.logs.slice(-8);
    let y = logY + 44;
    for (const line of visibleLogs) {
      this.ctx.fillText(line, 16, y);
      y += 18;
    }
  }

  private renderResultOverlay(): void {
    if (!this.result) {
      return;
    }

    const isClear = this.result.cleared;
    const boxW = isClear ? 520 : 460;
    const boxH = isClear ? 270 : 230;
    const x = Math.floor((CANVAS_WIDTH - boxW) / 2);
    const y = Math.floor((CANVAS_HEIGHT - boxH) / 2);

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    this.ctx.fillStyle = isClear ? '#1f2614' : '#1a1d24';
    this.ctx.fillRect(x, y, boxW, boxH);
    this.ctx.strokeStyle = isClear ? '#ffde73' : '#f2d27a';
    this.ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

    this.ctx.fillStyle = isClear ? '#fff2b6' : '#f7f7f7';
    this.ctx.font = isClear ? 'bold 30px monospace' : '20px monospace';
    this.ctx.fillText(isClear ? 'GAME CLEAR' : 'RESULT - DEAD', x + 24, y + (isClear ? 44 : 36));

    if (isClear) {
      this.ctx.font = '15px monospace';
      this.ctx.fillText('魔王を撃破し、迷宮を制覇した。', x + 24, y + 70);
    }

    this.ctx.font = '16px monospace';
    const lines = [
      `runXP: ${this.result.runXp}`,
      `取得PX: ${this.result.gainedPx}`,
      `合計PX: ${this.result.totalPx}`,
      `PLv: ${this.result.plv}`,
      `到達階: ${this.result.floorReached}F`
    ];

    let textY = y + (isClear ? 104 : 72);
    for (const line of lines) {
      this.ctx.fillText(line, x + 24, textY);
      textY += 30;
    }

    this.ctx.font = '14px monospace';
    this.ctx.fillText('下の「再挑戦」で次のランを開始', x + 24, y + boxH - 22);
  }
}
