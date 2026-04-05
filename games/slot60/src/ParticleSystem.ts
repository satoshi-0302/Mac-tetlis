import * as Phaser from 'phaser';

export class Particle {
    public x: number;
    public y: number;
    public color: string;
    public size: number;
    public speedX: number;
    public speedY: number;
    public gravity: number = 0.5;
    public life: number = 1.0;
    public decay: number;

    constructor(x: number, y: number, color: string) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 6 - 3;
        this.speedY = Math.random() * -10 - 5;
        this.decay = Math.random() * 0.02 + 0.01;
    }

    public update() {
        this.speedY += this.gravity;
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= this.decay;
    }
}

export class ParticleSystem {
    private particles: Particle[] = [];
    private graphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene) {
        this.graphics = scene.add.graphics();
        // Ensure particles are drawn on top of other game objects if needed
        this.graphics.setDepth(100);
    }

    public spawn(x: number, y: number, count: number = 10, colors: string[] = ['#fff', '#ff0', '#f0f', '#0ff']) {
        for (let i = 0; i < count; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.particles.push(new Particle(x, y, color));
        }
    }

    public update() {
        this.particles.forEach(p => p.update());
        this.particles = this.particles.filter(p => p.life > 0);
    }

    public draw() {
        this.graphics.clear();
        this.particles.forEach(p => {
            this.graphics.save();
            this.graphics.alpha = p.life;
            // Convert hex color string to number
            const colorNum = parseInt(p.color.replace('#', ''), 16);
            this.graphics.fillStyle(colorNum, 1);
            this.graphics.fillRect(p.x, p.y, p.size, p.size);
            this.graphics.restore();
        });
    }
}
