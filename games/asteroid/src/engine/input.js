import {
  INPUT_BOMB,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST
} from './constants.js';

const KEY_TO_BIT = {
  ArrowLeft: INPUT_LEFT,
  KeyA: INPUT_LEFT,
  ArrowRight: INPUT_RIGHT,
  KeyD: INPUT_RIGHT,
  ArrowUp: INPUT_THRUST,
  KeyW: INPUT_THRUST,
  Space: INPUT_SHOOT,
  ShiftLeft: INPUT_BOMB,
  ShiftRight: INPUT_BOMB
};

const TOUCH_AIM_DEADZONE_PX = 8;
const TOUCH_THRUST_DISTANCE_PX = 26;
const TOUCH_ROTATE_EPSILON_RAD = 0.08;
const TOUCH_BOMB_PULSE_FRAMES = 2;

function normalizeAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

export class InputController {
  constructor({ target = window, pointerTarget = target, onFirstInteraction, onMaskChange } = {}) {
    this.target = target;
    this.pointerTarget = pointerTarget;
    this.onFirstInteraction = onFirstInteraction;
    this.onMaskChange = onMaskChange;
    this.pressed = new Set();
    this.didInteract = false;
    this.touchPointers = new Map();
    this.touchAimPointerId = null;
    this.touchAimActive = false;
    this.touchAimAngle = 0;
    this.touchThrustActive = false;
    this.touchShootPointerIds = new Set();
    this.touchBombPulseFrames = 0;
    this.touchBombLatch = false;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    target.addEventListener('keydown', this.handleKeyDown, { passive: false });
    target.addEventListener('keyup', this.handleKeyUp, { passive: false });
    pointerTarget.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    pointerTarget.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    pointerTarget.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    pointerTarget.addEventListener('pointercancel', this.handlePointerUp, { passive: false });
    target.addEventListener('blur', this.handleBlur, { passive: true });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange, { passive: true });
    }
  }

  destroy() {
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.pointerTarget.removeEventListener('pointerdown', this.handlePointerDown);
    this.pointerTarget.removeEventListener('pointermove', this.handlePointerMove);
    this.pointerTarget.removeEventListener('pointerup', this.handlePointerUp);
    this.pointerTarget.removeEventListener('pointercancel', this.handlePointerUp);
    this.target.removeEventListener('blur', this.handleBlur);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.pressed.clear();
    this.touchPointers.clear();
    this.touchShootPointerIds.clear();
  }

  triggerFirstInteraction() {
    if (this.didInteract) {
      return;
    }
    this.didInteract = true;
    if (typeof this.onFirstInteraction === 'function') {
      this.onFirstInteraction();
    }
  }

  handlePointerDown(event) {
    if (event.pointerType !== 'touch') {
      return;
    }

    event.preventDefault();
    this.triggerFirstInteraction();
    const point = this.getLocalPoint(event);
    const isLeft = point.x < this.getPointerWidth() * 0.5;
    const role = isLeft && this.touchAimPointerId === null ? 'aim' : 'shoot';

    this.touchPointers.set(event.pointerId, {
      role,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y
    });

    if (role === 'aim') {
      this.touchAimPointerId = event.pointerId;
    } else {
      this.touchShootPointerIds.add(event.pointerId);
    }

    if (typeof this.pointerTarget.setPointerCapture === 'function') {
      try {
        this.pointerTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore; capture support varies by browser
      }
    }

    this.refreshTouchState();
    this.emitMaskChange();
  }

  clearInputState() {
    const hadInput =
      this.pressed.size > 0 ||
      this.touchPointers.size > 0 ||
      this.touchShootPointerIds.size > 0 ||
      this.touchAimPointerId !== null ||
      this.touchBombPulseFrames > 0 ||
      this.touchAimActive ||
      this.touchThrustActive;

    if (!hadInput) {
      return;
    }

    this.pressed.clear();
    this.touchPointers.clear();
    this.touchShootPointerIds.clear();
    this.touchAimPointerId = null;
    this.touchAimActive = false;
    this.touchThrustActive = false;
    this.touchBombPulseFrames = 0;
    this.touchBombLatch = false;
    this.emitMaskChange();
  }

  handleBlur() {
    this.clearInputState();
  }

  handleVisibilityChange() {
    if (typeof document !== 'undefined' && document.hidden) {
      this.clearInputState();
    }
  }

  getPointerWidth() {
    const rect = this.pointerTarget.getBoundingClientRect?.();
    return rect?.width ?? this.pointerTarget.clientWidth ?? 1;
  }

  getLocalPoint(event) {
    const rect = this.pointerTarget.getBoundingClientRect?.();
    if (!rect) {
      return { x: event.clientX, y: event.clientY };
    }
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  handlePointerMove(event) {
    if (event.pointerType !== 'touch') {
      return;
    }

    const pointerState = this.touchPointers.get(event.pointerId);
    if (!pointerState) {
      return;
    }

    event.preventDefault();
    const point = this.getLocalPoint(event);
    pointerState.x = point.x;
    pointerState.y = point.y;
    this.refreshTouchState();
    this.emitMaskChange();
  }

  handlePointerUp(event) {
    if (event.pointerType !== 'touch') {
      return;
    }

    const pointerState = this.touchPointers.get(event.pointerId);
    if (!pointerState) {
      return;
    }

    event.preventDefault();
    this.touchPointers.delete(event.pointerId);
    if (this.touchAimPointerId === event.pointerId) {
      this.touchAimPointerId = null;
    }
    this.touchShootPointerIds.delete(event.pointerId);
    this.refreshTouchState();
    this.emitMaskChange();
  }

  refreshTouchState() {
    this.touchAimActive = false;
    this.touchThrustActive = false;

    const aimPointer =
      this.touchAimPointerId === null ? null : this.touchPointers.get(this.touchAimPointerId);

    if (aimPointer) {
      const dx = aimPointer.x - aimPointer.startX;
      const dy = aimPointer.y - aimPointer.startY;
      const distance = Math.hypot(dx, dy);
      if (distance >= TOUCH_AIM_DEADZONE_PX) {
        this.touchAimActive = true;
        this.touchAimAngle = Math.atan2(dy, dx);
        this.touchThrustActive = distance >= TOUCH_THRUST_DISTANCE_PX;
      }
    }

    if (this.touchShootPointerIds.size >= 2) {
      if (!this.touchBombLatch) {
        this.touchBombPulseFrames = TOUCH_BOMB_PULSE_FRAMES;
        this.touchBombLatch = true;
      }
    } else {
      this.touchBombLatch = false;
    }
  }

  handleKeyDown(event) {
    const bit = KEY_TO_BIT[event.code];
    if (bit === undefined) {
      return;
    }

    event.preventDefault();
    this.triggerFirstInteraction();
    if (!this.pressed.has(bit)) {
      this.pressed.add(bit);
      this.emitMaskChange();
    }
  }

  handleKeyUp(event) {
    const bit = KEY_TO_BIT[event.code];
    if (bit === undefined) {
      return;
    }

    event.preventDefault();
    if (this.pressed.has(bit)) {
      this.pressed.delete(bit);
      this.emitMaskChange();
    }
  }

  emitMaskChange() {
    if (typeof this.onMaskChange === 'function') {
      this.onMaskChange(this.getMask({ consumeTransient: false }), performance.now());
    }
  }

  getMask({ shipAngle, consumeTransient = true } = {}) {
    let mask = 0;
    for (const bit of this.pressed) {
      mask |= bit;
    }

    if (this.touchAimActive && Number.isFinite(shipAngle)) {
      const delta = normalizeAngle(this.touchAimAngle - shipAngle);
      if (Math.abs(delta) >= TOUCH_ROTATE_EPSILON_RAD) {
        mask |= delta > 0 ? INPUT_RIGHT : INPUT_LEFT;
      }
      if (this.touchThrustActive) {
        mask |= INPUT_THRUST;
      }
    }

    if (this.touchShootPointerIds.size > 0) {
      mask |= INPUT_SHOOT;
    }

    if (this.touchBombPulseFrames > 0) {
      mask |= INPUT_BOMB;
      if (consumeTransient) {
        this.touchBombPulseFrames -= 1;
      }
    }

    return mask;
  }
}
