import Phaser from 'phaser';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../constants';
import { fetchLeaderboard } from '../net/api';

export class LeaderboardOverlay {
  private container: Phaser.GameObjects.Container;
  private onRestart: () => void;
  private onWatch: (entryId: string) => void;

  constructor(scene: Phaser.Scene, onRestart: () => void, onWatch: (entryId: string) => void) {
    this.onRestart = onRestart;
    this.onWatch = onWatch;
    this.container = scene.add.container(0, 0).setDepth(200);

    const bg = scene.add.graphics();
    bg.fillStyle(0x0a0a20, 0.9);
    bg.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    bg.lineStyle(2, 0x00ffff, 0.5);
    bg.strokeRect(40, 40, SCREEN_WIDTH - 80, SCREEN_HEIGHT - 80);
    this.container.add(bg);

    const title = scene.add.text(SCREEN_WIDTH / 2, 80, 'TOP 10 FLAPPERS', {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '32px',
      color: '#00ffff',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);
    this.container.add(title);

    const loading = scene.add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'LOADING RANKINGS...', {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '18px',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.container.add(loading);

    this.load(scene, loading);

    const restartBtn = scene.add.text(SCREEN_WIDTH / 2, SCREEN_HEIGHT - 80, 'PRESS ANY KEY TO RESTART', {
      fontFamily: '"Trebuchet MS", "Noto Sans JP", sans-serif',
      fontSize: '16px',
      color: '#ffde7f',
      backgroundColor: '#333333',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive();
    
    restartBtn.on('pointerdown', () => this.onRestart());
    this.container.add(restartBtn);
  }

  private async load(scene: Phaser.Scene, loading: Phaser.GameObjects.Text) {
    try {
      const data = await fetchLeaderboard();
      loading.setVisible(false);
      const entries = data.entries || [];

      entries.forEach((entry: any, i: number) => {
        const y = 140 + i * 32;
        const rank = scene.add.text(60, y, `${i + 1}`, { 
          fontSize: '18px', color: i < 3 ? '#ffde7f' : '#888888' 
        });
        const name = scene.add.text(100, y, entry.name.slice(0, 10), { 
          fontSize: '18px', color: '#ffffff' 
        });
        const score = scene.add.text(280, y, String(entry.score), { 
          fontSize: '18px', color: '#00ffff', align: 'right' 
        }).setOrigin(1, 0);

        this.container.add([rank, name, score]);

        if (entry.replayAvailable) {
          const watch = scene.add.text(340, y, 'WATCH', { 
            fontSize: '14px', color: '#7fe4ff', backgroundColor: '#222222', padding: { x: 4, y: 2 } 
          }).setInteractive().on('pointerdown', () => this.onWatch(entry.id));
          this.container.add(watch);
        }
      });

      if (entries.length === 0) {
        loading.setText('NO RECORDS YET!').setVisible(true);
      }
    } catch (e) {
      loading.setText('FAILED TO LOAD LEADERBOARD').setVisible(true);
      console.error(e);
    }
  }

  destroy() {
    this.container.destroy();
  }
}
