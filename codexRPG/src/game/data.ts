// Typed accessors for JSON-based game balance and progression data.

import enemiesJson from '../data/enemies.json';
import progressionJson from '../data/progression.json';
import treasuresJson from '../data/treasures.json';
import type { DerivedStats, Enemy, EnemyType, Position, TreasureDefinition } from './types';

interface ProgressionData {
  maxPlayerLevel: number;
  pxThresholds: number[];
  baseStats: {
    hp: number;
    mp: number;
    atk: number;
    matk: number;
    def: number;
  };
  growthPerLevel: {
    hp: number;
    mp: number;
    atk: number;
    matk: number;
    defEveryEvenLevel: number;
  };
  pxFormula: {
    runXpRate: number;
    floorBonus: number;
    flatBonus: number;
  };
}

interface EnemyProfile {
  name: string;
  xp: number;
  sprite: string;
}

interface EnemyStats {
  hp: number;
  atk: number;
  def: number;
  mdef: number;
}

interface EnemyFloorStatsBand {
  from: number;
  to: number;
  stats: Partial<Record<EnemyType, EnemyStats>>;
}

interface SpawnCount {
  count: number;
  weight: number;
}

interface SpawnSet {
  from: number;
  to: number;
  counts: SpawnCount[];
  types: EnemyType[];
}

interface EnemyData {
  profiles: Record<EnemyType, EnemyProfile>;
  floorStats: EnemyFloorStatsBand[];
  spawnSets: SpawnSet[];
}

const progression = progressionJson as ProgressionData;
const enemyData = enemiesJson as EnemyData;
const treasures = treasuresJson as TreasureDefinition[];

export const MAX_PLAYER_LEVEL = progression.maxPlayerLevel;
export const PX_THRESHOLDS = progression.pxThresholds;

export function getPlayerLevelFromPx(px: number): number {
  for (let i = PX_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (px >= PX_THRESHOLDS[i]) {
      return Math.min(i + 1, MAX_PLAYER_LEVEL);
    }
  }
  return 1;
}

export function buildStatsForLevel(level: number): DerivedStats {
  const clamped = Math.max(1, Math.min(level, MAX_PLAYER_LEVEL));
  const stats = {
    maxHp: progression.baseStats.hp,
    maxMp: progression.baseStats.mp,
    atk: progression.baseStats.atk,
    matk: progression.baseStats.matk,
    def: progression.baseStats.def
  };

  for (let lv = 2; lv <= clamped; lv += 1) {
    stats.maxHp += progression.growthPerLevel.hp;
    stats.maxMp += progression.growthPerLevel.mp;
    stats.atk += progression.growthPerLevel.atk;
    stats.matk += progression.growthPerLevel.matk;
    if (lv % 2 === 0) {
      stats.def += progression.growthPerLevel.defEveryEvenLevel;
    }
  }

  return stats;
}

export function calculatePxGain(runXp: number, floorReached: number): number {
  const runPart = Math.floor(runXp * progression.pxFormula.runXpRate);
  return runPart + floorReached * progression.pxFormula.floorBonus + progression.pxFormula.flatBonus;
}

export function getTreasureByFloor(floor: number): TreasureDefinition {
  const found = treasures.find((treasure) => treasure.floor === floor);
  if (!found) {
    throw new Error(`Treasure for floor ${floor} is missing.`);
  }
  return found;
}

export function getTreasureList(): TreasureDefinition[] {
  return [...treasures];
}

function findFloorBand<T extends { from: number; to: number }>(items: T[], floor: number): T {
  const band = items.find((entry) => floor >= entry.from && floor <= entry.to);
  if (!band) {
    throw new Error(`No band data for floor ${floor}.`);
  }
  return band;
}

export function getEnemyStatsForFloor(type: EnemyType, floor: number): EnemyStats {
  const band = findFloorBand(enemyData.floorStats, floor);
  const stats = band.stats[type];
  if (!stats) {
    throw new Error(`Missing stats for ${type} on floor ${floor}.`);
  }
  return stats;
}

export function getSpawnSetForFloor(floor: number): SpawnSet | null {
  if (floor === 10) {
    return null;
  }
  return findFloorBand(enemyData.spawnSets, floor);
}

export function rollSpawnCount(floor: number, random: () => number): number {
  const set = getSpawnSetForFloor(floor);
  if (!set) {
    return 1;
  }
  const total = set.counts.reduce((acc, entry) => acc + entry.weight, 0);
  let roll = random() * total;
  for (const entry of set.counts) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.count;
    }
  }
  return set.counts[set.counts.length - 1].count;
}

export function rollEnemyTypeForFloor(floor: number, random: () => number): EnemyType {
  if (floor === 10) {
    return 'demon_lord';
  }
  const set = getSpawnSetForFloor(floor);
  if (!set || set.types.length === 0) {
    throw new Error(`Invalid spawn set for floor ${floor}.`);
  }
  const index = Math.floor(random() * set.types.length);
  return set.types[index];
}

export function createEnemy(type: EnemyType, floor: number, id: number, position: Position): Enemy {
  const profile = enemyData.profiles[type];
  if (!profile) {
    throw new Error(`Missing enemy profile for ${type}.`);
  }
  const stats = getEnemyStatsForFloor(type, floor);
  return {
    id,
    type,
    name: profile.name,
    x: position.x,
    y: position.y,
    hp: stats.hp,
    maxHp: stats.hp,
    atk: stats.atk,
    def: stats.def,
    mdef: stats.mdef,
    xp: profile.xp
  };
}

export const ENEMY_NAMES: Record<EnemyType, string> = {
  goblin: 'ゴブリン',
  orc_soldier: 'オーク兵',
  skeleton_knight: 'スケルトンナイト',
  demon_lord: '魔王'
};
