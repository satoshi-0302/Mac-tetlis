import Phaser from 'phaser';
import './style.css';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { GAME_VERSION, SCREEN_HEIGHT, SCREEN_WIDTH } from './game/constants';
import { fetchLeaderboard, submitScore, type LeaderboardEntry, type LeaderboardSnapshot } from './net/api';

type RouteMode = 'mobile' | 'desktop' | 'auto';
type SceneState = 'ready' | 'playing' | 'gameover';

function getRouteMode(): RouteMode {
  const modeParam = new URLSearchParams(window.location.search).get('mode');
  if (modeParam === 'mobile') return 'mobile';
  if (modeParam === 'desktop') return 'desktop';
  return 'auto';
}

function sanitizeName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

function sanitizeMessage(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

function normalizeEntries(snapshot: LeaderboardSnapshot): LeaderboardEntry[] {
  const source = Array.isArray(snapshot.combinedEntries)
    ? snapshot.combinedEntries
    : Array.isArray(snapshot.entries)
      ? snapshot.entries
      : Array.isArray(snapshot.leaderboard)
        ? snapshot.leaderboard
        : [];

  return source
    .map((entry) => ({
      id: String(entry.id ?? ''),
      kind: String(entry.kind ?? 'human'),
      name: String(entry.name ?? 'PLAYER'),
      message: String(entry.message ?? ''),
      score: Number(entry.score ?? 0),
      createdAt: entry.createdAt,
      replayAvailable: Boolean(entry.replayAvailable),
      gameVersion: entry.gameVersion
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .slice(0, 10);
}

function createLeaderboardCell(entry: LeaderboardEntry | null, rank: number): HTMLElement {
  const cell = document.createElement('section');
  cell.className = `leaderboard-slot${entry ? '' : ' empty'}`;
  const title = document.createElement('div');
  title.className = 'leaderboard-slot-head';
  title.innerHTML = `<span class="rank">#${rank}</span>${entry ? `<span class="score">${entry.score}</span>` : ''}`;
  cell.append(title);

  if (!entry) {
    const empty = document.createElement('div');
    empty.className = 'leaderboard-empty';
    empty.textContent = '---';
    cell.append(empty);
    return cell;
  }

  const main = document.createElement('div');
  main.className = 'leaderboard-main';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = entry.name;
  const message = document.createElement('span');
  message.className = 'message';
  message.textContent = entry.message || 'NO COMMENT';
  main.append(name, message);
  cell.append(main);
  return cell;
}

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) {
  throw new Error('Missing #app root');
}

const routeMode = getRouteMode();
const prefersTouch =
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const compactRoute = routeMode === 'mobile' || (routeMode === 'auto' && prefersTouch);
document.body.dataset.routeMode = compactRoute ? 'mobile' : 'desktop';

app.innerHTML = `
  <div class="route-bar">
    <a class="btn tiny nav-button" href="/">LOBBY</a>
    <button id="mobileStartButton" class="btn tiny ${compactRoute ? '' : 'hidden'}" type="button">START</button>
    <span class="route-pill">${compactRoute ? 'SMARTPHONE' : 'DESKTOP'}</span>
  </div>
  <div class="layout">
    <section class="game-column">
      <div id="phaser-root" class="phaser-root"></div>
      <p id="runtimeStatus" class="runtime-status">TAP OR SPACE TO START</p>
      <p class="mobile-quick-help ${compactRoute ? '' : 'hidden'}">
        タップで羽ばたき。ゲームオーバー後は再タップで再開できます。
      </p>
    </section>
    <aside class="side-column">
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
          <label>
            Name (max 12)
            <input id="nameInput" name="name" maxlength="12" required autocomplete="nickname" placeholder="ACE" />
          </label>
          <label>
            Comment (max 20)
            <input id="messageInput" name="message" maxlength="20" autocomplete="off" placeholder="clean run" />
          </label>
          <button id="submitButton" class="btn" type="submit">Submit Score</button>
        </form>
        <p id="submitStatus" class="muted small"></p>
      </section>
    </aside>
  </div>
`;

const runtimeStatus = document.querySelector('#runtimeStatus');
const mobileStartButton = document.querySelector('#mobileStartButton');
const leaderboardList = document.querySelector('#leaderboardList');
const leaderboardStatus = document.querySelector('#leaderboardStatus');
const reloadLeaderboardButton = document.querySelector('#reloadLeaderboard');
const resultPanel = document.querySelector('#resultPanel');
const resultStats = document.querySelector('#resultStats');
const submitForm = document.querySelector('#submitForm');
const submitButton = document.querySelector('#submitButton');
const submitStatus = document.querySelector('#submitStatus');
const nameInput = document.querySelector('#nameInput');
const messageInput = document.querySelector('#messageInput');

if (
  !(runtimeStatus instanceof HTMLElement) ||
  !(mobileStartButton instanceof HTMLButtonElement) ||
  !(leaderboardList instanceof HTMLElement) ||
  !(leaderboardStatus instanceof HTMLElement) ||
  !(reloadLeaderboardButton instanceof HTMLButtonElement) ||
  !(resultPanel instanceof HTMLElement) ||
  !(resultStats instanceof HTMLElement) ||
  !(submitForm instanceof HTMLFormElement) ||
  !(submitButton instanceof HTMLButtonElement) ||
  !(submitStatus instanceof HTMLElement) ||
  !(nameInput instanceof HTMLInputElement) ||
  !(messageInput instanceof HTMLInputElement)
) {
  throw new Error('Failed to initialize UI nodes');
}

const runtimeStatusEl = runtimeStatus;
const mobileStartButtonEl = mobileStartButton;
const leaderboardListEl = leaderboardList;
const leaderboardStatusEl = leaderboardStatus;
const reloadLeaderboardButtonEl = reloadLeaderboardButton;
const resultPanelEl = resultPanel;
const resultStatsEl = resultStats;
const submitFormEl = submitForm;
const submitButtonEl = submitButton;
const submitStatusEl = submitStatus;
const nameInputEl = nameInput;
const messageInputEl = messageInput;

const NAME_STORAGE_KEY = 'chick-flap-player-name';
nameInputEl.value = localStorage.getItem(NAME_STORAGE_KEY) ?? '';

let latestScore = 0;
let bestScore = 0;
let sceneState: SceneState = 'ready';

function syncMobileStartButton(): void {
  const shouldShow = compactRoute && (sceneState === 'ready' || sceneState === 'gameover');
  mobileStartButtonEl.classList.toggle('hidden', !shouldShow);
  mobileStartButtonEl.textContent = sceneState === 'gameover' ? 'PLAY AGAIN' : 'START';
}

function updateRuntimeStatus(): void {
  if (sceneState === 'ready') {
    runtimeStatusEl.textContent = 'TAP OR SPACE TO START';
    return;
  }
  if (sceneState === 'playing') {
    runtimeStatusEl.textContent = `SCORE ${latestScore} / BEST ${bestScore}`;
    return;
  }
  runtimeStatusEl.textContent = `GAME OVER | SCORE ${latestScore} | TAP TO RESTART`;
}

function renderLeaderboard(snapshot: LeaderboardSnapshot): void {
  const entries = normalizeEntries(snapshot);
  leaderboardListEl.innerHTML = '';
  for (let i = 0; i < 10; i += 1) {
    leaderboardListEl.append(createLeaderboardCell(entries[i] ?? null, i + 1));
  }
  leaderboardStatusEl.textContent =
    entries.length > 0 ? '最新ランキングを表示しています。' : 'まだ記録がありません。最初の1位を狙えます。';
}

async function loadLeaderboard(): Promise<void> {
  leaderboardStatusEl.textContent = 'Loading leaderboard...';
  try {
    const snapshot = await fetchLeaderboard();
    renderLeaderboard(snapshot);
  } catch (error) {
    leaderboardStatusEl.textContent = `Leaderboard error: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

function showResultPanel(): void {
  resultStatsEl.innerHTML = `
    <div><span>Score</span><strong>${latestScore}</strong></div>
    <div><span>Best</span><strong>${bestScore}</strong></div>
    <div><span>Version</span><strong>${GAME_VERSION}</strong></div>
  `;
  resultPanelEl.classList.remove('hidden');
  submitButtonEl.disabled = latestScore <= 0;
  submitStatusEl.textContent = latestScore > 0 ? '名前を入力して送信できます。' : 'スコア0は送信できません。';
}

function requestScenePress(game: Phaser.Game): void {
  const scene = game.scene.getScene('game');
  if (scene instanceof GameScene) {
    scene.requestPress();
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser-root',
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  backgroundColor: '#070b1f',
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scene: [BootScene, GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

game.events.on('chick-flap:score', (payload: unknown) => {
  const data = payload as { score?: number; bestScore?: number };
  latestScore = Number(data.score ?? latestScore);
  bestScore = Number(data.bestScore ?? bestScore);
  if (sceneState === 'playing') {
    updateRuntimeStatus();
  }
});

game.events.on('chick-flap:state', (payload: unknown) => {
  const data = payload as { state?: SceneState };
  sceneState = data.state ?? sceneState;
  if (sceneState !== 'gameover') {
    resultPanelEl.classList.add('hidden');
    submitStatusEl.textContent = '';
  }
  updateRuntimeStatus();
  syncMobileStartButton();
});

game.events.on('chick-flap:gameover', () => {
  showResultPanel();
  updateRuntimeStatus();
  syncMobileStartButton();
});

mobileStartButtonEl.addEventListener('click', () => requestScenePress(game));
reloadLeaderboardButtonEl.addEventListener('click', () => {
  void loadLeaderboard();
});

submitFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  if (latestScore <= 0) {
    submitStatusEl.textContent = 'スコア0は送信できません。';
    return;
  }

  const name = sanitizeName(nameInputEl.value || 'PLAYER');
  if (!name) {
    submitStatusEl.textContent = '名前を入力してください。';
    return;
  }
  const message = sanitizeMessage(messageInputEl.value || 'NO COMMENT');
  nameInputEl.value = name;
  messageInputEl.value = message;

  submitButtonEl.disabled = true;
  submitStatusEl.textContent = 'Submitting...';
  void submitScore({
    name,
    message,
    score: latestScore,
    gameVersion: GAME_VERSION
  })
    .then(() => {
      localStorage.setItem(NAME_STORAGE_KEY, name);
      submitStatusEl.textContent = '送信完了。ランキングを更新しました。';
      return loadLeaderboard();
    })
    .catch((error: unknown) => {
      submitStatusEl.textContent = `Submit error: ${error instanceof Error ? error.message : 'unknown error'}`;
    })
    .finally(() => {
      submitButtonEl.disabled = sceneState !== 'gameover' || latestScore <= 0;
    });
});

updateRuntimeStatus();
syncMobileStartButton();
void loadLeaderboard();
