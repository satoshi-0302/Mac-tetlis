import Phaser from 'phaser';
import {
  CHICK_HIT_RADIUS,
  CHICK_SIZE,
  FLAP_VELOCITY,
  GRAVITY,
  MAX_FALL_SPEED
} from '../constants';

export class Chick {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private readonly frameKeys = ['chick-frame-up', 'chick-frame-mid', 'chick-frame-down'] as const;
  private baseFrameIndex = 0;
  private baseFrameElapsed = 0;
  private burstActive = false;
  private burstElapsed = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.physics.add.sprite(x, y, 'chick-frame-mid');
    this.sprite.setDisplaySize(CHICK_SIZE, CHICK_SIZE);
    this.sprite.setCollideWorldBounds(false);
    this.sprite.setDepth(40);
    this.sprite.setMaxVelocity(MAX_FALL_SPEED, MAX_FALL_SPEED);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const hitSize = CHICK_HIT_RADIUS * 2;
    body.setSize(hitSize, hitSize);
    body.setOffset((CHICK_SIZE - hitSize) / 2, (CHICK_SIZE - hitSize) / 2);
  }

  reset(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.sprite.setVelocity(0, 0);
    this.sprite.setAccelerationY(0);
    this.sprite.setAngle(-8);
    this.sprite.setTexture(this.frameKeys[1]);
    this.baseFrameIndex = 0;
    this.baseFrameElapsed = 0;
    this.burstActive = false;
    this.burstElapsed = 0;
  }

  start(): void {
    this.sprite.setAccelerationY(GRAVITY);
    this.flap();
  }

  flap(): void {
    this.sprite.setVelocityY(FLAP_VELOCITY);
    this.burstActive = true;
    this.burstElapsed = 0;
    this.sprite.setTexture(this.frameKeys[0]);
  }

  update(playState: 'ready' | 'playing' | 'gameover', deltaMs: number): void {
    const vy = this.sprite.body?.velocity.y ?? 0;
    if (playState === 'ready') {
      this.updateBaseLoop(deltaMs, [1, 0, 1], 300);
      this.sprite.setAngle(-8);
      return;
    }

    if (playState === 'gameover') {
      this.sprite.setTexture(this.frameKeys[2]);
      this.sprite.setAngle(Phaser.Math.Clamp(this.sprite.angle + 4, -90, 88));
      return;
    }

    if (this.burstActive) {
      this.burstElapsed += deltaMs;
      if (this.burstElapsed < 100) {
        this.sprite.setTexture(this.frameKeys[0]);
      } else if (this.burstElapsed < 200) {
        this.sprite.setTexture(this.frameKeys[1]);
      } else if (this.burstElapsed < 300) {
        this.sprite.setTexture(this.frameKeys[2]);
      } else {
        this.burstActive = false;
        this.burstElapsed = 0;
        this.baseFrameElapsed = 0;
      }
    } else if (vy > 220) {
      this.sprite.setTexture(this.frameKeys[2]);
      this.baseFrameElapsed = 0;
    } else {
      this.updateBaseLoop(deltaMs, [0, 1, 2], 300);
    }

    const ratio = Phaser.Math.Clamp(vy / MAX_FALL_SPEED, -1, 1);
    this.sprite.setAngle(Phaser.Math.Linear(-58, 82, (ratio + 1) / 2));
  }

  private updateBaseLoop(deltaMs: number, order: readonly number[], frameDurationMs: number): void {
    this.baseFrameElapsed += deltaMs;
    while (this.baseFrameElapsed >= frameDurationMs) {
      this.baseFrameElapsed -= frameDurationMs;
      this.baseFrameIndex = (this.baseFrameIndex + 1) % order.length;
    }
    this.sprite.setTexture(this.frameKeys[order[this.baseFrameIndex]]);
  }
}
