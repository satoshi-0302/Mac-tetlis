import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  FIXED_STEP_SECONDS,
  INPUT_THRUST,
  MAX_TICKS,
  RUN_SECONDS,
  SHIP_RADIUS,
  TICK_RATE
} from '../engine/constants.js';
import { ParticleSystem } from './particles.js';

function randomRange(random, min, max) {
  return min + (max - min) * random();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const TYPE_RENDER_STYLE = {
  tier1: { points: 11, jitter: 0.24, hueMin: 188, hueMax: 228, stroke: 2.1, fillAlpha: 0.16 },
  tier2: { points: 13, jitter: 0.22, hueMin: 168, hueMax: 210, stroke: 2.3, fillAlpha: 0.18 },
  tier3: { points: 15, jitter: 0.2, hueMin: 30, hueMax: 58, stroke: 2.7, fillAlpha: 0.2 },
  tier4: { points: 17, jitter: 0.17, hueMin: 16, hueMax: 40, stroke: 3.2, fillAlpha: 0.23 },
  tier5: { points: 19, jitter: 0.13, hueMin: 0, hueMax: 20, stroke: 3.8, fillAlpha: 0.27 }
};
const HUD_DISPLAY_FONT = '"Arial Black", "Impact", "Haettenschweiler", sans-serif';

function createStars(random, count) {
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: randomRange(random, 0, ARENA_WIDTH),
      y: randomRange(random, 0, ARENA_HEIGHT),
      radius: randomRange(random, 0.4, 2.2),
      alpha: randomRange(random, 0.18, 0.9),
      speed: randomRange(random, 0.1, 0.8)
    });
  }
  return stars;
}

export class Renderer {
  constructor(canvas, random) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.random = random;
    this.particles = new ParticleSystem(random);
    this.asteroidVisuals = new Map();
    this.hitFlash = 0;
    this.bombFlash = 0;
    this.bombWaves = [];
    this.stars = createStars(random, 180);
  }

  resetRun() {
    this.particles.clear();
    this.hitFlash = 0;
    this.bombFlash = 0;
    this.bombWaves.length = 0;
    this.asteroidVisuals.clear();
  }

  getAsteroidVisual(asteroid) {
    if (this.asteroidVisuals.has(asteroid.id)) {
      return this.asteroidVisuals.get(asteroid.id);
    }

    const style = TYPE_RENDER_STYLE[asteroid.type] ?? TYPE_RENDER_STYLE.tier1;
    const vertices = new Float32Array(style.points * 2);
    for (let i = 0; i < style.points; i += 1) {
      const angle = (i / style.points) * Math.PI * 2;
      const radius = asteroid.radius * randomRange(this.random, 1 - style.jitter, 1 + style.jitter);
      const offset = i * 2;
      vertices[offset] = Math.cos(angle) * radius;
      vertices[offset + 1] = Math.sin(angle) * radius;
    }

    const visual = {
      vertices,
      pointCount: style.points,
      hue: Math.floor(randomRange(this.random, style.hueMin, style.hueMax)),
      stroke: style.stroke,
      fillAlpha: style.fillAlpha
    };
    this.asteroidVisuals.set(asteroid.id, visual);
    return visual;
  }

  handleEvent(event) {
    if (event.type === 'shot') {
      this.particles.emitShot(event.x, event.y, event.angle);
      return;
    }

    if (event.type === 'kill') {
      this.particles.emitExplosion(event.x, event.y, event.size);
      return;
    }

    if (event.type === 'bomb') {
      this.bombWaves.push({
        x: event.x,
        y: event.y,
        age: 0,
        life: 0.55,
        maxRadius: Math.hypot(ARENA_WIDTH, ARENA_HEIGHT)
      });
      this.particles.emitShipAnnihilation(event.x, event.y);
      this.bombFlash = 1;
      return;
    }

    if (event.type === 'bomb-destroy') {
      this.particles.emitExplosion(event.x, event.y, event.size);
      return;
    }

    if (event.type === 'armor-hit') {
      this.particles.emitArmorHit(event.x, event.y);
      return;
    }

    if (event.type === 'ship-destroyed') {
      this.particles.emitShipAnnihilation(event.x, event.y);
      this.hitFlash = 1;
    }
  }

  update(state, inputMask) {
    if ((inputMask & INPUT_THRUST) !== 0) {
      const ship = state.ship;
      const exhaustX = ship.x - Math.cos(ship.angle) * (SHIP_RADIUS + 2);
      const exhaustY = ship.y - Math.sin(ship.angle) * (SHIP_RADIUS + 2);
      this.particles.emitThruster(exhaustX, exhaustY, ship.angle, ship.vx, ship.vy, 3);
    }

    this.particles.update();

    this.hitFlash *= 0.85;
    if (this.hitFlash < 0.01) {
      this.hitFlash = 0;
    }

    this.bombFlash *= 0.86;
    if (this.bombFlash < 0.01) {
      this.bombFlash = 0;
    }

    for (let i = this.bombWaves.length - 1; i >= 0; i -= 1) {
      const wave = this.bombWaves[i];
      wave.age += FIXED_STEP_SECONDS;
      if (wave.age >= wave.life) {
        this.bombWaves.splice(i, 1);
      }
    }
  }

  drawBackground(state) {
    const ctx = this.ctx;
    const visualTick = typeof state.visualTick === 'number' ? state.visualTick : state.tick;
    const starStep = state.lowPowerIdle ? 2 : 1;
    const gradient = ctx.createLinearGradient(0, 0, 0, ARENA_HEIGHT);
    gradient.addColorStop(0, '#0a0c1f');
    gradient.addColorStop(0.55, '#130b24');
    gradient.addColorStop(1, '#070913');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    const nebula = ctx.createRadialGradient(
      ARENA_WIDTH * 0.75,
      ARENA_HEIGHT * 0.2,
      30,
      ARENA_WIDTH * 0.75,
      ARENA_HEIGHT * 0.2,
      420
    );
    nebula.addColorStop(0, 'rgba(120, 60, 255, 0.28)');
    nebula.addColorStop(1, 'rgba(120, 60, 255, 0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    for (let index = 0; index < this.stars.length; index += starStep) {
      const star = this.stars[index];
      const twinkle = 0.68 + Math.sin((visualTick * star.speed) / 9) * 0.32;
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = '#f4fbff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawShip(ship, tick) {
    const ctx = this.ctx;

    if (ship.destroyed) {
      return;
    }

    if (ship.invulnTicks > 0 && Math.floor(tick / 4) % 2 === 0) {
      return;
    }

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    const glow = ctx.createLinearGradient(-16, 0, 18, 0);
    glow.addColorStop(0, '#7bf6ff');
    glow.addColorStop(1, '#eafaff');

    ctx.strokeStyle = glow;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(-12, 10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-12, -10);
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#35e3ff';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  drawAsteroids(asteroids) {
    const ctx = this.ctx;

    for (const asteroid of asteroids) {
      const visual = this.getAsteroidVisual(asteroid);
      const vertices = visual.vertices;
      const pointCount = visual.pointCount;

      ctx.save();
      ctx.translate(asteroid.x, asteroid.y);

      ctx.beginPath();
      for (let i = 0; i < pointCount; i += 1) {
        const offset = i * 2;
        const px = vertices[offset];
        const py = vertices[offset + 1];

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();

      ctx.strokeStyle = `hsl(${visual.hue} 88% 78%)`;
      ctx.lineWidth = visual.stroke;
      ctx.stroke();

      ctx.globalAlpha = visual.fillAlpha;
      ctx.fillStyle = `hsl(${visual.hue} 92% 62%)`;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  drawBullets(bullets) {
    const ctx = this.ctx;
    const previousComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    for (const bullet of bullets) {
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#98f9ff';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 6.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previousComposite;
  }

  drawHud(state) {
    const ctx = this.ctx;
    const timeLeft = Math.max(0, RUN_SECONDS - state.tick / TICK_RATE);

    ctx.fillStyle = 'rgba(6, 9, 16, 0.45)';
    ctx.fillRect(14, 14, 270, 114);

    ctx.fillStyle = '#d8f7ff';
    ctx.font = `700 24px ${HUD_DISPLAY_FONT}`;
    ctx.fillText(`SCORE ${state.score.toString().padStart(6, '0')}`, 24, 42);

    ctx.fillStyle = '#ffe8c0';
    ctx.font = `700 31px ${HUD_DISPLAY_FONT}`;
    ctx.fillText(timeLeft.toFixed(2), 24, 80);

    ctx.fillStyle = '#9ad3ff';
    ctx.font = `600 18px ${HUD_DISPLAY_FONT}`;
    const comboLabel = state.combo > 1 ? `${state.combo}x` : '1x';
    ctx.fillText(`COMBO ${comboLabel}  MAX ${state.maxCombo}x`, 24, 108);

    const progress = clamp(state.tick / MAX_TICKS, 0, 1);
    ctx.fillStyle = 'rgba(60, 84, 130, 0.5)';
    ctx.fillRect(14, ARENA_HEIGHT - 22, ARENA_WIDTH - 28, 8);
    ctx.fillStyle = '#3fe3ff';
    ctx.fillRect(14, ARENA_HEIGHT - 22, (ARENA_WIDTH - 28) * progress, 8);
  }

  drawFinalCountdown(state) {
    const timeLeft = Math.max(0, RUN_SECONDS - state.tick / TICK_RATE);
    if (timeLeft <= 0 || timeLeft > 10 || state.finished) {
      return;
    }

    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(state.tick * 0.35);
    const warningAlpha = 0.08 + pulse * 0.13;

    ctx.fillStyle = `rgba(255, 80, 120, ${warningAlpha})`;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    ctx.strokeStyle = `rgba(255, 120, 150, ${0.35 + pulse * 0.4})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, ARENA_WIDTH - 6, ARENA_HEIGHT - 6);

    const countdown = Math.ceil(timeLeft);
    const countdownScale = 1 + pulse * 0.08;
    ctx.save();
    ctx.translate(ARENA_WIDTH * 0.5, ARENA_HEIGHT * 0.23);
    ctx.scale(countdownScale, countdownScale);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 228, 190, 0.9)';
    ctx.font = `700 20px ${HUD_DISPLAY_FONT}`;
    ctx.fillText('FINAL 10 SECONDS', 0, -26);

    ctx.fillStyle = '#ffe3a6';
    ctx.font = `800 86px ${HUD_DISPLAY_FONT}`;
    ctx.fillText(String(countdown), 0, 38);

    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#ff4d7e';
    ctx.lineWidth = 3;
    ctx.strokeText(String(countdown), 0, 38);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    ctx.restore();
  }

  drawEndOverlay(state) {
    if (!state.finished) {
      return;
    }

    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5, 5, 12, 0.45)';
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffdd9a';
    ctx.font = `700 56px ${HUD_DISPLAY_FONT}`;
    if (state.endReason === 'ship-destroyed') {
      ctx.fillText('SHIP DESTROYED', ARENA_WIDTH * 0.5, ARENA_HEIGHT * 0.5 - 8);
    } else {
      ctx.fillText('TIME UP', ARENA_WIDTH * 0.5, ARENA_HEIGHT * 0.5 - 8);
    }

    ctx.fillStyle = '#ddf5ff';
    ctx.font = `600 24px ${HUD_DISPLAY_FONT}`;
    ctx.fillText('Submit your run on the right panel', ARENA_WIDTH * 0.5, ARENA_HEIGHT * 0.5 + 32);
    ctx.textAlign = 'left';
  }

  drawBombWaves() {
    if (this.bombWaves.length === 0) {
      return;
    }

    const ctx = this.ctx;
    for (const wave of this.bombWaves) {
      const ratio = wave.age / wave.life;
      const radius = wave.maxRadius * ratio;
      const alpha = (1 - ratio) * 0.65;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffe39a';
      ctx.lineWidth = 18 * (1 - ratio) + 2;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.45;
      ctx.strokeStyle = '#ff7f66';
      ctx.lineWidth = 34 * (1 - ratio) + 3;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, Math.max(0, radius - 10), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  render(state) {
    const ctx = this.ctx;
    const lowPowerIdle = state.lowPowerIdle === true;

    this.drawBackground(state);

    ctx.save();

    this.drawAsteroids(state.asteroids);
    if (!lowPowerIdle) {
      this.drawBullets(state.bullets);
      this.drawShip(state.ship, state.tick);
      this.particles.render(ctx);
      this.drawBombWaves();
    }

    ctx.restore();

    this.drawHud(state);
    this.drawFinalCountdown(state);
    this.drawEndOverlay(state);

    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 220, 230, ${this.hitFlash * 0.35})`;
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }

    if (this.bombFlash > 0) {
      ctx.fillStyle = `rgba(255, 244, 204, ${this.bombFlash * 0.62})`;
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }
  }
}
