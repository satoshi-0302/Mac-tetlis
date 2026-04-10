import * as Phaser from 'phaser';
import { CONFIG, SYMBOL, SYMBOL_DATA, SymbolType } from './Constants';

export class Reel {
    public id: number;
    public x: number;
    public y: number;
    public width: number;
    public height: number;

    public symbols: SymbolType[] = [];
    public offset: number = 0;
    public speed: number = 0;
    public isSpinning: boolean = false;
    public isStopping: boolean = false;
    public targetOffset: number = 0;

    private symbolSprites: Phaser.GameObjects.Image[] = [];

    constructor(scene: Phaser.Scene, id: number, x: number, y: number) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = CONFIG.REEL_WIDTH;
        this.height = CONFIG.REEL_HEIGHT;

        this.generateStrip();

        const container = scene.add.container(x, y);
        
        // Dark translucent background for the reel strip
        const background = scene.add.rectangle(0, 0, this.width, this.height, 0x0a0514, 0.8)
            .setOrigin(0, 0);
        container.add(background);

        // Create a mask for the container
        const shape = scene.add.graphics();
        shape.fillStyle(0xffffff);
        shape.fillRect(0, 0, this.width, this.height);
        shape.setPosition(x, y);
        shape.setVisible(false);
        const mask = shape.createGeometryMask();
        container.setMask(mask);

        // Initialize symbol sprites (enough to cover the visible area + overhead)
        for (let i = 0; i < CONFIG.VISIBLE_SYMBOLS + 2; i++) {
            const sprite = scene.add.image(0, 0, 'seven')
                .setOrigin(0, 0)
                .setDisplaySize(this.width, CONFIG.SYMBOL_SIZE);
            container.add(sprite);
            this.symbolSprites.push(sprite);
        }

        // Curvature effect (gradient overlay)
        const graphics = scene.add.graphics();
        container.add(graphics);
        this.drawOverlay(graphics);
    }

    private generateStrip() {
        const symbolKeys = Object.keys(SYMBOL) as (keyof typeof SYMBOL)[];
        for (let i = 0; i < 20; i++) {
            const randomKey = symbolKeys[Math.floor(Math.random() * symbolKeys.length)];
            this.symbols.push(SYMBOL[randomKey]);
        }
    }

    private drawOverlay(graphics: Phaser.GameObjects.Graphics) {
        // Since Phaser Graphics doesn't support linear gradients easily in a simple way for background,
        // we'll use a few translucent rectangles to mimic the shadow at the edges.
        
        // Left shadow
        graphics.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.3, 0, 0.3, 0);
        graphics.fillRect(0, 0, this.width * 0.1, this.height);
        
        // Right shadow
        graphics.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0.3, 0, 0.3);
        graphics.fillRect(this.width * 0.9, 0, this.width * 0.1, this.height);

        // Border
        graphics.lineStyle(1, 0x333333);
        graphics.strokeRect(0, 0, this.width, this.height);
    }

    public start() {
        this.isSpinning = true;
        this.isStopping = false;
        const speedStepIndex = Math.min(this.id, 1);
        const baseSpeed = CONFIG.REEL_BASE_SPEED + (speedStepIndex * CONFIG.REEL_SPEED_STEP);
        const speedRate = CONFIG.REEL_SPEED_MULTIPLIERS[this.id] || 1;
        this.speed = baseSpeed * speedRate;
    }

    public stop() {
        if (!this.isSpinning) return;
        this.isStopping = true;

        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const currentPos = this.offset;
        const extraDistance = symbolHeight * CONFIG.REEL_STOP_EXTRA_SYMBOLS;
        const snap = Math.floor((currentPos - extraDistance) / symbolHeight) * symbolHeight;
        this.targetOffset = snap;
    }

    public update(): boolean {
        if (this.isSpinning) {
            if (this.isStopping) {
                if (this.offset > this.targetOffset) {
                    this.offset -= this.speed * 1.2;
                    if (this.offset <= this.targetOffset) {
                        this.offset = this.targetOffset;
                        this.isSpinning = false;
                        this.isStopping = false;
                        this.speed = 0;
                        this.updateSprites();
                        return true;
                    }
                }
            } else {
                this.offset -= this.speed;
            }
            this.updateSprites();
        }
        return false;
    }

    private updateSprites() {
        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const totalSymbols = this.symbols.length;
        const normalizedOffset = ((this.offset % (totalSymbols * symbolHeight)) + (totalSymbols * symbolHeight)) % (totalSymbols * symbolHeight);
        const startIdx = Math.floor(normalizedOffset / symbolHeight) % totalSymbols;
        const pixelShift = normalizedOffset % symbolHeight;

        for (let i = -1; i < CONFIG.VISIBLE_SYMBOLS + 1; i++) {
            let symbolIdx = (startIdx + i);
            if (symbolIdx < 0) symbolIdx += totalSymbols;
            symbolIdx %= totalSymbols;

            const symbolCode = this.symbols[symbolIdx];
            const symbolData = SYMBOL_DATA[symbolCode as keyof typeof SYMBOL_DATA];

            const sprite = this.symbolSprites[i + 1];
            sprite.setTexture(symbolData.img);
            sprite.y = (i * symbolHeight) - pixelShift;
        }
    }

    public getResult(): SymbolType {
        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const totalSymbols = this.symbols.length;
        const normalizedOffset = ((this.offset % (totalSymbols * symbolHeight)) + (totalSymbols * symbolHeight)) % (totalSymbols * symbolHeight);
        const startIdx = Math.floor(normalizedOffset / symbolHeight) % totalSymbols;
        const middleIdx = (startIdx + 1) % totalSymbols;
        return this.symbols[middleIdx];
    }

    public preRender() {
        this.updateSprites();
    }
}
