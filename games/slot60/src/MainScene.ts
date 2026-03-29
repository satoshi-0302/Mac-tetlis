import * as Phaser from 'phaser';
import { CONFIG, GAME_STATE, GameSateType, SYMBOL, SYMBOL_DATA, SLOT_REPLAY_VERSION } from './Constants';
import { Reel } from './Reel';
import { ParticleSystem } from './ParticleSystem';
import { AudioController } from './AudioController';

interface RunStats {
    spins: number;
    wins: number;
    losses: number;
    jackpots: number;
    maxCombo: number;
    reachHits: number;
    scoreFromWins: number;
    lastSpurtWins: number;
}

export class MainScene extends Phaser.Scene {
    private reels: Reel[] = [];
    private particles!: ParticleSystem;
    private audio!: AudioController;
    private gameState: GameSateType = GAME_STATE.LOADING;
    private score: number = 0;
    private highScore: number = 0;
    private leaderboard: any[] = [];
    private feverMode: boolean = false;
    private feverTurns: number = 0;
    private message: string = "LOADING...";
    private timeLeftMs: number = CONFIG.TIME_LIMIT_MS;
    private isTimeAttackRunning: boolean = false;
    private comboCount: number = 0;
    private comboChainTimer: number = 0;
    private currentComboWindowMs: number = CONFIG.COMBO_CHAIN_WINDOW_MS;
    private stopIndex: number = 0;
    private reachMode: boolean = false;
    private flashTimer: number = 0;
    private comboFlashTimer: number = 0;
    private lastSpurtFxTimer: number = 0;
    private timeUpFxTimer: number = 0;
    private comboText: string = "";
    private shakeTimer: number = 0;
    private shakePower: number = 0;
    private runStats!: RunStats;
    private replayRounds: any[] = [];
    private replaySeed: number = 0;
    private submittingScore: boolean = false;
    private finalSubmissionError: string = "";
    private finalRank: number | null = null;

    private titleOverlay: HTMLElement | null = null;
    private uiGraphics!: Phaser.GameObjects.Graphics;
    private paylineGraphics!: Phaser.GameObjects.Graphics;
    private uiText: {
        score: Phaser.GameObjects.Text;
        best: Phaser.GameObjects.Text;
        time: Phaser.GameObjects.Text;
        spurt: Phaser.GameObjects.Text;
        combo: Phaser.GameObjects.Text;
        message: Phaser.GameObjects.Text;
        comboBonus: Phaser.GameObjects.Text;
        hyper: Phaser.GameObjects.Text;
        fever: Phaser.GameObjects.Text;
    } | null = null;

    private comboBar!: Phaser.GameObjects.Graphics;

    constructor() {
        super('MainScene');
    }

    preload() {
        this.load.image('cabinet', 'assets/cabinet.png');
        this.load.image('seven', 'assets/seven.png');
        this.load.image('bar', 'assets/bar.png');
        this.load.image('bell', 'assets/bell.png');
        this.load.image('cherry', 'assets/cherry.png');
    }

    create() {
        this.audio = new AudioController();
        this.particles = new ParticleSystem(this);
        this.runStats = this.createEmptyStats();
        this.replaySeed = Math.floor(Math.random() * 0x7fffffff);

        this.add.image(0, 0, 'cabinet').setOrigin(0, 0).setDisplaySize(CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        
        this.createReels();
        
        this.paylineGraphics = this.add.graphics().setDepth(10);
        this.uiGraphics = this.add.graphics().setDepth(20);
        this.comboBar = this.add.graphics().setDepth(20);

        this.createUI();

        this.titleOverlay = document.getElementById('title-screen');
        const playBtn = document.getElementById('play-button');
        if (playBtn) {
            playBtn.addEventListener('click', () => this.handleInput('primary'));
        }
        
        this.input.on('pointerdown', () => this.handleInput('primary'));
        this.input.keyboard?.on('keydown-SPACE', () => this.handleInput('primary'));
        this.input.keyboard?.on('keydown-ENTER', () => this.handleInput('primary'));
        this.input.keyboard?.on('keydown-S', () => this.handleInput('primary'));

        this.loadLeaderboardFromServer();
        this.reels.forEach(reel => reel.preRender());
        this.updateOverlay();
        
        this.gameState = GAME_STATE.INTRO;
        this.message = "TAP OR SPACE TO START";
    }

    private createEmptyStats(): RunStats {
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

    private createReels() {
        const startX = (CONFIG.CANVAS_WIDTH - (CONFIG.REEL_WIDTH * 3 + 40)) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;

        for (let i = 0; i < CONFIG.REEL_COUNT; i++) {
            this.reels.push(new Reel(this, i, startX + i * (CONFIG.REEL_WIDTH + 20), startY));
        }
    }

    private createUI() {
        const commonStyle = { font: 'bold 24px Inter, sans-serif', color: '#fff' };
        this.uiText = {
            score: this.add.text(60, 60, '', commonStyle).setOrigin(0, 0.5),
            best: this.add.text(CONFIG.CANVAS_WIDTH - 60, 60, '', commonStyle).setOrigin(1, 0.5),
            time: this.add.text(CONFIG.CANVAS_WIDTH / 2, 50, '', commonStyle).setOrigin(0.5, 0.5),
            spurt: this.add.text(CONFIG.CANVAS_WIDTH / 2, 76, '', { font: 'bold 20px Courier New', color: '#ff6a6a' }).setOrigin(0.5, 0.5).setVisible(false),
            combo: this.add.text(CONFIG.CANVAS_WIDTH / 2, 90, '', { font: 'bold 28px Courier New', color: '#ffb347' }).setOrigin(0.5, 0.5).setVisible(false),
            message: this.add.text(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 40, '', { font: 'bold 40px Courier New', color: '#fff' }).setOrigin(0.5, 0.5),
            comboBonus: this.add.text(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 100, '', { font: 'bold 26px Courier New', color: '#ffe082' }).setOrigin(0.5, 0.5).setVisible(false),
            hyper: this.add.text(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 140, 'HYPER CHAIN!', { font: 'bold 24px Courier New', color: '#8cfbff' }).setOrigin(0.5, 0.5).setVisible(false),
            fever: this.add.text(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 100, '', { font: 'bold 40px Courier New', color: '#ff0000' }).setOrigin(0.5, 0.5).setVisible(false)
        };
        
        // Add neon glow to UI text if possible or just use shadow
        Object.values(this.uiText).forEach(text => {
            text.setShadow(0, 0, '#ff00ff', 8);
            text.setDepth(30);
        });
    }

    update(_time: number, delta: number) {
        if (this.gameState === GAME_STATE.LOADING) return;

        if (this.isTimeAttackRunning && this.gameState !== GAME_STATE.TIMEUP) {
            this.timeLeftMs = Math.max(0, this.timeLeftMs - delta);
            if (this.timeLeftMs <= 0) {
                this.endTimeAttack();
            }
        }

        this.particles.update();

        if (this.flashTimer > 0) this.flashTimer -= delta;
        if (this.comboFlashTimer > 0) this.comboFlashTimer -= delta;
        if (this.lastSpurtFxTimer > 0) this.lastSpurtFxTimer -= delta;
        if (this.timeUpFxTimer > 0) this.timeUpFxTimer -= delta;

        if (this.comboCount > 0 && this.isTimeAttackRunning && this.gameState !== GAME_STATE.TIMEUP) {
            this.comboChainTimer = Math.max(0, this.comboChainTimer - delta);
            if (this.comboChainTimer <= 0) {
                this.comboCount = 0;
                this.comboText = "";
                this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
                this.message = "COMBO LOST";
            }
        }

        if (this.shakeTimer > 0) {
            this.shakeTimer -= delta;
            if (this.shakeTimer <= 0) {
                this.shakePower = 0;
            }
        }

        let allStopped = true;
        this.reels.forEach(reel => {
            const stopped = reel.update();
            if (!stopped && reel.isSpinning) allStopped = false;
        });

        if (this.gameState === GAME_STATE.STOPPING && allStopped) {
            this.evaluateResult();
        }

        this.drawPhaser();
    }

    private drawPhaser() {
        // Handle screen shake
        if (this.shakeTimer > 0 && this.shakePower > 0) {
            const dx = (Math.random() * 2 - 1) * this.shakePower;
            const dy = (Math.random() * 2 - 1) * this.shakePower;
            this.cameras.main.setScroll(-dx, -dy);
        } else {
            this.cameras.main.setScroll(0, 0);
        }

        // Set background color based on game state
        let bgColor = 0x0b011d;
        if (this.flashTimer > 0 && Math.floor(Date.now() / 50) % 2 === 0) {
            bgColor = 0x2a0a5a;
        }
        if (this.feverMode) {
            bgColor = 0x1a0033;
        }
        this.cameras.main.setBackgroundColor(bgColor);

        // Reach mode blinking
        this.reels.forEach((_reel, index) => {
            if (this.reachMode && index === 2 && Math.floor(Date.now() / 100) % 2 === 0) {
                // We'd need a separate graphic for reach highlight or just toggle visibility
            }
        });

        this.drawPayline();
        this.drawUIOverlay();
        this.particles.draw();
        this.updateUIText();
    }

    private drawPayline() {
        const g = this.paylineGraphics;
        g.clear();
        
        const totalReelWidth = (CONFIG.REEL_WIDTH * CONFIG.REEL_COUNT) + (20 * (CONFIG.REEL_COUNT - 1));
        const startX = (CONFIG.CANVAS_WIDTH - totalReelWidth) / 2;
        const startY = (CONFIG.CANVAS_HEIGHT - CONFIG.REEL_HEIGHT) / 2;
        const paylineY = startY + CONFIG.SYMBOL_SIZE * 1.5;

        g.save();
        // Neon Pink Payline
        // Phaser graphics don't easily do "dashed" lines + shadow blur in a single call like canvas
        // We'll mimic it with multiple lines if needed, but for now simple dashed line
        g.lineStyle(3, 0xff00ff);
        
        // Dashed line
        const dashLen = 10;
        const gapLen = 5;
        let curX = startX - 20;
        const endX = startX + totalReelWidth + 20;
        while (curX < endX) {
            g.lineBetween(curX, paylineY, Math.min(curX + dashLen, endX), paylineY);
            curX += dashLen + gapLen;
        }

        // High-tech Arrows (Chevron style)
        const drawChevron = (x: number, y: number, dir: number) => {
            g.fillStyle(0xff00ff);
            g.beginPath();
            g.moveTo(x, y - 10);
            g.lineTo(x + 10 * dir, y);
            g.lineTo(x, y + 10);
            g.lineTo(x - 5 * dir, y);
            g.closePath();
            g.fill();
        };

        drawChevron(startX - 35, paylineY, 1);
        drawChevron(startX + totalReelWidth + 35, paylineY, -1);
        
        // SCAN LINE text is handled in createUI
        g.restore();
    }

    private drawUIOverlay() {
        const g = this.uiGraphics;
        g.clear();

        if (this.comboFlashTimer > 0) {
            const alpha = Math.max(0.12, this.comboFlashTimer / CONFIG.COMBO_FX_DURATION_MS * 0.35);
            g.fillStyle(0xffaa28, alpha);
            g.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        }
        if (this.lastSpurtFxTimer > 0) {
            const alpha = Math.max(0.08, this.lastSpurtFxTimer / 550 * 0.20);
            g.fillStyle(0xff5050, alpha);
            g.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        }
        if (this.comboCount >= 5) {
            const pulse = 0.08 + ((Math.sin(Date.now() / 85) + 1) / 2) * 0.12;
            g.fillStyle(0x78f0ff, pulse);
            g.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
        }
        
        if (this.timeUpFxTimer > 0) {
            const fxRatio = this.timeUpFxTimer / 1800;
            g.fillStyle(0xffffff, 0.16 * fxRatio);
            g.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
            g.lineStyle(6, 0xffdc78, 0.9 * fxRatio);
            g.strokeCircle(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2, (1 - fxRatio) * 420);
        }

        // Draw Message Background
        if (this.message) {
            g.fillStyle(0x000000, 0.5);
            g.fillRect(0, CONFIG.CANVAS_HEIGHT - 80, CONFIG.CANVAS_WIDTH, 60);
        }
        
        // Ported Combo Bar
        if (this.comboCount > 0) {
            const ratio = Math.max(0, Math.min(1, this.comboChainTimer / this.currentComboWindowMs));
            const barW = 260;
            const barH = 14;
            const barX = (CONFIG.CANVAS_WIDTH - barW) / 2;
            const barY = 106;
            let chainColor = 0x7af0ff;
            if (this.comboChainTimer <= CONFIG.COMBO_CHAIN_WARNING_MS) {
                chainColor = Math.floor(Date.now() / 120) % 2 === 0 ? 0xff5252 : 0xffd2d2;
            }

            this.comboBar.clear();
            this.comboBar.fillStyle(0x000000, 0.45);
            this.comboBar.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
            this.comboBar.fillStyle(chainColor, 1);
            this.comboBar.fillRect(barX, barY, barW * ratio, barH);
            this.comboBar.lineStyle(1, 0xffffff, 0.6);
            this.comboBar.strokeRect(barX, barY, barW, barH);
        } else {
            this.comboBar.clear();
        }
    }

    private updateUIText() {
        if (!this.uiText) return;

        this.uiText.score.setText(`CREDITS: ${this.score}`);
        this.uiText.best.setText(`RECORD: ${this.highScore}`);
        
        const secondsLeft = this.timeLeftMs / 1000;
        this.uiText.time.setText(`TIME: ${secondsLeft.toFixed(1)}`);
        
        let timeColor = '#ffffff';
        if (secondsLeft <= 10) {
            timeColor = Math.floor(Date.now() / 120) % 2 === 0 ? '#ff4040' : '#ffd0d0';
        } else if (secondsLeft <= 20) {
            timeColor = '#ffd740';
        }
        this.uiText.time.setColor(timeColor);
        
        this.uiText.spurt.setVisible(secondsLeft <= CONFIG.LAST_SPURT_MS / 1000 && this.gameState !== GAME_STATE.TIMEUP);
        this.uiText.spurt.setText(`LAST SPURT x${CONFIG.LAST_SPURT_MULTIPLIER.toFixed(1)}`);
        
        this.uiText.combo.setVisible(this.comboCount >= 2);
        this.uiText.combo.setText(`COMBO x${this.comboCount}`);
        
        this.uiText.message.setText(this.message);
        
        this.uiText.comboBonus.setVisible(!!this.comboText && this.comboFlashTimer > 0);
        this.uiText.comboBonus.setText(this.comboText);
        
        this.uiText.hyper.setVisible(this.comboCount >= 5);
        
        this.uiText.fever.setVisible(this.feverMode);
        this.uiText.fever.setText(`FEVER: ${this.feverTurns}`);

        if (this.gameState === GAME_STATE.TIMEUP) {
            this.uiText.message.setText("TIME UP"); // Will be centered in end screen logic if needed or just use current text
        }
    }

    handleInput(action: string) {
        if (this.gameState === GAME_STATE.LOADING) return;
        if (action !== 'primary') return;
        this.audio.init();

        switch (this.gameState) {
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

    private resetGame() {
        this.hideEndScreen();
        this.score = 0;
        this.feverMode = false;
        this.feverTurns = 0;
        this.gameState = GAME_STATE.IDLE;
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
        this.lastSpurtFxTimer = 0;
        this.runStats = this.createEmptyStats();
        this.finalRank = null;
        this.finalSubmissionError = '';
        this.submittingScore = false;
        this.replayRounds = [];
        this.replaySeed = Math.floor(Math.random() * 0x7fffffff);
        this.updateOverlay();
        
        if (this.uiText) {
            this.uiText.fever.setVisible(false);
            this.uiText.combo.setVisible(false);
            this.uiText.hyper.setVisible(false);
        }
    }

    private spin() {
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

        this.gameState = GAME_STATE.SPINNING;
        this.stopIndex = 0;
        this.message = "SPINNING...";
        this.reachMode = false;
        this.audio.playSpinStart();

        this.reels.forEach(reel => reel.start());
    }

    private stopReel() {
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
                this.gameState = GAME_STATE.STOPPING;
            }
        }
    }

    private evaluateResult() {
        const results = this.reels.map(r => r.getResult());

        const r1 = results[0];
        const r2 = results[1];
        const r3 = results[2];

        let payout = 0;
        let basePayout = 0;
        let isWin = false;
        let isJackpot = false;

        if (r1 === r2 && r2 === r3) {
            basePayout = SYMBOL_DATA[r1 as keyof typeof SYMBOL_DATA].payout;
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
            this.gameState = GAME_STATE.RESULT;
        } else {
            this.runStats.losses++;
            this.comboCount = 0;
            this.comboText = "";
            this.comboChainTimer = 0;
            this.currentComboWindowMs = CONFIG.COMBO_CHAIN_WINDOW_MS;
            this.gameState = GAME_STATE.IDLE;
            this.message = "TRY AGAIN";
        }

        this.replayRounds.push({
            results: [...results],
            payout,
            scoreAfter: this.score,
            timeLeftMs: Math.max(0, Math.floor(this.timeLeftMs)),
            feverMode: this.feverMode,
            reachMode: this.reachMode,
            comboCount: this.comboCount
        });
    }

    private triggerFever() {
        this.feverMode = true;
        this.feverTurns = CONFIG.FEVER_TURNS;
    }

    private endTimeAttack() {
        this.isTimeAttackRunning = false;
        this.timeLeftMs = 0;
        this.gameState = GAME_STATE.TIMEUP;
        this.showEndScreen();
        // ... (remaining)
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

        this.submitScoreToServer(this.score);
    }

    private async submitScoreToServer(score: number) {
        if (score <= 0 || this.submittingScore) return;
        const nameInput = window.prompt('名前を入力してください（12文字まで）', 'PLAYER');
        const name = (nameInput || 'PLAYER').trim().slice(0, 12) || 'PLAYER';
        const commentInput = window.prompt('コメントを入力してください（20文字まで）', 'HOT STREAK');
        const message = (commentInput || 'NO COMMENT').trim().slice(0, 20) || 'NO COMMENT';
        this.submittingScore = true;
        this.finalSubmissionError = '';

        try {
            const replayData = JSON.stringify({
                version: SLOT_REPLAY_VERSION,
                seed: this.replaySeed,
                strips: this.reels.map((reel) => [...reel.symbols]),
                rounds: this.replayRounds.map((round) => ({ ...round }))
            });
            const replayDigest = await this.sha256Hex(replayData);
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gameId: 'slot60',
                    name,
                    message,
                    score,
                    replayData,
                    replayDigest
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
        } catch (error) {
            console.warn('Failed to submit slot60 score:', error);
            this.finalSubmissionError = 'NETWORK ERROR';
        } finally {
            this.submittingScore = false;
        }
    }

    private async sha256Hex(value: string) {
        const data = new TextEncoder().encode(String(value ?? ''));
        const digest = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    private normalizeLeaderboardRows(rows: any[]) {
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

    private async loadLeaderboardFromServer() {
        try {
            const response = await fetch('/api/leaderboard?gameId=slot60');
            if (!response.ok) return;
            const payload = await response.json();
            this.leaderboard = this.normalizeLeaderboardRows(payload?.combinedEntries || payload?.entries || []);
            this.highScore = this.leaderboard[0]?.score || 0;
            this.updateOverlay();
        } catch (error) {
            console.warn('Failed to load slot60 leaderboard:', error);
        }
    }

    private updateOverlay() {
        const isActive = this.gameState === GAME_STATE.INTRO;
        if (this.titleOverlay) {
            this.titleOverlay.classList.toggle('active', isActive);
            if (isActive && this.leaderboard.length > 0) {
                const top = this.leaderboard[0];
                const netVal = document.getElementById('net-high-score-value');
                const netName = document.getElementById('net-high-score-name');
                if (netVal) netVal.textContent = top.score.toLocaleString();
                if (netName) netName.textContent = top.name;
            }
        }
    }

    public resize() {
        const aspect = CONFIG.CANVAS_WIDTH / CONFIG.CANVAS_HEIGHT;
        const shell = document.querySelector('.slot-shell') as HTMLElement;
        const topbar = document.querySelector('.slot-topbar') as HTMLElement;
        const hint = document.querySelector('.slot-mobile-hint') as HTMLElement;
        const routeMode = document.body?.dataset?.routeMode;
        
        const reservedHeight =
            (topbar?.getBoundingClientRect().height || 0) +
            (routeMode === 'mobile' ? (hint?.getBoundingClientRect().height || 0) + 12 : 0) +
            20;

        let w = window.innerWidth - 16;
        let h = window.innerHeight - reservedHeight;

        if (shell) {
            w = Math.min(w, shell.clientWidth - 4);
        }
        h = Math.max(220, h);
        w = Math.max(280, w);

        if (w / h > aspect) {
            w = h * aspect;
        } else {
            h = w / aspect;
        }

        this.game.canvas.style.width = `${w}px`;
        this.game.canvas.style.height = `${h}px`;
    }

    // End Screen Leaders
    private endScreenContainer: Phaser.GameObjects.Container | null = null;

    private showEndScreen() {
        if (this.endScreenContainer) this.endScreenContainer.destroy();
        
        const container = this.add.container(0, 0).setDepth(100);
        this.endScreenContainer = container;

        const bg = this.add.rectangle(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT, 0x000000, 0.75).setOrigin(0, 0);
        container.add(bg);

        const commonStyle = { font: 'bold 30px Courier New', color: '#fff' };
        container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 110, 'TIME UP', { font: 'bold 48px Courier New', color: '#fff' }).setOrigin(0.5));
        container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 155, `FINAL: ${this.score}`, commonStyle).setOrigin(0.5));
        container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 192, `BEST: ${this.highScore}`, commonStyle).setOrigin(0.5));

        if (this.finalRank) {
            container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 238, `TOP10 RANK #${this.finalRank}`, { font: 'bold 22px Courier New', color: '#7af0ff' }).setOrigin(0.5));
        } else if (this.submittingScore) {
            container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 238, 'SAVING SCORE...', { font: 'bold 20px Courier New', color: '#ffd166' }).setOrigin(0.5));
        } else if (this.finalSubmissionError) {
            container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 238, this.finalSubmissionError, { font: 'bold 18px Courier New', color: '#ff8a80' }).setOrigin(0.5));
        }

        container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 286, 'TOP 10 LEADERBOARD', { font: 'bold 18px Courier New', color: '#fff' }).setOrigin(0.5));

        const baseY = 314;
        const rowH = 22;
        const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

        for (let i = 0; i < CONFIG.LEADERBOARD_LIMIT; i++) {
            const row = this.leaderboard[i];
            const y = baseY + i * rowH;
            if (!row) {
                container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, y, `${i + 1}. ---`, { font: 'bold 18px Courier New', color: 'rgba(255,255,255,0.35)' }).setOrigin(0.5));
                continue;
            }
            const marker = i === 0 ? '★' : '';
            const color = i < 3 ? '#ffd166' : '#d9e6ff';
            const rowText = `${i + 1}. ${shorten(row.name, 10)} ${row.score}${marker}`;
            container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, y, rowText, { font: 'bold 18px Courier New', color }).setOrigin(0.5));
        }

        container.add(this.add.text(CONFIG.CANVAS_WIDTH / 2, 582, 'TAP OR SPACE TO RETRY', { font: 'bold 24px Courier New', color: '#fff' }).setOrigin(0.5));
    }

    private hideEndScreen() {
        if (this.endScreenContainer) {
            this.endScreenContainer.destroy();
            this.endScreenContainer = null;
        }
    }
}
