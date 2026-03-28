import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.image('chick-frame-up', 'assets/chick_frame_01.png');
    this.load.image('chick-frame-mid', 'assets/chick_frame_02.png');
    this.load.image('chick-frame-down', 'assets/chick_frame_03.png');
  }

  create(): void {
    this.scene.start('game');
  }
}
