import Phaser from 'phaser';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../constants';

export class NameInputOverlay {
  private container: Phaser.GameObjects.Container;
  private onCommit: (name: string) => void;

  constructor(scene: Phaser.Scene, initialName: string, onCommit: (name: string) => void) {
    this.onCommit = onCommit;
    this.container = scene.add.container(0, 0).setDepth(150);

    const bg = scene.add.graphics();
    bg.fillStyle(0x000000, 0.85);
    bg.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.container.add(bg);

    const title = scene.add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 80, 'HIGH SCORE!', {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '40px',
      color: '#00ffff',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5);
    this.container.add(title);

    const prompt = scene.add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 20, 'ENTER YOUR NAME', {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '20px',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.container.add(prompt);

    const nameText = scene.add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 40, initialName, {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '48px',
      color: '#ffde7f',
      backgroundColor: '#222222',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5);
    this.container.add(nameText);

    const hint = scene.add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 120, 'TYPE AND PRESS ENTER', {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '16px',
      color: '#888888'
    }).setOrigin(0.5);
    this.container.add(hint);

    // Dynamic keyboard input
    let name = initialName;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        window.removeEventListener('keydown', keydown);
        this.destroy();
        this.onCommit(name);
      } else if (event.key === 'Backspace') {
        name = name.slice(0, -1);
      } else if (event.key.length === 1 && name.length < 12) {
        name += event.key.toUpperCase();
      }
      nameText.setText(name || '_');
    };
    window.addEventListener('keydown', keydown);

    // Fallback for mobile (prompt)
    if (typeof window !== 'undefined' && 'ontouchstart' in window) {
      nameText.setInteractive().on('pointerdown', () => {
         const newName = window.prompt('YOUR NAME:', name);
         if (newName !== null) {
           name = newName.toUpperCase().slice(0, 12).trim();
           nameText.setText(name || '_');
         }
      });
    }
  }

  destroy() {
    this.container.destroy();
  }
}
