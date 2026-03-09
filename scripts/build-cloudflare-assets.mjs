import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, '.cloudflare', 'assets');

function resetOutput() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(resolve(OUT_DIR, 'games'), { recursive: true });
}

function copyRecursive(from, to) {
  cpSync(from, to, { recursive: true });
}

function ensureAsteroidBuild() {
  const asteroidDist = resolve(ROOT, 'games', 'asteroid', 'dist', 'index.html');
  if (existsSync(asteroidDist)) {
    return;
  }

  execFileSync('npm', ['run', 'platform:build:asteroid'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

function copyPlatform() {
  copyRecursive(resolve(ROOT, 'platform', 'public'), OUT_DIR);
}

function copySnake() {
  const targetDir = resolve(OUT_DIR, 'games', 'snake60');
  mkdirSync(targetDir, { recursive: true });
  for (const fileName of ['index.html', 'style.css', 'game.js', 'audio.js']) {
    copyRecursive(resolve(ROOT, 'games', 'snake60', fileName), resolve(targetDir, fileName));
  }
}

function copyMissile() {
  const sourceDir = resolve(ROOT, 'games', 'missile-command');
  const targetDir = resolve(OUT_DIR, 'games', 'missile-command');
  mkdirSync(targetDir, { recursive: true });
  for (const fileName of [
    'index.html',
    'styles.css',
    'api.js',
    'audio.js',
    'balance.js',
    'effects.js',
    'entities.js',
    'game.js',
    'renderer.js',
    'replay.js',
    'ui.js'
  ]) {
    copyRecursive(resolve(sourceDir, fileName), resolve(targetDir, fileName));
  }
  for (const dirName of ['public', 'rl', 'sim']) {
    copyRecursive(resolve(sourceDir, dirName), resolve(targetDir, dirName));
  }
}

function copySlot() {
  copyRecursive(resolve(ROOT, 'games', 'slot60'), resolve(OUT_DIR, 'games', 'slot60'));
}

function copyAsteroid() {
  ensureAsteroidBuild();
  copyRecursive(resolve(ROOT, 'games', 'asteroid', 'dist'), resolve(OUT_DIR, 'games', 'asteroid'));
}

resetOutput();
copyPlatform();
copySnake();
copyMissile();
copySlot();
copyAsteroid();

console.log(`Cloudflare assets built at ${OUT_DIR}`);
