import * as Phaser from 'phaser';
import { MainScene } from './MainScene';
import { CONFIG } from './Constants';

console.log('Slot60: Module script loaded.');

const initGame = () => {
    console.log('Slot60: Initializing Phaser game...');
    
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    console.log('Slot60: Canvas element:', canvas);
    
    if (!canvas) {
        console.error('Slot60: Could not find #game-canvas element!');
        return;
    }

    const routePill = document.getElementById('route-pill');
    if (routePill) {
        routePill.textContent = document.body?.dataset?.routeMode === 'mobile' ? 'SMARTPHONE' : 'DESKTOP';
    }
    
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.CANVAS, // Explicitly set to CANVAS to resolve "Must set explicit renderType" error
        width: CONFIG.CANVAS_WIDTH,
        height: CONFIG.CANVAS_HEIGHT,
        parent: 'game-container',
        canvas: canvas,
        transparent: true,
        scene: [MainScene],
        scale: {
            mode: Phaser.Scale.NONE,
        },
        fps: {
            target: 60,
            forceSetTimeOut: true
        }
    };

    try {
        console.log('Slot60: Calling new Phaser.Game with Phaser.CANVAS...');
        const game = new Phaser.Game(config);
        
        window.addEventListener('resize', () => {
            const scene = game.scene.getScene('MainScene') as MainScene;
            if (scene) {
                scene.resize();
            }
        });

        game.events.once('ready', () => {
            console.log('Slot60: Phaser ready.');
            const scene = game.scene.getScene('MainScene') as MainScene;
            if (scene) {
                scene.resize();
            }
        });
    } catch (e: any) {
        console.error('Slot60: Failed to initialize Phaser game!', e);
        if (e.message) {
            console.error('Error message:', e.message);
        }
    }
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initGame();
} else {
    document.addEventListener('DOMContentLoaded', initGame);
}
