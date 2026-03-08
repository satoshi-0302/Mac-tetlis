// Constants.js
const SYMBOL = {
    SEVEN: 0,
    BAR: 1,
    BELL: 2,
    CHERRY: 3
};

const SYMBOL_DATA = {
    [SYMBOL.SEVEN]: { id: 0, name: '7', payout: 100, img: 'seven' },
    [SYMBOL.BAR]: { id: 1, name: 'BAR', payout: 50, img: 'bar' },
    [SYMBOL.BELL]: { id: 2, name: 'BELL', payout: 20, img: 'bell' },
    [SYMBOL.CHERRY]: { id: 3, name: 'CHRY', payout: 10, img: 'cherry' }
};

const GAME_STATE = {
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
};

const CONFIG = {
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
};

// Assets
const ASSETS = {
    cabinet: { src: 'assets/cabinet.png', img: new Image() },
    seven: { src: 'assets/seven.png', img: new Image() },
    bar: { src: 'assets/bar.png', img: new Image() },
    bell: { src: 'assets/bell.png', img: new Image() },
    cherry: { src: 'assets/cherry.png', img: new Image() },
};

// Audio.js
class AudioController {
    constructor() {
        this.ctx = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.initialized = true;
    }

    playTone(type, frequency, duration, volume = 0.1) {
        if (!this.initialized) this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);

        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playSpinStart() {
        this.playTone('square', 150, 0.3, 0.1);
    }

    playReelStop() {
        this.playTone('triangle', 800, 0.1, 0.1);
    }

    playWin() {
        const now = this.ctx.currentTime;
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            setTimeout(() => this.playTone('sine', freq, 0.3, 0.1), i * 100);
        });
    }

    playJackpot() {
        const now = this.ctx.currentTime;
        [523.25, 523.25, 523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            setTimeout(() => this.playTone('square', freq, 0.5, 0.1), i * 150);
        });
    }
}

// Input.js
class Input {
    constructor() {
        this.keys = {};
        this.touchActive = false;
        this.onInput = null;
        this.canvas = document.getElementById('game-canvas');

        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyS') {
                e.preventDefault();
                this.triggerInput('primary');
            }
        });

        if (this.canvas) {
            this.canvas.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.triggerInput('primary');
            });
        }
    }

    triggerInput(action = 'primary') {
        if (this.onInput) {
            this.onInput(action);
        }
    }

    setHandler(callback) {
        this.onInput = callback;
    }
}

// Particle.js
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 6 - 3;
        this.speedY = Math.random() * -10 - 5;
        this.gravity = 0.5;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
    }

    update() {
        this.speedY += this.gravity;
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= this.decay;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.restore();
    }
}

class ParticleSystem {
    constructor() {
        this.particles = [];
    }

    spawn(x, y, count = 10, colors = ['#fff', '#ff0', '#f0f', '#0ff']) {
        for (let i = 0; i < count; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.particles.push(new Particle(x, y, color));
        }
    }

    update() {
        this.particles.forEach(p => p.update());
        this.particles = this.particles.filter(p => p.life > 0);
    }

    draw(ctx) {
        this.particles.forEach(p => p.draw(ctx));
    }
}

// Reel.js
class Reel {
    constructor(id, x, y) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = CONFIG.REEL_WIDTH;
        this.height = CONFIG.REEL_HEIGHT;

        this.symbols = [];
        this.generateStrip();

        this.offset = 0;
        this.speed = 0;
        this.isSpinning = false;
        this.isStopping = false;
        this.targetOffset = 0;
    }

    generateStrip() {
        for (let i = 0; i < 20; i++) {
            const keys = Object.keys(SYMBOL);
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            this.symbols.push(SYMBOL[randomKey]);
        }
    }

    start() {
        this.isSpinning = true;
        this.isStopping = false;
        const baseSpeed = CONFIG.REEL_BASE_SPEED + (this.id * CONFIG.REEL_SPEED_STEP);
        const speedRate = CONFIG.REEL_SPEED_MULTIPLIERS[this.id] || 1;
        this.speed = baseSpeed * speedRate;
    }

    stop() {
        if (!this.isSpinning) return;
        this.isStopping = true;

        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const currentPos = this.offset;
        const extraDistance = symbolHeight * CONFIG.REEL_STOP_EXTRA_SYMBOLS;
        const snap = Math.ceil((currentPos + extraDistance) / symbolHeight) * symbolHeight;
        this.targetOffset = snap;
    }

    update() {
        if (this.isSpinning) {
            if (this.isStopping) {
                if (this.offset < this.targetOffset) {
                    this.offset += this.speed * 1.2;
                    if (this.offset >= this.targetOffset) {
                        this.offset = this.targetOffset;
                        this.isSpinning = false;
                        this.isStopping = false;
                        this.speed = 0;
                        return true;
                    }
                }
            } else {
                this.offset += this.speed;
            }
        }
        return false;
    }

    draw(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.x, this.y, this.width, this.height);
        ctx.clip();

        // White background for the reel strip
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const totalSymbols = this.symbols.length;

        const startIdx = Math.floor(this.offset / symbolHeight) % totalSymbols;
        const pixelShift = this.offset % symbolHeight;

        for (let i = -1; i < CONFIG.VISIBLE_SYMBOLS + 1; i++) {
            let symbolIdx = (startIdx + i);
            if (symbolIdx < 0) symbolIdx += totalSymbols;
            symbolIdx %= totalSymbols;

            const symbolCode = this.symbols[symbolIdx];
            const symbolData = SYMBOL_DATA[symbolCode];

            const drawY = this.y + (i * symbolHeight) - pixelShift;

            const img = ASSETS[symbolData.img].img;
            if (img && img.complete) {
                // Draw symbol image
                // Add padding to make it look nice
                const p = 10;
                ctx.drawImage(img, this.x + p, drawY + p, this.width - p * 2, symbolHeight - p * 2);
            } else {
                // Fallback text
                ctx.fillStyle = '#000';
                ctx.fillText(symbolData.name, this.x + this.width / 2, drawY + symbolHeight / 2);
            }
        }

        ctx.restore();

        // Inner shadow lines for reel curvature effect
        const grad = ctx.createLinearGradient(this.x, this.y, this.x + this.width, this.y);
        grad.addColorStop(0, 'rgba(0,0,0,0.3)');
        grad.addColorStop(0.1, 'rgba(0,0,0,0)');
        grad.addColorStop(0.9, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = grad;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(this.x, this.y, this.width, this.height);
    }

    getResult() {
        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const totalSymbols = this.symbols.length;
        const startIdx = Math.floor(this.offset / symbolHeight) % totalSymbols;
        let middleIdx = (startIdx + 1) % totalSymbols;
        return this.symbols[middleIdx];
    }
}

// Game.js
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.state = GAME_STATE.LOADING;
        this.score = 0;
        this.leaderboard = [];
        this.highScore = 0;

        this.reels = [];
        this.createReels();

        this.audio = new AudioController();
        this.input = new Input();
        this.input.setHandler((action) => this.handleInput(action));

        this.particles = new ParticleSystem();

        this.feverMode = false;
        this.feverTurns = 0;
        this.message = "LOADING...";

        this.lastTime = 0;
        this.stopIndex = 0;
        this.reachMode = false;
        this.flashTimer = 0;
        this.timeLeftMs = CONFIG.TIME_LIMIT_MS;
        this.isTimeAttackRunning = false;
        this.comboCount = 0;
        this.comboFlashTimer = 0;
        this.comboText = "";
        this.shakeTimer = 0;
        this.shakePower = 0;
        this.comboChainTimer = 0;
        this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
        this.timeUpFxTimer = 0;
        this.restartCooldownMs = 0;
        this.lastSpurtFxTimer = 0;
        this.runStats = this.createEmptyStats();
        this.finalRank = null;
        this.submittingScore = false;
        this.finalSubmissionError = '';

        // Load Assets
        this.loadAssets();
        this.loadLeaderboardFromServer();
    }

    createEmptyStats() {
        return {
            spins: 0,
            wins: 0,
            losses: 0,
            jackpots: 0,
            maxCombo: 0,
            reachHits: 0,
            scoreFromWins: 0,
            lastSpurtWins: 0
        };
    }

    normalizeLeaderboardRows(rows) {
        if (!Array.isArray(rows)) return [];
        return rows
            .filter((row) => row && typeof row.name === 'string')
            .map((row) => ({
                id: String(row.id || ''),
                name: row.name.slice(0, 14),
                score: Math.max(0, Math.floor(Number(row.score) || 0))
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, CONFIG.LEADERBOARD_LIMIT);
    }

    async loadLeaderboardFromServer() {
        try {
            const response = await fetch('/api/leaderboard?gameId=slot60');
            if (!response.ok) return;
            const payload = await response.json();
            this.leaderboard = this.normalizeLeaderboardRows(payload?.combinedEntries || payload?.entries || []);
            this.highScore = this.leaderboard[0]?.score || 0;
        } catch (error) {
            console.warn('Failed to load slot60 leaderboard:', error);
        }
    }

    async submitScoreToServer(score) {
        if (score <= 0 || this.submittingScore) return;
        const nameInput = window.prompt('名前を入力してください（12文字まで）', 'PLAYER');
        const name = (nameInput || 'PLAYER').trim().slice(0, 12) || 'PLAYER';
        this.submittingScore = true;
        this.finalSubmissionError = '';

        try {
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gameId: 'slot60',
                    name,
                    score
                })
            });
            const payload = await response.json();
            if (!response.ok) {
                this.finalSubmissionError = payload?.error || 'SCORE SAVE FAILED';
                return;
            }

            this.leaderboard = this.normalizeLeaderboardRows(payload?.leaderboard?.combinedEntries || []);
            this.highScore = Math.max(this.highScore, this.leaderboard[0]?.score || 0);
            const entryId = String(payload?.entry?.id || '');
            if (entryId) {
                const index = this.leaderboard.findIndex((row) => row.id === entryId);
                this.finalRank = index >= 0 ? index + 1 : null;
            }
            if (this.finalRank) {
                this.message = `TIME UP! RANK #${this.finalRank}`;
            } else {
                this.message = `TIME UP! SCORE: ${this.score}`;
            }
        } catch (error) {
            console.warn('Failed to submit slot60 score:', error);
            this.finalSubmissionError = 'NETWORK ERROR';
        } finally {
            this.submittingScore = false;
        }
    }

    loadAssets() {
        const keys = Object.keys(ASSETS);
        let loaded = 0;
        keys.forEach(key => {
            ASSETS[key].img.src = ASSETS[key].src;
            ASSETS[key].img.onload = () => {
                loaded++;
                if (loaded >= keys.length) {
                    this.state = GAME_STATE.INTRO;
                    this.message = "TAP OR SPACE TO START";
                    console.log("Assets loaded");
                }
            };
            ASSETS[key].img.onerror = (e) => {
                console.error("Failed to load asset:", ASSETS[key].src);
                // Proceed anyway just in case? Or stuck?
                // Let's count it to avoid lock
                loaded++;
                if (loaded >= keys.length) {
                    this.state = GAME_STATE.INTRO;
                    this.message = "TAP OR SPACE TO START";
                }
            };
        });
    }

    createReels() {
        const startX = (CONFIG.CANVAS_WIDTH - (CONFIG.REEL_WIDTH * 3 + 40)) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;

        for (let i = 0; i < CONFIG.REEL_COUNT; i++) {
            this.reels.push(new Reel(i, startX + i * (CONFIG.REEL_WIDTH + 20), startY));
        }
    }

    resize() {
        const aspect = CONFIG.CANVAS_WIDTH / CONFIG.CANVAS_HEIGHT;
        let w = window.innerWidth;
        let h = window.innerHeight;

        if (w / h > aspect) {
            w = h * aspect;
        } else {
            h = w / aspect;
        }

        this.canvas.width = CONFIG.CANVAS_WIDTH;
        this.canvas.height = CONFIG.CANVAS_HEIGHT;

        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
    }

    start() {
        requestAnimationFrame((t) => this.loop(t));
    }

    loop(timestamp) {
        const dt = timestamp - this.lastTime;
        this.lastTime = timestamp;

        this.update(dt);
        this.draw();

        requestAnimationFrame((t) => this.loop(t));
    }

    update(dt) {
        if (this.state === GAME_STATE.LOADING) return;

        if (this.isTimeAttackRunning && this.state !== GAME_STATE.TIMEUP) {
            this.timeLeftMs = Math.max(0, this.timeLeftMs - dt);
            if (this.timeLeftMs <= 0) {
                this.endTimeAttack();
            }
        }

        this.particles.update();

        if (this.flashTimer > 0) {
            this.flashTimer -= dt;
        }
        if (this.comboFlashTimer > 0) {
            this.comboFlashTimer -= dt;
        }
        if (this.lastSpurtFxTimer > 0) {
            this.lastSpurtFxTimer -= dt;
        }
        if (this.timeUpFxTimer > 0) {
            this.timeUpFxTimer -= dt;
        }
        if (this.restartCooldownMs > 0) {
            this.restartCooldownMs = Math.max(0, this.restartCooldownMs - dt);
        }
        if (this.comboCount > 0 && this.isTimeAttackRunning && this.state !== GAME_STATE.TIMEUP) {
            this.comboChainTimer = Math.max(0, this.comboChainTimer - dt);
            if (this.comboChainTimer <= 0) {
                this.comboCount = 0;
                this.comboText = "";
                this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
                this.message = "COMBO LOST";
            }
        }
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt;
            if (this.shakeTimer <= 0) {
                this.shakePower = 0;
            }
        }

        let allStopped = true;
        this.reels.forEach(reel => {
            const stopped = reel.update();
            if (!stopped && reel.isSpinning) allStopped = false;
        });

        if (this.state === GAME_STATE.STOPPING && allStopped) {
            this.evaluateResult();
        }
    }

    handleInput(action) {
        if (this.state === GAME_STATE.LOADING) return;
        if (action !== 'primary') return;
        this.audio.init();

        switch (this.state) {
            case GAME_STATE.INTRO:
            case GAME_STATE.GAMEOVER:
            case GAME_STATE.CLEAR:
            case GAME_STATE.TIMEUP:
                this.resetGame();
                break;
            case GAME_STATE.IDLE:
            case GAME_STATE.RESULT:
                this.spin();
                break;
            case GAME_STATE.SPINNING:
            case GAME_STATE.STOPPING:
                this.stopReel();
                break;
        }
    }

    resetGame() {
        this.score = 0;
        this.feverMode = false;
        this.feverTurns = 0;
        this.state = GAME_STATE.IDLE;
        this.message = "TAP OR SPACE";
        this.reachMode = false;
        this.stopIndex = 0;
        this.timeLeftMs = CONFIG.TIME_LIMIT_MS;
        this.isTimeAttackRunning = true;
        this.comboCount = 0;
        this.comboFlashTimer = 0;
        this.comboText = "";
        this.shakeTimer = 0;
        this.shakePower = 0;
        this.comboChainTimer = 0;
        this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
        this.timeUpFxTimer = 0;
        this.restartCooldownMs = 0;
        this.lastSpurtFxTimer = 0;
        this.runStats = this.createEmptyStats();
        this.finalRank = null;
        this.finalSubmissionError = '';
        this.submittingScore = false;
    }

    spin() {
        if (!this.isTimeAttackRunning || this.timeLeftMs <= 0) {
            this.endTimeAttack();
            return;
        }
        this.runStats.spins++;

        if (this.feverMode) {
            this.feverTurns--;
            if (this.feverTurns < 0) {
                this.feverMode = false;
            }
        }

        this.state = GAME_STATE.SPINNING;
        this.stopIndex = 0;
        this.message = "SPINNING...";
        this.reachMode = false;
        this.audio.playSpinStart();

        this.reels.forEach(reel => reel.start());
    }

    stopReel() {
        if (this.stopIndex < this.reels.length) {
            this.reels[this.stopIndex].stop();
            this.audio.playReelStop();

            if (this.stopIndex === 1) {
                const r1 = this.reels[0].getResult();
                const r2 = this.reels[1].getResult();
                if (r1 === r2) {
                    this.reachMode = true;
                    this.runStats.reachHits++;
                    this.message = "REACH!!";
                }
            }

            this.stopIndex++;

            if (this.stopIndex >= this.reels.length) {
                this.state = GAME_STATE.STOPPING;
            }
        }
    }

    evaluateResult() {
        const results = this.reels.map(r => r.getResult());

        const r1 = results[0];
        const r2 = results[1];
        const r3 = results[2];

        let payout = 0;
        let basePayout = 0;
        let isWin = false;
        let isJackpot = false;

        if (r1 === r2 && r2 === r3) {
            basePayout = SYMBOL_DATA[r1].payout;
            isWin = true;
            if (r1 === SYMBOL.SEVEN) {
                isJackpot = true;
                this.triggerFever();
            }
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
            basePayout = 5;
            isWin = true;
        }

        if (isWin) {
            this.comboCount += 1;
            this.runStats.wins++;
            const comboMultiplier = 1 + (Math.min(this.comboCount - 1, CONFIG.COMBO_MAX_STACK) * CONFIG.COMBO_STEP);
            payout = basePayout;
            if (this.feverMode) {
                payout *= CONFIG.FEVER_MULTIPLIER;
            }
            payout = Math.floor(payout * comboMultiplier);
            if (this.timeLeftMs <= CONFIG.LAST_SPURT_MS) {
                payout = Math.floor(payout * CONFIG.LAST_SPURT_MULTIPLIER);
                this.runStats.lastSpurtWins++;
                this.lastSpurtFxTimer = 550;
            }
            this.score += payout;
            this.runStats.scoreFromWins += payout;
            this.runStats.maxCombo = Math.max(this.runStats.maxCombo, this.comboCount);
            this.message = this.comboCount >= 2 ? `WIN! +${payout} COMBO x${this.comboCount}` : `WIN! +${payout}`;
            this.flashTimer = 500;
            this.comboFlashTimer = CONFIG.COMBO_FX_DURATION_MS;
            this.comboText = this.comboCount >= 2 ? `COMBO x${this.comboCount}  BONUS x${comboMultiplier.toFixed(2)}` : "";
            this.shakeTimer = 150 + Math.min(this.comboCount, 8) * 35;
            this.shakePower = Math.min(4 + this.comboCount * 1.3, 14);
            this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS + (this.feverMode ? CONFIG.COMBO_CHAIN_FEVER_BONUS_MS : 0);
            this.comboChainTimer = this.currentComboWindowMs;

            if (isJackpot) {
                this.runStats.jackpots++;
                this.audio.playJackpot();
                this.message = "JACKPOT! FEVER START!";
                this.particles.spawn(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, 100);
            } else {
                this.audio.playWin();
                if (payout >= 50) {
                    this.particles.spawn(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, 50);
                }
            }
            if (this.comboCount >= 2) {
                this.particles.spawn(
                    CONFIG.CANVAS_WIDTH / 2,
                    CONFIG.CANVAS_HEIGHT / 2,
                    40 + Math.min(this.comboCount * 12, 120),
                    ['#ffdf6b', '#ff8c42', '#ff4f81', '#7af0ff']
                );
            }
            if (this.comboCount >= 5) {
                this.particles.spawn(
                    CONFIG.CANVAS_WIDTH / 2,
                    CONFIG.CANVAS_HEIGHT / 2,
                    80,
                    ['#ffffff', '#8cfbff', '#ffd6ff', '#ffe66d']
                );
            }

            if (this.score > this.highScore) {
                this.highScore = this.score;
            }
            this.state = GAME_STATE.RESULT;
        } else {
            this.runStats.losses++;
            this.comboCount = 0;
            this.comboText = "";
            this.comboChainTimer = 0;
            this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
            this.state = GAME_STATE.IDLE;
            this.message = "TRY AGAIN";
        }
    }

    endTimeAttack() {
        this.isTimeAttackRunning = false;
        this.timeLeftMs = 0;
        this.state = GAME_STATE.TIMEUP;
        this.finalRank = null;
        this.message = `TIME UP! SCORE: ${this.score}`;
        this.reachMode = false;
        this.feverMode = false;
        this.feverTurns = 0;
        this.comboCount = 0;
        this.comboText = "";
        this.comboFlashTimer = 0;
        this.shakeTimer = 0;
        this.shakePower = 0;
        this.comboChainTimer = 0;
        this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
        this.timeUpFxTimer = 1800;
        this.restartCooldownMs = 0;
        this.flashTimer = 450;
        this.shakeTimer = 450;
        this.shakePower = 16;
        this.particles.spawn(
            CONFIG.CANVAS_WIDTH / 2,
            CONFIG.CANVAS_HEIGHT / 2,
            150,
            ['#ffffff', '#ffdd66', '#ff6b6b', '#7af0ff']
        );
        this.reels.forEach(reel => {
            reel.isSpinning = false;
            reel.isStopping = false;
            reel.speed = 0;
        });

        void this.submitScoreToServer(this.score);
    }

    triggerFever() {
        this.feverMode = true;
        this.feverTurns = CONFIG.FEVER_TURNS;
    }

    draw() {
        this.ctx.save();
        if (this.shakeTimer > 0 && this.shakePower > 0) {
            const dx = (Math.random() * 2 - 1) * this.shakePower;
            const dy = (Math.random() * 2 - 1) * this.shakePower;
            this.ctx.translate(dx, dy);
        }

        this.ctx.fillStyle = '#1e1e1e';
        if (this.flashTimer > 0 && Math.floor(Date.now() / 50) % 2 === 0) {
            this.ctx.fillStyle = '#555';
        }
        if (this.feverMode) {
            const hue = (Date.now() / 10) % 360;
            this.ctx.fillStyle = `hsl(${hue}, 20%, 20%)`;
        }
        this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        this.drawCabinet();

        this.reels.forEach((reel, index) => {
            if (this.reachMode && index === 2 && Math.floor(Date.now() / 100) % 2 === 0) {
                this.ctx.save();
                // Blink slightly stronger or usage an asset for highlight?
                // For now, simple rect is fine if behind reels
                this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                this.ctx.fillRect(reel.x, reel.y, reel.width, reel.height);
                this.ctx.restore();
            }
            reel.draw(this.ctx);
        });

        this.drawPayline();

        if (this.comboFlashTimer > 0) {
            const alpha = Math.max(0.12, this.comboFlashTimer / CONFIG.COMBO_FX_DURATION_MS * 0.35);
            this.ctx.fillStyle = `rgba(255, 170, 40, ${alpha.toFixed(3)})`;
            this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        }
        if (this.lastSpurtFxTimer > 0) {
            const alpha = Math.max(0.08, this.lastSpurtFxTimer / 550 * 0.20);
            this.ctx.fillStyle = `rgba(255, 80, 80, ${alpha.toFixed(3)})`;
            this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        }
        if (this.comboCount >= 5) {
            const pulse = 0.08 + ((Math.sin(Date.now() / 85) + 1) / 2) * 0.12;
            this.ctx.fillStyle = `rgba(120, 240, 255, ${pulse.toFixed(3)})`;
            this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        }
        if (this.timeUpFxTimer > 0) {
            const fxRatio = this.timeUpFxTimer / 1800;
            this.ctx.save();
            this.ctx.fillStyle = `rgba(255,255,255,${(0.16 * fxRatio).toFixed(3)})`;
            this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
            this.ctx.strokeStyle = `rgba(255,220,120,${(0.9 * fxRatio).toFixed(3)})`;
            this.ctx.lineWidth = 6;
            this.ctx.beginPath();
            this.ctx.arc(
                CONFIG.CANVAS_WIDTH / 2,
                CONFIG.CANVAS_HEIGHT / 2,
                (1 - fxRatio) * 420,
                0,
                Math.PI * 2
            );
            this.ctx.stroke();
            this.ctx.restore();
        }

        this.particles.draw(this.ctx);

        this.drawUI();
        this.ctx.restore();
    }

    drawCabinet() {
        const ctx = this.ctx;
        const totalReelWidth = (CONFIG.REEL_WIDTH * CONFIG.REEL_COUNT) + (20 * (CONFIG.REEL_COUNT - 1));
        const startX = (CONFIG.CANVAS_WIDTH - totalReelWidth) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;

        ctx.save();

        if (ASSETS.cabinet.img.complete) {
            // Draw the cabinet image centered
            // The image is 800x600, same as canvas
            ctx.drawImage(ASSETS.cabinet.img, 0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

            // Black out the reel area so particles/background don't show through nicely if image is transparent
            // The generated image might be transparent in the middle.
            ctx.fillStyle = '#000';
            // Draw a rect behind the reels
            // (already drawn by clearScreen, but maybe cabinet image has alpha?)
            // Let's assume cabinet image overlays everything except reel area.
        } else {
            // Fallback
            const padding = 30;
            const cx = startX - padding;
            const cy = startY - padding;
            const cw = totalReelWidth + (padding * 2);
            const ch = CONFIG.REEL_HEIGHT + (padding * 2);
            this.fillRoundRect(cx - 20, cy - 20, cw + 40, ch + 40, 20, '#222');
            ctx.fillStyle = '#000';
            this.fillRoundRect(startX - 10, startY - 10, totalReelWidth + 20, CONFIG.REEL_HEIGHT + 20, 5, '#000');
        }

        ctx.restore();
    }

    fillRoundRect(x, y, w, h, r, fillStyle) {
        const ctx = this.ctx;
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();

        if (fillStyle) {
            ctx.fillStyle = fillStyle;
            ctx.fill();
        }
    }

    drawPayline() {
        const ctx = this.ctx;
        const totalReelWidth = (CONFIG.REEL_WIDTH * CONFIG.REEL_COUNT) + (20 * (CONFIG.REEL_COUNT - 1));
        const startX = (CONFIG.CANVAS_WIDTH - totalReelWidth) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;

        const paylineY = startY + CONFIG.SYMBOL_SIZE * 1.5;

        ctx.save();

        ctx.shadowColor = '#00ff00';
        ctx.shadowBlur = 10;

        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Since we have a cabinet image now, we might need to adjust line length
        // to not look weird on top of it.
        ctx.moveTo(startX - 30, paylineY);
        ctx.lineTo(startX + totalReelWidth + 30, paylineY);
        ctx.stroke();

        ctx.fillStyle = '#ff0000';

        // Arrows
        ctx.beginPath();
        ctx.moveTo(startX - 50, paylineY - 15);
        ctx.lineTo(startX - 50, paylineY + 15);
        ctx.lineTo(startX - 20, paylineY);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(startX + totalReelWidth + 50, paylineY - 15);
        ctx.lineTo(startX + totalReelWidth + 50, paylineY + 15);
        ctx.lineTo(startX + totalReelWidth + 20, paylineY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'right';
        ctx.fillText("PAYLINE", startX - 60, paylineY + 5);

        ctx.restore();
    }

    drawUI() {
        // Adjust UI positions to likely fit the cabinet image
        // Usually top/bottom bars
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 30px Courier New';
        this.ctx.shadowColor = '#000';
        this.ctx.shadowBlur = 5;

        // Position score top left
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`SCORE: ${this.score}`, 40, 50);

        // Position best score top right
        this.ctx.textAlign = 'right';
        this.ctx.fillText(`BEST: ${this.highScore}`, CONFIG.CANVAS_WIDTH - 40, 50);

        const secondsLeft = this.timeLeftMs / 1000;
        let timeColor = '#ffffff';
        if (secondsLeft <= 10) {
            timeColor = Math.floor(Date.now() / 120) % 2 === 0 ? '#ff4040' : '#ffd0d0';
        } else if (secondsLeft <= 20) {
            timeColor = '#ffd740';
        }

        this.ctx.fillStyle = timeColor;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`TIME: ${secondsLeft.toFixed(1)}`, CONFIG.CANVAS_WIDTH / 2, 50);
        this.ctx.fillStyle = '#fff';
        if (secondsLeft <= CONFIG.LAST_SPURT_MS / 1000 && this.state !== GAME_STATE.TIMEUP) {
            this.ctx.fillStyle = '#ff6a6a';
            this.ctx.font = 'bold 20px Courier New';
            this.ctx.fillText(`LAST SPURT x${CONFIG.LAST_SPURT_MULTIPLIER.toFixed(1)}`, CONFIG.CANVAS_WIDTH / 2, 76);
            this.ctx.fillStyle = '#fff';
        }

        if (this.comboCount >= 2) {
            this.ctx.fillStyle = '#ffb347';
            this.ctx.font = 'bold 28px Courier New';
            this.ctx.fillText(`COMBO x${this.comboCount}`, CONFIG.CANVAS_WIDTH / 2, 90);
            this.ctx.fillStyle = '#fff';
        }
        if (this.comboCount > 0) {
            const ratio = Math.max(0, Math.min(1, this.comboChainTimer / this.currentComboWindowMs));
            const barW = 260;
            const barH = 14;
            const barX = (CONFIG.CANVAS_WIDTH - barW) / 2;
            const barY = 106;
            let chainColor = '#7af0ff';
            if (this.comboChainTimer <= CONFIG.COMBO_CHAIN_WARNING_MS) {
                chainColor = Math.floor(Date.now() / 120) % 2 === 0 ? '#ff5252' : '#ffd2d2';
            }

            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
            this.ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
            this.ctx.fillStyle = chainColor;
            this.ctx.fillRect(barX, barY, barW * ratio, barH);
            this.ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(barX, barY, barW, barH);
            this.ctx.restore();
        }

        // Message Center Bottom
        this.ctx.textAlign = 'center';
        this.ctx.font = 'bold 40px Courier New';

        // Add a background for message legibility
        const msg = this.message;
        const metrics = this.ctx.measureText(msg);

        // Check if message is empty or null
        if (msg) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
            this.ctx.fillRect(0, CONFIG.CANVAS_HEIGHT - 80, CONFIG.CANVAS_WIDTH, 60);
            this.ctx.restore();

            this.ctx.fillStyle = '#fff'; // Redraw fill style for text
            this.ctx.fillText(msg, CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 40);
        }

        if (this.comboText && this.comboFlashTimer > 0) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
            this.ctx.fillRect(0, CONFIG.CANVAS_HEIGHT - 130, CONFIG.CANVAS_WIDTH, 40);
            this.ctx.fillStyle = '#ffe082';
            this.ctx.font = 'bold 26px Courier New';
            this.ctx.fillText(this.comboText, CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 100);
            this.ctx.restore();
        }
        if (this.comboCount >= 5) {
            this.ctx.save();
            this.ctx.fillStyle = '#8cfbff';
            this.ctx.font = 'bold 24px Courier New';
            this.ctx.fillText('HYPER CHAIN!', CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 140);
            this.ctx.restore();
        }

        if (this.feverMode) {
            this.ctx.fillStyle = '#ff0000';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`FEVER: ${this.feverTurns}`, CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 100);
        }

        if (this.state === GAME_STATE.TIMEUP) {
            const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0,0,0,0.75)';
            this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

            this.ctx.fillStyle = '#fff';
            this.ctx.textAlign = 'center';
            this.ctx.font = 'bold 48px Courier New';
            this.ctx.fillText('TIME UP', CONFIG.CANVAS_WIDTH / 2, 110);

            this.ctx.font = 'bold 30px Courier New';
            this.ctx.fillText(`FINAL: ${this.score}`, CONFIG.CANVAS_WIDTH / 2, 155);
            this.ctx.fillText(`BEST: ${this.highScore}`, CONFIG.CANVAS_WIDTH / 2, 192);

            if (this.finalRank) {
                this.ctx.fillStyle = '#7af0ff';
                this.ctx.font = 'bold 22px Courier New';
                this.ctx.fillText(`TOP10 RANK #${this.finalRank}`, CONFIG.CANVAS_WIDTH / 2, 238);
            } else if (this.submittingScore) {
                this.ctx.fillStyle = '#ffd166';
                this.ctx.font = 'bold 20px Courier New';
                this.ctx.fillText('SAVING SCORE...', CONFIG.CANVAS_WIDTH / 2, 238);
            } else if (this.finalSubmissionError) {
                this.ctx.fillStyle = '#ff8a80';
                this.ctx.font = 'bold 18px Courier New';
                this.ctx.fillText(this.finalSubmissionError, CONFIG.CANVAS_WIDTH / 2, 238);
            }

            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 18px Courier New';
            this.ctx.fillText('TOP 10 LEADERBOARD', CONFIG.CANVAS_WIDTH / 2, 286);

            const baseY = 314;
            const rowH = 22;
            for (let i = 0; i < CONFIG.LEADERBOARD_LIMIT; i++) {
                const row = this.leaderboard[i];
                const y = baseY + i * rowH;
                if (!row) {
                    this.ctx.fillStyle = 'rgba(255,255,255,0.35)';
                    this.ctx.fillText(`${i + 1}. ---`, CONFIG.CANVAS_WIDTH / 2, y);
                    continue;
                }
                const marker = i === 0 ? '★' : '';
                this.ctx.fillStyle = i < 3 ? '#ffd166' : '#d9e6ff';
                const rowText = `${i + 1}. ${shorten(row.name, 10)} ${row.score}${marker}`;
                this.ctx.fillText(rowText, CONFIG.CANVAS_WIDTH / 2, y);
            }

            this.ctx.font = 'bold 24px Courier New';
            this.ctx.fillStyle = '#fff';
            this.ctx.fillText('TAP OR SPACE TO RETRY', CONFIG.CANVAS_WIDTH / 2, 582);
            this.ctx.restore();
        }
    }
}

// Start Game
window.addEventListener('load', () => {
    const game = new Game();
    game.start();
});
