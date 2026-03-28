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
  SCREEN_WIDTH
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
      this.updatePipes(deltaSec);
      this.checkCollisions();
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
      g.fillStyle(0x49ff8d);
      g.fillRect(0, 0, 88, 200);
      g.fillStyle(0x0e7042);
      g.fillRect(76, 0, 12, 200);
      g.generateTexture('pipe-body', 88, 200);
      g.destroy();
    }

    if (!this.textures.exists('pipe-cap')) {
      const g = this.add.graphics();
      g.fillStyle(0x49ff8d);
      g.fillRect(0, 0, 100, 24);
      g.fillStyle(0x0e7042);
      g.fillRect(88, 0, 12, 24);
      g.generateTexture('pipe-cap', 100, 24);
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

    const g = this.add.graphics();
    g.name = 'bg';
    g.setDepth(1);

    g.fillGradientStyle(0x18226f, 0x18226f, 0xff784f, 0xff784f, 1);
    g.fillRect(0, 0, SCREEN_WIDTH, PLAY_HEIGHT);

    g.fillStyle(0xffde7f);
    g.fillCircle(480, 118, 54);
    for (let i = 0; i < 12; i += 1) {
      if (i % 2 !== 0) continue;
      g.lineStyle(2, 0xff784f, 1);
      g.lineBetween(438, 78 + i * 7, 522, 78 + i * 7);
    }

    const horizonY = PLAY_HEIGHT * 0.8;
    g.lineStyle(2, 0x57f3ff, 1);
    g.lineBetween(0, horizonY, SCREEN_WIDTH, horizonY);
    for (let i = 0; i < 35; i += 1) {
      const x = (i * 36 - this.skyOffset) % (SCREEN_WIDTH + 40);
      g.lineStyle(1, 0x5d63ff, 0.7);
      g.lineBetween(x, horizonY, SCREEN_WIDTH / 2, PLAY_HEIGHT - 2);
    }

    g.fillStyle(0x38e0ff, 0.75);
    this.clouds.forEach((cloud) => {
      g.fillCircle(cloud.x, cloud.y, 16);
      g.fillCircle(cloud.x + 18, cloud.y - 5, 13);
      g.fillCircle(cloud.x - 17, cloud.y + 2, 12);
      g.fillRect(cloud.x - 22, cloud.y, 42, 12);
    });

    g.fillStyle(0x3f7d3d);
    g.fillRect(0, PLAY_HEIGHT, SCREEN_WIDTH, 64);
    g.fillStyle(0xb4ec74);
    for (let stripe = 0; stripe < SCREEN_WIDTH + 32; stripe += 32) {
      const x = (stripe - this.groundOffset) % (SCREEN_WIDTH + 32) - 32;
      g.fillRect(x, PLAY_HEIGHT + 8, 20, 16);
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
