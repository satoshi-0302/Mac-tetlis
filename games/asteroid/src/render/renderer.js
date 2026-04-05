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

function normalizeAngleForDraw(angle) {
  const full = Math.PI * 2;
  let value = angle % full;
  if (value < 0) {
    value += full;
  }
  return value;
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
    this.shipDeathFlash = 0;
    this.bombWaves = [];
    this.shipDeathWaves = [];
    this.clearWaves = [];
    this.barrierRipples = [];
    this.stars = createStars(random, 180);
  }

  resetRun() {
    this.particles.clear();
    this.hitFlash = 0;
    this.bombFlash = 0;
    this.shipDeathFlash = 0;
    this.bombWaves.length = 0;
    this.shipDeathWaves.length = 0;
    this.clearWaves.length = 0;
    this.barrierRipples.length = 0;
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

    if (event.type === 'clear-wave') {
      this.clearWaves.push(
        {
          x: event.x,
          y: event.y,
          age: 0,
          life: 0.9,
          maxRadius: Math.hypot(ARENA_WIDTH, ARENA_HEIGHT) * 0.72,
          coreColor: '#8df9ff',
          edgeColor: '#fff1ad'
        },
        {
          x: event.x,
          y: event.y,
          age: 0.08,
          life: 1.15,
          maxRadius: Math.hypot(ARENA_WIDTH, ARENA_HEIGHT),
          coreColor: '#8dbeff',
          edgeColor: '#ffffff'
        }
      );
      this.bombFlash = 1;
      return;
    }

    if (event.type === 'clear-destroy') {
      this.particles.emitExplosion(event.x, event.y, event.size);
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

    if (event.type === 'barrier-hit') {
      this.particles.emitArmorHit(event.x, event.y);
      this.particles.emitExplosion(event.x, event.y, event.size ?? 2);
      if ((event.size ?? 0) >= 4) {
        this.particles.emitExplosion(event.x, event.y, Math.max(2, (event.size ?? 4) - 1));
      }
      this.clearWaves.push({
        x: event.x,
        y: event.y,
        age: 0,
        life: 0.22 + (event.size ?? 1) * 0.06,
        maxRadius: 44 + (event.radius ?? 18) * 1.8,
        coreColor: '#ffe28a',
        edgeColor: '#fffdf3'
      });
      this.barrierRipples.push({
        x: event.x,
        y: event.y,
        angle: event.angle ?? 0,
        age: 0,
        life: 0.32 + (event.size ?? 1) * 0.04,
        size: event.size ?? 1
      });
      return;
    }

    if (event.type === 'ship-destroyed') {
      this.particles.emitShipAnnihilation(event.x, event.y);
      this.shipDeathWaves.push(
        {
          x: event.x,
          y: event.y,
          age: 0,
          life: 0.52,
          maxRadius: 180,
          innerColor: '#ffb17a',
          outerColor: '#ff537c'
        },
        {
          x: event.x,
          y: event.y,
          age: 0.06,
          life: 0.72,
          maxRadius: 260,
          innerColor: '#8af4ff',
          outerColor: '#ffffff'
        }
      );
      this.hitFlash = 1;
      this.shipDeathFlash = 1;
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

    this.shipDeathFlash *= 0.9;
    if (this.shipDeathFlash < 0.01) {
      this.shipDeathFlash = 0;
    }

    for (let i = this.bombWaves.length - 1; i >= 0; i -= 1) {
      const wave = this.bombWaves[i];
      wave.age += FIXED_STEP_SECONDS;
      if (wave.age >= wave.life) {
        this.bombWaves.splice(i, 1);
      }
    }

    for (let i = this.shipDeathWaves.length - 1; i >= 0; i -= 1) {
      const wave = this.shipDeathWaves[i];
      wave.age += FIXED_STEP_SECONDS;
      if (wave.age >= wave.life) {
        this.shipDeathWaves.splice(i, 1);
      }
    }

    for (let i = this.clearWaves.length - 1; i >= 0; i -= 1) {
      const wave = this.clearWaves[i];
      wave.age += FIXED_STEP_SECONDS;
      if (wave.age >= wave.life) {
        this.clearWaves.splice(i, 1);
      }
    }

    for (let i = this.barrierRipples.length - 1; i >= 0; i -= 1) {
      const ripple = this.barrierRipples[i];
      ripple.age += FIXED_STEP_SECONDS;
      if (ripple.age >= ripple.life) {
        this.barrierRipples.splice(i, 1);
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

  drawPredictiveOverlay(state) {
    const overlay = state.debugOverlay;
    if (!overlay || state.lowPowerIdle) {
      return;
    }

    const ctx = this.ctx;
    const ship = state.ship;

    if (Array.isArray(overlay.safeSectors)) {
      const radius = 98;
      for (let i = 0; i < overlay.safeSectors.length; i += 1) {
        const sector = overlay.safeSectors[i];
        const start = normalizeAngleForDraw(sector.start);
        const end = normalizeAngleForDraw(sector.end);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#33ff99';
        ctx.beginPath();
        ctx.moveTo(ship.x, ship.y);
        if (end >= start) {
          ctx.arc(ship.x, ship.y, radius, start, end);
        } else {
          ctx.arc(ship.x, ship.y, radius, start, Math.PI * 2);
          ctx.arc(ship.x, ship.y, radius, 0, end);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (typeof overlay.escapeTargetAngle === 'number') {
      const radius = 112;
      ctx.strokeStyle = 'rgba(255, 207, 102, 0.95)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(ship.x, ship.y);
      ctx.lineTo(
        ship.x + Math.cos(overlay.escapeTargetAngle) * radius,
        ship.y + Math.sin(overlay.escapeTargetAngle) * radius
      );
      ctx.stroke();
    }

    if (Array.isArray(overlay.highThreatAsteroids)) {
      const top = overlay.highThreatAsteroids.slice(0, 3);
      const highlightedThreatIds = new Set(overlay.dangerHud?.highlightedThreatIds ?? []);
      for (let i = 0; i < top.length; i += 1) {
        const threat = top[i];
        const px = ship.x + threat.relX;
        const py = ship.y + threat.relY;
        const highlighted = highlightedThreatIds.has(threat.id);
        ctx.strokeStyle = highlighted ? '#ff4d6d' : i === 0 ? '#ff8f5c' : '#ffc857';
        ctx.lineWidth = highlighted ? 3.6 : i === 0 ? 3.2 : 2.2;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(px, py, 14 + i * 3, 0, Math.PI * 2);
        ctx.stroke();
        if (highlighted) {
          ctx.fillStyle = 'rgba(255, 77, 109, 0.18)';
          ctx.beginPath();
          ctx.arc(px, py, 14 + i * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    if (Array.isArray(overlay.predictedShipPositions)) {
      for (let i = 0; i < overlay.predictedShipPositions.length; i += 1) {
        const marker = overlay.predictedShipPositions[i];
        const alpha = marker.horizon === 30 ? 0.8 : marker.horizon === 60 ? 0.62 : 0.45;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#5de7ff';
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    const panelX = ARENA_WIDTH - 292;
    const panelY = 16;
    const panelHeight = 332;
    ctx.fillStyle = 'rgba(5, 10, 20, 0.58)';
    ctx.fillRect(panelX, panelY, 276, panelHeight);
    ctx.strokeStyle = 'rgba(110, 230, 255, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(panelX, panelY, 276, panelHeight);

    ctx.fillStyle = '#d9fbff';
    ctx.font = `600 14px ${HUD_DISPLAY_FONT}`;
    const chosen = overlay.chosenAction;
    const actionLine = chosen ? `ACT ${chosen.label}` : 'ACT -';
    ctx.fillText(actionLine, panelX + 10, panelY + 22);
    const dangerHud = overlay.dangerHud ?? null;
    if (dangerHud) {
      const dangerColor =
        dangerHud.level === 'critical'
          ? '#ff4d6d'
          : dangerHud.level === 'high'
            ? '#ffb347'
            : dangerHud.level === 'medium'
              ? '#ffe680'
              : '#78f0a4';
      ctx.fillStyle = 'rgba(30, 42, 68, 0.9)';
      ctx.fillRect(panelX + 10, panelY + 28, 256, 12);
      ctx.fillStyle = dangerColor;
      ctx.fillRect(panelX + 10, panelY + 28, 256 * clamp(dangerHud.score ?? 0, 0, 1), 12);
      ctx.strokeStyle = 'rgba(190, 236, 255, 0.35)';
      ctx.strokeRect(panelX + 10, panelY + 28, 256, 12);
      ctx.fillStyle = dangerColor;
      ctx.fillText(
        `DANGER ${(Number(dangerHud.score ?? 0) * 100).toFixed(0)}% ${String(dangerHud.level ?? 'low').toUpperCase()} ${dangerHud.recoverable ? 'RECOVERABLE' : 'HARD'}`,
        panelX + 10,
        panelY + 56
      );
      ctx.fillStyle = 'rgba(210, 244, 255, 0.9)';
      const components = dangerHud.components ?? {};
      ctx.fillText(
        `COL ${Number(components.collision ?? 0).toFixed(2)}  EDGE ${Number(components.edgeTrap ?? 0).toFixed(2)}`,
        panelX + 10,
        panelY + 76
      );
      ctx.fillText(
        `SPD ${Number(components.overAcceleration ?? 0).toFixed(2)}  ESC ${Number(components.lowEscapeRoom ?? 0).toFixed(2)}`,
        panelX + 10,
        panelY + 96
      );
      const reasons = Array.isArray(dangerHud.reasons) ? dangerHud.reasons : [];
      for (let i = 0; i < Math.min(3, reasons.length); i += 1) {
        ctx.fillStyle = 'rgba(255, 236, 196, 0.95)';
        ctx.fillText(`WHY ${reasons[i]}`, panelX + 10, panelY + 116 + i * 16);
      }
    }
    const prediction120 = chosen?.prediction120 ?? null;
    if (prediction120) {
      ctx.fillStyle = '#7fe9ff';
      ctx.fillText(`120T TTC ${Number.isFinite(prediction120.minPredictedTtc) ? prediction120.minPredictedTtc.toFixed(2) : 'INF'}`, panelX + 10, panelY + 172);
      ctx.fillText(`120T MGN ${prediction120.minMargin.toFixed(1)}  EDGE ${prediction120.edgeTrapRisk.toFixed(2)}`, panelX + 10, panelY + 192);
      ctx.fillText(`OPEN ${prediction120.openAngle.toFixed(2)}  CTR ${prediction120.centerReturnScore.toFixed(2)}`, panelX + 10, panelY + 212);
    }
    const escapeMode = overlay.escapeMode;
    if (escapeMode?.active) {
      ctx.fillStyle = '#ffcf66';
      ctx.fillText(`ESC ${escapeMode.reason} (${escapeMode.ticksRemaining})`, panelX + 10, panelY + 230);
    }
    const dangerAnalysis = overlay.dangerAnalysis;
    if (dangerAnalysis) {
      ctx.fillStyle = 'rgba(255, 222, 168, 0.92)';
      ctx.fillText(
        `DNG ${dangerAnalysis.dangerousCount}/${dangerAnalysis.inspectedCount} best=${dangerAnalysis.bestCandidateDanger ? 'Y' : 'N'} gap=${dangerAnalysis.meaningfulGap ? 'Y' : 'N'}`,
        panelX + 10,
        panelY + 246
      );
    }

    if (Array.isArray(overlay.topCandidateScores)) {
      const topScores = overlay.topCandidateScores.slice(0, 3);
      for (let i = 0; i < topScores.length; i += 1) {
        const candidate = topScores[i];
        const prediction = candidate.prediction120;
        const scoreText = `${i + 1}. ${candidate.id} ${candidate.score.toFixed(2)}`;
        const detailText = prediction
          ? `ttc=${Number.isFinite(prediction.minPredictedTtc) ? prediction.minPredictedTtc.toFixed(2) : 'INF'} mgn=${prediction.minMargin.toFixed(0)} edge=${prediction.edgeTrapRisk.toFixed(2)}`
          : 'prediction unavailable';
        ctx.fillStyle = i === 0 ? '#8dffb3' : '#b8e9ff';
        ctx.fillText(scoreText, panelX + 10, panelY + 262 + i * 16);
        ctx.fillStyle = 'rgba(210, 244, 255, 0.82)';
        ctx.fillText(detailText, panelX + 18, panelY + 275 + i * 16);
      }
    }
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
    const clearSequence = state.clearSequence ?? null;
    ctx.fillStyle =
      state.endReason === 'ship-destroyed'
        ? 'rgba(5, 5, 12, 0.26)'
        : clearSequence
          ? 'rgba(3, 7, 16, 0.24)'
          : 'rgba(5, 5, 12, 0.45)';
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    if (state.endReason === 'ship-destroyed') {
      return;
    }

    ctx.textAlign = 'center';
    if (clearSequence) {
      if (performance.now() < clearSequence.displayAtMs) {
        ctx.textAlign = 'left';
        return;
      }
      const pulse = 0.7 + Math.sin((state.visualTick ?? state.tick) * 0.08) * 0.18;
      ctx.fillStyle = '#bffcff';
      ctx.font = `800 62px ${HUD_DISPLAY_FONT}`;
      ctx.fillText('GAME CLEAR', ARENA_WIDTH * 0.5, 108);
      ctx.globalAlpha = 0.32 + pulse * 0.18;
      ctx.strokeStyle = '#fff4ae';
      ctx.lineWidth = 4;
      ctx.strokeText('GAME CLEAR', ARENA_WIDTH * 0.5, 108);
      ctx.globalAlpha = 1;

      const promptPulse = 0.58 + Math.sin((state.visualTick ?? state.tick) * 0.12) * 0.22;
      ctx.fillStyle = `rgba(255, 241, 173, ${promptPulse})`;
      ctx.font = `700 20px ${HUD_DISPLAY_FONT}`;
      ctx.fillText('HIT ANY KEY', ARENA_WIDTH * 0.5, 146);
    } else {
      ctx.fillStyle = '#ffdd9a';
      ctx.font = `700 56px ${HUD_DISPLAY_FONT}`;
      ctx.fillText('TIME UP', ARENA_WIDTH * 0.5, ARENA_HEIGHT * 0.5 - 8);

      ctx.fillStyle = '#ddf5ff';
      ctx.font = `600 24px ${HUD_DISPLAY_FONT}`;
      ctx.fillText('Submit your run on the right panel', ARENA_WIDTH * 0.5, ARENA_HEIGHT * 0.5 + 32);
    }
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

  drawShipDeathWaves() {
    if (this.shipDeathWaves.length === 0) {
      return;
    }

    const ctx = this.ctx;
    for (const wave of this.shipDeathWaves) {
      const ratio = clamp(wave.age / wave.life, 0, 1);
      const radius = wave.maxRadius * ratio;
      const alpha = (1 - ratio) * 0.85;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = wave.outerColor;
      ctx.lineWidth = 24 * (1 - ratio) + 3;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = wave.innerColor;
      ctx.lineWidth = 46 * (1 - ratio) + 6;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, Math.max(0, radius - 12), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawClearWaves() {
    if (this.clearWaves.length === 0) {
      return;
    }

    const ctx = this.ctx;
    for (const wave of this.clearWaves) {
      const ratio = clamp(wave.age / wave.life, 0, 1);
      const radius = wave.maxRadius * ratio;
      const alpha = (1 - ratio) * 0.82;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = wave.edgeColor;
      ctx.lineWidth = 28 * (1 - ratio) + 3;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.46;
      ctx.strokeStyle = wave.coreColor;
      ctx.lineWidth = 56 * (1 - ratio) + 6;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, Math.max(0, radius - 16), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawClearBarrier(state) {
    const sequence = state.clearSequence ?? null;
    if (!sequence || state.ship.destroyed) {
      return;
    }

    const ctx = this.ctx;
    const { ship } = state;
    const pulse = Math.sin((state.visualTick ?? state.tick) * 0.1);
    const barrierProgress = clamp(sequence.barrierProgress ?? 1, 0, 1);
    if (barrierProgress <= 0.02) {
      return;
    }
    const radius = sequence.barrierRadius * barrierProgress * (1 + pulse * 0.015);

    ctx.save();
    ctx.translate(ship.x, ship.y);

    const glow = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius * 1.3);
    glow.addColorStop(0, `rgba(160, 248, 255, ${0.1 + barrierProgress * 0.12})`);
    glow.addColorStop(0.55, `rgba(126, 180, 255, ${0.05 + barrierProgress * 0.08})`);
    glow.addColorStop(1, 'rgba(126, 180, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(184, 248, 255, ${0.28 + barrierProgress * 0.56})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = -2; i <= 2; i += 1) {
      const ratio = i / 2.6;
      const lineY = ratio * radius * 0.72;
      const lineRadius = Math.max(radius * 0.22, radius * Math.cos(ratio * Math.PI * 0.5));
      ctx.globalAlpha = (0.12 + (1 - Math.abs(ratio)) * 0.14) * barrierProgress;
      ctx.strokeStyle = i === 0 ? '#fff4ae' : '#7ff2ff';
      ctx.lineWidth = i === 0 ? 1.7 : 1.2;
      ctx.beginPath();
      ctx.ellipse(0, lineY, lineRadius, radius * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let i = 0; i < 6; i += 1) {
      const rotation = ((state.visualTick ?? state.tick) * 0.012 + (i / 6) * Math.PI) % (Math.PI * 2);
      ctx.globalAlpha = (0.18 + (i % 2) * 0.08) * barrierProgress;
      ctx.strokeStyle = i % 2 === 0 ? '#9dd9ff' : '#d5fdff';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * (0.28 + (i % 3) * 0.11), radius, rotation, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawBarrierRipples(state) {
    const sequence = state.clearSequence ?? null;
    if (!sequence || this.barrierRipples.length === 0) {
      return;
    }

    const ctx = this.ctx;
    for (const ripple of this.barrierRipples) {
      const ratio = clamp(ripple.age / ripple.life, 0, 1);
      const size = ripple.size ?? 1;
      const radius = 10 + ratio * (20 + size * 6);
      const alpha = (1 - ratio) * 0.88;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#fff0ac';
      ctx.lineWidth = (4 + size * 0.7) * (1 - ratio) + 1;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, radius, ripple.angle - 0.9, ripple.angle + 0.9);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = '#86f3ff';
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, radius + 8, ripple.angle - 0.75, ripple.angle + 0.75);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawClearWarp(state) {
    const sequence = state.clearSequence ?? null;
    if (!sequence || sequence.phase !== 'warp') {
      return;
    }

    const ctx = this.ctx;
    const progress = clamp(sequence.warpProgress ?? 0, 0, 1);
    const shipX = state.ship.x;
    const shipY = state.ship.y;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i += 1) {
      const spread = (i - 3.5) * 14;
      const width = 8 + progress * 18 - Math.abs(i - 3.5);
      const gradient = ctx.createLinearGradient(shipX + spread, shipY - 180, shipX + spread, shipY + 24);
      gradient.addColorStop(0, 'rgba(120, 225, 255, 0)');
      gradient.addColorStop(0.45, `rgba(120, 225, 255, ${0.12 + progress * 0.24})`);
      gradient.addColorStop(1, 'rgba(255, 245, 186, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(shipX + spread - width * 0.5, shipY - 220 - progress * 120, width, 260 + progress * 130);
    }
    ctx.restore();
  }

  render(state) {
    const ctx = this.ctx;
    const lowPowerIdle = state.lowPowerIdle === true;

    this.drawBackground(state);

    ctx.save();

    this.drawAsteroids(state.asteroids);
    if (!lowPowerIdle) {
      this.drawBullets(state.bullets);
      this.drawClearWarp(state);
      this.drawShip(state.ship, state.tick);
      this.drawClearBarrier(state);
      this.particles.render(ctx);
      this.drawBarrierRipples(state);
      this.drawClearWaves();
      this.drawShipDeathWaves();
      this.drawBombWaves();
    }

    ctx.restore();

    this.drawHud(state);
    this.drawPredictiveOverlay(state);
    this.drawFinalCountdown(state);
    this.drawEndOverlay(state);

    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 220, 230, ${this.hitFlash * 0.35})`;
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }

    if (this.shipDeathFlash > 0) {
      const gradient = ctx.createRadialGradient(
        ARENA_WIDTH * 0.5,
        ARENA_HEIGHT * 0.5,
        40,
        ARENA_WIDTH * 0.5,
        ARENA_HEIGHT * 0.5,
        ARENA_WIDTH * 0.7
      );
      gradient.addColorStop(0, `rgba(255, 246, 232, ${this.shipDeathFlash * 0.26})`);
      gradient.addColorStop(0.38, `rgba(255, 143, 168, ${this.shipDeathFlash * 0.18})`);
      gradient.addColorStop(1, 'rgba(255, 143, 168, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }

    if (this.bombFlash > 0) {
      ctx.fillStyle = `rgba(255, 244, 204, ${this.bombFlash * 0.62})`;
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }
  }
}
