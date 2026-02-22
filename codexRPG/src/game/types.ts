// Central type definitions shared across gameplay modules.

export type TileType = 'wall' | 'floor' | 'stairs' | 'chest_closed' | 'chest_open';

export type EnemyType = 'goblin' | 'orc_soldier' | 'skeleton_knight' | 'demon_lord';

export type TreasureId =
  | 'far_sight'
  | 'regen_step'
  | 'might'
  | 'arcane_mastery'
  | 'iron_wall'
  | 'counter'
  | 'mana_drain'
  | 'swift'
  | 'demon_guard'
  | 'holy_blade';

export interface Position {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DungeonFloor {
  tiles: TileType[][];
  rooms: Rect[];
  playerStart: Position;
  stairsPos: Position;
  chestPos: Position;
}

export interface DerivedStats {
  maxHp: number;
  maxMp: number;
  atk: number;
  matk: number;
  def: number;
}

export interface PlayerState {
  x: number;
  y: number;
  hp: number;
  mp: number;
  stats: DerivedStats;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  mdef: number;
  xp: number;
}

export interface TreasureDefinition {
  floor: number;
  id: TreasureId;
  name: string;
  description: string;
}

export interface PlayerBuffs {
  farSight: boolean;
  regenStep: boolean;
  might: boolean;
  arcaneMastery: boolean;
  ironWall: boolean;
  counter: boolean;
  manaDrain: boolean;
  swift: boolean;
  demonGuard: boolean;
  holyBlade: boolean;
}

export interface PersistentProgress {
  px: number;
  plv: number;
}

export interface RunResult {
  cleared: boolean;
  runXp: number;
  gainedPx: number;
  totalPx: number;
  plv: number;
  floorReached: number;
}

export interface PlayerTurnState {
  movesLeft: number;
  offenseUsed: boolean;
}
