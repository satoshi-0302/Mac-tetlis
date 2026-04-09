export const SYMBOL = {
    SEVEN: 0,
    BAR: 1,
    BELL: 2,
    CHERRY: 3
} as const;

export type SymbolType = typeof SYMBOL[keyof typeof SYMBOL];

export const SYMBOL_DATA = {
    [SYMBOL.SEVEN]: { id: 0, name: '7', payout: 100, img: 'seven', color: '#ff0000' },
    [SYMBOL.BAR]: { id: 1, name: 'BAR', payout: 50, img: 'bar', color: '#0000ff' },
    [SYMBOL.BELL]: { id: 2, name: 'BELL', payout: 20, img: 'bell', color: '#ffff00' },
    [SYMBOL.CHERRY]: { id: 3, name: 'CHRY', payout: 10, img: 'cherry', color: '#ff00ff' }
} as const;

export const GAME_STATE = {
    INTRO: 0,
    IDLE: 1,
    SPINNING: 2,
    STOPPING: 3,
    RESULT: 4,
    FEVER: 5,
    GAMEOVER: 6,
    CLEAR: 7,
    TIMEUP: 8,
    LOADING: 99
} as const;

export type GameSateType = typeof GAME_STATE[keyof typeof GAME_STATE];

export const CONFIG = {
    REEL_COUNT: 3,
    VISIBLE_SYMBOLS: 3,
    SYMBOL_SIZE: 100,
    REEL_WIDTH: 120,
    REEL_HEIGHT: 300,
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 600,
    INITIAL_COINS: 100,
    BET_AMOUNT: 10,
    CLEAR_COINS: 1000,
    FEVER_TURNS: 5,
    FEVER_MULTIPLIER: 5,
    TIME_LIMIT_MS: 60000,
    REEL_BASE_SPEED: 28,
    REEL_SPEED_STEP: 8,
    REEL_SPEED_MULTIPLIERS: [0.33, 0.5, 1],
    REEL_STOP_EXTRA_SYMBOLS: 0.8,
    COMBO_STEP: 0.25,
    COMBO_MAX_STACK: 8,
    COMBO_FX_DURATION_MS: 600,
    COMBO_CHAIN_WINDOW_MS: 3800,
    COMBO_CHAIN_WARNING_MS: 1200,
    COMBO_CHAIN_FEVER_BONUS_MS: 1400,
    RESTART_LOCK_MS: 3000,
    LAST_SPURT_MS: 10000,
    LAST_SPURT_MULTIPLIER: 1.5,
    LEADERBOARD_LIMIT: 10
} as const;

export const SLOT_REPLAY_VERSION = 'slot60-replay-v1';
