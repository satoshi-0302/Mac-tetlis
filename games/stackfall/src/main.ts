import Phaser from 'phaser';
import './style.css';
import { fetchLeaderboard, fetchReplay, submitScore } from './net/api.js';

  // Removed unused ShapeConfig

interface Piece {
  matrix: number[][];
  color: number;
  x: number; y: number;
  lockTimer: number; id: number;
}
interface InputState {
  l: number; r: number; u: number; d: number; s: number; rr: number;
}
interface PointerData {
  active: boolean;
  startX: number; startY: number;
  lastX: number; lastY: number;
  startTime: number;
  moved: boolean;
  gestureLock: 'HORIZONTAL' | 'VERTICAL' | null;
  isRightHalf: boolean;
  wantsSoftDrop?: boolean;
}
interface LeaderboardEntry {
  kind: string;
  score: number;
  name: string;
  message?: string;
  replayDigest?: string;
  id?: string;
}

const WIDTH = 960;
const HEIGHT = 750;
const RUN_SECONDS = 60;
const COLS = 10;
const ROWS = 25;
const BLOCK_SIZE = 28;
const BOARD_X = WIDTH / 2 - (COLS * BLOCK_SIZE) / 2;
const BOARD_Y = HEIGHT / 2 - (ROWS * BLOCK_SIZE) / 2 + 10;
const STORAGE_KEY = 'stackfall-tetris-best-name';

const SHAPES = [
  { matrix: [[1,1,1,1]], color: 0x00FFFF },
  { matrix: [[1,0,0],[1,1,1]], color: 0x0055FF },
  { matrix: [[0,0,1],[1,1,1]], color: 0xFF8800 },
  { matrix: [[1,1],[1,1]], color: 0xFFDD00 },
  { matrix: [[0,1,1],[1,1,0]], color: 0x00FF44 },
  { matrix: [[0,1,0],[1,1,1]], color: 0xAA00FF },
  { matrix: [[1,1,0],[0,1,1]], color: 0xFF0033 }
];

function sfc32(a: number, b: number, c: number, d: number) {
  return function() {
    a |= 0; b |= 0; c |= 0; d |= 0; 
    let t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  }
}

async function computeSha256(str: string) {
  const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq: number, type: OscillatorType, duration: number, vol = 0.1, delay = 0) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + delay + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + delay);
  osc.stop(audioCtx.currentTime + delay + duration);
}

const sfx = {
  move: () => playTone(300, 'sine', 0.1, 0.05),
  rotate: () => playTone(400, 'triangle', 0.1, 0.05),
  lock: () => playTone(150, 'square', 0.2, 0.1),
  hardDrop: () => {
    playTone(100, 'sawtooth', 0.15, 0.2);
    playTone(80, 'square', 0.2, 0.2);
  },
  clear: () => {
    playTone(600, 'sine', 0.3, 0.1);
    playTone(800, 'sine', 0.4, 0.1, 0.1);
  },
  tetris: () => {
    playTone(400, 'square', 0.5, 0.15);
    playTone(600, 'square', 0.5, 0.15, 0.1);
    playTone(800, 'square', 0.5, 0.15, 0.2);
    playTone(1200, 'sawtooth', 0.8, 0.2, 0.3);
  }
};

class BGMPlayer {
  isPlaying: boolean;
  timerId: any;
  notes: number[];
  index: number;
  
  constructor() {
    this.isPlaying = false;
    this.timerId = null;
    this.notes = [220, 261.63, 329.63, 261.63, 293.66, 349.23, 440, 349.23];
    this.index = 0;
  }
  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    this.playNext();
  }
  playNext() {
    if (!this.isPlaying) return;
    const freq = this.notes[this.index % this.notes.length];
    playTone(freq, 'sine', 0.25, 0.02);
    this.index++;
    this.timerId = setTimeout(() => this.playNext(), 250);
  }
  stop() {
    this.isPlaying = false;
    if (this.timerId) clearTimeout(this.timerId);
  }
}
const bgm = new BGMPlayer();

const routeModeParam = new URLSearchParams(window.location.search).get('mode');
const routeMode = routeModeParam === 'mobile' ? 'mobile' : routeModeParam === 'desktop' ? 'desktop' : 'auto';
const prefersTouch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const isMobile = routeMode === 'mobile' || (routeMode !== 'desktop' && prefersTouch);
document.body.dataset.routeMode = isMobile ? 'mobile' : 'desktop';

const app = document.querySelector('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <div class="route-bar">
    <a class="btn tiny nav-button" href="/">LOBBY</a>
    <span class="route-pill">${isMobile ? 'SMARTPHONE' : 'STACKFALL 60'}</span>
  </div>
  <div class="layout">
    <section class="game-column">
      <div class="canvas-wrap">
        <div id="phaser-root"></div>
      </div>
      
      <div class="status-bar">
        <span id="runtimeStatus" class="runtime-status">Press Space or Tap Canvas to start.</span>
        <button id="stopReplayBtn" class="btn tiny hidden" type="button">Stop Replay</button>
      </div>
    </section>
    
    <aside class="side-column">
      <section class="panel controls-panel">
        <h1>STACKFALL 60</h1>
        <ul>
          <li><strong>Continuous Drop</strong>: 3マスごとに次々とブロックが降り立つ！</li>
          <li><strong>Active Piece</strong>: 操作できるのは最下部のブロックだけ！</li>
          <li>Rotate: <kbd>↑</kbd></li>
          <li>Move: <kbd>←</kbd> / <kbd>→</kbd></li>
          <li>Soft Drop (Active Only): <kbd>↓</kbd></li>
          <li>Hard Drop: <kbd>Space</kbd></li>
        </ul>
      </section>

      <section class="panel leaderboard-panel">
        <div class="panel-head">
          <h2>LEADERBOARD</h2>
          <button id="reloadLeaderboard" class="btn tiny" type="button">Refresh</button>
        </div>
        <div id="leaderboardList" class="leaderboard-list"></div>
        <p id="leaderboardStatus" class="muted small"></p>
      </section>

      <section class="panel result-panel hidden" id="resultPanel">
        <h2>RUN RESULT</h2>
        <div id="resultStats" class="result-stats"></div>
        <form id="submitForm" class="submit-form">
          <label>Name (max 12) <input id="nameInput" name="name" maxlength="12" required /></label>
          <label>Comment (max 20) <input id="messageInput" name="message" maxlength="20" autocomplete="off" /></label>
          <button id="submitButton" class="btn" type="submit">Submit Score</button>
        </form>
        <p id="submitStatus" class="muted small"></p>
      </section>
    </aside>
  </div>
`;

const ui: Record<string, any> = {
  runtimeStatus: document.getElementById('runtimeStatus'),
  stopReplayBtn: document.getElementById('stopReplayBtn'),
  leaderboardList: document.getElementById('leaderboardList'),
  leaderboardStatus: document.getElementById('leaderboardStatus'),
  reloadLeaderboard: document.getElementById('reloadLeaderboard'),
  resultPanel: document.getElementById('resultPanel'),
  resultStats: document.getElementById('resultStats'),
  submitForm: document.getElementById('submitForm'),
  submitButton: document.getElementById('submitButton'),
  submitStatus: document.getElementById('submitStatus'),
  nameInput: document.getElementById('nameInput'),
  messageInput: document.getElementById('messageInput')
};

ui.nameInput.value = localStorage.getItem(STORAGE_KEY) || '';

let gameSceneInstance: StackfallScene | null = null;

class StackfallScene extends Phaser.Scene {
  runMode!: 'TITLE' | 'READY' | 'PLAYING' | 'REPLAY' | 'GAMEOVER';
  score!: number;
  lines!: number;
  bestScore!: number;
  timeLeft!: number;
  rng!: any;
  seed!: number;
  tickCount!: number;
  accumulator!: number;
  inputEvents!: Record<number, InputState>;
  replayEvents!: Record<number, InputState>;
  grid!: number[][];
  fallingPieces!: Piece[];
  dropIntervalBase!: number;
  dropInterval!: number;
  dropTicks!: number;
  activeLockDelayTicks!: number;
  inactiveLockDelayTicks!: number;
  moveDasTicks!: number;
  softDropTicks!: number;
  boardGroup!: Phaser.GameObjects.Group;
  piecesGroup!: Phaser.GameObjects.Group;
  fxGroup!: Phaser.GameObjects.Group;
  particles!: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkles!: Phaser.GameObjects.Particles.ParticleEmitter;
  hudTime!: Phaser.GameObjects.Text;
  hudScore!: Phaser.GameObjects.Text;
  hudLines!: Phaser.GameObjects.Text;
  hudName!: Phaser.GameObjects.Text;
  hudResult!: Phaser.GameObjects.Text;
  hudFlash!: Phaser.GameObjects.Rectangle;
  keys!: any;
  pointersData!: Record<number, PointerData>;
  gestureBuffer!: string[];
  gestureInputs!: InputState;
  softDropHold!: number;

  constructor() {
    super('stackfall');
  }

  create() {
    gameSceneInstance = this;
    
    this.runMode = 'READY'; // READY, PLAYING, REPLAY, GAMEOVER
    this.score = 0;
    this.lines = 0;
    this.bestScore = 0;
    this.timeLeft = RUN_SECONDS;
    
    // Deterministic state
    this.rng = null;
    this.seed = 0;
    this.tickCount = 0;
    this.accumulator = 0;
    this.inputEvents = {}; // { tickCount: { l, r, u, d, s } }
    this.replayEvents = {};
    
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.fallingPieces = [];
    
    this.dropIntervalBase = 60; // ticks (1 second)
    this.dropInterval = this.dropIntervalBase;
    this.dropTicks = 0;
    this.activeLockDelayTicks = 30; // 0.5 sec
    this.inactiveLockDelayTicks = 240; // 4 secs
    this.moveDasTicks = 0;
    this.softDropTicks = 0;
    
    this.generateBlockTexture();
    
    this.boardGroup = this.add.group();
    this.piecesGroup = this.add.group();
    this.fxGroup = this.add.group();
    
    this.particles = this.add.particles(0, 0, 'block_glow', {
      lifespan: 800, speed: { min: 50, max: 250 },
      scale: { start: 0.6, end: 0 }, blendMode: 'ADD', emitting: false
    });
    this.sparkles = this.add.particles(0, 0, 'block_glow', {
      lifespan: 1200, speed: { min: 100, max: 400 },
      scale: { start: 0.8, end: 0 }, tint: 0xFFDD00, blendMode: 'ADD', emitting: false
    });
    
    this.drawBoard();
    this.createUI();
    this.createInput();
    this.syncHud();
  }

  generateBlockTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
    g.fillStyle(0xFFFFFF, 1);
    g.fillRoundedRect(0, 0, BLOCK_SIZE, BLOCK_SIZE, 6);
    g.fillStyle(0x000000, 0.25);
    g.fillRoundedRect(0, BLOCK_SIZE/2, BLOCK_SIZE, BLOCK_SIZE/2, { tl: 0, tr: 0, bl: 6, br: 6 });
    g.lineStyle(2, 0xFFFFFF, 0.85);
    g.strokeRoundedRect(2, 2, BLOCK_SIZE-4, BLOCK_SIZE-4, 4);
    g.generateTexture('modern_block', BLOCK_SIZE, BLOCK_SIZE);
    
    const glow = this.make.graphics({ x: 0, y: 0, add: false } as any);
    glow.fillStyle(0xFFFFFF, 1);
    glow.fillCircle(8, 8, 8);
    glow.generateTexture('block_glow', 16, 16);
    
    const flashRow = this.make.graphics({ x:0, y:0, add: false } as any);
    flashRow.fillStyle(0xFFFFFF, 1);
    flashRow.fillRect(0, 0, COLS * BLOCK_SIZE, BLOCK_SIZE);
    flashRow.generateTexture('flash_row', COLS * BLOCK_SIZE, BLOCK_SIZE);
  }

  drawBoard() {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x050b14);
    
    const boardBg = this.add.rectangle(BOARD_X + (COLS * BLOCK_SIZE) / 2, BOARD_Y + (ROWS * BLOCK_SIZE) / 2, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE, 0x0a1526);
    boardBg.setStrokeStyle(3, 0x244273);
    
    const graphics = this.add.graphics({ lineStyle: { width: 1, color: 0x1a3055, alpha: 0.5 } });
    for (let i = 1; i < COLS; i++) {
        graphics.moveTo(BOARD_X + i * BLOCK_SIZE, BOARD_Y);
        graphics.lineTo(BOARD_X + i * BLOCK_SIZE, BOARD_Y + ROWS * BLOCK_SIZE);
    }
    for (let i = 1; i < ROWS; i++) {
        graphics.moveTo(BOARD_X, BOARD_Y + i * BLOCK_SIZE);
        graphics.lineTo(BOARD_X + COLS * BLOCK_SIZE, BOARD_Y + i * BLOCK_SIZE);
    }
    graphics.strokePath();
  }

  createUI() {
    const textStyle = { fontFamily: 'Orbitron', fontSize: '24px', color: '#00FFFF', align: 'left' };
    const numStyle = { fontFamily: 'Orbitron', fontSize: '32px', color: '#FFF', align: 'left' };
    
    const leftX = 40;
    
    this.add.text(leftX, BOARD_Y + 50, 'TIME', textStyle);
    this.hudTime = this.add.text(leftX, BOARD_Y + 80, '60', numStyle);
    
    this.add.text(leftX, BOARD_Y + 150, 'SCORE', textStyle);
    this.hudScore = this.add.text(leftX, BOARD_Y + 180, '0', numStyle);
    
    this.add.text(leftX, BOARD_Y + 250, 'LINES', textStyle);
    this.hudLines = this.add.text(leftX, BOARD_Y + 280, '0', numStyle);
    
    this.hudName = this.add.text(leftX, BOARD_Y + 380, '', { ...textStyle, color: '#FFDD00', fontSize: '18px' });
    this.hudResult = this.add.text(WIDTH/2, HEIGHT/2, '', { fontFamily: 'Orbitron', fontSize: '48px', color: '#FFF', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(100);
    this.hudFlash = this.add.rectangle(WIDTH/2, HEIGHT/2, WIDTH, HEIGHT, 0x00FFFF, 0.2).setDepth(99).setAlpha(0);
  }

  createInput() {
    this.keys = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      space: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      z: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
    };
    
    // Tap to start
    this.input.on('pointerdown', () => {
      if (this.runMode === 'READY' || this.runMode === 'GAMEOVER') this.startRun(null);
    });

    // Gestures functionality for Mobile modes
    this.pointersData = {};
    this.gestureBuffer = [];
    this.gestureInputs = { u: 0, s: 0, d: 0, l: 0, r: 0, rr: 0 };
    this.softDropHold = 0;

    this.input.addPointer(2); // Enable full multi-touch

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.runMode === 'READY' || this.runMode === 'GAMEOVER') {
        this.startRun(null); return;
      }
      const isRightHalf = pointer.x > 480;

      this.pointersData[pointer.id] = {
        active: true,
        startX: pointer.x,
        startY: pointer.y,
        lastX: pointer.x,
        lastY: pointer.y,
        startTime: this.time.now,
        moved: false,
        gestureLock: null,
        isRightHalf: isRightHalf
      };
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const pData = this.pointersData[pointer.id];
      if (!pData || !pData.active || this.runMode !== 'PLAYING') return;
      
      const totalDx = pointer.x - pData.startX;
      const dyTotal = pointer.y - pData.startY;
      
      // Determine primary axis of gesture when first crossing the movement threshold
      if (!pData.moved && (Math.abs(totalDx) > 15 || Math.abs(dyTotal) > 15)) {
        pData.moved = true;
        if (Math.abs(dyTotal) > Math.abs(totalDx) * 1.5) {
          pData.gestureLock = 'VERTICAL';
        } else {
          pData.gestureLock = 'HORIZONTAL';
        }
      }

      // If swiping down forcefully, drastically raise the resistance to lateral shifts
      const moveThreshold = (pData.gestureLock === 'VERTICAL') ? 85 : 35;
      
      const dx = pointer.x - pData.lastX;
      // X Movement: move based on threshold
      if (dx > moveThreshold) {
        const moves = Math.floor(dx / moveThreshold);
        for(let i = 0; i < moves; i++) this.gestureBuffer.push('r');
        pData.lastX += moves * moveThreshold;
      } else if (dx < -moveThreshold) {
        const moves = Math.floor(Math.abs(dx) / moveThreshold);
        for(let i = 0; i < moves; i++) this.gestureBuffer.push('l');
        pData.lastX -= moves * moveThreshold;
      }
      
      // Y Soft Drop: hold down soft drop if dragged down enough
      if (dyTotal > 40) {
        pData.wantsSoftDrop = true;
      } else {
        pData.wantsSoftDrop = false;
      }
      this.softDropHold = Object.values(this.pointersData).some(p => p.active && p.wantsSoftDrop) ? 1 : 0;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const pData = this.pointersData[pointer.id];
      if (!pData || !pData.active) return;
      pData.active = false;
      pData.wantsSoftDrop = false;
      this.softDropHold = Object.values(this.pointersData).some(p => p.active && p.wantsSoftDrop) ? 1 : 0;

      if (this.runMode !== 'PLAYING') {
        delete this.pointersData[pointer.id];
        return;
      }

      const totalDx = pointer.x - pData.startX;
      const dyTotal = pointer.y - pData.startY;
      const dt = this.time.now - pData.startTime;
      const vy = dyTotal / Math.max(1, dt);

      if (!pData.moved) {
        // Tap to rotate
        if (pData.isRightHalf) {
           this.gestureInputs.rr = 1;
        } else {
           this.gestureInputs.u = 1;
        }
      } else if (vy > 0.8 && dyTotal > 50 && dyTotal > Math.abs(totalDx) * 1.2) {
        // Strong flick down for Hard Drop (must be primarily vertical)
        this.gestureInputs.s = 1;
      }
      
      delete this.pointersData[pointer.id];
    });
  }

  startRun(seed: number | null, replayEvents: Record<number, InputState> | null = null) {
    ui.resultPanel.classList.add('hidden');
    ui.submitStatus.textContent = '';
    
    this.runMode = replayEvents ? 'REPLAY' : 'PLAYING';
    this.seed = seed ?? (Date.now() ^ 0x9e3779b9) >>> 0;
    this.rng = sfc32(this.seed, this.seed ^ 0xdeadbeef, this.seed ^ 0x8badf00d, this.seed ^ 0x11111111);
    this.tickCount = 0;
    this.accumulator = 0;
    this.inputEvents = {};
    this.replayEvents = replayEvents || {};
    
    this.score = 0;
    this.lines = 0;
    this.timeLeft = RUN_SECONDS;
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.fallingPieces = [];
    this.boardGroup.clear(true, true);
    this.piecesGroup.clear(true, true);
    this.fxGroup.clear(true, true);
    this.hudResult.setText('');
    this.hudName.setText(this.runMode === 'REPLAY' ? '[REPLAYING]' : '');
    
    this.spawnPiece();
    this.syncHud();
    this.dropInterval = this.dropIntervalBase;
    
    bgm.start();
    ui.runtimeStatus.textContent = this.runMode === 'REPLAY' ? 'Replaying run...' : 'Playing...';
    if (this.runMode === 'REPLAY') {
      ui.stopReplayBtn.classList.remove('hidden');
      document.getElementById('touchControls')?.classList.add('hidden');
    } else {
      ui.stopReplayBtn.classList.add('hidden');
      document.getElementById('touchControls')?.classList.remove('hidden');
    }
  }

  spawnPiece() {
    // Deterministic random
    const idx = Math.floor(this.rng() * SHAPES.length);
    const shapeConfig = SHAPES[idx];
    const newPiece = {
      matrix: shapeConfig.matrix,
      color: shapeConfig.color,
      x: Math.floor(COLS / 2) - Math.floor(shapeConfig.matrix[0].length / 2),
      y: 0,
      lockTimer: 0,
      id: this.rng()
    };
    
    if (this.checkCollision(newPiece.matrix, newPiece.x, newPiece.y, newPiece.id)) {
      this.finishRun('GAMEOVER');
      return;
    }
    
    this.fallingPieces.push(newPiece);
  }

  getActivePiece() {
    if (this.fallingPieces.length === 0) return null;
    return this.fallingPieces.reduce((lowest, piece) => (piece.y > lowest.y ? piece : lowest), this.fallingPieces[0]);
  }

  checkCollision(matrix: number[][], px: number, py: number, ignoreId: number) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c]) {
          const nx = px + c;
          const ny = py + r;
          if (nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && this.grid[ny][nx])) return true;
        }
      }
    }
    for (const other of this.fallingPieces) {
      if (other.id === ignoreId) continue;
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c]) {
            const nx = px + c;
            const ny = py + r;
            for (let or = 0; or < other.matrix.length; or++) {
              for (let oc = 0; oc < other.matrix[or].length; oc++) {
                if (other.matrix[or][oc]) {
                  if (other.x + oc === nx && other.y + or === ny) return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }

  moveActivePiece(dx: number, dy: number) {
    const active = this.getActivePiece();
    if (!active) return false;
    if (!this.checkCollision(active.matrix, active.x + dx, active.y + dy, active.id)) {
      active.x += dx;
      active.y += dy;
      if (dx !== 0) {
        if (this.runMode === 'PLAYING') {
           sfx.move();
           this.vibrate(2);
        }
        active.lockTimer = 0;
      }
      return true;
    }
    return false;
  }

  rotateActivePiece() {
    const active = this.getActivePiece();
    if (!active) return;
    const matrix = active.matrix;
    const newMatrix = matrix[0].map((_val, index) => matrix.map(row => row[index]).reverse());
    if (!this.checkCollision(newMatrix, active.x, active.y, active.id)) {
      active.matrix = newMatrix;
    } else if (!this.checkCollision(newMatrix, active.x - 1, active.y, active.id)) {
      active.matrix = newMatrix; active.x -= 1;
    } else if (!this.checkCollision(newMatrix, active.x + 1, active.y, active.id)) {
      active.matrix = newMatrix; active.x += 1;
    } else return;
    
    if (this.runMode === 'PLAYING') sfx.rotate();
    active.lockTimer = 0; 
  }

  rotateActivePieceReverse() {
    const active = this.getActivePiece();
    if (!active) return;
    const matrix = active.matrix;
    const newMatrix = matrix[0].map((_val, index) => matrix.map(row => row[matrix[0].length - 1 - index]));
    if (!this.checkCollision(newMatrix, active.x, active.y, active.id)) {
      active.matrix = newMatrix;
    } else if (!this.checkCollision(newMatrix, active.x - 1, active.y, active.id)) {
      active.matrix = newMatrix; active.x -= 1;
    } else if (!this.checkCollision(newMatrix, active.x + 1, active.y, active.id)) {
      active.matrix = newMatrix; active.x += 1;
    } else return;
    
    if (this.runMode === 'PLAYING') sfx.rotate();
    active.lockTimer = 0; 
  }

  hardDropActivePiece() {
    const active = this.getActivePiece();
    if (!active) return;
    let distance = 0;
    while (!this.checkCollision(active.matrix, active.x, active.y + 1, active.id)) {
      active.y += 1; distance++;
    }
    if (distance > 0) {
      if (this.runMode === 'PLAYING') {
          sfx.hardDrop();
          this.vibrate([15, 30, 15]);
          this.cameras.main.shake(80, 0.008);
          const impactY = BOARD_Y + (active.y + active.matrix.length) * BLOCK_SIZE;
          const flash = this.add.rectangle(BOARD_X + (COLS*BLOCK_SIZE)/2, impactY, COLS * BLOCK_SIZE, 10, 0xFFFFFF, 0.8);
          this.fxGroup.add(flash);
          this.tweens.add({ targets: flash, alpha: 0, duration: 150, onComplete: () => flash.destroy() });
      }
    }
    this.score += distance * 2;
    active.lockTimer = this.activeLockDelayTicks;
    this.lockPieces(); 
  }

  lockPieces() {
    let lockedAny = false;
    const active = this.getActivePiece();
    
    for (let i = this.fallingPieces.length - 1; i >= 0; i--) {
      const piece = this.fallingPieces[i];
      const isAct = (piece === active);
      
      if (this.checkCollision(piece.matrix, piece.x, piece.y + 1, piece.id)) {
        piece.lockTimer += 1; 
        const delayLimit = isAct ? this.activeLockDelayTicks : this.inactiveLockDelayTicks;
        
        if (piece.lockTimer >= delayLimit) {
          for (let r = 0; r < piece.matrix.length; r++) {
            for (let c = 0; c < piece.matrix[r].length; c++) {
              if (piece.matrix[r][c]) {
                if (piece.y + r < 0) {
                  this.finishRun('GAMEOVER');
                  return;
                }
                this.grid[piece.y + r][piece.x + c] = piece.color;
              }
            }
          }
          this.fallingPieces.splice(i, 1);
          lockedAny = true;
          if (this.runMode === 'PLAYING') {
             sfx.lock();
             this.vibrate(10);
          }
        }
      } else {
        piece.lockTimer = 0;
      }
    }
    if (lockedAny) this.clearLines();
  }

  clearLines() {
    let linesCleared: number[] = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].every(cell => cell !== 0)) {
        linesCleared.push(r);
      }
    }
    if (linesCleared.length > 0) {
      for (const r of linesCleared) {
         if (this.runMode === 'PLAYING') {
             const flash = this.add.image(BOARD_X + (COLS * BLOCK_SIZE)/2, BOARD_Y + r * BLOCK_SIZE + BLOCK_SIZE/2, 'flash_row');
             this.fxGroup.add(flash);
             this.tweens.add({ targets: flash, alpha: 0, scaleY: 1.5, duration: 300, onComplete: () => flash.destroy() });
             for(let c=0; c<COLS; c++) {
                this.particles.emitParticleAt(BOARD_X + c * BLOCK_SIZE + BLOCK_SIZE/2, BOARD_Y + r * BLOCK_SIZE + BLOCK_SIZE/2);
             }
         }
      }
      
      if (linesCleared.length >= 4) {
        if (this.runMode === 'PLAYING') {
            sfx.tetris();
            this.vibrate([30, 50, 30, 50, 30]);
            this.cameras.main.shake(300, 0.015);
            for (const r of linesCleared) {
              this.sparkles.emitParticleAt(BOARD_X + (COLS * BLOCK_SIZE)/2, BOARD_Y + r * BLOCK_SIZE + BLOCK_SIZE/2, 40);
            }
        }
      } else {
        if (this.runMode === 'PLAYING') {
            sfx.clear();
            this.vibrate([20, 30, 20]);
            this.cameras.main.shake(100, 0.005 * linesCleared.length);
        }
      }

      for (const r of linesCleared) {
        this.grid.splice(r, 1);
        this.grid.unshift(Array(COLS).fill(0));
      }
      this.lines += linesCleared.length;
      const points = [0, 100, 300, 500, 1500];
      this.score += (points[linesCleared.length] || 2000) * (this.lines > 10 ? 2 : 1);
      this.dropIntervalBase = Math.max(10, 60 - (this.lines * 2)); // speed up
    }
  }

  vibrate(pattern) {
    if (this.runMode !== 'PLAYING') return;
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch(e) {}
    }
  }

  captureInputs() {
    if (this.runMode !== 'PLAYING') return { l:0, r:0, u:0, d:0, s:0, rr:0 };
    
    // Read one buffered gesture movement per tick
    let gL = 0, gR = 0;
    if (this.gestureBuffer && this.gestureBuffer.length > 0) {
      const g = this.gestureBuffer.shift();
      if (g === 'l') gL = 1;
      if (g === 'r') gR = 1;
    }

    const tU = this.gestureInputs.u;
    const tRR = this.gestureInputs.rr;
    const tS = this.gestureInputs.s;
    
    const isU = Phaser.Input.Keyboard.JustDown(this.keys.up) || tU ? 1 : 0;
    const isRR = Phaser.Input.Keyboard.JustDown(this.keys.z) || tRR ? 1 : 0;
    const isS = Phaser.Input.Keyboard.JustDown(this.keys.space) || tS ? 1 : 0;
    
    this.gestureInputs.u = 0;
    this.gestureInputs.rr = 0;
    this.gestureInputs.s = 0;

    return {
      l: this.keys.left.isDown || gL ? 1 : 0,
      r: this.keys.right.isDown || gR ? 1 : 0,
      u: isU,
      d: this.keys.down.isDown || this.softDropHold ? 1 : 0,
      s: isS,
      rr: isRR
    };
  }

  logicTick() {
    this.tickCount++;
    if (this.tickCount % 60 === 0) {
        this.timeLeft -= 1;
        if (this.timeLeft <= 0) {
            this.finishRun('TIME UP');
            return;
        }
    }

    let input: InputState = { l:0, r:0, u:0, d:0, s:0, rr: 0 };
    if (this.runMode === 'PLAYING') {
        input = this.captureInputs();
        if (input.l || input.r || input.u || input.d || input.s) {
            this.inputEvents[this.tickCount] = input;
        }
    } else if (this.runMode === 'REPLAY') {
        input = this.replayEvents[this.tickCount] || input;
    }

    const newestPiece = this.fallingPieces[this.fallingPieces.length - 1];
    if (!newestPiece || newestPiece.y >= 3) {
      this.spawnPiece();
      if (this.runMode === 'GAMEOVER') return;
    }
    
    if (input.s) {
        this.hardDropActivePiece();
    } else if (input.rr) {
        this.rotateActivePieceReverse();
    } else if (input.u) {
        this.rotateActivePiece();
    }
    
    // Custom DAS for L/R
    if (input.l || input.r) {
        this.moveDasTicks++;
        if (this.moveDasTicks === 1 || this.moveDasTicks > 12) {
            if (this.moveDasTicks > 12) this.moveDasTicks = 8;
            if (input.l) this.moveActivePiece(-1, 0);
            if (input.r) this.moveActivePiece(1, 0);
        }
    } else {
        this.moveDasTicks = 0;
    }

    // Soft Drop
    if (input.d) {
        this.softDropTicks++;
        if (this.softDropTicks > 2) { // 2 ticks = ~30Hz drop
            this.softDropTicks = 0;
            const active = this.getActivePiece();
            if (active && !this.checkCollision(active.matrix, active.x, active.y + 1, active.id)) {
                active.y += 1;
                this.score += 1;
            }
        }
    } else {
        this.softDropTicks = 0;
    }

    // Gravity
    this.dropTicks++;
    if (this.dropTicks >= this.dropIntervalBase) {
      this.dropTicks = 0;
      for (const piece of this.fallingPieces) {
        if (!this.checkCollision(piece.matrix, piece.x, piece.y + 1, piece.id)) {
          piece.y += 1;
        }
      }
    }
    
    this.lockPieces();
  }

  update(_time: number, delta: number) {
    if (this.runMode !== 'PLAYING' && this.runMode !== 'REPLAY') return;
    
    // Fixed timestep accumulation
    this.accumulator += delta;
    const TICK_MS = 1000 / 60; // 60Hz logic ticks
    
    // Prevent spiral of death
    if (this.accumulator > 200) this.accumulator = 200; 

    while (this.accumulator >= TICK_MS) {
        this.accumulator -= TICK_MS;
        this.logicTick();
        if (this.runMode === 'GAMEOVER' as any) break;
    }
    
    this.syncHud();
    this.drawGame();
  }

  drawGame() {
    this.boardGroup.clear(true, true);
    this.piecesGroup.clear(true, true);
    
    const active = this.getActivePiece();
    
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) {
          this.drawBlock(c, r, this.grid[r][c], 1, this.boardGroup);
        }
      }
    }
    
    if (active && this.runMode !== 'GAMEOVER') {
        let ghostY = active.y;
        while (!this.checkCollision(active.matrix, active.x, ghostY + 1, active.id)) {
            ghostY++;
        }
        for (let r = 0; r < active.matrix.length; r++) {
          for (let c = 0; c < active.matrix[r].length; c++) {
            if (active.matrix[r][c]) {
              this.drawBlock(active.x + c, ghostY + r, active.color, 0.4, this.piecesGroup);
            }
          }
        }
    }
    
    for (const piece of this.fallingPieces) {
      const isAct = (piece === active);
      const isResting = !isAct && piece.lockTimer > 0;
      let alpha = isAct ? 1 : 0.7;
      if (isResting) {
          alpha = 0.5 + Math.sin(this.time.now / 100) * 0.2; // Visual pulse for non-active waiting
      }
      
      for (let r = 0; r < piece.matrix.length; r++) {
        for (let c = 0; c < piece.matrix[r].length; c++) {
          if (piece.matrix[r][c]) {
            this.drawBlock(piece.x + c, piece.y + r, piece.color, alpha, this.piecesGroup, isAct);
          }
        }
      }
    }
  }

  drawBlock(x, y, color, alpha = 1, group, pulse = false) {
    if (y < 0) return;
    const block = this.add.sprite(BOARD_X + x * BLOCK_SIZE + BLOCK_SIZE / 2, BOARD_Y + y * BLOCK_SIZE + BLOCK_SIZE / 2, 'modern_block');
    block.setTint(color); block.setAlpha(alpha);
    if (pulse) block.setScale(1.0 + Math.sin(this.time.now / 150) * 0.05);
    group.add(block);
  }

  async finishRun(reason) {
    bgm.stop();
    const isPlaying = this.runMode === 'PLAYING';
    this.runMode = 'GAMEOVER';
    
    if (isPlaying && this.score > this.bestScore) this.bestScore = this.score;
    
    this.hudResult.setText(reason);
    this.tweens.add({ targets: this.hudFlash, alpha: 0.5, yoyo: true, duration: 200 });
    
    ui.runtimeStatus.textContent = '';
    ui.stopReplayBtn.classList.add('hidden');
    document.getElementById('touchControls')?.classList.add('hidden');
    
    if (isPlaying) {
      const payloadObj = { seed: this.seed, events: this.inputEvents };
      const replayDataStr = btoa(JSON.stringify(payloadObj));
      const digest = await computeSha256(replayDataStr);
      
      ui.resultPanel.classList.remove('hidden');
      ui.resultStats.innerHTML = `
        <div><span>Score</span><strong>${this.score}</strong></div>
        <div><span>Lines</span><strong>${this.lines}</strong></div>
      `;
      
      ui.submitForm.onsubmit = async (e) => {
        e.preventDefault();
        ui.submitButton.disabled = true;
        ui.submitStatus.textContent = 'Submitting...';
        
        try {
          const playerName = ui.nameInput.value.trim().toUpperCase() || 'PLAYER';
          localStorage.setItem(STORAGE_KEY, playerName);
          const payload = {
            name: playerName,
            message: ui.messageInput.value.trim(),
            score: this.score,
            lines: this.lines,
            replayData: replayDataStr,
            replayDigest: digest
          };
          const res = await submitScore(payload);
          if (res.success) {
            ui.submitForm.reset();
            refreshLeaderboard();
          }
        } catch (err: any) {
          ui.submitStatus.textContent = `Fail: ${err.message}`;
        } finally {
          ui.submitButton.disabled = false;
        }
      };
    }
  }

  syncHud() {
    this.hudTime.setText(Math.max(0, this.timeLeft).toString());
    this.hudScore.setText(this.score.toString());
    this.hudLines.setText(this.lines.toString());
  }
}

// Prevent fatal viewport scrolling on mobile devices during swipe/flick gestures
const preventScrollListener = (e: Event) => {
  if (document.body.getAttribute('data-route-mode') === 'mobile') {
    if (!(e.target as Element).closest('.side-column')) {
      e.preventDefault();
    }
  }
};
document.body.addEventListener('touchmove', preventScrollListener, { passive: false });

new Phaser.Game({
  type: Phaser.AUTO, parent: 'phaser-root', width: WIDTH, height: HEIGHT,
  backgroundColor: '#000', transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [StackfallScene]
});

// Sidebar logic
async function refreshLeaderboard() {
  try {
    const lbResp = await fetchLeaderboard();
    const lb: LeaderboardEntry[] = lbResp?.entries || [];
    ui.leaderboardList.innerHTML = '';
    
    if (!lb || lb.length === 0) {
      ui.leaderboardList.innerHTML = '<div class="leaderboard-empty muted">No scores yet.</div>';
      return;
    }
    
    lb.slice(0, 10).forEach((entry: LeaderboardEntry, i: number) => {
      const el = document.createElement('div');
      el.className = 'leaderboard-slot';
      el.innerHTML = `
        <div class="leaderboard-slot-head">
          <div style="display:flex;gap:8px;align-items:center;">
             <span class="rank">#${i+1}</span>
             <span class="leaderboard-kind ${entry.kind}">${entry.kind.toUpperCase()}</span>
          </div>
          <span class="score">${entry.score}</span>
        </div>
        <div class="leaderboard-main">
          <div>
            <div class="name">${entry.name}</div>
            <div class="message">${entry.message || ''}</div>
          </div>
          <div class="leaderboard-actions">
            ${entry.replayDigest ? `<button class="btn tiny play-replay-btn" data-kind="${entry.kind}" data-id="${entry.id}">Replay</button>` : ''}
          </div>
        </div>
      `;
      ui.leaderboardList.appendChild(el);
    });
    
    document.querySelectorAll('.play-replay-btn').forEach(btn => {
      btn.addEventListener('click', async (_e: Event) => {
        if (!gameSceneInstance) return;
        ui.leaderboardStatus.textContent = 'Loading replay...';
        (btn as HTMLButtonElement).disabled = true;
        try {
          const run = await fetchReplay((btn as HTMLElement).dataset.kind as string, (btn as HTMLElement).dataset.id as string);
          if (run && run.events) {
            gameSceneInstance.startRun(run.seed, run.events);
            ui.leaderboardStatus.textContent = 'Playing replay!';
          }
        } catch (err: any) {
          ui.leaderboardStatus.textContent = `Error: ${err.message}`;
        } finally {
          (btn as HTMLButtonElement).disabled = false;
        }
      });
    });
    ui.leaderboardStatus.textContent = 'Loaded.';
  } catch (err: any) {
    ui.leaderboardStatus.textContent = `Failed to load leaderboard.`;
  }
}

ui.reloadLeaderboard.addEventListener('click', refreshLeaderboard);
ui.stopReplayBtn.addEventListener('click', () => {
    if (gameSceneInstance && gameSceneInstance.runMode === 'REPLAY') {
       gameSceneInstance.finishRun('STOPPED');
    }
});
refreshLeaderboard();
