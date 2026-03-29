export const ACTION_TARGETS = Object.freeze([
  Object.freeze({ x: 150, y: 170, label: "A1" }),
  Object.freeze({ x: 320, y: 170, label: "A2" }),
  Object.freeze({ x: 490, y: 170, label: "A3" }),
  Object.freeze({ x: 640, y: 170, label: "A4" }),
  Object.freeze({ x: 790, y: 170, label: "A5" }),
  Object.freeze({ x: 960, y: 170, label: "A6" }),
  Object.freeze({ x: 1130, y: 170, label: "A7" }),
  Object.freeze({ x: 150, y: 290, label: "B1" }),
  Object.freeze({ x: 320, y: 290, label: "B2" }),
  Object.freeze({ x: 490, y: 290, label: "B3" }),
  Object.freeze({ x: 640, y: 290, label: "B4" }),
  Object.freeze({ x: 790, y: 290, label: "B5" }),
  Object.freeze({ x: 960, y: 290, label: "B6" }),
  Object.freeze({ x: 1130, y: 290, label: "B7" }),
  Object.freeze({ x: 150, y: 430, label: "C1" }),
  Object.freeze({ x: 320, y: 430, label: "C2" }),
  Object.freeze({ x: 490, y: 430, label: "C3" }),
  Object.freeze({ x: 640, y: 430, label: "C4" }),
  Object.freeze({ x: 790, y: 430, label: "C5" }),
  Object.freeze({ x: 960, y: 430, label: "C6" }),
  Object.freeze({ x: 1130, y: 430, label: "C7" }),
]);

export const NOOP_ACTION_INDEX = 0;
export const ACTION_COUNT = ACTION_TARGETS.length + 1;

export function resolveActionTarget(actionIndex) {
  if (!Number.isInteger(actionIndex) || actionIndex <= 0) {
    return null;
  }

  return ACTION_TARGETS[actionIndex - 1] ?? null;
}

export function clampActionIndex(actionIndex) {
  if (!Number.isInteger(actionIndex)) {
    return NOOP_ACTION_INDEX;
  }

  return Math.max(NOOP_ACTION_INDEX, Math.min(ACTION_COUNT - 1, actionIndex));
}
