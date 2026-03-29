import {
  BATTERY,
  ENEMY_TYPES,
  WORLD,
  clamp,
  lerp,
} from "./balance.js";

let nextEntityId = 1;

function allocateId() {
  const value = nextEntityId;
  nextEntityId += 1;
  return value;
}

export class City {
  constructor({ x, width, height, index }) {
    this.id = allocateId();
    this.index = index;
    this.x = x;
    this.y = WORLD.groundY;
    this.width = width;
    this.height = height;
    this.alive = true;
    this.flash = 0;
    this.ruinHeat = 0;
  }

  get left() {
    return this.x - this.width / 2;
  }

  get right() {
    return this.x + this.width / 2;
  }

  get top() {
    return this.y - this.height;
  }

  destroy() {
    if (!this.alive) {
      return false;
    }

    this.alive = false;
    this.flash = 1;
    this.ruinHeat = 1;
    return true;
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.ruinHeat = Math.max(0, this.ruinHeat - dt * 0.12);
  }
}

export class Interceptor {
  constructor(targetX, targetY) {
    this.id = allocateId();
    this.originX = BATTERY.x;
    this.originY = BATTERY.y - BATTERY.barrelHeight;
    this.targetX = targetX;
    this.targetY = clamp(targetY, 44, WORLD.groundY - 30);
    this.duration = WORLD.interceptorTravelTime;
    this.elapsed = 0;
    this.currentX = this.originX;
    this.currentY = this.originY;
  }

  update(dt) {
    this.elapsed += dt;
    const linear = clamp(this.elapsed / this.duration, 0, 1);
    const eased = 1 - Math.pow(1 - linear, 3);
    this.currentX = lerp(this.originX, this.targetX, eased);
    this.currentY = lerp(this.originY, this.targetY, eased);
    return linear >= 1;
  }
}

export class EnemyMissile {
  constructor({
    type,
    startX,
    startY = -44,
    targetX,
    targetY,
    targetCityId = null,
    speed,
    splitProgress = 0.42,
  }) {
    const definition = ENEMY_TYPES[type];
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy) || 1;

    this.id = allocateId();
    this.type = type;
    this.definition = definition;
    this.startX = startX;
    this.startY = startY;
    this.x = startX;
    this.y = startY;
    this.targetX = targetX;
    this.targetY = targetY;
    this.targetCityId = targetCityId;
    this.vx = dx / distance;
    this.vy = dy / distance;
    this.totalDistance = distance;
    this.distanceTravelled = 0;
    this.speed = speed;
    this.radius = definition.radius;
    this.hitPoints = definition.armor;
    this.splitProgress = splitProgress;
    this.splitTriggered = false;
    this.visibleTicks = startY >= 0 ? 0 : -1;
    this.flash = 0;
    this.armorBreakFlash = 0;
    this.active = true;
    this.glowSeed = Math.random() * Math.PI * 2;
    this.trailMaxAge = 0.28;
    this.trail = [{ x: startX, y: startY, age: 0 }];
  }

  get progress() {
    return clamp(this.distanceTravelled / this.totalDistance, 0, 1);
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 6.2);
    this.armorBreakFlash = Math.max(0, this.armorBreakFlash - dt * 2.6);
    this.glowSeed += dt * (this.type === "fast" ? 10 : 6.4);

    const distanceStep = this.speed * dt;
    this.distanceTravelled += distanceStep;

    if (this.distanceTravelled >= this.totalDistance) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.syncVisibleTicks();
      this.updateTrail(dt);
      return { reachedTarget: true };
    }

    this.x += this.vx * distanceStep;
    this.y += this.vy * distanceStep;
    this.syncVisibleTicks();
    this.updateTrail(dt);
    return { reachedTarget: false };
  }

  syncVisibleTicks() {
    if (this.y < 0) {
      return;
    }

    if (this.visibleTicks < 0) {
      this.visibleTicks = 0;
      return;
    }

    this.visibleTicks += 1;
  }

  updateTrail(dt) {
    this.trail = this.trail
      .map((point) => ({ ...point, age: point.age + dt }))
      .filter((point) => point.age <= this.trailMaxAge);

    const previous = this.trail[this.trail.length - 1];
    if (!previous || Math.hypot(previous.x - this.x, previous.y - this.y) > 9) {
      this.trail.push({ x: this.x, y: this.y, age: 0 });
    } else {
      previous.x = this.x;
      previous.y = this.y;
      previous.age = 0;
    }
  }

  shouldSplit() {
    return this.type === "split" && !this.splitTriggered && this.progress >= this.splitProgress;
  }

  takeHit() {
    this.hitPoints -= 1;
    this.flash = 1;

    if (this.hitPoints <= 0) {
      this.active = false;
      return { destroyed: true, remaining: 0 };
    }

    this.armorBreakFlash = 1;
    return { destroyed: false, remaining: this.hitPoints };
  }
}

export class Explosion {
  constructor({
    x,
    y,
    maxRadius,
    coreColor,
    edgeColor,
    comboId = 0,
    chainDepth = 0,
    damaging = true,
    secondary = false,
  }) {
    this.id = allocateId();
    this.x = x;
    this.y = y;
    this.maxRadius = maxRadius;
    this.coreColor = coreColor;
    this.edgeColor = edgeColor;
    this.comboId = comboId;
    this.chainDepth = chainDepth;
    this.damaging = damaging;
    this.secondary = secondary;
    this.hitIds = new Set();
    this.age = 0;
    this.currentRadius = 0;
    this.alpha = 1;
    this.ringRadius = 0;
    this.growDuration = secondary ? 0.09 : 0.13;
    this.holdDuration = secondary ? 0.04 : 0.07;
    this.fadeDuration = secondary ? 0.28 : 0.4;
    this.totalDuration = this.growDuration + this.holdDuration + this.fadeDuration;
    this.active = true;
  }

  update(dt) {
    this.age += dt;

    if (this.age <= this.growDuration) {
      const t = this.age / this.growDuration;
      this.currentRadius = this.maxRadius * (1 - Math.pow(1 - t, 2));
      this.alpha = 1;
    } else if (this.age <= this.growDuration + this.holdDuration) {
      this.currentRadius = this.maxRadius;
      this.alpha = 0.95;
    } else if (this.age <= this.totalDuration) {
      const t =
        (this.age - this.growDuration - this.holdDuration) / this.fadeDuration;
      this.currentRadius = lerp(this.maxRadius, this.maxRadius * 1.16, t);
      this.alpha = 1 - t;
    } else {
      this.active = false;
      this.alpha = 0;
    }

    this.ringRadius = this.currentRadius * 1.12;
    return this.active;
  }
}

export class Particle {
  constructor({
    x,
    y,
    vx,
    vy,
    life,
    size,
    color,
    drag = 0.9,
    gravity = 120,
    glow = 0,
  }) {
    this.id = allocateId();
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.color = color;
    this.drag = drag;
    this.gravity = gravity;
    this.glow = glow;
  }

  update(dt) {
    this.life -= dt;

    if (this.life <= 0) {
      return false;
    }

    this.vx *= Math.pow(this.drag, dt * 60);
    this.vy = this.vy * Math.pow(this.drag, dt * 60) + this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    return true;
  }

  get alpha() {
    return clamp(this.life / this.maxLife, 0, 1);
  }
}
