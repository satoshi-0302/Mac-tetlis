import { CONFIG, SYMBOL, SYMBOL_DATA } from './Constants.js';

export class Reel {
    constructor(id, x, y) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = CONFIG.REEL_WIDTH;
        this.height = CONFIG.REEL_HEIGHT;

        // Create a random strip of symbols
        this.symbols = [];
        this.generateStrip();

        this.offset = 0; // Pixel offset for scrolling
        this.speed = 0;
        this.isSpinning = false;
        this.isStopping = false;
        this.targetOffset = 0;
    }

    generateStrip() {
        // Simple random generation for now. 
        // In a real slot, this might be a fixed weighted strip.
        for (let i = 0; i < 20; i++) {
            const keys = Object.keys(SYMBOL);
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            this.symbols.push(SYMBOL[randomKey]);
        }
    }

    start() {
        this.isSpinning = true;
        this.isStopping = false;
        this.speed = 20 + (this.id * 5); // Different speeds for visual effect
    }

    stop() {
        if (!this.isSpinning) return;
        this.isStopping = true;

        // Calculate target to snap to nearest symbol
        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const currentPos = this.offset;
        // Ensure we stop at a clean multiple of symbolHeight
        // Add some extra spin to make it feel natural
        const extraDistance = symbolHeight * 2;
        const snap = Math.ceil((currentPos + extraDistance) / symbolHeight) * symbolHeight;
        this.targetOffset = snap;
    }

    update() {
        if (this.isSpinning) {
            if (this.isStopping) {
                // Decelerate or move to target
                if (this.offset < this.targetOffset) {
                    this.offset += this.speed;
                    // Simple snap logic: if we passed target, set to target
                    if (this.offset >= this.targetOffset) {
                        this.offset = this.targetOffset;
                        this.isSpinning = false;
                        this.isStopping = false;
                        this.speed = 0;
                        return true; // Stopped this frame
                    }
                }
            } else {
                this.offset += this.speed;
            }
        }
        // Wrap offset to keep numbers manageable (infinite scroll illusion)
        // For simplicity in this version, we might just let it grow or handle wrapping in draw
        return false;
    }

    draw(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.x, this.y, this.width, this.height);
        ctx.clip();

        // Draw background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const totalSymbols = this.symbols.length;

        // Determine which symbols to draw based on offset
        // We need to draw visible symbols + 1 buffer for smooth scrolling
        const startIdx = Math.floor(this.offset / symbolHeight) % totalSymbols;
        const pixelShift = this.offset % symbolHeight;

        for (let i = -1; i < CONFIG.VISIBLE_SYMBOLS + 1; i++) {
            let symbolIdx = (startIdx + i);
            if (symbolIdx < 0) symbolIdx += totalSymbols;
            symbolIdx %= totalSymbols;

            const symbolCode = this.symbols[symbolIdx];
            const symbolData = SYMBOL_DATA[symbolCode];

            const drawY = this.y + (i * symbolHeight) - pixelShift;

            // Draw Symbol
            ctx.fillStyle = symbolData.color;
            ctx.fillRect(this.x + 10, drawY + 10, this.width - 20, symbolHeight - 20);

            ctx.fillStyle = '#000';
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(symbolData.name, this.x + this.width / 2, drawY + symbolHeight / 2);
        }

        ctx.restore();

        // Draw Border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x, this.y, this.width, this.height);
    }

    getResult() {
        // Return the symbols currently in the middle row (or all visible)
        // Assuming 3 visible, middle is index 1 relative to start
        const symbolHeight = CONFIG.SYMBOL_SIZE;
        const totalSymbols = this.symbols.length;
        const startIdx = Math.floor(this.offset / symbolHeight) % totalSymbols;

        // Middle symbol is startIdx + 1
        let middleIdx = (startIdx + 1) % totalSymbols;
        return this.symbols[middleIdx];
    }
}
