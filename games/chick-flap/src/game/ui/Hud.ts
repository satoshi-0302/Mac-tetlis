import Phaser from 'phaser';
import { GAME_VERSION, SCREEN_HEIGHT, SCREEN_WIDTH } from '../constants';

export class Hud {
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly versionText: Phaser.GameObjects.Text;
  private readonly centerText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const mobileRoute =
      typeof document !== 'undefined' && document.body.dataset.routeMode === 'mobile';
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: mobileRoute ? '30px' : '34px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6
    };

    this.scoreText = scene.add.text(SCREEN_WIDTH / 2, 24, '0', style).setOrigin(0.5, 0).setDepth(80);
    this.titleText = scene
      .add.text(14, 10, 'CHICK FLAP', {
        fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
        fontSize: mobileRoute ? '22px' : '24px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
      })
      .setDepth(80);
    this.versionText = scene
      .add.text(14, SCREEN_HEIGHT - 28, GAME_VERSION.toUpperCase(), {
        fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
        fontSize: mobileRoute ? '12px' : '14px',
        color: '#7fe4ff',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setDepth(80);
    this.centerText = scene
      .add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 36, '', {
        fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
        fontSize: mobileRoute ? '26px' : '30px',
        align: 'center',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(81);
  }

  setScore(score: number): void {
    this.scoreText.setText(String(score));
  }

  showReady(): void {
    this.centerText.setText('TAP TO FLAP\nSPACE / CLICK / TAP');
  }

  showGameOver(score: number, bestScore: number): void {
    this.centerText.setText(`GAME OVER\nSCORE ${score}\nBEST ${bestScore}\nPRESS TO RESTART`);
  }

  clearCenter(): void {
    this.centerText.setText('');
  }
}
