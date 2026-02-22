// Spritesheet loading and fallback pixel-art generation.

export type SpriteKey =
  | 'floor'
  | 'wall'
  | 'stairs_down'
  | 'chest_closed'
  | 'chest_open'
  | 'player'
  | 'goblin'
  | 'orc_soldier'
  | 'skeleton_knight'
  | 'demon_lord'
  | 'marker_stairs'
  | 'marker_chest'
  | 'ui_cursor';

export const TILE_SIZE = 32;
const SHEET_WIDTH = TILE_SIZE * 8;
const SHEET_HEIGHT = TILE_SIZE * 2;

const SPRITE_COORDS: Record<SpriteKey, { cx: number; cy: number }> = {
  floor: { cx: 0, cy: 0 },
  wall: { cx: 1, cy: 0 },
  stairs_down: { cx: 2, cy: 0 },
  chest_closed: { cx: 3, cy: 0 },
  chest_open: { cx: 4, cy: 0 },
  player: { cx: 5, cy: 0 },
  goblin: { cx: 6, cy: 0 },
  orc_soldier: { cx: 7, cy: 0 },
  skeleton_knight: { cx: 0, cy: 1 },
  demon_lord: { cx: 1, cy: 1 },
  marker_stairs: { cx: 2, cy: 1 },
  marker_chest: { cx: 3, cy: 1 },
  ui_cursor: { cx: 4, cy: 1 }
};

export interface LoadedSpriteSheet {
  image: CanvasImageSource;
}

type TilePainter = (ctx: CanvasRenderingContext2D, x: number, y: number) => void;

function pixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawFloorBase(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x, y, 32, 32, '#1f1a16');
  pixelRect(ctx, x + 1, y + 1, 30, 30, '#3a312a');
  pixelRect(ctx, x + 3, y + 3, 8, 8, '#473b33');
  pixelRect(ctx, x + 12, y + 2, 6, 6, '#52453b');
  pixelRect(ctx, x + 20, y + 5, 9, 5, '#4a3e35');
  pixelRect(ctx, x + 5, y + 14, 12, 6, '#4b3d33');
  pixelRect(ctx, x + 20, y + 15, 8, 9, '#55473d');
  pixelRect(ctx, x + 10, y + 23, 10, 6, '#4a3d34');
}

function drawWallTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x, y, 32, 32, '#171a1f');
  pixelRect(ctx, x + 1, y + 1, 30, 30, '#404a57');
  for (let row = 0; row < 4; row += 1) {
    const rowY = y + 3 + row * 7;
    pixelRect(ctx, x + 2, rowY, 28, 1, '#2b323d');
    const offset = row % 2 === 0 ? 3 : 8;
    for (let col = offset; col < 30; col += 10) {
      pixelRect(ctx, x + col, rowY - 5, 1, 6, '#2b323d');
    }
  }
  pixelRect(ctx, x + 2, y + 24, 28, 6, '#2d333d');
}

function drawStairsTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawFloorBase(ctx, x, y);
  pixelRect(ctx, x + 5, y + 5, 22, 22, '#8f929a');
  for (let i = 0; i < 6; i += 1) {
    const stepY = y + 7 + i * 3;
    pixelRect(ctx, x + 7 + i, stepY, 18 - i * 2, 2, i % 2 === 0 ? '#dbdee5' : '#717680');
  }
  pixelRect(ctx, x + 8, y + 6, 16, 1, '#f6f7fa');
}

function drawChestClosedTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawFloorBase(ctx, x, y);
  pixelRect(ctx, x + 5, y + 14, 22, 12, '#8a4b1c');
  pixelRect(ctx, x + 4, y + 10, 24, 6, '#c37b31');
  pixelRect(ctx, x + 14, y + 16, 4, 6, '#f1ce89');
  pixelRect(ctx, x + 6, y + 20, 20, 1, '#613410');
}

function drawChestOpenTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawFloorBase(ctx, x, y);
  pixelRect(ctx, x + 5, y + 17, 22, 9, '#8a4b1c');
  pixelRect(ctx, x + 4, y + 9, 10, 4, '#c37b31');
  pixelRect(ctx, x + 18, y + 9, 10, 4, '#c37b31');
  pixelRect(ctx, x + 14, y + 18, 4, 4, '#f1ce89');
}

function drawPlayerSprite(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 12, y + 3, 8, 8, '#ffd9bd');
  pixelRect(ctx, x + 10, y + 11, 12, 12, '#2f89d8');
  pixelRect(ctx, x + 8, y + 23, 6, 7, '#1f4f88');
  pixelRect(ctx, x + 18, y + 23, 6, 7, '#1f4f88');
  pixelRect(ctx, x + 5, y + 13, 4, 2, '#d7e8ff');
  pixelRect(ctx, x + 23, y + 13, 4, 2, '#d7e8ff');
  pixelRect(ctx, x + 21, y + 9, 2, 12, '#c8d0dd');
  pixelRect(ctx, x + 23, y + 10, 4, 2, '#dfe5ef');
}

function drawGoblinSprite(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 10, y + 5, 12, 9, '#72b857');
  pixelRect(ctx, x + 9, y + 14, 14, 11, '#436f32');
  pixelRect(ctx, x + 7, y + 25, 6, 5, '#304f25');
  pixelRect(ctx, x + 19, y + 25, 6, 5, '#304f25');
  pixelRect(ctx, x + 12, y + 8, 2, 2, '#111');
  pixelRect(ctx, x + 18, y + 8, 2, 2, '#111');
  pixelRect(ctx, x + 14, y + 12, 4, 2, '#a4d987');
}

function drawOrcSprite(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 10, y + 4, 12, 8, '#f0be8b');
  pixelRect(ctx, x + 8, y + 12, 16, 12, '#7f573b');
  pixelRect(ctx, x + 7, y + 24, 6, 6, '#5b3e2b');
  pixelRect(ctx, x + 19, y + 24, 6, 6, '#5b3e2b');
  pixelRect(ctx, x + 6, y + 11, 2, 13, '#9ca0aa');
  pixelRect(ctx, x + 5, y + 10, 4, 2, '#c7ccd5');
  pixelRect(ctx, x + 12, y + 7, 2, 2, '#111');
  pixelRect(ctx, x + 18, y + 7, 2, 2, '#111');
}

function drawSkeletonSprite(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 10, y + 4, 12, 9, '#e0e2e8');
  pixelRect(ctx, x + 9, y + 13, 14, 12, '#a6adb8');
  pixelRect(ctx, x + 7, y + 25, 6, 5, '#878c95');
  pixelRect(ctx, x + 19, y + 25, 6, 5, '#878c95');
  pixelRect(ctx, x + 12, y + 8, 2, 2, '#111');
  pixelRect(ctx, x + 18, y + 8, 2, 2, '#111');
  pixelRect(ctx, x + 13, y + 14, 6, 2, '#d2d5dc');
}

function drawDemonSprite(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 8, y + 3, 16, 9, '#bf2222');
  pixelRect(ctx, x + 7, y + 12, 18, 12, '#731111');
  pixelRect(ctx, x + 5, y + 24, 7, 6, '#4f0d0d');
  pixelRect(ctx, x + 20, y + 24, 7, 6, '#4f0d0d');
  pixelRect(ctx, x + 9, y + 1, 4, 3, '#f1d27c');
  pixelRect(ctx, x + 19, y + 1, 4, 3, '#f1d27c');
  pixelRect(ctx, x + 12, y + 7, 2, 2, '#111');
  pixelRect(ctx, x + 18, y + 7, 2, 2, '#111');
  pixelRect(ctx, x + 12, y + 16, 8, 2, '#cc4040');
}

function drawMarkerStairs(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 14, y + 3, 4, 20, '#fff38e');
  pixelRect(ctx, x + 9, y + 20, 14, 4, '#fff38e');
  pixelRect(ctx, x + 11, y + 24, 10, 3, '#f8fdcf');
}

function drawMarkerChest(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 15, y + 6, 2, 2, '#bffff8');
  pixelRect(ctx, x + 13, y + 8, 6, 2, '#8cefe7');
  pixelRect(ctx, x + 11, y + 10, 10, 8, '#73ddd4');
  pixelRect(ctx, x + 13, y + 18, 6, 2, '#8cefe7');
  pixelRect(ctx, x + 15, y + 20, 2, 2, '#bffff8');
}

function drawUiCursor(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pixelRect(ctx, x + 3, y + 3, 26, 3, '#f5d77a');
  pixelRect(ctx, x + 3, y + 26, 26, 3, '#f5d77a');
  pixelRect(ctx, x + 3, y + 6, 3, 20, '#f5d77a');
  pixelRect(ctx, x + 26, y + 6, 3, 20, '#f5d77a');
}

const SPRITE_PAINTERS: Record<SpriteKey, TilePainter> = {
  floor: drawFloorBase,
  wall: drawWallTile,
  stairs_down: drawStairsTile,
  chest_closed: drawChestClosedTile,
  chest_open: drawChestOpenTile,
  player: drawPlayerSprite,
  goblin: drawGoblinSprite,
  orc_soldier: drawOrcSprite,
  skeleton_knight: drawSkeletonSprite,
  demon_lord: drawDemonSprite,
  marker_stairs: drawMarkerStairs,
  marker_chest: drawMarkerChest,
  ui_cursor: drawUiCursor
};

function paintTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  painter: TilePainter
): void {
  const x = cx * TILE_SIZE;
  const y = cy * TILE_SIZE;
  painter(ctx, x, y);
}

export function createFallbackSpritesheetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create spritesheet context.');
  }
  ctx.imageSmoothingEnabled = false;

  (Object.entries(SPRITE_COORDS) as Array<[SpriteKey, { cx: number; cy: number }]>).forEach(
    ([key, coord]) => {
      paintTile(ctx, coord.cx, coord.cy, SPRITE_PAINTERS[key]);
    }
  );

  return canvas;
}

async function tryLoadImage(url: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}

export async function loadSpriteSheet(): Promise<LoadedSpriteSheet> {
  try {
    const image = await tryLoadImage('/spritesheet.png');
    if (image.width < SHEET_WIDTH || image.height < SHEET_HEIGHT) {
      throw new Error('Spritesheet size is outdated.');
    }
    return { image };
  } catch {
    const fallback = createFallbackSpritesheetCanvas();
    return { image: fallback };
  }
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sheet: LoadedSpriteSheet,
  key: SpriteKey,
  x: number,
  y: number,
  size = TILE_SIZE
): void {
  const coord = SPRITE_COORDS[key];
  const sx = coord.cx * TILE_SIZE;
  const sy = coord.cy * TILE_SIZE;
  ctx.drawImage(sheet.image, sx, sy, TILE_SIZE, TILE_SIZE, x, y, size, size);
}
