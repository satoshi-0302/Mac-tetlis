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

function copyPath(from, to, recursive = true) {
  cpSync(from, to, { recursive });
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
  const publicDir = resolve(ROOT, 'platform', 'public');
  for (const fileName of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    copyPath(resolve(publicDir, fileName), resolve(OUT_DIR, fileName), false);
  }
  mkdirSync(resolve(OUT_DIR, 'static'), { recursive: true });
  for (const fileName of ['styles.css', 'lobby.js']) {
    copyPath(resolve(publicDir, fileName), resolve(OUT_DIR, 'static', fileName), false);
  }
  copyPath(resolve(publicDir, 'icons'), resolve(OUT_DIR, 'static', 'icons'), true);
  copyPath(resolve(publicDir, 'assets'), resolve(OUT_DIR, 'static', 'assets'), true);
}

function copySnake() {
  const targetDir = resolve(OUT_DIR, 'games', 'snake60');
  mkdirSync(targetDir, { recursive: true });
  for (const fileName of ['index.html', 'style.css', 'game.js', 'audio.js']) {
    copyPath(resolve(ROOT, 'games', 'snake60', fileName), resolve(targetDir, fileName), false);
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
    copyPath(resolve(sourceDir, fileName), resolve(targetDir, fileName), false);
  }
  for (const dirName of ['public', 'rl', 'sim']) {
    copyPath(resolve(sourceDir, dirName), resolve(targetDir, dirName), true);
  }
}

function copySlot() {
  copyPath(resolve(ROOT, 'games', 'slot60'), resolve(OUT_DIR, 'games', 'slot60'), true);
}

function copyAsteroid() {
  ensureAsteroidBuild();
  copyPath(resolve(ROOT, 'games', 'asteroid', 'dist'), resolve(OUT_DIR, 'games', 'asteroid'), true);
}

function ensureStackfallBuild() {
  const stackfallDist = resolve(ROOT, 'games', 'stackfall', 'dist', 'index.html');
  if (existsSync(stackfallDist)) {
    return;
  }
  execFileSync('npm', ['run', 'platform:build:stackfall'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

function copyStackfall() {
  ensureStackfallBuild();
  copyPath(resolve(ROOT, 'games', 'stackfall', 'dist'), resolve(OUT_DIR, 'games', 'stackfall'), true);
}

resetOutput();
copyPlatform();
copySnake();
copyMissile();
copySlot();
copyAsteroid();
copyStackfall();

console.log(`Cloudflare assets built at ${OUT_DIR}`);
