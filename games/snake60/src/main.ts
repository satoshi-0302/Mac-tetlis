import Phaser from 'phaser';
import '../style.css';
import { synth } from './audio';

type DirectionCode = 'U' | 'D' | 'L' | 'R';
type TurnSide = 'left' | 'right';
type GameState = 'TITLE' | 'PLAYING' | 'GAMEOVER' | 'SUBMITTING' | 'REPLAY' | 'REPLAY_OVER';
type Vec = { x: number; y: number };
type ScoreEntry = {
  id?: string;
  replayId?: string;
  replayAvailable?: boolean;
  name: string;
  score: number;
  message: string;
};
type ReplayPayload = {
  version: string;
  tickRate: number;
  minStraightMoves: number;
  directions: string;
};
type ReplayPlayback = {
  entry: ScoreEntry;
  directions: string;
  tickIndex: number;
};
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
};
type DeadBodyPart = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vRot: number;
  color: string;
};

const GRID_SIZE = 20;
const INITIAL_SPEED = 120;
const SPEED_INC = 2;
const START_TIME = 60;
const HUMAN_MIN_STRAIGHT_MOVES = 0;
const REPLAY_VERSION = 'snake60-replay-v2';
const REPLAY_TICK_RATE = 60;
const REPLAY_TICK_MS = 1000 / REPLAY_TICK_RATE;
const MAX_REPLAY_TICKS = START_TIME * REPLAY_TICK_RATE;
const COLOR_BG = '#050505';
const COLOR_SNAKE = '#00f3ff';
const COLOR_APPLE = '#39ff14';
const DIRECTION_VECTORS: Record<DirectionCode, Vec> = {
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 }
};

function queryRequired<T extends Element>(id: string, guard: (el: Element | null) => el is T): T {
  const el = document.getElementById(id);
  if (!guard(el)) {
    throw new Error(`Snake60 bootstrap failed: #${id}`);
  }
  return el;
}

const canvas = queryRequired('gameCanvas', (el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
const gameContainer = queryRequired('game-container', (el): el is HTMLElement => el instanceof HTMLElement);
const uiLayer = queryRequired('ui-layer', (el): el is HTMLElement => el instanceof HTMLElement);
const titleScreen = queryRequired('title-screen', (el): el is HTMLElement => el instanceof HTMLElement);
const gameoverScreen = queryRequired('gameover-screen', (el): el is HTMLElement => el instanceof HTMLElement);
const gameOverTitle = queryRequired('gameover-title', (el): el is HTMLElement => el instanceof HTMLElement);
const currentScoreEl = queryRequired('current-score', (el): el is HTMLElement => el instanceof HTMLElement);
const timeLeftEl = queryRequired('time-left', (el): el is HTMLElement => el instanceof HTMLElement);
const highScoreHUD = queryRequired('high-score', (el): el is HTMLElement => el instanceof HTMLElement);
const finalScoreEl = queryRequired('final-score', (el): el is HTMLElement => el instanceof HTMLElement);
const leaderboardList = queryRequired('leaderboard-list', (el): el is HTMLUListElement => el instanceof HTMLUListElement);
const hsEntryForm = queryRequired('highscore-entry', (el): el is HTMLElement => el instanceof HTMLElement);
const hsNameInput = queryRequired('hs-name', (el): el is HTMLInputElement => el instanceof HTMLInputElement);
const hsMsgInput = queryRequired('hs-message', (el): el is HTMLInputElement => el instanceof HTMLInputElement);
const hsSubmitBtn = queryRequired('hs-submit', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
const restartPrompt = queryRequired('restart-prompt', (el): el is HTMLElement => el instanceof HTMLElement);
const replayExitBtn = queryRequired('replay-exit', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
const modeBanner = queryRequired('mode-banner', (el): el is HTMLElement => el instanceof HTMLElement);
const mobileControls = queryRequired('mobile-controls', (el): el is HTMLElement => el instanceof HTMLElement);
const playButton = queryRequired('play-button', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
const touchRestartButton = queryRequired('touch-restart-button', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement);

const routeModeParam = new URLSearchParams(window.location.search).get('mode');
const hasCoarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const isMobileRoute = routeModeParam === 'mobile' || (routeModeParam !== 'desktop' && hasCoarsePointer);
document.body.dataset.routeMode = isMobileRoute ? 'mobile' : 'desktop';

function normalizeBasePath(path: string) {
  if (!path) return '/';
  return path.endsWith('/') ? path : `${path}/`;
}

const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);
const APP_BASE_URL = new URL(APP_BASE_PATH, window.location.origin);
const PLATFORM_BASE_URL = new URL('../..', APP_BASE_URL);

function resolvePlatformHref(path = '') {
  return new URL(path.replace(/^\//, ''), PLATFORM_BASE_URL).pathname;
}

function resolveApiUrl(path: string) {
  return new URL(path.replace(/^\//, ''), PLATFORM_BASE_URL).toString();
}

const TILE_COUNT_X = canvas.width / GRID_SIZE;
const TILE_COUNT_Y = canvas.height / GRID_SIZE;

let ctx: CanvasRenderingContext2D;
let snake: Vec[] = [];
let velocity: Vec = { x: 1, y: 0 };
let lastInput: Vec = { x: 1, y: 0 };
let apples: Vec[] = [];
let deadBodyParts: DeadBodyPart[] = [];
let particles: Particle[] = [];
let score = 0;
let highScore = Number(localStorage.getItem('websnake_highscore') || 0);
let speed = INITIAL_SPEED;
let timeLeft = START_TIME;
let gameSeed = 12345;
let topScores: ScoreEntry[] = [];
let currentGameState: GameState = 'TITLE';
let inputQueue: DirectionCode[] = [];
let recordedDirections: DirectionCode[] = [];
let replayPlayback: ReplayPlayback | null = null;
let simulationAccumulator = 0;
let moveAccumulator = 0;
let frameTickCount = 0;
let straightMovesSinceTurn = 0;
let activeMinStraightMoves = HUMAN_MIN_STRAIGHT_MOVES;
let loadingReplay = false;

function setupPlatformSwitcher() {
  const params = new URLSearchParams(window.location.search);
  const link = document.getElementById('platform-switch-link') as HTMLAnchorElement | null;
  if (!link) return;
  if (isMobileRoute) {
    link.textContent = 'PC版で遊ぶ';
    params.set('mode', 'desktop');
  } else {
    link.textContent = 'スマホ版で遊ぶ';
    params.set('mode', 'mobile');
  }
  const nextUrl = new URL(window.location.href);
  nextUrl.search = params.toString();
  link.href = nextUrl.toString();
}

function seededRandom() {
  let t = (gameSeed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function directionCodeFromVector(v: Vec): DirectionCode {
  if (v.x === 0 && v.y === -1) return 'U';
  if (v.x === 0 && v.y === 1) return 'D';
  if (v.x === -1 && v.y === 0) return 'L';
  return 'R';
}

function rotateDirectionCode(baseCode: DirectionCode, turnSide: TurnSide): DirectionCode {
  const leftTurns: Record<DirectionCode, DirectionCode> = { U: 'L', L: 'D', D: 'R', R: 'U' };
  const rightTurns: Record<DirectionCode, DirectionCode> = { U: 'R', R: 'D', D: 'L', L: 'U' };
  if (turnSide === 'left') return leftTurns[baseCode];
  return rightTurns[baseCode];
}

function sanitizeName(value: string) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 12);
  return cleaned || 'ANON';
}

function sanitizeMessage(value: string) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 20);
}

function setModeBanner(text: string) {
  if (!text) {
    modeBanner.textContent = '';
    modeBanner.classList.add('hidden');
    return;
  }
  modeBanner.textContent = text;
  modeBanner.classList.remove('hidden');
}

function formatTurnModeLabel(minStraightMoves: number) {
  return minStraightMoves > 0 ? `LOCK ${minStraightMoves}` : 'FREE TURN';
}

function setReplayControlsVisible(visible: boolean) {
  replayExitBtn.classList.toggle('hidden', !visible);
}

function resetCoreState() {
  snake = [
    { x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 },
    { x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }
  ];
  velocity = { x: 1, y: 0 };
  lastInput = { x: 1, y: 0 };
  apples = [];
  deadBodyParts = [];
  particles = [];
  score = 0;
  speed = INITIAL_SPEED;
  timeLeft = START_TIME;
  gameSeed = 12345;
  simulationAccumulator = 0;
  moveAccumulator = 0;
  frameTickCount = 0;
  straightMovesSinceTurn = 0;
  inputQueue = [];
  activeMinStraightMoves = HUMAN_MIN_STRAIGHT_MOVES;
  currentScoreEl.innerText = String(score);
  timeLeftEl.innerText = String(timeLeft);
  timeLeftEl.classList.remove('time-warning');
  gameContainer.classList.remove('shake', 'shake-heavy');
  placeApples();
}

function hideAllOverlays() {
  uiLayer.classList.remove('active');
  titleScreen.classList.remove('active');
  gameoverScreen.classList.remove('active');
  gameoverScreen.classList.add('hidden');
  hsEntryForm.classList.add('hidden');
}

function startGame() {
  synth.init();
  resetCoreState();
  hideAllOverlays();
  restartPrompt.classList.remove('hidden');
  restartPrompt.innerText = 'PRESS [SPACE] TO REBOOT';
  playButton.classList.add('hidden');
  touchRestartButton.classList.add('hidden');
  recordedDirections = [];
  replayPlayback = null;
  currentGameState = 'PLAYING';
  setModeBanner('FREE TURN');
  setReplayControlsVisible(false);
  synth.startBGM();
}

function applyDirectionCode(code: DirectionCode) {
  const next = DIRECTION_VECTORS[code];
  if (lastInput.x === -next.x && lastInput.y === -next.y) return;
  const sameDirection = velocity.x === next.x && velocity.y === next.y;
  if (!sameDirection && straightMovesSinceTurn < activeMinStraightMoves) return;
  velocity = { ...next };
  if (!sameDirection) straightMovesSinceTurn = 0;
}

function queueDirectionForGameplay(key: string) {
  let code: DirectionCode | null = null;
  if (key === 'ArrowUp' || key === 'w' || key === 'W') code = 'U';
  if (key === 'ArrowDown' || key === 's' || key === 'S') code = 'D';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') code = 'L';
  if (key === 'ArrowRight' || key === 'd' || key === 'D') code = 'R';
  if (!code) return;
  const lastQueued = inputQueue[inputQueue.length - 1] || directionCodeFromVector(velocity);
  if (code === lastQueued) return;
  inputQueue.push(code);
  if (inputQueue.length > 2) inputQueue.shift();
}

function queueRelativeTurn(turnSide: TurnSide) {
  const baseCode = inputQueue[inputQueue.length - 1] || directionCodeFromVector(velocity);
  const nextCode = rotateDirectionCode(baseCode, turnSide);
  if (nextCode === baseCode) return;
  inputQueue.push(nextCode);
  if (inputQueue.length > 2) inputQueue.shift();
}

function bindMobileControls() {
  mobileControls.classList.toggle('hidden', !isMobileRoute);
  touchRestartButton.classList.toggle('hidden', !isMobileRoute);

  const triggerTouchTurn = (turnSide: string) => {
    if (currentGameState === 'TITLE') {
      startGame();
      return;
    }
    if (currentGameState === 'PLAYING' && (turnSide === 'left' || turnSide === 'right')) {
      queueRelativeTurn(turnSide);
      return;
    }
    if (currentGameState === 'GAMEOVER' || currentGameState === 'REPLAY_OVER' || currentGameState === 'REPLAY') {
      returnToTitle();
    }
  };

  mobileControls.querySelectorAll<HTMLButtonElement>('[data-touch-turn]').forEach((button) => {
    const turnSide = String(button.getAttribute('data-touch-turn') || '').trim();
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      triggerTouchTurn(turnSide);
    });
  });

  playButton.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (currentGameState === 'TITLE') startGame();
  });
  touchRestartButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (currentGameState === 'GAMEOVER' || currentGameState === 'REPLAY_OVER' || currentGameState === 'REPLAY') {
      returnToTitle();
    }
  });
}

function playRunEndEffects() {
  const head = snake[0];
  if (head) spawnParticles(head.x, head.y, '#ffffff', 50);
  deadBodyParts = snake.map((segment, index) => {
    const angle = Math.random() * Math.PI * 2;
    const force = Math.random() * 8 + 2;
    return {
      x: segment.x * GRID_SIZE,
      y: segment.y * GRID_SIZE,
      vx: Math.cos(angle) * force,
      vy: Math.sin(angle) * force,
      rotation: 0,
      vRot: (Math.random() - 0.5) * 0.5,
      color: index === 0 ? '#ffffff' : COLOR_SNAKE
    };
  });
  snake = [];
  apples = [];
  gameContainer.classList.remove('shake');
  void gameContainer.offsetWidth;
  gameContainer.classList.add('shake-heavy');
}

function qualifiesForTop10(value: number) {
  if (topScores.length < 10) return true;
  return value >= Number(topScores[topScores.length - 1]?.score || 0);
}

function finishRun() {
  const isReplay = currentGameState === 'REPLAY';
  currentGameState = isReplay ? 'REPLAY_OVER' : 'GAMEOVER';
  synth.stopBGM();
  synth.playGameOverSound();
  playRunEndEffects();

  if (!isReplay && score > highScore) {
    highScore = score;
    localStorage.setItem('websnake_highscore', String(highScore));
    highScoreHUD.innerText = String(highScore);
  }

  setReplayControlsVisible(false);
  setModeBanner(isReplay ? 'REPLAY COMPLETE' : '');
  const shouldSubmit = !isReplay && score > 0 && qualifiesForTop10(score);
  window.setTimeout(() => {
    finalScoreEl.innerText = String(score);
    gameOverTitle.innerText = isReplay ? 'REPLAY COMPLETE' : 'SYSTEM FAILURE';
    restartPrompt.classList.remove('hidden');
    restartPrompt.innerText = isReplay ? 'PRESS [SPACE] TO RETURN' : 'PRESS [SPACE] TO REBOOT';
    uiLayer.classList.add('active');
    gameoverScreen.classList.remove('hidden');
    gameoverScreen.classList.add('active');

    if (shouldSubmit) {
      currentGameState = 'SUBMITTING';
      hsEntryForm.classList.remove('hidden');
      restartPrompt.classList.add('hidden');
      touchRestartButton.classList.add('hidden');
      hsNameInput.value = '';
      hsMsgInput.value = '';
      hsNameInput.focus();
    } else {
      hsEntryForm.classList.add('hidden');
      touchRestartButton.classList.remove('hidden');
    }
  }, 800);
}

function returnToTitle() {
  synth.stopBGM();
  currentGameState = 'TITLE';
  replayPlayback = null;
  recordedDirections = [];
  inputQueue = [];
  loadingReplay = false;
  setModeBanner('');
  setReplayControlsVisible(false);
  hsSubmitBtn.innerText = 'SUBMIT TO NETWORK';
  hsSubmitBtn.disabled = false;
  gameOverTitle.innerText = 'SYSTEM FAILURE';
  restartPrompt.innerText = 'PRESS [SPACE] TO REBOOT';
  uiLayer.classList.add('active');
  titleScreen.classList.add('active');
  gameoverScreen.classList.remove('active');
  gameoverScreen.classList.add('hidden');
  hsEntryForm.classList.add('hidden');
  touchRestartButton.classList.add('hidden');
  playButton.classList.remove('hidden');
}

async function fetchScores() {
  try {
    const res = await fetch(resolveApiUrl('api/scores'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    topScores = await res.json() as ScoreEntry[];
    renderLeaderboard();
    if (topScores.length > 0) {
      const top = topScores[0];
      highScore = Number(top.score || 0);
      highScoreHUD.innerText = String(highScore);
      const netVal = document.getElementById('network-high-score-value');
      const netName = document.getElementById('network-high-score-name');
      if (netVal) netVal.innerText = highScore.toLocaleString();
      if (netName) netName.innerText = sanitizeName(top.name);
    }
  } catch (error) {
    console.error('Failed to fetch scores', error);
    leaderboardList.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'Leaderboard unavailable.';
    leaderboardList.appendChild(li);
  }
}

async function fetchReplay(replayId: string) {
  const replayPath = `api/replays/${encodeURIComponent(String(replayId || ''))}`;
  const res = await fetch(resolveApiUrl(replayPath));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as ReplayPayload;
}

function buildReplayPayload() {
  if (recordedDirections.length === 0 || recordedDirections.length > MAX_REPLAY_TICKS) {
    return null;
  }
  return {
    version: REPLAY_VERSION,
    tickRate: REPLAY_TICK_RATE,
    minStraightMoves: activeMinStraightMoves,
    directions: recordedDirections.join('')
  };
}

async function submitScore(name: string, message: string) {
  const replay = buildReplayPayload();
  if (!replay) return false;
  const normalizedMessage = sanitizeMessage(message) || 'NO COMMENT';
  try {
    const res = await fetch(resolveApiUrl('api/scores'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message: normalizedMessage, replay })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json() as { scores?: ScoreEntry[] };
    topScores = Array.isArray(payload.scores) ? payload.scores : [];
    renderLeaderboard();
    if (topScores.length > 0) {
      highScore = Number(topScores[0].score || 0);
      highScoreHUD.innerText = String(highScore);
    }
    return true;
  } catch (error) {
    console.error('Failed to submit score', error);
    return false;
  } finally {
    if (currentGameState === 'SUBMITTING') {
      hsSubmitBtn.innerText = 'SUBMIT TO NETWORK';
      hsSubmitBtn.disabled = false;
    }
  }
}

function renderLeaderboard() {
  leaderboardList.innerHTML = '';
  if (topScores.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No scores for current rule yet.';
    leaderboardList.appendChild(li);
    return;
  }

  topScores.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = `lb-row ${index === 0 ? 'highlight' : ''}`;
    const rank = document.createElement('span');
    rank.textContent = `#${index + 1}`;
    const name = document.createElement('span');
    name.textContent = sanitizeName(entry.name);
    const scoreValue = document.createElement('span');
    scoreValue.textContent = String(Number(entry.score) || 0);
    const message = document.createElement('span');
    message.textContent = sanitizeMessage(entry.message);
    const action = document.createElement('span');
    action.className = 'lb-action';
    if (entry.replayAvailable && entry.replayId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'replay-button';
      button.textContent = 'REPLAY';
      button.addEventListener('click', () => void startReplayFromEntry(entry));
      action.appendChild(button);
    } else {
      action.textContent = '--';
    }
    li.append(rank, name, scoreValue, message, action);
    leaderboardList.appendChild(li);
  });
}

async function startReplayFromEntry(entry: ScoreEntry) {
  if (loadingReplay) return;
  loadingReplay = true;
  setModeBanner('LOADING REPLAY');
  setReplayControlsVisible(false);
  try {
    const replay = await fetchReplay(entry.replayId || entry.id || '');
    if (!replay?.directions) throw new Error('Replay payload is empty');
    synth.init();
    resetCoreState();
    hideAllOverlays();
    activeMinStraightMoves = Math.max(0, Number(replay.minStraightMoves ?? 0));
    replayPlayback = {
      entry,
      directions: String(replay.directions),
      tickIndex: 0
    };
    recordedDirections = [];
    inputQueue = [];
    currentGameState = 'REPLAY';
    setModeBanner(`REPLAY: ${sanitizeName(entry.name)} / ${formatTurnModeLabel(activeMinStraightMoves)}`);
    setReplayControlsVisible(true);
    synth.startBGM();
  } catch (error) {
    console.error('Failed to load replay', error);
    returnToTitle();
  } finally {
    loadingReplay = false;
  }
}

function placeApples() {
  const targetAppleCount = 5 + Math.floor(score / 10);
  while (apples.length < targetAppleCount) {
    let valid = false;
    const newApple = { x: 0, y: 0 };
    while (!valid) {
      newApple.x = Math.floor(seededRandom() * TILE_COUNT_X);
      newApple.y = Math.floor(seededRandom() * TILE_COUNT_Y);
      valid = true;
      for (const segment of snake) {
        if (segment.x === newApple.x && segment.y === newApple.y) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      for (const apple of apples) {
        if (apple.x === newApple.x && apple.y === newApple.y) {
          valid = false;
          break;
        }
      }
    }
    apples.push({ ...newApple });
  }
}

function triggerScreenShake() {
  gameContainer.classList.remove('shake');
  void gameContainer.offsetWidth;
  gameContainer.classList.add('shake');
}

function spawnParticles(x: number, y: number, color: string, amount = 15) {
  for (let i = 0; i < amount; i += 1) {
    particles.push({
      x: x * GRID_SIZE + GRID_SIZE / 2,
      y: y * GRID_SIZE + GRID_SIZE / 2,
      vx: (Math.random() - 0.5) * 15,
      vy: (Math.random() - 0.5) * 15,
      life: 1,
      decay: 0.02 + Math.random() * 0.03,
      color
    });
  }
}

function updateParticles() {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.life -= particle.decay;
    if (particle.life <= 0) {
      particles.splice(index, 1);
    }
  }
}

function drawParticles() {
  for (const particle of particles) {
    ctx.globalAlpha = particle.life;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 3 * particle.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 10;
    ctx.shadowColor = particle.color;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function updateLogic() {
  lastInput = { ...velocity };
  const newHead = { x: snake[0].x + velocity.x, y: snake[0].y + velocity.y };
  if (newHead.x < 0) newHead.x = TILE_COUNT_X - 1;
  if (newHead.x >= TILE_COUNT_X) newHead.x = 0;
  if (newHead.y < 0) newHead.y = TILE_COUNT_Y - 1;
  if (newHead.y >= TILE_COUNT_Y) newHead.y = 0;

  for (const segment of snake) {
    if (segment.x === newHead.x && segment.y === newHead.y) {
      finishRun();
      return;
    }
  }

  snake.unshift(newHead);
  let ateApple = false;
  for (let index = 0; index < apples.length; index += 1) {
    if (newHead.x === apples[index].x && newHead.y === apples[index].y) {
      ateApple = true;
      score += 10;
      currentScoreEl.innerText = String(score);
      speed = Math.max(30, speed - SPEED_INC);
      synth.playEatSound();
      triggerScreenShake();
      spawnParticles(apples[index].x, apples[index].y, COLOR_APPLE);
      apples.splice(index, 1);
      break;
    }
  }
  if (ateApple) placeApples();
  else snake.pop();
  straightMovesSinceTurn += 1;
  synth.playMoveSound();
}

function updatePhysics() {
  deadBodyParts.forEach((part) => {
    part.x += part.vx;
    part.y += part.vy;
    part.rotation += part.vRot;
    part.vx *= 0.98;
    part.vy *= 0.98;
  });
}

function applyQueuedDirection() {
  while (inputQueue.length > 0) {
    const currentCode = directionCodeFromVector(velocity);
    const nextCode = inputQueue[0];
    applyDirectionCode(nextCode);
    inputQueue.shift();
    if (directionCodeFromVector(velocity) !== currentCode || nextCode === currentCode) {
      return;
    }
  }
}

function advanceRunFrame() {
  frameTickCount += 1;
  if (frameTickCount % REPLAY_TICK_RATE === 0) {
    timeLeft -= 1;
    timeLeftEl.innerText = String(timeLeft);
    if (timeLeft <= 10 && timeLeft > 0) {
      timeLeftEl.classList.add('time-warning');
      triggerScreenShake();
      synth.playMoveSound();
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      timeLeftEl.innerText = '0';
      finishRun();
      return;
    }
  }
  moveAccumulator += REPLAY_TICK_MS;
  if (moveAccumulator >= speed) {
    updateLogic();
    moveAccumulator -= speed;
  }
}

function updateSimulationFrame() {
  if (currentGameState === 'PLAYING') {
    applyQueuedDirection();
    if (recordedDirections.length < MAX_REPLAY_TICKS) {
      recordedDirections.push(directionCodeFromVector(velocity));
    }
    advanceRunFrame();
    updateParticles();
    return;
  }
  if (currentGameState === 'REPLAY') {
    if (!replayPlayback || replayPlayback.tickIndex >= replayPlayback.directions.length) {
      returnToTitle();
      return;
    }
    applyDirectionCode(replayPlayback.directions[replayPlayback.tickIndex] as DirectionCode);
    replayPlayback.tickIndex += 1;
    advanceRunFrame();
    updateParticles();
    return;
  }
  updateParticles();
  if (currentGameState === 'GAMEOVER' || currentGameState === 'REPLAY_OVER' || currentGameState === 'SUBMITTING') {
    updatePhysics();
  }
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawGame(renderTime: number) {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  const pulseFactor = timeLeft <= 10 ? 50 : 150;
  apples.forEach((apple) => {
    ctx.fillStyle = COLOR_APPLE;
    ctx.shadowBlur = (timeLeft <= 10 ? 20 : 15) + Math.sin(renderTime / pulseFactor) * 5;
    ctx.shadowColor = COLOR_APPLE;
    ctx.fillRect(apple.x * GRID_SIZE + 2, apple.y * GRID_SIZE + 2, GRID_SIZE - 4, GRID_SIZE - 4);
    ctx.shadowBlur = 0;
  });

  ctx.fillStyle = COLOR_SNAKE;
  ctx.shadowBlur = timeLeft <= 10 ? 15 : 10;
  ctx.shadowColor = timeLeft <= 10 ? '#ff003c' : COLOR_SNAKE;
  for (let index = 0; index < snake.length; index += 1) {
    const segment = snake[index];
    if (index === 0) {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = timeLeft <= 10 && index % 2 === 0 ? '#ff003c' : COLOR_SNAKE;
      ctx.globalAlpha = 1 - index / (snake.length * 1.5);
    }
    ctx.fillRect(segment.x * GRID_SIZE + 1, segment.y * GRID_SIZE + 1, GRID_SIZE - 2, GRID_SIZE - 2);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  deadBodyParts.forEach((part) => {
    ctx.save();
    ctx.translate(part.x + GRID_SIZE / 2, part.y + GRID_SIZE / 2);
    ctx.rotate(part.rotation);
    ctx.fillStyle = part.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = part.color;
    ctx.fillRect(-GRID_SIZE / 2 + 2, -GRID_SIZE / 2 + 2, GRID_SIZE - 4, GRID_SIZE - 4);
    ctx.restore();
  });
  drawParticles();
}

class SnakeScene extends Phaser.Scene {
  create() {
    const got = this.game.canvas.getContext('2d');
    if (!got) throw new Error('2D context unavailable');
    ctx = got;
    this.events.on(Phaser.Scenes.Events.RENDER, () => {
      drawGame(this.game.loop.time);
    });
  }

  update(_time: number, delta: number) {
    const dt = Math.min(100, delta);
    simulationAccumulator += dt;
    while (simulationAccumulator >= REPLAY_TICK_MS) {
      simulationAccumulator -= REPLAY_TICK_MS;
      updateSimulationFrame();
    }
  }
}

titleScreen.classList.toggle('touch-mode', window.matchMedia?.('(pointer: coarse)').matches ?? false);
setupPlatformSwitcher();
bindMobileControls();
void fetchScores();
highScoreHUD.innerText = String(highScore);

const lobbyLink = document.querySelector<HTMLAnchorElement>('.top-action-button');
if (lobbyLink) {
  lobbyLink.href = resolvePlatformHref();
}

const titleThumbnail = document.querySelector<HTMLImageElement>('.game-title-thumbnail');
if (titleThumbnail) {
  const thumbnailPath = titleThumbnail.dataset.thumbnailPath || 'static/assets/thumbnails/snake60.png';
  titleThumbnail.src = resolvePlatformHref(thumbnailPath);
}

window.addEventListener('keydown', (event) => {
  if (synth.ctx.state === 'suspended') {
    synth.init();
  }
  if (currentGameState === 'TITLE') {
    if (event.code === 'Space') startGame();
    return;
  }
  if (currentGameState === 'GAMEOVER' || currentGameState === 'REPLAY_OVER') {
    if (event.code === 'Space' || event.code === 'Escape') returnToTitle();
    return;
  }
  if (currentGameState === 'SUBMITTING') {
    if (event.code === 'Escape') {
      returnToTitle();
      return;
    }
    if (event.key === 'Enter') hsSubmitBtn.click();
    return;
  }
  if (currentGameState === 'REPLAY') {
    if (event.code === 'Escape' || event.code === 'Space') returnToTitle();
    return;
  }
  if (currentGameState === 'PLAYING') {
    queueDirectionForGameplay(event.key);
  }
});

hsSubmitBtn.addEventListener('click', async () => {
  if (currentGameState !== 'SUBMITTING') return;
  const name = sanitizeName(hsNameInput.value);
  const message = sanitizeMessage(hsMsgInput.value);
  hsSubmitBtn.innerText = 'SENDING...';
  hsSubmitBtn.disabled = true;
  const submitted = await submitScore(name, message);
  if (submitted) returnToTitle();
  else {
    hsSubmitBtn.innerText = 'RETRY SUBMIT';
    hsSubmitBtn.disabled = false;
  }
});

replayExitBtn.addEventListener('click', () => {
  if (currentGameState === 'REPLAY') returnToTitle();
});

new Phaser.Game({
  type: Phaser.CANVAS,
  canvas,
  width: canvas.width,
  height: canvas.height,
  backgroundColor: '#050505',
  clearBeforeRender: false,
  fps: { target: 60, forceSetTimeOut: true },
  scene: [SnakeScene]
});
