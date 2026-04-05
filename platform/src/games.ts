import type { GameConfig } from './types.js';

export const GAMES: GameConfig[] = [
  {
    id: 'snake60',
    slug: 'snake60',
    title: 'Snake60',
    description: '60秒のネオンスネーク。短時間でどこまで伸ばせるかを競います。',
    route: '/games/snake60/',
    desktopRoute: '/games/snake60/?mode=desktop',
    mobileRoute: '/games/snake60/?mode=mobile',
    supportsTouch: true,
    supportsReplay: true,
    sortOrder: 1,
    currentGameVersion: 'snake60-rule-v2'
  },
  {
    id: 'missile-command',
    slug: 'missile-command',
    title: 'MissileCommand',
    description: '4都市を守る60秒防衛戦。連鎖爆発で高得点を狙うゲームです。',
    route: '/games/missile-command/',
    desktopRoute: '/games/missile-command/?mode=desktop',
    mobileRoute: '/games/missile-command/?mode=mobile',
    supportsTouch: true,
    supportsReplay: true,
    sortOrder: 2,
    currentGameVersion: 'orbital-shield-rl-poc-v3'
  },
  {
    id: 'asteroid',
    slug: 'asteroid',
    title: 'Asteroid',
    description: '固定60tickのアステロイド戦。AIのベストスコアが目標になります。',
    route: '/games/asteroid/',
    desktopRoute: '/games/asteroid/?mode=desktop',
    mobileRoute: '/games/asteroid/?mode=mobile',
    supportsTouch: true,
    supportsReplay: true,
    sortOrder: 3,
    currentGameVersion: 'sim-60tick-v2'
  },
  {
    id: 'slot60',
    slug: 'slot60',
    title: 'Slot60',
    description: '60秒のスロットチャレンジ。揃えて稼いだスコアでランキングを競います。',
    route: '/games/slot60/',
    desktopRoute: '/games/slot60/?mode=desktop',
    mobileRoute: '/games/slot60/?mode=mobile',
    supportsTouch: true,
    supportsReplay: true,
    sortOrder: 4,
    currentGameVersion: 'slot60-rule-v1'
  },
  {
    id: 'stackfall',
    slug: 'stackfall',
    title: 'Stackfall',
    description: '60秒でどれだけラインを消せるかを競う、変形テトリスです。',
    route: '/games/stackfall/',
    desktopRoute: '/games/stackfall/?mode=desktop',
    mobileRoute: '/games/stackfall/?mode=mobile',
    supportsTouch: true,
    supportsReplay: true,
    sortOrder: 5,
    currentGameVersion: 'stackfall-events-v1'
  },
  {
    id: 'chick-flap',
    slug: 'chick-flap',
    title: 'ChickFlap',
    description: '可愛いひよこでパイプをくぐる、高難度フラップアクションです。',
    route: '/games/chick-flap/',
    desktopRoute: '/games/chick-flap/?mode=desktop',
    mobileRoute: '/games/chick-flap/?mode=mobile',
    supportsTouch: true,
    supportsReplay: false,
    sortOrder: 6,
    currentGameVersion: 'chick-flap-phaser-v2-leaderboard-mobile'
  }
];

export function getGameById(gameId: string): GameConfig | null {
  return GAMES.find((game) => game.id === gameId) ?? null;
}
