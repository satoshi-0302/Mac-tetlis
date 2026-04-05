export const SYMBOL = {
    SEVEN: 0,
    BAR: 1,
    BELL: 2,
    CHERRY: 3
};

export const SYMBOL_DATA = {
    [SYMBOL.SEVEN]: { id: 0, name: '7', color: '#ff0000', payout: 100 },
    [SYMBOL.BAR]: { id: 1, name: 'BAR', color: '#0000ff', payout: 50 },
    [SYMBOL.BELL]: { id: 2, name: 'BELL', color: '#ffff00', payout: 20 },
    [SYMBOL.CHERRY]: { id: 3, name: 'CHRY', color: '#ff00ff', payout: 10 }
};

export const GAME_STATE = {
    INTRO: 0,
    IDLE: 1,
    SPINNING: 2,
    STOPPING: 3,
    RESULT: 4,
    FEVER: 5, // Not a standalone state, but a mode flag usually. Maybe handled in logic.
    GAMEOVER: 6,
    CLEAR: 7
};

export const CONFIG = {
    REEL_COUNT: 3,
    VISIBLE_SYMBOLS: 3, // Number of symbols visible per reel (usually 3 for 3x3)
    SYMBOL_SIZE: 100, // Pixel size of a symbol (width/height)
    REEL_WIDTH: 120,
    REEL_HEIGHT: 300, // 3 * SYMBOL_SIZE
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 600,
    INITIAL_COINS: 100,
    BET_AMOUNT: 10,
    CLEAR_COINS: 1000,
    FEVER_TURNS: 5,
    FEVER_MULTIPLIER: 5
};
