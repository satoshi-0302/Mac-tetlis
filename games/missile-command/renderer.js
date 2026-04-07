import { BARRIER_BALANCE, BATTERY, ENEMY_TYPES, WORLD } from "./balance.js";

function hexToRgb(hex) {
  const trimmed = hex.replace("#", "");
  const normalized =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((value) => value + value)
          .join("")
      : trimmed;

  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function withAlpha(color, alpha) {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createSeededRandom(seed) {
  let value = seed;

  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.stars = [];
    this.resize();
    this.createBackgroundElements();
  }

  createBackgroundElements() {
    const rng = createSeededRandom(137);
    this.stars = Array.from({ length: 90 }, () => ({
      x: rng() * WORLD.width,
      y: rng() * (WORLD.groundY - 180),
      size: 0.8 + rng() * 2.2,
      twinkle: rng() * Math.PI * 2,
      speed: 0.5 + rng() * 1.5,
    }));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WORLD.width * dpr;
    this.canvas.height = WORLD.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * WORLD.width,
      y: ((clientY - rect.top) / rect.height) * WORLD.height,
    };
  }

  render(game) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);

    this.drawBackground(game.elapsed, game.state);

    ctx.save();
    if (game.screenShake > 0.1) {
      const shakeX = (Math.random() - 0.5) * game.screenShake;
      const shakeY = (Math.random() - 0.5) * game.screenShake * 0.6;
      ctx.translate(shakeX, shakeY);
    }

    this.drawHorizon(game.elapsed);
    this.drawGround();
    this.drawBattery();
    this.drawCities(game.cities);
    this.drawEnemyMissiles(game.enemyMissiles);
    this.drawInterceptors(game.interceptors);
    this.drawExplosions(game.explosions);
    this.drawParticles(game.particles);
    this.drawBarrier(game);
    ctx.restore();

    this.drawScenarioOverlay(game);
  }

  drawBackground(elapsed, state) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, "#07101d");
    gradient.addColorStop(0.5, "#13223a");
    gradient.addColorStop(1, "#1d1420");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const glow = ctx.createRadialGradient(
      WORLD.width * 0.5,
      WORLD.groundY - 90,
      10,
      WORLD.width * 0.5,
      WORLD.groundY - 90,
      260,
    );
    glow.addColorStop(0, "rgba(255, 135, 91, 0.28)");
    glow.addColorStop(0.45, "rgba(255, 135, 91, 0.12)");
    glow.addColorStop(1, "rgba(255, 135, 91, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    for (const star of this.stars) {
      const alpha = 0.35 + Math.sin(elapsed * star.speed + star.twinkle) * 0.25;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    for (let line = 0; line < WORLD.height; line += 4) {
      ctx.fillRect(0, line, WORLD.width, 1);
    }

    if (state === "title") {
      ctx.fillStyle = "rgba(126, 248, 255, 0.08)";
      ctx.beginPath();
      ctx.arc(WORLD.width * 0.84, 120, 74, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawHorizon(elapsed) {
    const ctx = this.ctx;
    ctx.fillStyle = "#08111e";
    ctx.beginPath();
    ctx.moveTo(0, WORLD.groundY - 18);
    ctx.lineTo(80, WORLD.groundY - 106);
    ctx.lineTo(210, WORLD.groundY - 86);
    ctx.lineTo(320, WORLD.groundY - 156);
    ctx.lineTo(470, WORLD.groundY - 96);
    ctx.lineTo(650, WORLD.groundY - 162);
    ctx.lineTo(840, WORLD.groundY - 112);
    ctx.lineTo(980, WORLD.groundY - 154);
    ctx.lineTo(1120, WORLD.groundY - 74);
    ctx.lineTo(1280, WORLD.groundY - 122);
    ctx.lineTo(1280, WORLD.groundY);
    ctx.lineTo(0, WORLD.groundY);
    ctx.closePath();
    ctx.fill();

  }

  drawGround() {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, WORLD.groundY, 0, WORLD.height);
    gradient.addColorStop(0, "#2a2429");
    gradient.addColorStop(0.45, "#1a1117");
    gradient.addColorStop(1, "#09070b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, WORLD.groundY, WORLD.width, WORLD.height - WORLD.groundY);

    ctx.strokeStyle = "rgba(255, 141, 106, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.groundY);
    ctx.lineTo(WORLD.width, WORLD.groundY);
    ctx.stroke();
  }

  drawBattery() {
    const ctx = this.ctx;

    ctx.save();
    ctx.translate(BATTERY.x, BATTERY.y);

    ctx.fillStyle = "#1d2f44";
    ctx.beginPath();
    ctx.moveTo(-68, 20);
    ctx.lineTo(-26, -18);
    ctx.lineTo(26, -18);
    ctx.lineTo(68, 20);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#294d6c";
    ctx.fillRect(-18, -BATTERY.barrelHeight, 36, 44);

    ctx.fillStyle = "#7ef8ff";
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(126, 248, 255, 0.6)";
    ctx.beginPath();
    ctx.arc(0, -10, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawCities(cities) {
    const ctx = this.ctx;

    for (const city of cities) {
      ctx.save();
      ctx.translate(city.x, city.y);
      const flash = Number(city.flash ?? 0);
      const ruinHeat = Number(city.ruinHeat ?? 0);

      if (city.alive) {
        const glowStrength = 0.08 + flash * 0.18;
        ctx.fillStyle = withAlpha("#7ef8ff", glowStrength);
        ctx.fillRect(-city.width * 0.65, -city.height - 8, city.width * 1.3, city.height + 24);

        ctx.fillStyle = "#2b4c67";
        ctx.fillRect(-city.width / 2, -city.height, city.width, city.height);
        ctx.fillRect(-city.width * 0.18, -city.height - 16, city.width * 0.36, 18);

        ctx.fillStyle = "rgba(190, 235, 255, 0.85)";
        for (let row = 0; row < 3; row += 1) {
          for (let col = 0; col < 5; col += 1) {
            const x = -city.width * 0.32 + col * (city.width * 0.16);
            const y = -city.height * 0.75 + row * (city.height * 0.22);
            ctx.fillRect(x, y, city.width * 0.08, city.height * 0.12);
          }
        }
      } else {
        ctx.fillStyle = "#2c1d22";
        ctx.beginPath();
        ctx.moveTo(-city.width / 2, 0);
        ctx.lineTo(-city.width * 0.26, -city.height * 0.35);
        ctx.lineTo(0, -city.height * 0.14);
        ctx.lineTo(city.width * 0.18, -city.height * 0.42);
        ctx.lineTo(city.width / 2, 0);
        ctx.closePath();
        ctx.fill();

        if (ruinHeat > 0) {
          ctx.fillStyle = withAlpha("#ff9c43", ruinHeat * 0.6);
          ctx.fillRect(-city.width * 0.34, -city.height * 0.24, city.width * 0.68, 12);
        }
      }

      ctx.restore();
    }
  }

  drawEnemyMissiles(missiles) {
    const ctx = this.ctx;

    for (const missile of missiles) {
      ctx.save();
      const definition = missile.definition ?? ENEMY_TYPES[missile.type] ?? ENEMY_TYPES.normal;
      const trail = Array.isArray(missile.trail) ? missile.trail : [];
      const glowSeed = Number(missile.glowSeed ?? 0);
      const trailMaxAge = Number(missile.trailMaxAge ?? 0.28);
      const vx = Number(missile.vx ?? 0);
      const vy = Number(missile.vy ?? 1);
      const radius = Number(missile.radius ?? definition.radius ?? 6);
      const hitPoints = Number(missile.hitPoints ?? 1);
      const armorBreakFlash = Number(missile.armorBreakFlash ?? 0);
      const pulse = 0.7 + Math.sin(glowSeed) * 0.2;
      const flareLength = missile.type === "fast" ? 96 : 72;
      const tailX = missile.x - vx * flareLength;
      const tailY = missile.y - vy * flareLength;

      ctx.globalCompositeOperation = "lighter";
      for (let index = 1; index < trail.length; index += 1) {
        const previous = trail[index - 1];
        const current = trail[index];
        const life = 1 - Number(current.age ?? 0) / Math.max(0.01, trailMaxAge);
        const thickness =
          missile.type === "armored" ? 6.8 : missile.type === "fast" ? 5.6 : 4.8;

        if (life <= 0) {
          continue;
        }

        ctx.strokeStyle = withAlpha(definition.color, life * 0.22);
        ctx.lineWidth = thickness * life;
        ctx.lineCap = "round";
        ctx.shadowBlur = 18;
        ctx.shadowColor = withAlpha(definition.edgeColor, life * 0.5);
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(current.x, current.y);
        ctx.stroke();
      }

      const streak = ctx.createLinearGradient(tailX, tailY, missile.x, missile.y);
      streak.addColorStop(0, withAlpha(definition.color, 0));
      streak.addColorStop(0.45, withAlpha(definition.color, 0.18));
      streak.addColorStop(1, withAlpha(definition.edgeColor, 0.95));
      ctx.strokeStyle = streak;
      ctx.lineWidth = missile.type === "armored" ? 7.6 : missile.type === "fast" ? 6 : 5.2;
      ctx.lineCap = "round";
      ctx.shadowBlur = missile.type === "fast" ? 18 : 22;
      ctx.shadowColor = withAlpha(definition.edgeColor, 0.62);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(missile.x, missile.y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const halo = ctx.createRadialGradient(
        missile.x,
        missile.y,
        0,
        missile.x,
        missile.y,
        radius * 3.6,
      );
      halo.addColorStop(0, withAlpha("#ffffff", 0.8 * pulse));
      halo.addColorStop(0.28, withAlpha(definition.edgeColor, 0.52 * pulse));
      halo.addColorStop(1, withAlpha(definition.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(missile.x, missile.y, radius * 3.6, 0, Math.PI * 2);
      ctx.fill();

      if (missile.type === "split") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(missile.x, missile.y, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = definition.edgeColor;
      ctx.beginPath();
      ctx.arc(missile.x, missile.y, radius + 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = definition.color;
      ctx.beginPath();
      ctx.arc(missile.x, missile.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = withAlpha("#ffffff", 0.82);
      ctx.beginPath();
      ctx.arc(
        missile.x - vx * 2.4,
        missile.y - vy * 2.4,
        radius * 0.48,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      if (hitPoints > 1) {
        ctx.strokeStyle = withAlpha("#fff7cb", 0.88);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(missile.x, missile.y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (armorBreakFlash > 0) {
        ctx.fillStyle = withAlpha("#ffffff", armorBreakFlash * 0.9);
        ctx.beginPath();
        ctx.arc(missile.x, missile.y, radius + 7, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  drawInterceptors(interceptors) {
    const ctx = this.ctx;

    for (const interceptor of interceptors) {
      ctx.save();
      ctx.strokeStyle = "rgba(126, 248, 255, 0.92)";
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 12;
      ctx.shadowColor = "rgba(126, 248, 255, 0.68)";
      ctx.beginPath();
      ctx.moveTo(interceptor.originX, interceptor.originY);
      ctx.lineTo(interceptor.currentX, interceptor.currentY);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(interceptor.currentX, interceptor.currentY, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawExplosions(explosions) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const explosion of explosions) {
      const radius = Math.max(0, explosion.currentRadius);
      if (radius <= 0.5) {
        continue;
      }

      const gradient = ctx.createRadialGradient(
        explosion.x,
        explosion.y,
        0,
        explosion.x,
        explosion.y,
        radius,
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * explosion.alpha})`);
      gradient.addColorStop(0.22, withAlpha(explosion.coreColor ?? "#7ef8ff", 0.9 * explosion.alpha));
      gradient.addColorStop(0.68, withAlpha(explosion.edgeColor ?? "#60d5ff", 0.5 * explosion.alpha));
      gradient.addColorStop(1, withAlpha(explosion.edgeColor ?? "#60d5ff", 0));

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = withAlpha("#ffffff", 0.3 * explosion.alpha);
      ctx.lineWidth = explosion.secondary ? 1.4 : 2.2;
      ctx.beginPath();
      ctx.arc(explosion.x, explosion.y, explosion.ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawParticles(particles) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const particle of particles) {
      ctx.fillStyle = withAlpha(particle.color, particle.alpha);
      ctx.shadowBlur = particle.glow;
      ctx.shadowColor = withAlpha(particle.color, particle.alpha);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawBarrier(game) {
    const barrier = game.barrier;
    if (!barrier?.active) {
      return;
    }

    const ctx = this.ctx;
    const progress = Math.max(0, Math.min(1, Number(barrier.progress ?? 0)));
    if (progress <= 0.001) {
      return;
    }

    const reveal = 1 - Math.pow(1 - progress, 2.1);
    const shimmer = Number(barrier.elapsed ?? 0) * 5.2;
    const apexY = game.getBarrierSurfaceY(WORLD.width * 0.5);
    const domeGlow = (0.34 + reveal * 0.66) * BARRIER_BALANCE.revealGlow;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const fieldGradient = ctx.createLinearGradient(0, apexY - 18, 0, WORLD.height);
    fieldGradient.addColorStop(0, "rgba(159, 252, 255, 0)");
    fieldGradient.addColorStop(0.18, `rgba(126, 248, 255, ${0.05 + reveal * 0.08})`);
    fieldGradient.addColorStop(0.62, `rgba(68, 188, 232, ${0.08 + reveal * 0.11})`);
    fieldGradient.addColorStop(1, `rgba(26, 88, 130, ${0.15 + reveal * 0.13})`);
    ctx.fillStyle = fieldGradient;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.height);
    for (let x = 0; x <= WORLD.width; x += 24) {
      ctx.lineTo(x, game.getBarrierSurfaceY(x));
    }
    ctx.lineTo(WORLD.width, WORLD.height);
    ctx.closePath();
    ctx.fill();

    const innerGlow = ctx.createRadialGradient(
      WORLD.width * 0.5,
      apexY + 22,
      24,
      WORLD.width * 0.5,
      apexY + 22,
      WORLD.width * 0.54,
    );
    innerGlow.addColorStop(0, `rgba(255, 255, 255, ${0.08 + reveal * 0.1})`);
    innerGlow.addColorStop(0.45, `rgba(126, 248, 255, ${0.06 + reveal * 0.08})`);
    innerGlow.addColorStop(1, "rgba(126, 248, 255, 0)");
    ctx.fillStyle = innerGlow;
    ctx.fillRect(0, apexY - 20, WORLD.width, WORLD.height - apexY + 20);

    ctx.strokeStyle = `rgba(159, 252, 255, ${0.28 + reveal * 0.42})`;
    ctx.lineWidth = 4.5 + reveal * 1.8;
    ctx.shadowBlur = 24 * domeGlow;
    ctx.shadowColor = `rgba(126, 248, 255, ${0.48 + reveal * 0.22})`;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x += 20) {
      const waveOffset = Math.sin(shimmer + x * 0.016) * (1.2 + reveal * 1.6);
      const y = game.getBarrierSurfaceY(x) + waveOffset;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 + reveal * 0.28})`;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x += 28) {
      const waveOffset = Math.sin(shimmer * 1.36 + x * 0.024) * (0.8 + reveal);
      const y = game.getBarrierSurfaceY(x) - 8 + waveOffset;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + reveal * 0.12})`;
    ctx.lineWidth = 12 + reveal * 6;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x += 36) {
      const bandOffset = Math.sin(shimmer * 0.8 + x * 0.011) * 3.2;
      const y = game.getBarrierSurfaceY(x) + 28 + bandOffset;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.restore();
  }

  drawScenarioOverlay(game) {
    const ctx = this.ctx;
    const overlayState =
      typeof game.getScenarioOverlayState === "function" ? game.getScenarioOverlayState() : null;
    if (!overlayState) {
      return;
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = overlayState.type === "clear" ? "rgba(4, 10, 18, 0.28)" : "rgba(4, 10, 18, 0.2)";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.shadowBlur = overlayState.type === "clear" ? 34 : 28;
    ctx.shadowColor =
      overlayState.type === "clear" ? "rgba(126, 248, 255, 0.55)" : "rgba(255, 164, 120, 0.55)";
    ctx.fillStyle = overlayState.type === "clear" ? "#7ef8ff" : "#fff5d8";
    ctx.font =
      overlayState.type === "clear"
        ? '700 86px "Avenir Next Condensed", "Arial Narrow Bold", sans-serif'
        : '700 180px "Avenir Next Condensed", "Arial Narrow Bold", sans-serif';
    ctx.fillText(
      overlayState.type === "clear" ? overlayState.label : String(overlayState.value),
      WORLD.width * 0.5,
      240,
    );
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
