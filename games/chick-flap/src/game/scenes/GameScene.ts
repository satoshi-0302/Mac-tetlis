import Phaser from 'phaser';
import { Chick } from '../objects/Chick';
import { PipePair } from '../objects/PipePair';
import {
  CHICK_START_X,
  CHICK_START_Y,
  PIPE_MAX_CENTER_Y,
  PIPE_MIN_CENTER_Y,
  PIPE_SPACING,
  PIPE_SPAWN_OFFSET,
  PLAY_HEIGHT,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  GAME_DURATION
} from '../constants';
import { Hud } from '../ui/Hud';

type State = 'ready' | 'playing' | 'gameover';

export class GameScene extends Phaser.Scene {
  private chick!: Chick;
  private hud!: Hud;
  private state: State = 'ready';
  private pipes: PipePair[] = [];
  private score = 0;
  private bestScore = 0;
  private frameTick = 0;
  private playingTime = 0;
  private gameOverTimer = 0;
  private skyOffset = 0;
  private groundOffset = 0;
  private clouds: Array<{ x: number; y: number; speed: number }> = [];
  private domPointerHandler: (() => void) | null = null;
  private domTouchHandler: ((event: TouchEvent) => void) | null = null;
  private domKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor() {
    super('game');
  }

  public requestPress(): void {
    this.handlePress();
  }

  create(): void {
    this.createTextures();
    this.physics.world.setBounds(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    this.chick = new Chick(this, CHICK_START_X, CHICK_START_Y);
    this.hud = new Hud(this);
    this.hud.showReady();
    this.resetPipes();
    this.clouds = [
      { x: 100, y: 138, speed: 0.8 },
      { x: 320, y: 176, speed: 1.0 },
      { x: 560, y: 132, speed: 0.7 }
    ];

    const press = () => this.handlePress();
    this.input.keyboard?.on('keydown-SPACE', press);
    this.input.keyboard?.on('keydown-UP', press);
    this.input.on('pointerdown', press);
    this.registerDomInputFallback(press);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unregisterDomInputFallback());
    this.emitState();
    this.emitScore();
  }

  update(_: number, delta: number): void {
    const deltaSec = Math.min(delta / 1000, 1 / 30);
    this.frameTick += 1;

    this.updateParallax(deltaSec);
    this.drawBackground();

    if (this.state === 'ready') {
      this.chick.sprite.y = CHICK_START_Y + Math.sin(this.frameTick * 0.11) * 10;
    }

    if (this.state === 'playing') {
      this.playingTime += delta;
      this.updatePipes(deltaSec);
      this.checkCollisions();

      if (this.playingTime >= GAME_DURATION) {
        this.triggerGameOver();
      }
    }

    if (this.state === 'gameover') {
      this.gameOverTimer += delta;
    }

    this.chick.update(this.state, delta);
  }

  private handlePress(): void {
    if (this.state === 'ready') {
      this.state = 'playing';
      this.hud.clearCenter();
      this.chick.start();
      this.emitState();
      return;
    }

    if (this.state === 'playing') {
      this.chick.flap();
      return;
    }

    if (this.state === 'gameover' && this.gameOverTimer > 420) {
      this.restartRound();
    }
  }

  private restartRound(): void {
    this.state = 'ready';
    this.score = 0;
    this.playingTime = 0;
    this.gameOverTimer = 0;
    this.hud.setScore(0);
    this.hud.showReady();
    this.chick.reset(CHICK_START_X, CHICK_START_Y);
    this.resetPipes();
    this.emitState();
    this.emitScore();
  }

  private resetPipes(): void {
    this.pipes.forEach((pipe) => pipe.destroy());
    this.pipes = [];
    const startX = SCREEN_WIDTH + PIPE_SPAWN_OFFSET;
    for (let i = 0; i < 3; i += 1) {
      this.pipes.push(new PipePair(this, startX + i * PIPE_SPACING, Phaser.Math.Between(PIPE_MIN_CENTER_Y, PIPE_MAX_CENTER_Y)));
    }
  }

  private updatePipes(deltaSec: number): void {
    this.pipes.forEach((pipe) => pipe.update(deltaSec));
    while (this.pipes.length > 0 && this.pipes[0].rightEdge < -20) {
      const first = this.pipes.shift();
      first?.destroy();
    }

    while (this.pipes.length < 3) {
      const baseX = this.pipes.length > 0 ? this.pipes[this.pipes.length - 1].top.x : SCREEN_WIDTH + PIPE_SPAWN_OFFSET;
      this.pipes.push(
        new PipePair(this, baseX + PIPE_SPACING, Phaser.Math.Between(PIPE_MIN_CENTER_Y, PIPE_MAX_CENTER_Y))
      );
    }

    for (const pipe of this.pipes) {
      if (!pipe.scored && pipe.rightEdge < this.chick.sprite.x) {
        pipe.scored = true;
        this.score += 1;
        this.bestScore = Math.max(this.bestScore, this.score);
        this.hud.setScore(this.score);
        this.emitScore();
      }
    }
  }

  private checkCollisions(): void {
    if (this.chick.sprite.y + 16 >= PLAY_HEIGHT || this.chick.sprite.y - 16 <= 0) {
      this.triggerGameOver();
      return;
    }

    for (const pipe of this.pipes) {
      if (
        this.physics.overlap(this.chick.sprite, pipe.top) ||
        this.physics.overlap(this.chick.sprite, pipe.bottom) ||
        this.physics.overlap(this.chick.sprite, pipe.topCap) ||
        this.physics.overlap(this.chick.sprite, pipe.bottomCap)
      ) {
        this.triggerGameOver();
        return;
      }
    }
  }

  private triggerGameOver(): void {
    if (this.state !== 'playing') return;
    this.state = 'gameover';
    this.gameOverTimer = 0;
    this.chick.sprite.setAccelerationY(0);
    this.chick.sprite.setVelocityY(120);
    this.hud.showGameOver(this.score, this.bestScore);
    this.emitState();
    this.game.events.emit('chick-flap:gameover', {
      score: this.score,
      bestScore: this.bestScore
    });
  }

  private emitScore(): void {
    this.game.events.emit('chick-flap:score', {
      score: this.score,
      bestScore: this.bestScore
    });
  }

  private emitState(): void {
    this.game.events.emit('chick-flap:state', {
      state: this.state
    });
  }

  private createTextures(): void {
    if (!this.textures.exists('pipe-body')) {
      const g = this.add.graphics();
      // Stainless steel cylinder look
      const w = 92;
      const h = 200;
      // Main metallic gray
      g.fillStyle(0x777777);
      g.fillRect(0, 0, w, h);
      // Highlights & Shadows
      g.fillStyle(0x333333, 0.4);
      g.fillRect(0, 0, w * 0.2, h); // Left shadow
      g.fillStyle(0xffffff, 0.5);
      g.fillRect(w * 0.3, 0, w * 0.05, h); // Specular highlight 1
      g.fillStyle(0xffffff, 0.3);
      g.fillRect(w * 0.4, 0, w * 0.1, h); // Broad light
      g.fillStyle(0x222222, 0.5);
      g.fillRect(w * 0.8, 0, w * 0.2, h); // Right shadow

      // Cyberpunk detail line
      g.lineStyle(2, 0x00ffff, 0.3);
      g.lineBetween(w * 0.5, 0, w * 0.5, h);

      g.generateTexture('pipe-body', w, h);
      g.destroy();
    }

    if (!this.textures.exists('pipe-cap')) {
      const g = this.add.graphics();
      const w = 104;
      const h = 28;
      // Chrome/Steel Cap
      g.fillStyle(0xaaaaaa);
      g.fillRoundedRect(0, 0, w, h, 6);
      // Shine
      g.fillStyle(0xffffff, 0.6);
      g.fillRoundedRect(4, 4, w - 8, 6, 3);
      // Cyber accent
      g.fillStyle(0x00ffff, 0.8);
      g.fillRect(w * 0.45, h * 0.7, w * 0.1, h * 0.2);

      g.generateTexture('pipe-cap', w, h);
      g.destroy();
    }
  }

  private updateParallax(deltaSec: number): void {
    this.groundOffset = (this.groundOffset + 282 * deltaSec) % 32;
    this.skyOffset = (this.skyOffset + 0.6 * 60 * deltaSec) % (SCREEN_WIDTH + 40);
    this.clouds.forEach((cloud) => {
      cloud.x -= 1.3 * cloud.speed * 60 * deltaSec;
      if (cloud.x < -50) cloud.x = SCREEN_WIDTH + 50;
    });
  }

  private drawBackground(): void {
    this.children.list
      .filter((child) => (child as Phaser.GameObjects.GameObject & { name?: string }).name === 'bg')
      .forEach((child) => child.destroy());

    const progress = Math.min(this.playingTime / GAME_DURATION, 1);
    const darknessStep = Math.floor(this.playingTime / 10000); // 0 to 6
    const brightness = Math.max(0, 1 - (darknessStep * 1) / 6);

    const g = this.add.graphics();
    g.name = 'bg';
    g.setDepth(1);

    // Sky colors
    const skyTop = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x18226f),
      Phaser.Display.Color.ValueToColor(0x000000),
      1,
      progress
    );
    const skyBottom = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0xff784f),
      Phaser.Display.Color.ValueToColor(0x220000),
      1,
      progress
    );

    const topHex = Phaser.Display.Color.GetColor(skyTop.r, skyTop.g, skyTop.b);
    const botHex = Phaser.Display.Color.GetColor(skyBottom.r, skyBottom.g, skyBottom.b);

    g.fillGradientStyle(topHex, topHex, botHex, botHex, 1);
    g.fillRect(0, 0, SCREEN_WIDTH, PLAY_HEIGHT);

    // Sun sinking (starts at 118, ends at PLAY_HEIGHT + 100)
    const sunStartX = 480;
    const sunStartY = 118;
    const sunEndY = PLAY_HEIGHT + 60;
    const sunY = sunStartY + (sunEndY - sunStartY) * progress;

    if (brightness > 0) {
      g.fillStyle(0xffde7f, brightness);
      g.fillCircle(sunStartX, sunY, 54);
      // Retrowave bars on sun
      for (let i = 0; i < 12; i += 1) {
        if (i % 2 !== 0) continue;
        g.lineStyle(2, botHex, 1);
        g.lineBetween(sunStartX - 42, sunY - 40 + i * 7, sunStartX + 42, sunY - 40 + i * 7);
      }
    }

    // Sea instead of grid
    const horizonY = PLAY_HEIGHT * 0.75;
    const seaColor = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x18226f),
      Phaser.Display.Color.ValueToColor(0x000000),
      1,
      progress
    );
    const seaHex = Phaser.Display.Color.GetColor(seaColor.r, seaColor.g, seaColor.b);
    g.fillStyle(seaHex);
    g.fillRect(0, horizonY, SCREEN_WIDTH, PLAY_HEIGHT - horizonY);

    // Sun Reflection on Water
    if (sunY < horizonY + 100 && brightness > 0) {
      const reflectWidth = 60 * brightness;
      g.fillStyle(0xffde7f, 0.3 * brightness);
      g.fillRect(sunStartX - reflectWidth / 2, horizonY, reflectWidth, PLAY_HEIGHT - horizonY);
    }

    // Sea details (Cyberpunk glimmer)
    const glimmerAlpha = 0.4 * brightness;
    if (glimmerAlpha > 0) {
      g.lineStyle(1, 0x57f3ff, glimmerAlpha);
      for (let i = 0; i < 6; i += 1) {
        const y = horizonY + 10 + i * 12;
        const xOffset = (this.frameTick * (1 + i * 0.2)) % 60;
        for (let x = -60; x < SCREEN_WIDTH; x += 60) {
          g.lineBetween(x + xOffset, y, x + xOffset + 20, y);
        }
      }
    }

    // Ground area (Dark Cyber style)
    g.fillStyle(0x0a0a1a);
    g.fillRect(0, PLAY_HEIGHT, SCREEN_WIDTH, 64);
    g.lineStyle(2, 0x00ffff, 0.5 * brightness);
    g.lineBetween(0, PLAY_HEIGHT, SCREEN_WIDTH, PLAY_HEIGHT);
    // Ground Grid
    for (let stripe = 0; stripe < SCREEN_WIDTH / 32; stripe += 1) {
      const x = (stripe * 44 - this.groundOffset) % (SCREEN_WIDTH + 44) - 44;
      g.lineStyle(1, 0x00ffff, 0.2 * brightness);
      g.lineBetween(x, PLAY_HEIGHT, (x - 100) * 1.5, SCREEN_HEIGHT);
    }
  }

  private registerDomInputFallback(press: () => void): void {
    const canvas = this.game.canvas;
    this.domPointerHandler = () => press();
    this.domTouchHandler = (event: TouchEvent) => {
      event.preventDefault();
      press();
    };
    this.domKeyHandler = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        event.preventDefault();
        press();
      }
    };

    canvas.addEventListener('pointerdown', this.domPointerHandler);
    canvas.addEventListener('touchstart', this.domTouchHandler, { passive: false });
    window.addEventListener('keydown', this.domKeyHandler);
  }

  private unregisterDomInputFallback(): void {
    const canvas = this.game.canvas;
    if (this.domPointerHandler) {
      canvas.removeEventListener('pointerdown', this.domPointerHandler);
      this.domPointerHandler = null;
    }
    if (this.domTouchHandler) {
      canvas.removeEventListener('touchstart', this.domTouchHandler);
      this.domTouchHandler = null;
    }
    if (this.domKeyHandler) {
      window.removeEventListener('keydown', this.domKeyHandler);
      this.domKeyHandler = null;
    }
  }
}
