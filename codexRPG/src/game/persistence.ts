// localStorage persistence for permanent PX/PLv progression only.

import { getPlayerLevelFromPx } from './data';
import type { PersistentProgress } from './types';

const PX_KEY = 'codexRPG_px';
const PLV_KEY = 'codexRPG_plv';

function parseNonNegativeInt(value: string | null): number {
  if (value === null) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function loadProgress(): PersistentProgress {
  const px = parseNonNegativeInt(localStorage.getItem(PX_KEY));
  const plv = getPlayerLevelFromPx(px);
  localStorage.setItem(PX_KEY, String(px));
  localStorage.setItem(PLV_KEY, String(plv));
  return { px, plv };
}

export function saveProgress(progress: PersistentProgress): void {
  localStorage.setItem(PX_KEY, String(Math.max(0, Math.floor(progress.px))));
  localStorage.setItem(PLV_KEY, String(Math.max(1, Math.floor(progress.plv))));
}
