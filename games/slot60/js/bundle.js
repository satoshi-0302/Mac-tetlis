/**
 * Constants
 */
const SYMBOL = {
    SEVEN: 0,
    BAR: 1,
    BELL: 2,
    CHERRY: 3
};

const SYMBOL_DATA = {
    [SYMBOL.SEVEN]: { id: 0, name: '7', color: '#ff0000', payout: 100, img: 'assets/symbol_7.png' },
    [SYMBOL.BAR]: { id: 1, name: 'BAR', color: '#0000ff', payout: 50, img: 'assets/symbol_bar.png' },
    [SYMBOL.BELL]: { id: 2, name: 'BELL', color: '#ffff00', payout: 20, img: 'assets/symbol_bell.png' },
    [SYMBOL.CHERRY]: { id: 3, name: 'CHRY', color: '#ff00ff', payout: 10, img: 'assets/symbol_cherry.png' }
};

const GAME_STATE = {
    INTRO: 0,
    IDLE: 1,
    SPINNING: 2,
    STOPPING: 3,
    RESULT: 4,
    FEVER: 5,
    GAMEOVER: 6,
    CLEAR: 7
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
    FEVER_MULTIPLIER: 5
};

/**
 * Input
 */
class Input {
    constructor() {
        this.keys = {};
        this.touchActive = false;
        this.onInput = null;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.triggerInput();
            }
        });

        window.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.triggerInput();
        }, { passive: false });

        window.addEventListener('mousedown', (e) => {
            this.triggerInput();
        });
    }

    triggerInput() {
        if (this.onInput) {
            this.onInput();
        }
    }

    setHandler(callback) {
        this.onInput = callback;
    }
}

/**
 * Audio
 */
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
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            setTimeout(() => this.playTone('sine', freq, 0.3, 0.1), i * 100);
        });
    }

    playJackpot() {
        [523.25, 523.25, 523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            setTimeout(() => this.playTone('square', freq, 0.5, 0.1), i * 150);
        });
    }
}

/**
 * Particle
 */
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

/**
 * Reel
 */
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
        this.speed = 20 + (this.id * 5);
    }

    stop() {
        if (!this.isSpinning) return;
        this.isStopping = true;

        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const currentPos = this.offset;
        const extraDistance = symbolHeight * 2;
        const snap = Math.ceil((currentPos + extraDistance) / symbolHeight) * symbolHeight;
        this.targetOffset = snap;
    }

    update() {
        if (this.isSpinning) {
            if (this.isStopping) {
                if (this.offset < this.targetOffset) {
                    this.offset += this.speed;
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

            // Draw Symbol Image
            if (!symbolData.imgObj) {
                symbolData.imgObj = new Image();
                symbolData.imgObj.src = symbolData.img;
            }

            if (symbolData.imgObj.complete && symbolData.imgObj.naturalWidth !== 0) {
                const padding = 10;
                ctx.drawImage(symbolData.imgObj, this.x + padding, drawY + padding, this.width - padding * 2, symbolHeight - padding * 2);
            } else {
                // Fallback
                ctx.fillStyle = symbolData.color;
                ctx.fillRect(this.x + 10, drawY + 10, this.width - 20, symbolHeight - 20);

                ctx.fillStyle = '#000';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(symbolData.name, this.x + this.width / 2, drawY + symbolHeight / 2);
            }
        }

        ctx.restore();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
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

/**
 * Game
 */
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.state = GAME_STATE.INTRO;
        this.coins = CONFIG.INITIAL_COINS;
        this.highScore = parseInt(localStorage.getItem('slot_highscore')) || 0;

        this.reels = [];
        this.createReels();

        this.audio = new AudioController();
        this.input = new Input();
        this.input.setHandler(() => this.handleInput());

        this.particles = new ParticleSystem();

        this.feverMode = false;
        this.feverTurns = 0;
        this.message = "PRESS SPACE TO START";

        this.lastTime = 0;
        this.stopIndex = 0;

        this.reachMode = false;
        this.flashTimer = 0;

        this.loadImages();
    }

    loadImages() {
        Object.values(SYMBOL_DATA).forEach(data => {
            const img = new Image();
            img.src = data.img;
            data.imgObj = img; // Preload into global data structure
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
        this.particles.update();

        if (this.flashTimer > 0) {
            this.flashTimer -= dt;
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

    handleInput() {
        this.audio.init();

        switch (this.state) {
            case GAME_STATE.INTRO:
            case GAME_STATE.GAMEOVER:
            case GAME_STATE.CLEAR:
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
        this.coins = CONFIG.INITIAL_COINS;
        this.feverMode = false;
        this.feverTurns = 0;
        this.state = GAME_STATE.IDLE;
        this.message = "PRESS SPACE TO SPIN";
        this.reachMode = false;
    }

    spin() {
        if (this.coins < CONFIG.BET_AMOUNT && !this.feverMode) {
            this.state = GAME_STATE.GAMEOVER;
            this.message = "GAME OVER";
            return;
        }

        if (!this.feverMode) {
            this.coins -= CONFIG.BET_AMOUNT;
        } else {
            this.feverTurns--;
            if (this.feverTurns < 0) {
                this.feverMode = false;
                this.coins -= CONFIG.BET_AMOUNT;
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
        let isWin = false;
        let isJackpot = false;

        if (r1 === r2 && r2 === r3) {
            payout = SYMBOL_DATA[r1].payout;
            isWin = true;
            if (r1 === SYMBOL.SEVEN) {
                isJackpot = true;
                this.triggerFever();
            }
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
            payout = 5;
            isWin = true;
        }

        if (this.feverMode && isWin) {
            payout *= CONFIG.FEVER_MULTIPLIER;
        }

        if (isWin) {
            this.coins += payout;
            this.message = `WIN! +${payout}`;
            this.flashTimer = 500;

            if (isJackpot) {
                this.audio.playJackpot();
                this.message = "JACKPOT! FEVER START!";
                this.particles.spawn(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, 100);
            } else {
                this.audio.playWin();
                if (payout >= 50) {
                    this.particles.spawn(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, 50);
                }
            }

            if (this.coins > this.highScore) {
                this.highScore = this.coins;
                localStorage.setItem('slot_highscore', this.highScore);
            }

            if (this.coins >= CONFIG.CLEAR_COINS) {
                this.state = GAME_STATE.CLEAR;
                this.message = "CONGRATULATIONS!";
                this.audio.playJackpot();
                this.particles.spawn(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, 200);
            } else {
                this.state = GAME_STATE.RESULT;
            }
        } else {
            this.state = GAME_STATE.IDLE;
            this.message = "TRY AGAIN";

            if (this.coins < CONFIG.BET_AMOUNT) {
                this.state = GAME_STATE.GAMEOVER;
                this.message = "GAME OVER";
            }
        }
    }

    triggerFever() {
        this.feverMode = true;
        this.feverTurns = CONFIG.FEVER_TURNS;
    }

    draw() {
        this.ctx.fillStyle = '#1e1e1e';
        if (this.flashTimer > 0 && Math.floor(Date.now() / 50) % 2 === 0) {
            this.ctx.fillStyle = '#555';
        }
        if (this.feverMode) {
            const hue = (Date.now() / 10) % 360;
            this.ctx.fillStyle = `hsl(${hue}, 20%, 20%)`;
        }
        this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        this.reels.forEach((reel, index) => {
            if (this.reachMode && index === 2 && Math.floor(Date.now() / 100) % 2 === 0) {
                this.ctx.save();
                this.ctx.fillStyle = '#500';
                this.ctx.fillRect(reel.x - 5, reel.y - 5, reel.width + 10, reel.height + 10);
                this.ctx.restore();
            }
            reel.draw(this.ctx);
        });

        this.particles.draw(this.ctx);

        this.drawUI();
    }

    drawUI() {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '30px Courier New';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`COINS: ${this.coins}`, 20, 50);

        this.ctx.textAlign = 'right';
        this.ctx.fillText(`HIGH: ${this.highScore}`, CONFIG.CANVAS_WIDTH - 20, 50);

        this.ctx.textAlign = 'center';
        this.ctx.font = '40px Courier New';
        this.ctx.fillText(this.message, CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 50);

        if (this.feverMode) {
            this.ctx.fillStyle = '#ff0000';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(`FEVER: ${this.feverTurns}`, 20, CONFIG.CANVAS_HEIGHT - 50);
        }
    }
}

/**
 * Main
 */
window.addEventListener('load', () => {
    const game = new Game();
    game.start();
});
