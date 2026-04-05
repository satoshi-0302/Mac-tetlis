import { FIXED_STEP_SECONDS } from '../engine/constants.js';

function randomRange(random, min, max) {
  return min + (max - min) * random();
}

export class ParticleSystem {
  constructor(random) {
    this.random = random;
    this.items = [];
  }

  clear() {
    this.items.length = 0;
  }

  addParticle({
    x,
    y,
    vx,
    vy,
    life,
    size,
    color,
    drag = 0.97,
    alpha = 1,
    kind = 'glow',
    rotation = 0,
    spin = 0,
    stretch = 1
  }) {
    this.items.push({
      x,
      y,
      vx,
      vy,
      life,
      maxLife: life,
      size,
      color,
      drag,
      alpha,
      kind,
      rotation,
      spin,
      stretch
    });
  }

  emitThruster(x, y, angle, shipVx, shipVy, count = 2) {
    for (let i = 0; i < count; i += 1) {
      const spread = randomRange(this.random, -0.38, 0.38);
      const speed = randomRange(this.random, 80, 200);
      const particleAngle = angle + Math.PI + spread;

      this.addParticle({
        x,
        y,
        vx: shipVx + Math.cos(particleAngle) * speed,
        vy: shipVy + Math.sin(particleAngle) * speed,
        life: randomRange(this.random, 0.08, 0.18),
        size: randomRange(this.random, 1.5, 3.2),
        color: this.random() > 0.4 ? '#ffe266' : '#ff7f50',
        drag: 0.92,
        alpha: 0.95
      });
    }
  }

  emitShot(x, y, angle) {
    for (let i = 0; i < 10; i += 1) {
      const spread = randomRange(this.random, -0.26, 0.26);
      const speed = randomRange(this.random, 120, 280);
      const particleAngle = angle + spread;

      this.addParticle({
        x,
        y,
        vx: Math.cos(particleAngle) * speed,
        vy: Math.sin(particleAngle) * speed,
        life: randomRange(this.random, 0.05, 0.12),
        size: randomRange(this.random, 1.2, 2.5),
        color: '#74f2ff',
        drag: 0.9,
        alpha: 0.85
      });
    }
  }

  emitExplosion(x, y, size) {
    const count = size >= 4 ? 58 : size === 3 ? 38 : size === 2 ? 28 : 18;
    const palette = ['#ffb347', '#ff7f50', '#ff4d6d', '#f7f7ff', '#7ee7ff'];

    for (let i = 0; i < count; i += 1) {
      const angle = randomRange(this.random, 0, Math.PI * 2);
      const speed = randomRange(this.random, 90, size >= 4 ? 320 : size === 3 ? 260 : 220);
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomRange(this.random, 0.15, 0.45),
        size: randomRange(this.random, 1.3, size >= 4 ? 6.4 : size === 3 ? 5 : 4),
        color: palette[Math.floor(this.random() * palette.length)],
        drag: 0.95,
        alpha: 1
      });
    }
  }

  emitArmorHit(x, y) {
    for (let i = 0; i < 14; i += 1) {
      const angle = randomRange(this.random, 0, Math.PI * 2);
      const speed = randomRange(this.random, 80, 220);
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomRange(this.random, 0.08, 0.2),
        size: randomRange(this.random, 1.1, 2.8),
        color: this.random() > 0.45 ? '#ffd1dc' : '#9fdfff',
        drag: 0.9,
        alpha: 0.9
      });
    }
  }

  emitShipAnnihilation(x, y) {
    const palette = ['#ffffff', '#ffd7a8', '#ff8fa8', '#ff5f5f', '#7ee7ff'];
    for (let i = 0; i < 110; i += 1) {
      const angle = randomRange(this.random, 0, Math.PI * 2);
      const speed = randomRange(this.random, 120, 560);
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomRange(this.random, 0.16, 0.58),
        size: randomRange(this.random, 1.8, 8.2),
        color: palette[Math.floor(this.random() * palette.length)],
        drag: 0.91,
        alpha: 1
      });
    }

    for (let i = 0; i < 34; i += 1) {
      const angle = randomRange(this.random, 0, Math.PI * 2);
      const speed = randomRange(this.random, 180, 520);
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomRange(this.random, 0.28, 0.8),
        size: randomRange(this.random, 3.5, 8.8),
        color: this.random() > 0.45 ? '#c8f8ff' : '#ffb3a7',
        drag: 0.94,
        alpha: 0.95,
        kind: 'shard',
        rotation: randomRange(this.random, 0, Math.PI * 2),
        spin: randomRange(this.random, -14, 14),
        stretch: randomRange(this.random, 1.8, 3.8)
      });
    }

    for (let i = 0; i < 3; i += 1) {
      this.addParticle({
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0.12 + i * 0.05,
        size: 28 + i * 18,
        color: i === 0 ? '#ffffff' : i === 1 ? '#ffb4a2' : '#7ee7ff',
        drag: 1,
        alpha: i === 0 ? 0.9 : 0.45
      });
    }
  }

  update() {
    const dt = FIXED_STEP_SECONDS;
    let writeIndex = 0;
    for (let i = 0; i < this.items.length; i += 1) {
      const particle = this.items[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        continue;
      }

      particle.vx *= particle.drag;
      particle.vy *= particle.drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.spin * dt;

      if (writeIndex !== i) {
        this.items[writeIndex] = particle;
      }
      writeIndex += 1;
    }
    this.items.length = writeIndex;
  }

  render(ctx) {
    if (this.items.length === 0) {
      return;
    }

    const previousComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    for (const particle of this.items) {
      const lifeRatio = particle.life / particle.maxLife;
      ctx.globalAlpha = particle.alpha * lifeRatio;
      ctx.fillStyle = particle.color;
      if (particle.kind === 'shard') {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.fillRect(
          -particle.size * 0.5,
          -particle.size * 0.18,
          particle.size * particle.stretch * lifeRatio,
          particle.size * 0.36
        );
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * (0.6 + lifeRatio), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previousComposite;
  }
}
