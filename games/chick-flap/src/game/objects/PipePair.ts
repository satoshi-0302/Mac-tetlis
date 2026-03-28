import Phaser from 'phaser';
import { PIPE_CAP_HEIGHT, PIPE_GAP, PIPE_SPEED, PIPE_WIDTH, PLAY_HEIGHT } from '../constants';

export class PipePair {
  readonly top: Phaser.Physics.Arcade.Image;
  readonly bottom: Phaser.Physics.Arcade.Image;
  readonly topCap: Phaser.Physics.Arcade.Image;
  readonly bottomCap: Phaser.Physics.Arcade.Image;
  scored = false;

  constructor(scene: Phaser.Scene, x: number, centerY: number) {
    const topHeight = centerY - PIPE_GAP / 2;
    const bottomY = centerY + PIPE_GAP / 2;
    const bottomHeight = PLAY_HEIGHT - bottomY;

    this.top = scene.physics.add.image(x, topHeight / 2, 'pipe-body');
    this.top.setDisplaySize(PIPE_WIDTH, topHeight).setImmovable(true).setGravity(0, 0).setDepth(20);

    this.bottom = scene.physics.add.image(x, bottomY + bottomHeight / 2, 'pipe-body');
    this.bottom
      .setDisplaySize(PIPE_WIDTH, bottomHeight)
      .setImmovable(true)
      .setGravity(0, 0)
      .setDepth(20);

    this.topCap = scene.physics.add.image(x, topHeight - PIPE_CAP_HEIGHT / 2, 'pipe-cap');
    this.topCap
      .setDisplaySize(PIPE_WIDTH + 12, PIPE_CAP_HEIGHT)
      .setImmovable(true)
      .setGravity(0, 0)
      .setDepth(21);

    this.bottomCap = scene.physics.add.image(x, bottomY + PIPE_CAP_HEIGHT / 2, 'pipe-cap');
    this.bottomCap
      .setDisplaySize(PIPE_WIDTH + 12, PIPE_CAP_HEIGHT)
      .setImmovable(true)
      .setGravity(0, 0)
      .setDepth(21);
  }

  update(deltaSec: number): void {
    const move = PIPE_SPEED * deltaSec;
    this.top.x -= move;
    this.bottom.x -= move;
    this.topCap.x -= move;
    this.bottomCap.x -= move;

    this.top.body?.updateFromGameObject();
    this.bottom.body?.updateFromGameObject();
    this.topCap.body?.updateFromGameObject();
    this.bottomCap.body?.updateFromGameObject();
  }

  get rightEdge(): number {
    return this.top.x + PIPE_WIDTH / 2;
  }

  destroy(): void {
    this.top.destroy();
    this.bottom.destroy();
    this.topCap.destroy();
    this.bottomCap.destroy();
  }
}
