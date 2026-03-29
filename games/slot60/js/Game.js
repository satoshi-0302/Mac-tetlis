import { CONFIG, GAME_STATE, SYMBOL_DATA, SYMBOL } from './Constants.js';
import { Reel } from './Reel.js';
import { AudioController } from './Audio.js';
import { Input } from './Input.js';
import { ParticleSystem } from './Particle.js';

export class Game {
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
        this.stopIndex = 0; // Which reel to stop next

        this.reachMode = false;
        this.flashTimer = 0;
    }

    createReels() {
        const startX = (CONFIG.CANVAS_WIDTH - (CONFIG.REEL_WIDTH * 3 + 40)) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;

        for (let i = 0; i < CONFIG.REEL_COUNT; i++) {
            this.reels.push(new Reel(i, startX + i * (CONFIG.REEL_WIDTH + 20), startY));
        }
    }

    resize() {
        // Maintain aspect ratio
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
        // Update particles
        this.particles.update();

        if (this.flashTimer > 0) {
            this.flashTimer -= dt;
        }

        // Update reels
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
        this.audio.init(); // Ensure audio context is ready

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

            // Check for Reach
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
            // 3 of a kind
            payout = SYMBOL_DATA[r1].payout;
            isWin = true;
            if (r1 === SYMBOL.SEVEN) {
                isJackpot = true;
                this.triggerFever();
            }
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
            // 2 of a kind (Small Win)
            payout = 5;
            isWin = true;
        }

        if (this.feverMode && isWin) {
            payout *= CONFIG.FEVER_MULTIPLIER;
        }

        if (isWin) {
            this.coins += payout;
            this.message = `WIN! +${payout}`;
            this.flashTimer = 500; // Flash for 500ms

            if (isJackpot) {
                this.audio.playJackpot();
                this.message = "JACKPOT! FEVER START!";
                this.particles.spawn(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, 100);
            } else {
                this.audio.playWin();
                if (payout >= 50) { // Big win
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
        // Clear background
        this.ctx.fillStyle = '#1e1e1e';
        if (this.flashTimer > 0 && Math.floor(Date.now() / 50) % 2 === 0) {
            this.ctx.fillStyle = '#555'; // Flash effect
        }
        if (this.feverMode) {
            // Rainbow background effect or just color shift
            const hue = (Date.now() / 10) % 360;
            this.ctx.fillStyle = `hsl(${hue}, 20%, 20%)`;
        }
        this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        this.drawCabinet(); // Draw cabinet behind reels

        // Draw Reels
        this.reels.forEach((reel, index) => {
            // Reach effect: blink background of right reel (index 2)
            if (this.reachMode && index === 2 && Math.floor(Date.now() / 100) % 2 === 0) {
                this.ctx.save();
                this.ctx.fillStyle = '#500';
                this.ctx.fillRect(reel.x - 5, reel.y - 5, reel.width + 10, reel.height + 10);
                this.ctx.restore();
            }
            reel.draw(this.ctx);
        });

        this.drawPayline(); // Draw payline on top of reels

        // Draw Particles
        this.particles.update(); // Update moved here to be consistent? No, update should remain in update(). 
        // Wait, original code had this.particles.draw(this.ctx); here
        this.particles.draw(this.ctx);

        // Draw UI
        this.drawUI();
    }

    drawCabinet() {
        const ctx = this.ctx;
        const totalReelWidth = (CONFIG.REEL_WIDTH * CONFIG.REEL_COUNT) + (20 * (CONFIG.REEL_COUNT - 1));
        const startX = (CONFIG.CANVAS_WIDTH - totalReelWidth) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;

        // Cabinet Frame
        const padding = 30;

        ctx.save();

        // Outer Body
        // Round rect for cabinet
        const cx = startX - padding;
        const cy = startY - padding;
        const cw = totalReelWidth + (padding * 2);
        const ch = CONFIG.REEL_HEIGHT + (padding * 2);

        // Draw Outer Shell
        this.fillRoundRect(cx - 20, cy - 20, cw + 40, ch + 40, 20, '#222');
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 5;
        ctx.stroke();

        // Inner Bezel (Metallic look)
        const gradient = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
        gradient.addColorStop(0, '#888');
        gradient.addColorStop(0.5, '#eee');
        gradient.addColorStop(1, '#888');

        this.fillRoundRect(cx, cy, cw, ch, 10, gradient);

        // Screen/Glass area (Black background behind reels)
        this.fillRoundRect(startX - 10, startY - 10, totalReelWidth + 20, CONFIG.REEL_HEIGHT + 20, 5, '#000');

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

        // Middle row Y center
        // Row 0: 0-100, Row 1 (Center): 100-200. Center is 150.
        const paylineY = startY + CONFIG.SYMBOL_SIZE * 1.5;

        ctx.save();

        // Glow effect
        ctx.shadowColor = '#00ff00';
        ctx.shadowBlur = 10;

        // Line
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Draw line slightly extending beyond reels
        ctx.moveTo(startX - 25, paylineY);
        ctx.lineTo(startX + totalReelWidth + 25, paylineY);
        ctx.stroke();

        // Indicators (Triangles)
        ctx.fillStyle = '#ff0000';

        // Left Triangle
        ctx.beginPath();
        ctx.moveTo(startX - 40, paylineY - 15);
        ctx.moveTo(startX - 40, paylineY + 15);
        ctx.moveTo(startX - 15, paylineY);
        ctx.fill();

        // Right Triangle
        ctx.beginPath();
        ctx.moveTo(startX + totalReelWidth + 40, paylineY - 15);
        ctx.moveTo(startX + totalReelWidth + 40, paylineY + 15);
        ctx.moveTo(startX + totalReelWidth + 15, paylineY);
        ctx.fill();

        // "PAYLINE" Text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'right';
        ctx.fillText("PAYLINE", startX - 50, paylineY + 5);

        ctx.restore();
    }

    drawUI() {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '30px Courier New';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`COINS: ${this.coins}`, 20, 50);

        this.ctx.textAlign = 'right';
        this.ctx.fillText(`HIGH: ${this.highScore}`, CONFIG.CANVAS_WIDTH - 20, 50);

        // Message Area
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
