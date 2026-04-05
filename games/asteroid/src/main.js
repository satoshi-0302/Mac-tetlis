import './style.css';

import { AudioEngine } from './audio/audio-engine.js';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ASTEROID_TYPES,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_THRUST,
  MAX_TICKS,
  RUN_SECONDS,
  TICK_RATE
} from './engine/constants.js';
import { createFixedLoop } from './engine/fixed-loop.js';
import { InputController } from './engine/input.js';
import { createRng } from './engine/rng.js';
import {
  createInitialState,
  stepSimulation,
  summarizeRun
} from './game/sim-core.js';
import { createSpawnSchedule } from './game/spawn-schedule.js';
import { fetchLeaderboard, fetchReplay, submitScore } from './net/api.js';
import { loadDemoAgent } from './rl/demo-agent.js';
import {
  createReplayBuffer,
  digestReplayBase64,
  digestString,
  encodeReplay
} from './replay/replay.js';
import {
  decodeReplayFrames,
  runHeadlessReplayFromFrames
} from './replay/verify-runner.js';
import { Renderer } from './render/renderer.js';

const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing #app root');
}

const routeModeParam = new URLSearchParams(window.location.search).get('mode');
const routeAutoWatchParam = new URLSearchParams(window.location.search).get('autowatch');
const routeMode = routeModeParam === 'mobile' ? 'mobile' : routeModeParam === 'desktop' ? 'desktop' : 'auto';
const prefersTouch =
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const compactRoute = routeMode === 'mobile' || (routeMode !== 'desktop' && prefersTouch);
const autoWatchEnabled = routeAutoWatchParam === '1';
document.body.dataset.routeMode = compactRoute ? 'mobile' : 'desktop';

app.innerHTML = `
  <div class="route-bar">
    <a class="btn tiny nav-button" href="/">LOBBY</a>
    <button id="mobileStartButton" class="btn tiny ${compactRoute ? '' : 'hidden'}" type="button">START</button>
    <span class="route-pill">${compactRoute ? 'SMARTPHONE' : 'DESKTOP'}</span>
  </div>
  <div class="layout">
    <section class="game-column">
      <div class="canvas-wrap">
        <canvas id="gameCanvas" width="960" height="640" aria-label="Asteroids 60 game canvas"></canvas>
        <div id="gameOverOverlay" class="game-over-overlay" aria-hidden="true">
          <div class="game-over-panel">
            <strong>GAME OVER</strong>
          </div>
        </div>
        <div id="title-screen" class="active">
          <img src="/static/assets/thumbnails/asteroid.png" class="game-title-thumbnail" alt="Asteroid Thumbnail">
          <div class="top-score-display">
            <span class="label">NETWORK HIGH SCORE</span>
            <strong class="score-value" id="net-high-score-total">---</strong>
            <span class="score-name" id="net-high-score-player">---</span>
          </div>
          <button class="play-button" id="title-play-button">PLAY</button>
          <div class="platform-switcher">
            <a href="#" id="platform-switch-link" class="switch-link">---</a>
          </div>
        </div>
      </div>
      <div class="status-bar">
        <span id="runtimeStatus" class="runtime-status">Press Space to start the 60-second run.</span>
        <button id="stopReplayButton" class="btn tiny hidden" type="button">Stop Replay</button>
      </div>
      <p class="mobile-quick-help ${compactRoute ? '' : 'hidden'}">
        左ドラッグで向きと加速、右側タッチ長押しでショットです。未開始時は画面タップで開始できます。
      </p>
    </section>

    <aside class="side-column">
      <section class="panel controls-panel">
        <h1>ASTEROIDS 60</h1>
        <p class="muted">One deterministic 60-second run. Same spawn schedule every time.</p>
        <ul>
          <li>Rotate: <kbd>A</kbd>/<kbd>D</kbd> or <kbd>&larr;</kbd>/<kbd>&rarr;</kbd></li>
          <li>Thrust: <kbd>W</kbd> or <kbd>&uarr;</kbd></li>
          <li>Start / Shoot / Restart: <kbd>Space</kbd></li>
          <li>AI Demo: toggle <kbd>DEMO</kbd> button for auto-play.</li>
          <li>Touch: left drag aim+thrust, right hold shoot.</li>
          <li>Close kill bonus + combo multiplier reward precision.</li>
          <li>Tier3 unlocks at 15s, tier4 at 30s, and the 45s tier5 spike is currently paused.</li>
        </ul>
        <div class="demo-row">
          <button id="demoToggle" class="btn tiny" type="button">DEMO: OFF</button>
          <span id="demoStatus" class="muted small">Demo policy is not loaded yet.</span>
        </div>
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

const canvas = document.querySelector('#gameCanvas');
const gameOverOverlay = document.querySelector('#gameOverOverlay');
const runtimeStatus = document.querySelector('#runtimeStatus');
const stopReplayButton = document.querySelector('#stopReplayButton');
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
const demoToggle = document.querySelector('#demoToggle');
const demoStatus = document.querySelector('#demoStatus');
const mobileStartButton = document.querySelector('#mobileStartButton');

if (
  !(canvas instanceof HTMLCanvasElement) ||
  !(gameOverOverlay instanceof HTMLElement) ||
  !(runtimeStatus instanceof HTMLElement) ||
  !(stopReplayButton instanceof HTMLButtonElement) ||
  !(leaderboardList instanceof HTMLElement) ||
  !(leaderboardStatus instanceof HTMLElement) ||
  !(reloadLeaderboardButton instanceof HTMLButtonElement) ||
  !(resultPanel instanceof HTMLElement) ||
  !(resultStats instanceof HTMLElement) ||
  !(submitForm instanceof HTMLFormElement) ||
  !(submitButton instanceof HTMLButtonElement) ||
  !(submitStatus instanceof HTMLElement) ||
  !(nameInput instanceof HTMLInputElement) ||
  !(messageInput instanceof HTMLInputElement) ||
  !(demoToggle instanceof HTMLButtonElement) ||
  !(demoStatus instanceof HTMLElement) ||
  !(mobileStartButton instanceof HTMLButtonElement)
) {
  throw new Error('Failed to initialize UI nodes');
}

let spawnSchedule = createSpawnSchedule();
const vfxRandom = createRng((Date.now() ^ 0x9e3779b9) >>> 0);
const renderer = new Renderer(canvas, vfxRandom);
const audio = new AudioEngine();
const RUN_DURATION_MS = RUN_SECONDS * 1000;
const TICK_MS = 1000 / TICK_RATE;
const INPUT_MASK = INPUT_LEFT | INPUT_RIGHT | INPUT_THRUST | INPUT_SHOOT;
const POST_FINISH_SETTLE_MS = 1150;
const POST_FINISH_TRIM_MS = 400;
const POST_FINISH_ASTEROID_LIMIT = 5;
const IDLE_UPDATE_INTERVAL_MS = 1000 / 20;
const IDLE_RENDER_INTERVAL_MS = 1000 / 30;
const IDLE_ASTEROID_LIMIT = 5;
const DEMO_RESTART_DELAY_MS = 1200;
const REPLAY_FINISH_HOLD_MS = 1400;
const DEMO_DEATH_LOG_FRAMES = 180;
const EDGE_STAY_MARGIN = 84;
const SPIN_STREAK_THRESHOLD = 18;
const CLEAR_SEQUENCE_SETTLE_MS = 900;
const CLEAR_BARRIER_RADIUS = 92;
const CLEAR_DEMO_ASTEROID_LIMIT = 8;
const CLEAR_DEMO_SPAWN_INTERVAL_MS = 260;
const CLEAR_BANNER_DELAY_MS = 1000;
const CLEAR_TARGET_X = ARENA_WIDTH * 0.5;
const CLEAR_TARGET_Y = ARENA_HEIGHT * 0.5 + 8;
const CLEAR_WARP_DURATION_MS = 900;
const CLEAR_WARP_SPEED = 420;

let state = createInitialState(spawnSchedule);
state.lowPowerIdle = false;
let runStarted = false;
let didFinish = false;
let replayPayload = null;
let replayDigestPromise = null;
let runStartMs = performance.now();
let inputTimeline = [{ t: 0, mask: 0 }];
let activeRunId = 0;
let finishAtMs = 0;
let finishLastMotionMs = 0;
let finishReducedAsteroids = false;
let idlePowerSaveActive = false;
let idleLastUpdateMs = 0;
let idleLastRenderMs = 0;
let replayVerifyWorker = null;
let replayVerifyRequestId = 0;
const replayVerifyPending = new Map();
let demoEnabled = false;
let demoLoadPromise = null;
let demoAgent = null;
let demoRestartAtMs = 0;
let demoRunCount = 0;
let demoBestScore = 0;
let demoDebugOverlay = null;
let leaderboardSnapshot = null;
let replaySession = null;
let replayLoadRequestId = 0;
let autoWatchTriggered = false;
let demoTelemetry = null;
let demoAnalytics = createDemoAnalytics();
let gameOverOverlayTimeoutId = 0;

function setDemoStatus(text) {
  demoStatus.textContent = text;
}

function refreshDemoButton() {
  demoToggle.classList.toggle('active', demoEnabled);
  demoToggle.textContent = demoEnabled ? 'DEMO: ON' : 'DEMO: OFF';
}

function setStopReplayButtonVisible(visible) {
  stopReplayButton.classList.toggle('hidden', !visible);
}

function isLiveRunActive() {
  return runStarted && !didFinish && !replaySession;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createRingBuffer(limit) {
  return {
    limit,
    values: [],
    cursor: 0,
    size: 0
  };
}

function pushRingBuffer(buffer, value) {
  if (buffer.size < buffer.limit) {
    buffer.values.push(value);
    buffer.size += 1;
    buffer.cursor = buffer.size % buffer.limit;
    return;
  }
  buffer.values[buffer.cursor] = value;
  buffer.cursor = (buffer.cursor + 1) % buffer.limit;
}

function readRingBuffer(buffer) {
  if (buffer.size < buffer.limit) {
    return buffer.values.slice();
  }
  const start = buffer.cursor;
  return [...buffer.values.slice(start), ...buffer.values.slice(0, start)];
}

function createDemoAnalytics() {
  return {
    runCount: 0,
    survivalTicks: [],
    scores: [],
    totalFrames: 0,
    edgeFrames: 0,
    spinFrames: 0,
    spinShootFrames: 0,
    predictionDangerFrames: 0,
    highEdgeTrapRiskFrames: 0,
    shieldActiveFrames: 0,
    shieldAppliedFrames: 0,
    shieldBlockedCandidateCount: 0,
    deathCauseCounts: {},
    worstEpisodes: []
  };
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) * 0.5;
  }
  return sorted[mid];
}

function createDemoTelemetry() {
  return {
    frameRing: createRingBuffer(DEMO_DEATH_LOG_FRAMES),
    rotateDir: 0,
    rotateStreak: 0,
    edgeFrames: 0,
    spinFrames: 0,
    spinShootFrames: 0,
    predictionDangerFrames: 0,
    highEdgeTrapRiskFrames: 0,
    shieldActiveFrames: 0,
    shieldAppliedFrames: 0,
    shieldBlockedCandidateCount: 0,
    totalFrames: 0
  };
}

function estimateDeathCauseFromTelemetry(summary, telemetry, stateSnapshot) {
  if (summary.endReason === 'time-up') {
    return 'time-up';
  }
  const lastFrame = readRingBuffer(telemetry.frameRing).slice(-1)[0] ?? null;
  const global = lastFrame?.global ?? null;
  const prediction120 = lastFrame?.prediction120 ?? null;
  if (
    prediction120 &&
    prediction120.edgeTrapRisk >= 0.72 &&
    (prediction120.centerReturnScore ?? 1) < 0.42
  ) {
    return 'edge-trap-collision';
  }
  if (global?.edgeTrapRisk >= 0.72) {
    return 'edge-trap-collision';
  }
  if (global?.minTimeToCollision !== null && Number.isFinite(global?.minTimeToCollision) && global.minTimeToCollision < 0.42) {
    return 'sudden-close-collision';
  }
  if (stateSnapshot.asteroids.length >= 8) {
    return 'overwhelmed-collision';
  }
  return 'collision';
}

function buildDemoMetricsSummary() {
  if (demoAnalytics.runCount === 0) {
    return null;
  }
  const worstSurvivalTicks = percentile(demoAnalytics.survivalTicks, 0.1);
  const medianSurvivalTicks = median(demoAnalytics.survivalTicks);
  const worstScore = percentile(demoAnalytics.scores, 0.1);
  const edgeStayRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.edgeFrames / demoAnalytics.totalFrames : 0;
  const continuousSpinRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.spinFrames / demoAnalytics.totalFrames : 0;
  const continuousSpinShootRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.spinShootFrames / demoAnalytics.totalFrames : 0;
  const predictionDangerRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.predictionDangerFrames / demoAnalytics.totalFrames : 0;
  const highEdgeTrapRiskRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.highEdgeTrapRiskFrames / demoAnalytics.totalFrames : 0;
  const shieldActiveRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.shieldActiveFrames / demoAnalytics.totalFrames : 0;
  const shieldAppliedRatio =
    demoAnalytics.totalFrames > 0 ? demoAnalytics.shieldAppliedFrames / demoAnalytics.totalFrames : 0;

  return {
    runs: demoAnalytics.runCount,
    primary: {
      worst10SurvivalTicks: worstSurvivalTicks,
      medianSurvivalTicks
    },
    secondary: {
      worst10Score: worstScore,
      edgeStayRatio,
      continuousSpinRatio,
      continuousSpinShootRatio,
      predictionDangerRatio,
      highEdgeTrapRiskRatio,
      shieldActiveRatio,
      shieldAppliedRatio,
      shieldBlockedCandidateCount: demoAnalytics.shieldBlockedCandidateCount,
      deathCauseEstimate: { ...demoAnalytics.deathCauseCounts }
    },
    worstEpisodes: demoAnalytics.worstEpisodes.map((episode) => ({
      runIndex: episode.runIndex,
      survivalTicks: episode.survivalTicks,
      score: episode.score,
      deathCause: episode.deathCause,
      frames: episode.frames
    }))
  };
}

function clearSubmissionState({
  hideResultPanel = true,
  disableSubmit = demoEnabled,
  statusText = demoEnabled ? 'Demo mode: score submission disabled.' : ''
} = {}) {
  replayPayload = null;
  replayDigestPromise = null;
  submitButton.disabled = disableSubmit;
  submitStatus.textContent = statusText;
  if (hideResultPanel) {
    resultPanel.classList.add('hidden');
  }
}

function stopReplayPlayback({
  restorePreview = true,
  statusText = 'Replay stopped. Press Space to start the 60-second run.'
} = {}) {
  if (!replaySession) {
    return;
  }

  replaySession = null;
  setStopReplayButtonVisible(false);
  audio.setThruster(false);

  if (restorePreview) {
    prepareStartPreview();
    setRuntimeStatus(statusText);
  }
}

async function ensureDemoAgentLoaded() {
  if (demoAgent) {
    return demoAgent;
  }
  if (demoLoadPromise) {
    return demoLoadPromise;
  }

  setDemoStatus('Loading demo controller...');
  const policyPath = './rl/demo-policy.json';
  demoLoadPromise = loadDemoAgent(policyPath, {
    mode: 'predictive'
  })
    .then((loaded) => {
      demoAgent = loaded.agent;
      if (loaded.mode === 'predictive') {
        setDemoStatus('Predictive controller ready (120-tick survival lookahead).');
      } else {
        const trainedScore = Number(loaded.policy?.best?.score);
        if (Number.isFinite(trainedScore)) {
          setDemoStatus(`AI ready. Trained score: ${trainedScore}.`);
        } else {
          setDemoStatus('AI ready.');
        }
      }
      return demoAgent;
    })
    .catch((error) => {
      setDemoStatus(`Demo load failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw error;
    })
    .finally(() => {
      demoLoadPromise = null;
    });

  return demoLoadPromise;
}

function getRunInputMask({ consumeTransient = true } = {}) {
  if (demoEnabled && demoAgent) {
    const mask = demoAgent.nextMask(state) & INPUT_MASK;
    demoDebugOverlay =
      typeof demoAgent.getDebugOverlay === 'function' ? demoAgent.getDebugOverlay() : null;
    return mask;
  }
  demoDebugOverlay = null;
  return (
    input.getMask({
      shipAngle: state.ship.angle,
      consumeTransient
    }) & INPUT_MASK
  );
}

async function setDemoModeEnabled(enabled) {
  if (enabled === demoEnabled) {
    return;
  }

  if (enabled && isLiveRunActive()) {
    setRuntimeStatus('Current 60-second run is locked. Wait for it to finish before changing demo mode.');
    return;
  }

  if (enabled) {
    if (replaySession) {
      stopReplayPlayback({
        restorePreview: false
      });
    }

    try {
      await ensureDemoAgentLoaded();
    } catch {
      refreshDemoButton();
      return;
    }

    demoEnabled = true;
    demoRunCount = 0;
    demoBestScore = 0;
    demoTelemetry = null;
    demoAnalytics = createDemoAnalytics();
    demoDebugOverlay = null;
    demoRestartAtMs = 0;
    if (typeof input.clearInputState === 'function') {
      input.clearInputState();
    }
    refreshDemoButton();
    clearSubmissionState({
      disableSubmit: true,
      statusText: 'Demo mode: score submission disabled.'
    });
    resetRun();
    startRun();
    setRuntimeStatus('AI demo running...');
    return;
  }

  const demoWasRunning = demoEnabled && runStarted && !didFinish;
  demoEnabled = false;
  demoRestartAtMs = 0;
  demoTelemetry = null;
  demoDebugOverlay = null;
  refreshDemoButton();
  if (typeof input.clearInputState === 'function') {
    input.clearInputState();
  }
  if (demoWasRunning || didFinish || replaySession) {
    resetRun();
    prepareStartPreview();
  } else {
    clearSubmissionState({
      disableSubmit: false,
      statusText: ''
    });
  }
  setDemoStatus('Demo mode off. Press Space to start manual run.');
  setRuntimeStatus('Demo disabled. Press Space to start the 60-second run.');
}

function createReplayVerificationWorker() {
  if (typeof Worker === 'undefined') {
    return null;
  }

  const worker = new Worker(new URL('./replay/verify-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event) => {
    const payload = event.data ?? {};
    const pending = replayVerifyPending.get(payload.requestId);
    if (!pending) {
      return;
    }
    replayVerifyPending.delete(payload.requestId);

    if (!payload.ok) {
      pending.reject(new Error(payload.error ?? 'Replay worker verification failed'));
      return;
    }

    pending.resolve({
      score: payload.score,
      summary: payload.summary,
      replayDigest: payload.replayDigest
    });
  });

  worker.addEventListener('error', (event) => {
    for (const pending of replayVerifyPending.values()) {
      pending.reject(event.error instanceof Error ? event.error : new Error('Replay worker crashed'));
    }
    replayVerifyPending.clear();
    replayVerifyWorker = null;
  });

  return worker;
}

function verifyReplayViaWorker(replayData) {
  if (!replayVerifyWorker) {
    replayVerifyWorker = createReplayVerificationWorker();
  }
  if (!replayVerifyWorker) {
    return Promise.reject(new Error('Worker API unavailable'));
  }

  const requestId = ++replayVerifyRequestId;
  return new Promise((resolve, reject) => {
    replayVerifyPending.set(requestId, { resolve, reject });
    replayVerifyWorker.postMessage({
      requestId,
      replayData,
      seed: 0
    });
  });
}

function setRuntimeStatus(text) {
  runtimeStatus.textContent = text;
}

function setGameOverOverlayVisible(visible) {
  gameOverOverlay.classList.toggle('active', visible);
  gameOverOverlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function clearGameOverOverlaySchedule() {
  if (gameOverOverlayTimeoutId > 0) {
    window.clearTimeout(gameOverOverlayTimeoutId);
    gameOverOverlayTimeoutId = 0;
  }
}

function scheduleGameOverOverlay() {
  clearGameOverOverlaySchedule();
  gameOverOverlayTimeoutId = window.setTimeout(() => {
    gameOverOverlayTimeoutId = 0;
    setGameOverOverlayVisible(true);
  }, 500);
}

function syncMobileStartButton() {
  const shouldShow = compactRoute && !replaySession && (!runStarted || didFinish);
  mobileStartButton.classList.toggle('hidden', !shouldShow);
  mobileStartButton.textContent = didFinish ? 'PLAY AGAIN' : 'START';
}

function sanitizeName(value) {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12);
}

function sanitizeMessage(value) {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function beginRunClock(initialMask = 0) {
  runStartMs = performance.now();
  inputTimeline = [{ t: 0, mask: initialMask & INPUT_MASK }];
}

function recordInputChange(mask, nowMs) {
  const clampedTime = Math.max(0, Math.min(RUN_DURATION_MS, nowMs - runStartMs));
  const cleanedMask = mask & INPUT_MASK;
  const last = inputTimeline[inputTimeline.length - 1];

  if (last && last.mask === cleanedMask) {
    return;
  }

  if (last && Math.abs(last.t - clampedTime) < 0.0001) {
    last.mask = cleanedMask;
    return;
  }

  inputTimeline.push({ t: clampedTime, mask: cleanedMask });
}

function buildReplayFromTimeline() {
  const replay = createReplayBuffer();
  if (inputTimeline.length === 0) {
    return replay;
  }

  let eventIndex = 0;
  let activeMask = inputTimeline[0].mask & INPUT_MASK;

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    const tickTime = tick * TICK_MS;
    while (
      eventIndex + 1 < inputTimeline.length &&
      inputTimeline[eventIndex + 1].t <= tickTime + 0.0001
    ) {
      eventIndex += 1;
      activeMask = inputTimeline[eventIndex].mask & INPUT_MASK;
    }
    replay[tick] = activeMask;
  }

  return replay;
}

function wrapCoord(value, span) {
  const wrapped = value % span;
  return wrapped >= 0 ? wrapped : wrapped + span;
}

function lerp(current, target, factor) {
  return current + (target - current) * factor;
}

function normalizeAngleDelta(angle) {
  const full = Math.PI * 2;
  let value = angle % full;
  if (value > Math.PI) {
    value -= full;
  } else if (value < -Math.PI) {
    value += full;
  }
  return value;
}

function buildIdleAsteroidSet(sourceAsteroids, limit = IDLE_ASTEROID_LIMIT, withFallback = true) {
  const selected = sourceAsteroids
    .filter((asteroid) => asteroid.hitPoints > 0)
    .sort((a, b) => b.radius - a.radius)
    .slice(0, limit)
    .map((asteroid, index) => {
      const heading = Math.atan2(asteroid.vy, asteroid.vx);
      const baseAngle = Number.isFinite(heading) ? heading : index * 1.31;
      const speed = Math.hypot(asteroid.vx, asteroid.vy);
      const idleSpeed = Math.max(24, Math.min(92, speed * 0.34 + 16));
      return {
        id: asteroid.id,
        type: asteroid.type,
        radius: asteroid.radius,
        x: wrapCoord(asteroid.x, ARENA_WIDTH),
        y: wrapCoord(asteroid.y, ARENA_HEIGHT),
        vx: Math.cos(baseAngle) * idleSpeed,
        vy: Math.sin(baseAngle) * idleSpeed
      };
    });

  if (selected.length > 0 || !withFallback) {
    return selected;
  }

  const fallbackTypes = ['tier3', 'tier2', 'tier4', 'tier1', 'tier2', 'tier3', 'tier1', 'tier2'];
  const fallbackCount = Math.min(limit, fallbackTypes.length);
  return fallbackTypes.slice(0, fallbackCount).map((type, index) => {
    const typeStats = ASTEROID_TYPES[type];
    const angle = index * 1.15 + 0.4;
    const orbit = 140 + index * 54;
    const speed = 32 + index * 10;
    return {
      id: -(index + 1),
      type,
      radius: typeStats.radius,
      x: wrapCoord(ARENA_WIDTH * 0.5 + Math.cos(angle) * orbit, ARENA_WIDTH),
      y: wrapCoord(ARENA_HEIGHT * 0.5 + Math.sin(angle) * (orbit * 0.62), ARENA_HEIGHT),
      vx: Math.cos(angle + Math.PI * 0.5) * speed,
      vy: Math.sin(angle + Math.PI * 0.5) * speed
    };
  });
}

function stepPostFinishMotion(nowMs, motionScale = 1) {
  if (finishLastMotionMs === 0) {
    finishLastMotionMs = nowMs;
    return;
  }

  const elapsedMs = nowMs - finishLastMotionMs;
  if (elapsedMs <= 0) {
    return;
  }

  finishLastMotionMs = nowMs;
  const baseSeconds = Math.min(elapsedMs, 250) / 1000;
  const clampedScale = Math.max(0, motionScale);
  const motionSeconds = baseSeconds * clampedScale;
  const visualRate = TICK_RATE * Math.max(0.25, clampedScale);
  state.visualTick = (typeof state.visualTick === 'number' ? state.visualTick : state.tick) + baseSeconds * visualRate;

  if (motionSeconds <= 0) {
    return;
  }

  let bulletWriteIndex = 0;
  const bulletLifeLoss = baseSeconds * TICK_RATE;
  for (let i = 0; i < state.bullets.length; i += 1) {
    const bullet = state.bullets[i];
    bullet.x += bullet.vx * motionSeconds;
    bullet.y += bullet.vy * motionSeconds;
    bullet.lifeTicks -= bulletLifeLoss;
    if (
      bullet.lifeTicks <= 0 ||
      bullet.x < 0 ||
      bullet.x > ARENA_WIDTH ||
      bullet.y < 0 ||
      bullet.y > ARENA_HEIGHT ||
      bullet._removed
    ) {
      continue;
    }
    if (bulletWriteIndex !== i) {
      state.bullets[bulletWriteIndex] = bullet;
    }
    bulletWriteIndex += 1;
  }
  state.bullets.length = bulletWriteIndex;

  for (const asteroid of state.asteroids) {
    asteroid.x = wrapCoord(asteroid.x + asteroid.vx * motionSeconds, ARENA_WIDTH);
    asteroid.y = wrapCoord(asteroid.y + asteroid.vy * motionSeconds, ARENA_HEIGHT);
  }
}

function prepareIdleScene() {
  state.asteroids = buildIdleAsteroidSet(state.asteroids);
  state.bullets = [];
  state.events = [];
  state.debugOverlay = null;
  state.ship.destroyed = true;
  state.lowPowerIdle = true;
  state.visualTick = typeof state.visualTick === 'number' ? state.visualTick : state.tick;
  renderer.resetRun();
  idleLastUpdateMs = performance.now();
  idleLastRenderMs = 0;
}

function prepareStartPreview() {
  resetRun();
  state.asteroids = buildIdleAsteroidSet(state.asteroids, IDLE_ASTEROID_LIMIT, true);
  state.ship.destroyed = true;
  state.lowPowerIdle = true;
  state.debugOverlay = null;
  state.visualTick = 0;
  idlePowerSaveActive = true;
  idleLastUpdateMs = performance.now();
  idleLastRenderMs = 0;
}

function stepIdleScene(nowMs) {
  if (idleLastUpdateMs === 0) {
    idleLastUpdateMs = nowMs;
    return;
  }

  const elapsedMs = nowMs - idleLastUpdateMs;
  if (elapsedMs < IDLE_UPDATE_INTERVAL_MS) {
    return;
  }

  const deltaSeconds = Math.min(elapsedMs, 250) / 1000;
  idleLastUpdateMs = nowMs;
  state.visualTick = (typeof state.visualTick === 'number' ? state.visualTick : state.tick) + deltaSeconds * 38;

  for (const asteroid of state.asteroids) {
    asteroid.x = wrapCoord(asteroid.x + asteroid.vx * deltaSeconds, ARENA_WIDTH);
    asteroid.y = wrapCoord(asteroid.y + asteroid.vy * deltaSeconds, ARENA_HEIGHT);
  }
}

function resetSimulationState() {
  state = createInitialState(spawnSchedule);
  state.lowPowerIdle = false;
  state.debugOverlay = null;
  state.clearSequence = null;
  finishAtMs = 0;
  finishLastMotionMs = 0;
  finishReducedAsteroids = false;
  idlePowerSaveActive = false;
  idleLastUpdateMs = 0;
  idleLastRenderMs = 0;
  renderer.resetRun();
  audio.setThruster(false);
}

function resetRun() {
  replaySession = null;
  setStopReplayButtonVisible(false);
  clearGameOverOverlaySchedule();
  setGameOverOverlayVisible(false);
  spawnSchedule = createSpawnSchedule();
  resetSimulationState();
  runStarted = false;
  didFinish = false;
  clearSubmissionState({
    disableSubmit: demoEnabled
  });
  inputTimeline = [{ t: 0, mask: 0 }];
  demoRestartAtMs = 0;
  syncMobileStartButton();
}

function startRun() {
  if (replaySession) {
    stopReplayPlayback({
      restorePreview: false
    });
  }

  activeRunId += 1;
  runStarted = true;
  clearGameOverOverlaySchedule();
  setGameOverOverlayVisible(false);
  state.lowPowerIdle = false;
  state.debugOverlay = null;
  if (demoEnabled && demoAgent) {
    demoAgent.reset();
    demoTelemetry = createDemoTelemetry();
  } else {
    demoTelemetry = null;
  }
  beginRunClock(
    getRunInputMask({
      consumeTransient: false
    })
  );
  if (demoEnabled) {
    setRuntimeStatus('AI demo run started.');
  } else {
    setRuntimeStatus('Run started. 60-second timer is real-time and will not pause in background tabs.');
  }
  syncMobileStartButton();
}

canvas.addEventListener(
  'pointerdown',
  (event) => {
    if (!compactRoute || event.pointerType === 'mouse') {
      return;
    }
    if (replaySession || demoEnabled) {
      return;
    }
    if (runStarted && !didFinish) {
      return;
    }

    event.preventDefault();
    resetRun();
    startRun();
  },
  { passive: false }
);

function renderResultPanel(summary = summarizeRun(state)) {
  const accuracy = `${(summary.accuracy * 100).toFixed(1)}%`;

  resultStats.innerHTML = `
    <div><span>Score</span><strong>${summary.score}</strong></div>
    <div><span>Kills</span><strong>${summary.kills}</strong></div>
    <div><span>Max Combo</span><strong>${summary.maxCombo}x</strong></div>
    <div><span>Accuracy</span><strong>${accuracy}</strong></div>
    <div><span>Crashes</span><strong>${summary.crashes}</strong></div>
  `;

  resultPanel.classList.remove('hidden');
}

async function buildReplayPayload() {
  const authoritativeReplay = buildReplayFromTimeline();
  const replayData = encodeReplay(authoritativeReplay);
  try {
    const verified = await verifyReplayViaWorker(replayData);
    return {
      replayData,
      replayDigest: verified.replayDigest,
      finalStateHash: verified.finalStateHash,
      score: verified.score,
      summary: verified.summary
    };
  } catch {
    const replayResult = runHeadlessReplayFromFrames(authoritativeReplay, { seed: 0, spawnSchedule });
    const replayDigest = await digestReplayBase64(replayData);
    const finalStateHash = await digestString(replayResult.finalStateHashMaterial);
    return {
      replayData,
      replayDigest,
      finalStateHash,
      score: replayResult.summary.score,
      summary: {
        ...replayResult.summary,
        finalStateHash
      }
    };
  }
}

function handleSimulationEvents(events, inputMask) {
  for (const event of events) {
    renderer.handleEvent(event);
    if (event.type === 'shot') {
      audio.playShot();
    } else if (event.type === 'bomb') {
      audio.playBomb();
    } else if (event.type === 'kill') {
      audio.playExplosion(event.size);
    } else if (event.type === 'clear-destroy') {
      audio.playExplosion(event.size);
    } else if (event.type === 'clear-wave') {
      audio.playBomb();
      audio.playGameClearFanfare();
    } else if (event.type === 'barrier-hit') {
      const blastSize = Math.max(2, Math.min(4, event.size ?? 1));
      audio.playExplosion(blastSize);
      if (blastSize >= 4) {
        audio.playExplosion(blastSize - 1);
      }
    } else if (event.type === 'ship-destroyed') {
      audio.playShipDestroyed();
    }
  }

  audio.setThruster((inputMask & INPUT_THRUST) !== 0);
}

function startReplayPlayback(payload) {
  if (isLiveRunActive()) {
    setRuntimeStatus('Finish the current 60-second run before watching a replay.');
    return;
  }

  const titleOverlay = document.getElementById('title-screen');
  if (titleOverlay) {
    titleOverlay.classList.remove('active');
  }
  clearGameOverOverlaySchedule();
  setGameOverOverlayVisible(false);

  const replayBytes = decodeReplayFrames(payload.replayData);
  const seed = Number(payload.seed ?? payload.summary?.seed ?? 0);
  const replayId = String(payload.id ?? '');
  spawnSchedule = createSpawnSchedule(seed);

  replaySession = {
    kind: payload.kind === 'ai' ? 'ai' : 'human',
    id: replayId,
    name: String(payload.name ?? 'Replay'),
    score: Number(payload.score ?? 0),
    seed,
    replayBytes,
    tickCursor: 0,
    startMs: 0,
    finishedAtMs: 0,
    lastInputMask: 0
  };

  runStarted = false;
  didFinish = false;
  activeRunId += 1;
  resetSimulationState();
  clearSubmissionState({
    disableSubmit: true,
    statusText: 'Replay mode: score submission disabled.'
  });
  setStopReplayButtonVisible(true);

  const sourceLabel = replaySession.kind === 'ai' ? 'AI' : 'Human';
  const replayRef = replaySession.id ? ` id=${replaySession.id}` : '';
  setRuntimeStatus(
    `Watching ${sourceLabel} replay${replayRef} seed=${replaySession.seed}: ${replaySession.name} (${replaySession.score}).`
  );
  syncMobileStartButton();
}

function stepReplayPlayback(nowMs) {
  if (!replaySession) {
    return;
  }

  if (replaySession.startMs === 0) {
    replaySession.startMs = nowMs;
  }

  // Refactor: We no longer calculate targetTick from wall clock here.
  // Instead, the main loop calls stepReplayTick individually.
}

function stepReplayTick(nowMs = performance.now()) {
  if (!replaySession) {
    return;
  }
  state.debugOverlay = null;

  if (!state.finished) {
    const inputMask = replaySession.replayBytes[replaySession.tickCursor] & INPUT_MASK;
    const events = stepSimulation(state, inputMask);
    handleSimulationEvents(events, inputMask);
    renderer.update(state, inputMask);
    replaySession.lastInputMask = inputMask;
    replaySession.tickCursor += 1;
  }

  if (state.finished) {
    audio.setThruster(false);
    if (state.endReason === 'time-up' && !state.clearSequence) {
      activateClearSequence(nowMs);
    }
    if (state.clearSequence) {
      stepClearSequence(nowMs);
    }
    if (replaySession.finishedAtMs === 0) {
      replaySession.finishedAtMs = nowMs;
      const replayRef = replaySession.id ? ` id=${replaySession.id}` : '';
      if (state.clearSequence) {
        setRuntimeStatus('');
      } else {
        setRuntimeStatus(
          `Replay finished${replayRef} seed=${replaySession.seed}: ${replaySession.name} scored ${replaySession.score}. Press Space for a live run.`
        );
      }
    } else if (!state.clearSequence && nowMs - replaySession.finishedAtMs >= REPLAY_FINISH_HOLD_MS) {
      stopReplayPlayback({
        statusText: 'Replay finished. Press Space to start the 60-second run.'
      });
    }
  }
}

function updateDemoTelemetry(inputMask) {
  if (!demoEnabled || !demoTelemetry) {
    return;
  }

  const decision =
    typeof demoAgent?.getLastDecision === 'function' ? demoAgent.getLastDecision() : null;
  const rotateDir = (inputMask & INPUT_LEFT) !== 0 ? -1 : (inputMask & INPUT_RIGHT) !== 0 ? 1 : 0;
  if (rotateDir !== 0 && rotateDir === demoTelemetry.rotateDir) {
    demoTelemetry.rotateStreak += 1;
  } else if (rotateDir !== 0) {
    demoTelemetry.rotateStreak = 1;
  } else {
    demoTelemetry.rotateStreak = 0;
  }
  demoTelemetry.rotateDir = rotateDir;

  const inEdge =
    state.ship.x < EDGE_STAY_MARGIN ||
    state.ship.x > ARENA_WIDTH - EDGE_STAY_MARGIN ||
    state.ship.y < EDGE_STAY_MARGIN ||
    state.ship.y > ARENA_HEIGHT - EDGE_STAY_MARGIN;
  const spinning = demoTelemetry.rotateStreak >= SPIN_STREAK_THRESHOLD;
  const spinShoot = spinning && (inputMask & INPUT_SHOOT) !== 0;
  const shield = decision?.safetyShield ?? null;
  const escapeMode = decision?.escapeMode ?? null;
  const dangerAnalysis = decision?.dangerAnalysis ?? null;
  const dangerHud = decision?.debugOverlay?.dangerHud ?? null;
  const shieldActive = Boolean(shield?.active);
  const shieldApplied = Boolean(shield?.applied);
  const blockedCandidateCount = Array.isArray(shield?.blockedCandidates) ? shield.blockedCandidates.length : 0;
  const prediction120 = decision?.debugOverlay?.chosenAction?.prediction120 ?? null;
  const futureDanger =
    prediction120 !== null &&
    ((Number.isFinite(prediction120.minPredictedTtc) && prediction120.minPredictedTtc < 0.75) ||
      prediction120.minMargin < 18 ||
      prediction120.collisionRisk > 1.4);
  const highEdgeTrapRisk =
    prediction120 !== null &&
    prediction120.edgeTrapRisk >= 0.7 &&
    (prediction120.centerReturnScore ?? 1) < 0.5;

  demoTelemetry.totalFrames += 1;
  if (inEdge) {
    demoTelemetry.edgeFrames += 1;
  }
  if (spinning) {
    demoTelemetry.spinFrames += 1;
  }
  if (spinShoot) {
    demoTelemetry.spinShootFrames += 1;
  }
  if (futureDanger) {
    demoTelemetry.predictionDangerFrames += 1;
  }
  if (highEdgeTrapRisk) {
    demoTelemetry.highEdgeTrapRiskFrames += 1;
  }
  if (shieldActive) {
    demoTelemetry.shieldActiveFrames += 1;
  }
  if (shieldApplied) {
    demoTelemetry.shieldAppliedFrames += 1;
  }
  if (blockedCandidateCount > 0) {
    demoTelemetry.shieldBlockedCandidateCount += blockedCandidateCount;
  }

  pushRingBuffer(demoTelemetry.frameRing, {
    tick: state.tick,
    inputMask,
    actionId: decision?.actionId ?? 'unknown',
    actionScore: decision?.score ?? null,
    global: decision?.features?.global ?? null,
    topCandidates: decision?.topCandidates ?? [],
    prediction120,
    dangerHud: dangerHud
      ? {
          score: Number(dangerHud.score ?? 0),
          level: String(dangerHud.level ?? 'low'),
          recoverable: Boolean(dangerHud.recoverable),
          reasons: Array.isArray(dangerHud.reasons) ? dangerHud.reasons.slice(0, 3) : [],
          components: dangerHud.components ? { ...dangerHud.components } : null
        }
      : null,
    dangerAnalysis: dangerAnalysis
      ? {
          active: Boolean(dangerAnalysis.active),
          bestCandidateDanger: Boolean(dangerAnalysis.bestCandidateDanger),
          consensusDanger: Boolean(dangerAnalysis.consensusDanger),
          meaningfulGap: Boolean(dangerAnalysis.meaningfulGap),
          dangerousCount: Number(dangerAnalysis.dangerousCount ?? 0),
          inspectedCount: Number(dangerAnalysis.inspectedCount ?? 0)
        }
      : null,
    safetyShield: shield
      ? {
          active: shieldActive,
          applied: shieldApplied,
          level: String(shield.level ?? ''),
          reason: String(shield.reason ?? ''),
          blockedCandidates: Array.isArray(shield.blockedCandidates) ? shield.blockedCandidates.slice(0, 5) : []
        }
      : null,
    escapeMode: escapeMode
      ? {
          active: Boolean(escapeMode.active),
          engaged: Boolean(escapeMode.engaged),
          ticksRemaining: Number(escapeMode.ticksRemaining ?? 0),
          preferredRotateDir: Number(escapeMode.preferredRotateDir ?? 0),
          reason: String(escapeMode.reason ?? '')
        }
      : null,
    ship: {
      x: state.ship.x,
      y: state.ship.y,
      vx: state.ship.vx,
      vy: state.ship.vy,
      angle: state.ship.angle,
      cooldownTicks: state.ship.cooldownTicks
    },
    asteroidCount: state.asteroids.length,
    edge: inEdge,
    spinning,
    spinShoot,
    futureDanger,
    highEdgeTrapRisk,
    shieldActive,
    shieldApplied
  });
}

function appendWorstEpisode(episode) {
  demoAnalytics.worstEpisodes.push(episode);
  demoAnalytics.worstEpisodes.sort((a, b) => a.survivalTicks - b.survivalTicks);
  if (demoAnalytics.worstEpisodes.length > 5) {
    demoAnalytics.worstEpisodes.length = 5;
  }
}

function createAsteroidForClearDemo(type, x, y, vx, vy) {
  const stats = ASTEROID_TYPES[type] ?? ASTEROID_TYPES.tier1;
  return {
    id: state.nextAsteroidId++,
    type,
    sizeClass: stats.sizeClass,
    radius: stats.radius,
    hitPoints: stats.hitPoints,
    maxHitPoints: stats.hitPoints,
    x,
    y,
    vx,
    vy
  };
}

function createClearDemoAsteroid(sequence) {
  const spawnIndex = sequence.spawnCount++;
  const lane = (Math.floor(spawnIndex / 4) % 5) / 4;
  const side = spawnIndex % 4;
  const margin = 44;
  let x = 0;
  let y = 0;

  if (side === 0) {
    x = -margin;
    y = 80 + lane * (ARENA_HEIGHT - 160);
  } else if (side === 1) {
    x = ARENA_WIDTH + margin;
    y = 80 + lane * (ARENA_HEIGHT - 160);
  } else if (side === 2) {
    x = 120 + lane * (ARENA_WIDTH - 240);
    y = -margin;
  } else {
    x = 120 + lane * (ARENA_WIDTH - 240);
    y = ARENA_HEIGHT + margin;
  }

  const typeCycle = ['tier2', 'tier3', 'tier1', 'tier4', 'tier2', 'tier3'];
  const type = typeCycle[spawnIndex % typeCycle.length];
  const aimAngle =
    Math.atan2(sequence.targetY - y, sequence.targetX - x) + Math.sin(spawnIndex * 0.91) * 0.22;
  const speed = 150 + (spawnIndex % 5) * 18;
  return createAsteroidForClearDemo(type, x, y, Math.cos(aimAngle) * speed, Math.sin(aimAngle) * speed);
}

function activateClearSequence(nowMs = performance.now()) {
  if (state.clearSequence) {
    return;
  }

  const ship = state.ship;
  const sequence = {
    startedAtMs: nowMs,
    phase: 'deploy',
    displayAtMs: nowMs + CLEAR_BANNER_DELAY_MS,
    targetX: CLEAR_TARGET_X,
    targetY: CLEAR_TARGET_Y,
    barrierRadius: CLEAR_BARRIER_RADIUS,
    nextSpawnAtMs: nowMs + CLEAR_SEQUENCE_SETTLE_MS * 0.45,
    spawnCount: 0,
    demoActive: true,
    warpStartedAtMs: 0,
    warpProgress: 0,
    barrierProgress: 0,
    startX: ship.x,
    startY: ship.y
  };

  state.clearSequence = sequence;
  state.lowPowerIdle = false;
  state.visualTick = typeof state.visualTick === 'number' ? state.visualTick : state.tick;
  state.debugOverlay = null;
  state.bullets = [];
  ship.destroyed = false;
  ship.invulnTicks = 0;
  ship.angle = -Math.PI * 0.5;

  const clearedAsteroids = state.asteroids.slice();
  state.asteroids = [];
  const clearEvents = [{ type: 'clear-wave', x: ship.x, y: ship.y }];
  for (const asteroid of clearedAsteroids) {
    clearEvents.push({
      type: 'clear-destroy',
      x: asteroid.x,
      y: asteroid.y,
      size: asteroid.sizeClass,
      asteroidType: asteroid.type
    });
  }
  handleSimulationEvents(clearEvents, 0);
  renderer.update(state, 0);
  setRuntimeStatus('');
}

function beginClearWarp(nowMs = performance.now()) {
  const sequence = state.clearSequence;
  if (!sequence || sequence.phase === 'warp') {
    return;
  }

  sequence.phase = 'warp';
  sequence.demoActive = false;
  sequence.warpStartedAtMs = nowMs;
  sequence.warpProgress = 0;
  audio.playWarpAscend();
  setRuntimeStatus('');
}

function stepClearSequence(nowMs) {
  const sequence = state.clearSequence;
  if (!sequence) {
    return;
  }

  if (finishLastMotionMs === 0) {
    finishLastMotionMs = nowMs;
    return;
  }

  const elapsedMs = Math.min(Math.max(0, nowMs - finishLastMotionMs), 250);
  finishLastMotionMs = nowMs;
  const deltaSeconds = elapsedMs / 1000;
  state.visualTick = (typeof state.visualTick === 'number' ? state.visualTick : state.tick) + deltaSeconds * TICK_RATE * 1.2;

  if (deltaSeconds <= 0) {
    return;
  }

  const ship = state.ship;
  ship.destroyed = false;
  ship.angle += normalizeAngleDelta(-Math.PI * 0.5 - ship.angle) * (1 - Math.exp(-deltaSeconds * 7.5));

  if (sequence.phase === 'warp') {
    const warpElapsed = Math.max(0, nowMs - sequence.warpStartedAtMs);
    const warpProgress = clamp(warpElapsed / CLEAR_WARP_DURATION_MS, 0, 1);
    const eased = 1 - Math.pow(1 - warpProgress, 3);
    sequence.warpProgress = warpProgress;
    sequence.barrierProgress = Math.max(0, 1 - eased * 1.35);
    ship.vx = 0;
    ship.vy = -CLEAR_WARP_SPEED * (0.55 + eased * 1.35);
    ship.x = lerp(ship.x, sequence.targetX, 1 - Math.exp(-deltaSeconds * 10));
    ship.y += ship.vy * deltaSeconds;

    state.asteroids.length = 0;
    if (warpProgress >= 1 || ship.y < -120) {
      resetRun();
      if (titleScreen) {
        titleScreen.classList.add('active');
      }
      prepareStartPreview();
      setRuntimeStatus('Press Space to start the 60-second run.');
    }
    renderer.update(state, 0);
    return;
  }

  const settleProgress = clamp((nowMs - sequence.startedAtMs) / CLEAR_SEQUENCE_SETTLE_MS, 0, 1);
  const settleEase = 1 - Math.pow(1 - settleProgress, 3);
  sequence.barrierProgress = settleEase;
  ship.vx = 0;
  ship.vy = 0;
  ship.x = lerp(sequence.startX, sequence.targetX, settleEase);
  ship.y = lerp(sequence.startY, sequence.targetY, settleEase);

  if (settleProgress >= 1) {
    sequence.phase = 'demo';
  }

  const activeBarrierRadius = sequence.barrierRadius * Math.max(0.08, sequence.barrierProgress);

  while (
    sequence.barrierProgress >= 0.72 &&
    nowMs >= sequence.nextSpawnAtMs &&
    state.asteroids.length < CLEAR_DEMO_ASTEROID_LIMIT
  ) {
    state.asteroids.push(createClearDemoAsteroid(sequence));
    sequence.nextSpawnAtMs += CLEAR_DEMO_SPAWN_INTERVAL_MS;
  }

  const barrierEvents = [];
  let writeIndex = 0;
  for (let i = 0; i < state.asteroids.length; i += 1) {
    const asteroid = state.asteroids[i];
    asteroid.x = wrapCoord(asteroid.x + asteroid.vx * deltaSeconds, ARENA_WIDTH);
    asteroid.y = wrapCoord(asteroid.y + asteroid.vy * deltaSeconds, ARENA_HEIGHT);

    const dx = asteroid.x - ship.x;
    const dy = asteroid.y - ship.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= activeBarrierRadius + asteroid.radius) {
      const hitAngle = Math.atan2(dy, dx);
      barrierEvents.push({
        type: 'barrier-hit',
        x: ship.x + Math.cos(hitAngle) * activeBarrierRadius,
        y: ship.y + Math.sin(hitAngle) * activeBarrierRadius,
        angle: hitAngle,
        size: asteroid.sizeClass,
        radius: asteroid.radius
      });
      continue;
    }

    if (writeIndex !== i) {
      state.asteroids[writeIndex] = asteroid;
    }
    writeIndex += 1;
  }
  state.asteroids.length = writeIndex;

    if (barrierEvents.length > 0) {
      handleSimulationEvents(barrierEvents, 0);
  }

  renderer.update(state, 0);
}

function onRunFinished(nowMs = performance.now()) {
  if (didFinish) {
    return;
  }

  const finishedRunId = activeRunId;
  didFinish = true;
  audio.setThruster(false);
  finishAtMs = nowMs;
  finishLastMotionMs = finishAtMs;
  finishReducedAsteroids = false;
  idlePowerSaveActive = false;
  state.lowPowerIdle = false;
  state.visualTick = state.tick;
  clearGameOverOverlaySchedule();
  if (state.endReason === 'ship-destroyed') {
    state.ship.destroyed = true;
    scheduleGameOverOverlay();
  } else {
    activateClearSequence(nowMs);
    setGameOverOverlayVisible(false);
  }

  if (demoEnabled) {
    const summary = summarizeRun(state);
    demoRunCount += 1;
    demoBestScore = Math.max(demoBestScore, summary.score);
    const telemetry = demoTelemetry ?? createDemoTelemetry();
    const deathCause = estimateDeathCauseFromTelemetry(summary, telemetry, state);
    demoAnalytics.runCount += 1;
    demoAnalytics.survivalTicks.push(summary.survivalTicks);
    demoAnalytics.scores.push(summary.score);
    demoAnalytics.totalFrames += telemetry.totalFrames;
    demoAnalytics.edgeFrames += telemetry.edgeFrames;
    demoAnalytics.spinFrames += telemetry.spinFrames;
    demoAnalytics.spinShootFrames += telemetry.spinShootFrames;
    demoAnalytics.predictionDangerFrames += telemetry.predictionDangerFrames;
    demoAnalytics.highEdgeTrapRiskFrames += telemetry.highEdgeTrapRiskFrames;
    demoAnalytics.shieldActiveFrames += telemetry.shieldActiveFrames;
    demoAnalytics.shieldAppliedFrames += telemetry.shieldAppliedFrames;
    demoAnalytics.shieldBlockedCandidateCount += telemetry.shieldBlockedCandidateCount;
    demoAnalytics.deathCauseCounts[deathCause] = (demoAnalytics.deathCauseCounts[deathCause] ?? 0) + 1;
    if (summary.endReason === 'ship-destroyed') {
      appendWorstEpisode({
        runIndex: demoRunCount,
        survivalTicks: summary.survivalTicks,
        score: summary.score,
        deathCause,
        frames: readRingBuffer(telemetry.frameRing)
      });
    }

    const metrics = buildDemoMetricsSummary();
    if (metrics) {
      console.log('[predictive-demo-metrics]', metrics);
      window.__asteroidPredictiveDemoMetrics = metrics;
      window.__asteroidPredictiveEpisodeSamples = metrics.worstEpisodes;
    }

    const worst10 = metrics?.primary?.worst10SurvivalTicks ?? summary.survivalTicks;
    const medianTicks = metrics?.primary?.medianSurvivalTicks ?? summary.survivalTicks;
    setRuntimeStatus(
      `AI demo #${demoRunCount} score ${summary.score}. p10=${Math.round(worst10)} ticks, median=${Math.round(medianTicks)} ticks. Restarting...`
    );
    setDemoStatus(
      `Predictive demo runs=${demoRunCount}, last=${summary.score}, best=${demoBestScore}, edgeRiskFrames=${demoAnalytics.highEdgeTrapRiskFrames}`
    );
    submitButton.disabled = true;
    submitStatus.textContent = 'Demo mode: score submission disabled.';
    resultPanel.classList.add('hidden');
    replayPayload = null;
    replayDigestPromise = null;
    demoTelemetry = null;
    demoRestartAtMs = nowMs + DEMO_RESTART_DELAY_MS;
    return;
  }

  submitButton.disabled = true;
  submitStatus.textContent = 'Preparing replay digest...';

  replayDigestPromise = buildReplayPayload()
    .then((payload) => {
      if (finishedRunId !== activeRunId || !didFinish) {
        return;
      }
      replayPayload = payload;
      renderResultPanel(payload.summary);
      submitButton.disabled = false;
      submitStatus.textContent = 'Replay verified locally. Ready to submit.';
    })
    .catch((error) => {
      if (finishedRunId !== activeRunId || !didFinish) {
        return;
      }
      replayPayload = null;
      renderResultPanel();
      submitStatus.textContent = `Replay digest failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    });
}

function refreshLeaderboardStatus(overrideText = '') {
  if (overrideText) {
    leaderboardStatus.textContent = overrideText;
    return;
  }

  if (!leaderboardSnapshot) {
    leaderboardStatus.textContent = '';
    return;
  }

  if ((leaderboardSnapshot.combinedEntries ?? []).length > 0) {
    leaderboardStatus.textContent = 'AI とプレイヤーが同じ Top10 に並びます。WATCH で replay を見られます。';
    return;
  }

  leaderboardStatus.textContent = 'Leaderboard はまだ空です。最初の記録を作れます。';
}

function createLeaderboardCell(entry, rank) {
  const cell = document.createElement('section');
  const kindClass = entry?.kind ? ` ${entry.kind}` : '';
  const placeholderClass = entry?.isPlaceholder ? ' placeholder' : '';
  cell.className = `leaderboard-slot${kindClass}${entry ? '' : ' empty'}${placeholderClass}`;

  const head = document.createElement('div');
  head.className = 'leaderboard-slot-head';

  if (entry?.kind) {
    const badge = document.createElement('span');
    badge.className = `leaderboard-kind ${entry.kind}`;
    badge.textContent = entry.kind === 'ai' ? 'AI' : 'HUMAN';
    head.append(badge);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'leaderboard-kind-spacer';
    head.append(spacer);
  }

  const rankNode = document.createElement('span');
  rankNode.className = 'rank';
  rankNode.textContent = `#${rank}`;
  head.append(rankNode);

  cell.append(head);

  if (!entry) {
    const empty = document.createElement('div');
    empty.className = 'leaderboard-empty muted';
    empty.textContent = '---';
    cell.append(empty);
    return cell;
  }

  const main = document.createElement('div');
  main.className = 'leaderboard-main';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = entry.name ?? '';
  main.append(name);

  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = String(entry.score);
  main.append(score);

  cell.append(main);

  const message = document.createElement('div');
  message.className = 'message';
  const detailParts = [];
  if (entry.message) {
    detailParts.push(entry.message);
  }
  if (entry.kind === 'ai' && entry.summary?.survivalSeconds) {
    detailParts.push(`${Number(entry.summary.survivalSeconds).toFixed(2)}s`);
  }
  if (entry.kind === 'human' && entry.gameVersion === 'legacy') {
    detailParts.push('legacy');
  }
  message.textContent = detailParts.join(' | ');
  cell.append(message);

  const actions = document.createElement('div');
  actions.className = 'leaderboard-actions';

  if (entry.replayAvailable) {
    const watchButton = document.createElement('button');
    watchButton.className = 'btn tiny';
    watchButton.type = 'button';
    watchButton.textContent = 'WATCH';
    watchButton.disabled = false;
    watchButton.dataset.replayKind = entry.kind ?? '';
    watchButton.dataset.replayId = String(entry.id);
    actions.append(watchButton);
  }

  cell.append(actions);
  return cell;
}

function buildUnifiedLeaderboardEntries(snapshot) {
  const combinedEntries = Array.isArray(snapshot?.combinedEntries) ? snapshot.combinedEntries : null;
  const aiEntries = Array.isArray(snapshot?.aiEntries) ? snapshot.aiEntries : [];
  const humanEntries = Array.isArray(snapshot?.humanEntries) ? snapshot.humanEntries : [];

  const liveEntries = combinedEntries
    ? combinedEntries.slice(0, 10)
    : [...aiEntries, ...humanEntries]
        .sort((a, b) => {
          const scoreDelta = Number(b?.score ?? 0) - Number(a?.score ?? 0);
          if (scoreDelta !== 0) {
            return scoreDelta;
          }

          const aRank = Number(a?.rank ?? Number.POSITIVE_INFINITY);
          const bRank = Number(b?.rank ?? Number.POSITIVE_INFINITY);
          if (aRank !== bRank) {
            return aRank - bRank;
          }

          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        })
        .slice(0, 10);

  const entries = liveEntries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    message: entry.message ?? entry.comment ?? ''
  }));

  while (entries.length < 10) {
    entries.push({
      id: `rank-${String(entries.length + 1).padStart(2, '0')}`,
      rank: entries.length + 1,
      kind: '',
      name: '',
      message: '',
      score: 0,
      replayAvailable: false,
      isPlaceholder: true
    });
  }

  return entries;
}

function renderLeaderboard(snapshot) {
  leaderboardSnapshot = snapshot;
  leaderboardList.innerHTML = '';

  const entries = buildUnifiedLeaderboardEntries(snapshot);
  for (const entry of entries) {
    leaderboardList.append(createLeaderboardCell(entry, entry.rank));
  }

  if (autoWatchEnabled && !autoWatchTriggered) {
    const target = entries.find((entry) => entry?.replayAvailable && entry?.kind && entry?.id);
    if (target) {
      autoWatchTriggered = true;
      void playLeaderboardReplay(target.kind, target.id);
    }
  }

  refreshLeaderboardStatus();
}

async function loadLeaderboard() {
  refreshLeaderboardStatus('Loading leaderboard...');
  try {
    const snapshot = await fetchLeaderboard();
    renderLeaderboard(snapshot);
    
    // Update title overlay if present
    const entries = buildUnifiedLeaderboardEntries(snapshot);
    if (entries.length > 0 && !entries[0].isPlaceholder) {
      const top = entries[0];
      const netVal = document.getElementById('net-high-score-total');
      const netName = document.getElementById('net-high-score-player');
      if (netVal) netVal.textContent = top.score.toLocaleString();
      if (netName) netName.textContent = top.name;
    }
  } catch (error) {
    refreshLeaderboardStatus(`Leaderboard error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

function setupPlatformSwitcher() {
  const params = new URLSearchParams(window.location.search);
  const link = document.getElementById('platform-switch-link');
  if (!link) return;

  if (compactRoute) {
    link.textContent = 'PC版で遊ぶ';
    params.set('mode', 'desktop');
  } else {
    link.textContent = 'スマホ版で遊ぶ';
    params.set('mode', 'mobile');
  }
  link.href = `?${params.toString()}`;
}

const titlePlayButton = document.getElementById('title-play-button');
const titleScreen = document.getElementById('title-screen');
if (titlePlayButton && titleScreen) {
  titlePlayButton.addEventListener('click', () => {
    titleScreen.classList.remove('active');
    if (!runStarted) {
      resetRun();
      startRun();
    }
  });
}
setupPlatformSwitcher();

async function playLeaderboardReplay(kind, id) {
  const requestId = ++replayLoadRequestId;
  refreshLeaderboardStatus(`Loading ${kind === 'ai' ? 'AI' : 'human'} replay...`);

  if (demoEnabled) {
    await setDemoModeEnabled(false);
  }

  if (isLiveRunActive()) {
    refreshLeaderboardStatus('Finish the current 60-second run first. Replay watching is locked during live play.');
    return;
  }

  try {
    const payload = await fetchReplay(kind, id);
    if (requestId !== replayLoadRequestId) {
      return;
    }
    startReplayPlayback(payload);
    refreshLeaderboardStatus();
  } catch (error) {
    if (requestId !== replayLoadRequestId) {
      return;
    }
    refreshLeaderboardStatus(`Replay error: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

const input = new InputController({
  pointerTarget: canvas,
  onFirstInteraction: () => {
    audio.unlock().then(
      () => {
        if (!runStarted) {
          setRuntimeStatus('Audio active. Press Space to launch the 60-second run.');
        }
      },
      () => {
        if (!runStarted) {
          setRuntimeStatus('Audio unlock failed. Press Space to start anyway.');
        }
      }
    );
  }
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyP' && !event.repeat) {
    event.preventDefault();
    void setDemoModeEnabled(!demoEnabled);
    return;
  }

  if (
    !event.repeat &&
    didFinish &&
    state.clearSequence?.demoActive &&
    !replaySession &&
    !demoEnabled &&
    !['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab'].includes(event.code)
  ) {
    event.preventDefault();
    beginClearWarp();
    return;
  }

  if (event.code !== 'Space' || event.repeat) {
    return;
  }
  if (replaySession) {
    event.preventDefault();
    stopReplayPlayback({
      restorePreview: false
    });
    resetRun();
    startRun();
    return;
  }

  if (demoEnabled) {
    event.preventDefault();
    return;
  }

  if (didFinish) {
    resetRun();
    startRun();
    return;
  }

  if (!runStarted) {
    const titleOverlay = document.getElementById('title-screen');
    if (titleOverlay) titleOverlay.classList.remove('active');
    resetRun();
    startRun();
  }
});

reloadLeaderboardButton.addEventListener('click', () => {
  loadLeaderboard();
});
mobileStartButton.addEventListener('click', () => {
  if (replaySession || (runStarted && !didFinish)) {
    return;
  }
  resetRun();
  startRun();
});
stopReplayButton.addEventListener('click', () => {
  stopReplayPlayback();
  syncMobileStartButton();
});
demoToggle.addEventListener('click', () => {
  void setDemoModeEnabled(!demoEnabled);
});
leaderboardList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest('button[data-replay-kind][data-replay-id]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return;
  }

  void playLeaderboardReplay(button.dataset.replayKind, button.dataset.replayId);
});

nameInput.addEventListener('input', () => {
  const cleaned = sanitizeName(nameInput.value);
  if (nameInput.value !== cleaned) {
    nameInput.value = cleaned;
  }
});

messageInput.addEventListener('input', () => {
  const cleaned = sanitizeMessage(messageInput.value);
  if (messageInput.value !== cleaned) {
    messageInput.value = cleaned;
  }
});

submitForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (demoEnabled) {
    submitStatus.textContent = 'Demo mode is running. Score submission is disabled.';
    return;
  }

  if (replayDigestPromise) {
    submitButton.disabled = true;
    await replayDigestPromise;
  }

  if (!replayPayload) {
    submitStatus.textContent = 'Finish a run and wait for local replay verification first.';
    submitButton.disabled = false;
    return;
  }

  const name = sanitizeName(nameInput.value);
  const message = sanitizeMessage(messageInput.value) || 'NO COMMENT';

  if (!name) {
    submitStatus.textContent = 'Name is required.';
    submitButton.disabled = false;
    return;
  }

  submitButton.disabled = true;
  submitStatus.textContent = 'Submitting score...';

  try {
    const response = await submitScore({
      name,
      message,
      score: replayPayload.score,
      replayDigest: replayPayload.replayDigest,
      replayData: replayPayload.replayData,
      finalStateHash: replayPayload.finalStateHash
    });
    submitStatus.textContent = 'Score accepted and verified by server.';
    if (response?.leaderboard) {
      renderLeaderboard(response.leaderboard);
    } else {
      await loadLeaderboard();
    }
  } catch (error) {
    submitStatus.textContent = `Submit failed: ${error instanceof Error ? error.message : 'unknown error'}`;
  } finally {
    submitButton.disabled = false;
  }
});

const loop = createFixedLoop({
  stepHz: TICK_RATE,
  update: () => {
    const nowMs = performance.now();

    if (replaySession) {
      stepReplayTick(nowMs);
      return;
    }

    if (!runStarted) {
      state.debugOverlay = null;
      stepIdleScene(nowMs);
      audio.setThruster(false);
      return;
    }

    if (!state.finished) {
      const elapsedMs = nowMs - runStartMs;

      if (elapsedMs >= RUN_DURATION_MS) {
        state.tick = MAX_TICKS;
        state.finished = true;
        state.endReason = 'time-up';
        state.events = [];
        state.debugOverlay = null;
        renderer.update(state, 0);
        audio.setThruster(false);
      } else {
        const inputMask = getRunInputMask();
        state.debugOverlay = demoEnabled ? demoDebugOverlay : null;
        updateDemoTelemetry(inputMask);
        recordInputChange(inputMask, nowMs);
        const events = stepSimulation(state, inputMask);
        handleSimulationEvents(events, inputMask);
        renderer.update(state, inputMask);
      }

      if (state.finished && state.endReason === 'time-up') {
        setRuntimeStatus('');
      } else if (state.finished && state.endReason === 'ship-destroyed') {
        setRuntimeStatus('');
      }
    } else {
      state.debugOverlay = null;
      if (state.clearSequence) {
        stepClearSequence(nowMs);
      } else {
        const sinceFinishMs = Math.max(0, nowMs - finishAtMs);
        if (sinceFinishMs < POST_FINISH_SETTLE_MS) {
          stepPostFinishMotion(nowMs, 1);
          renderer.update(state, 0);
        } else if (sinceFinishMs < POST_FINISH_SETTLE_MS + POST_FINISH_TRIM_MS) {
          if (!finishReducedAsteroids) {
            state.asteroids = buildIdleAsteroidSet(state.asteroids, POST_FINISH_ASTEROID_LIMIT, false);
            finishReducedAsteroids = true;
          }
          stepPostFinishMotion(nowMs, 0.72);
          renderer.update(state, 0);
        } else {
          if (!idlePowerSaveActive) {
            prepareIdleScene();
            idlePowerSaveActive = true;
          }
          stepIdleScene(nowMs);
        }
      }
      audio.setThruster(false);
    }

    if (state.finished) {
      onRunFinished(nowMs);
      if (demoEnabled && didFinish && demoRestartAtMs > 0 && nowMs >= demoRestartAtMs) {
        resetRun();
        startRun();
        return;
      }
    }
  },
  render: () => {
    if (idlePowerSaveActive) {
      const nowMs = performance.now();
      if (nowMs - idleLastRenderMs < IDLE_RENDER_INTERVAL_MS) {
        return;
      }
      idleLastRenderMs = nowMs;
    }
    renderer.render(state);
  }
});

prepareStartPreview();
refreshDemoButton();
syncMobileStartButton();
loop.start();
loadLeaderboard();

window.addEventListener('beforeunload', () => {
  if (replayVerifyWorker) {
    replayVerifyWorker.terminate();
    replayVerifyWorker = null;
  }
  replayVerifyPending.clear();
});
