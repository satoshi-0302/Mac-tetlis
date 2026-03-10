import {
  BARRIER_BALANCE,
  AI_BALANCE,
  CITY_LAYOUT,
  STORAGE_KEYS,
  WORLD,
  clamp,
  getClearCityBonus,
  getBurstChance,
  getEnemySpeed,
  getSpawnRate,
  pickEnemyType,
  randomRange,
} from "./balance.js";
import { fetchLeaderboard, fetchReplay, submitLeaderboardEntry } from "./api.js";
import { City, EnemyMissile, Interceptor } from "./entities.js";
import {
  addAmbientEmbers,
  addArmorSparks,
  addBarrierDeployWave,
  addBarrierIntercept,
  addCelebrationFirework,
  addCityCollapse,
  addGroundImpact,
  addPlayerExplosion,
  addReplayBarrierInterceptBurst,
  addSecondaryExplosion,
  addSplitFlash,
  getScoreGain,
} from "./effects.js";
import { ReplayPlayer, ReplayRecorder } from "./replay.js";
import { createPresetDemoAgent, loadDemoAgent, resolveAgentActionTarget } from "./rl/demo-agent.js";
import { AudioEngine } from "./audio.js";
import { Renderer } from "./renderer.js";
import { GameUI } from "./ui.js";

export class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.renderer = new Renderer(this.canvas);
    this.ui = new GameUI({
      onStart: () => this.startRun({ demo: false }),
      onRetry: () => this.startRun({ demo: this.isDemoRun }),
      onTitle: () => this.showTitle(),
      onToggleAudio: () => this.toggleAudio(),
      onDemo: () => this.startPreferredDemo(),
      onReplay: (entry) => this.startReplayFromEntry(entry),
      onExitReplay: () => this.exitReplay(),
      onRefreshLeaderboard: () => this.refreshLeaderboard(),
      onNameChange: (value) => this.handlePlayerNameChange(value),
      onCommentChange: (value) => this.handlePlayerCommentChange(value),
    });
    this.audio = new AudioEngine();
    this.effectIntensity = 1;
    this.ui.setAudioState({
      enabled: !this.audio.isMuted(),
      supported: this.audio.supported,
    });

    this.highScore = this.loadHighScore();
    this.playerName = this.loadPlayerName();
    this.playerComment = this.loadPlayerComment();
    this.demoAgent = null;
    this.demoPolicy = null;
    this.demoSource = "loading";
    this.demoDecisionAccumulator = 0;
    this.demoDecisionInterval = 0.1;
    this.sceneDemoPreset = "edge-prediction";
    this.aiShotCooldown = 0;
    this.isDemoRun = false;
    this.replayRecorder = new ReplayRecorder();
    this.replayPlayer = null;
    this.replayEntry = null;
    this.replayLoadToken = 0;
    this.gameVersion = "orbital-shield-rl-poc-v3";
    this.comboSeed = 1;
    this.lastTimestamp = 0;
    this.frameAccumulator = 0;
    this.fixedStepSeconds = 1 / 60;
    this.maxFixedStepsPerFrame = 12;
    this.playTicks = 0;
    this.deployTicks = 0;
    this.pendingLaunches = [];
    this.fireworkTimer = 0;
    this.barrier = {
      active: false,
      elapsed: 0,
      progress: 0,
      stormAccumulator: 0,
    };
    this.replayFrameEvents = [];
    this.replayTransientParticles = [];

    this.ui.setPlayerName(this.playerName);
    this.ui.setPlayerComment(this.playerComment);
    this.ui.setDemoState({
      ready: false,
      label: "AIデモを準備中です。",
      source: "loading",
    });

    this.setupInput();
    this.showTitle();
    this.exposeDebugApi();
    this.applyBootstrapScene();
    this.bootstrapAsync();

    this.syncResponsiveSettings();
    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.syncResponsiveSettings();
    });
    requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  async bootstrapAsync() {
    await Promise.allSettled([
      this.initializeDemoAgent(this.sceneDemoPreset),
      this.refreshLeaderboard(),
    ]);
  }

  syncResponsiveSettings() {
    const coarsePointer =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const isPortrait = window.innerHeight > window.innerWidth;
    const isNarrow = window.innerWidth <= 720;
    const availableWidth = Math.max(320, window.innerWidth - 32);
    const estimatedStageHeight = Math.min(
      Math.max(320, window.innerHeight - 170),
      availableWidth * (9 / 16),
    );
    const constrainedTitleLayout = estimatedStageHeight < 760;
    const compactUi = coarsePointer || isNarrow;

    this.effectIntensity = coarsePointer && isPortrait ? 0.74 : isNarrow ? 0.88 : 1;
    document.body.dataset.mobile = compactUi ? "true" : "false";
    document.body.dataset.portrait = isPortrait ? "true" : "false";
    this.ui.syncResponsivePanels({
      compact: compactUi,
      constrainedHeight: constrainedTitleLayout,
    });
    this.syncOrientationLock({ compactUi, isPortrait });
  }

  async syncOrientationLock({ compactUi, isPortrait }) {
    const orientation = window.screen?.orientation;
    if (!orientation?.lock) {
      return;
    }

    try {
      if (compactUi && isPortrait) {
        await orientation.lock("landscape");
        return;
      }

      if (!compactUi && orientation.unlock) {
        orientation.unlock();
      }
    } catch (error) {
      // Some browsers require fullscreen or user activation for orientation lock.
    }
  }

  setupInput() {
    this.ui.titleScreen.addEventListener("pointerdown", (event) => {
      if (this.state !== "title") {
        return;
      }

      const target = event.target;
      const interactiveTarget =
        target instanceof Element ? target.closest("button, input, summary, label") : target?.parentElement?.closest?.("button, input, summary, label");
      if (interactiveTarget) {
        return;
      }

      this.startRun();
    });

    window.addEventListener("keydown", (event) => {
      if (this.state === "replay" && event.key === "Escape") {
        event.preventDefault();
        this.exitReplay();
        return;
      }

      if (this.state !== "title") {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      this.startRun();
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.state !== "playing" || this.isDemoRun) {
        return;
      }

      event.preventDefault();
      const position = this.renderer.toWorld(event.clientX, event.clientY);
      this.queueLaunchRequest(position.x, position.y);
    });
  }

  exposeDebugApi() {
    const debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";
    if (!debugEnabled) {
      delete window.__missileCommand;
      return;
    }

    window.__missileCommand = {
      start: () => this.startRun({ demo: false }),
      demo: () => this.startDemoRun({ preset: "edge-prediction" }),
      replay: (id) => this.startReplayFromEntry({ id, replayId: id, name: "Replay" }),
      title: () => this.showTitle(),
      toggleAudio: () => this.toggleAudio(),
      clickWorld: (x, y) => this.queueLaunchRequest(x, y),
      forceSpawn: (type = "normal") => this.spawnEnemy(type),
      setTimeLeft: (seconds) => {
        this.elapsed = clamp(WORLD.gameDuration - seconds, 0, WORLD.gameDuration);
        this.syncHud();
      },
      forceClear: () => {
        if (this.state === "playing") {
          this.elapsed = WORLD.gameDuration;
          this.finishRun(this.getAliveCities().length > 0 ? "clear" : "gameover");
        }
      },
      forceGameOver: () => {
        for (const city of this.cities) {
          city.destroy();
        }
        if (this.state === "playing") {
          this.finishRun("gameover");
        }
      },
      getSnapshot: () => ({
        state: this.state,
        score: this.score,
        maxChain: this.maxChain,
        timeLeft: Number(this.getTimeLeft().toFixed(2)),
        aliveCities: this.getAliveCities().length,
        highScore: this.highScore,
        enemyCount: this.enemyMissiles.length,
        explosionCount: this.explosions.length,
      }),
    };
  }

  async toggleAudio() {
    if (!this.audio.supported) {
      this.ui.setAudioState({ enabled: false, supported: false });
      return;
    }

    await this.audio.unlock();
    this.audio.setMuted(!this.audio.isMuted());
    this.ui.setAudioState({
      enabled: !this.audio.isMuted(),
      supported: this.audio.supported,
    });
  }

  loadHighScore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.highScore);
      const parsed = Number.parseInt(raw ?? "0", 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (error) {
      return 0;
    }
  }

  loadPlayerName() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.playerName);
      const name = String(raw ?? "").trim();
      return name || "ACE";
    } catch (error) {
      return "ACE";
    }
  }

  loadPlayerComment() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.playerComment);
      return String(raw ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20);
    } catch (error) {
      return "";
    }
  }

  saveHighScore() {
    try {
      window.localStorage.setItem(STORAGE_KEYS.highScore, String(this.highScore));
    } catch (error) {
      // localStorage is optional; the game still works without it.
    }
  }

  savePlayerName() {
    try {
      window.localStorage.setItem(STORAGE_KEYS.playerName, this.playerName);
    } catch (error) {
      // localStorage is optional.
    }
  }

  savePlayerComment() {
    try {
      window.localStorage.setItem(STORAGE_KEYS.playerComment, this.playerComment);
    } catch (error) {
      // localStorage is optional.
    }
  }

  handlePlayerNameChange(value) {
    const sanitized = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12);
    this.playerName = sanitized || "ACE";
    this.ui.setPlayerName(this.playerName);
    this.savePlayerName();
  }

  handlePlayerCommentChange(value) {
    this.playerComment = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20);
    this.ui.setPlayerComment(this.playerComment);
    this.savePlayerComment();
  }

  async initializeDemoAgent(preset = null) {
    const resolvedPreset = preset ?? this.sceneDemoPreset;
    const loaded =
      resolvedPreset && createPresetDemoAgent(resolvedPreset)
        ? createPresetDemoAgent(resolvedPreset)
        : await loadDemoAgent();
    this.demoAgent = loaded.agent;
    this.demoPolicy = loaded.policy;
    this.demoSource = loaded.source;
    const decisionTicks = Number(
      loaded.policy?.config?.decisionTicks ?? (loaded.source === "policy" ? 2 : 3),
    );
    this.demoDecisionInterval = loaded.source === "edge-prediction" ? 1 / 60 : 1 / 20;
    this.ui.setDemoState({
      ready: true,
      source: loaded.source,
      label:
        loaded.source === "policy"
          ? `${loaded.agent.policyName} を読み込みました。`
          : loaded.source === "heuristic-policy"
            ? `${loaded.agent.policyName} を読み込みました。`
            : loaded.source === "edge-prediction" || loaded.source === "bottom-priority"
              ? `${loaded.agent.policyName} を読み込みました。`
          : "学習済みポリシーが未配置のため、ヒューリスティックAIでデモ再生します。",
    });
  }

  async refreshLeaderboard() {
    this.ui.setLeaderboardStatus("Leaderboardを読み込み中です。");

    try {
      const board = await fetchLeaderboard();
      this.ui.setLeaderboard(board);
      this.ui.setLeaderboardStatus("Leaderboardに接続済みです。");
    } catch (error) {
      this.ui.setLeaderboard({
        humanEntries: [],
        aiEntries: [],
      });
      this.ui.setLeaderboardStatus(
        "Leaderboardサーバーに接続できません。Nodeサーバー起動後に Refresh してください。",
        true,
      );
    }
  }

  createCities() {
    return CITY_LAYOUT.map((layout, index) => new City({ ...layout, index }));
  }

  applyBootstrapScene() {
    const params = new URLSearchParams(window.location.search);
    const scene = params.get("scene");
    const replayId = String(params.get("replayId") ?? "").trim();

    if (scene === "showcase") {
      this.setupShowcaseScene();
      return;
    }

    if (scene === "demo") {
      window.setTimeout(() => {
        void this.startPreferredDemo();
      }, 60);
      return;
    }

    if (scene === "edge-prediction-demo") {
      this.sceneDemoPreset = "edge-prediction";
      window.setTimeout(() => {
        void this.startDemoRun({ preset: "edge-prediction" });
      }, 60);
      return;
    }

    if (scene === "top-ai-replay") {
      window.setTimeout(() => {
        void this.startTopReplay("ai");
      }, 60);
      return;
    }

    if (scene === "top-human-replay") {
      window.setTimeout(() => {
        void this.startTopReplay("human");
      }, 60);
      return;
    }

    if (scene === "average-ai-replay") {
      window.setTimeout(() => {
        void this.startReplayFromEntry({
          id: "edge-prediction-average-100",
          replayId: "edge-prediction-average-100",
          name: "Average Edge Prediction",
        });
      }, 60);
      return;
    }

    if (scene === "replay" && replayId) {
      window.setTimeout(() => {
        void this.startReplayFromEntry({
          id: replayId,
          replayId,
          name: "Replay",
        });
      }, 60);
      return;
    }

    if (scene === "clear") {
      this.startRun();
      this.elapsed = WORLD.gameDuration;
      window.setTimeout(() => this.startBarrierSequence(), 60);
      return;
    }

    if (scene === "gameover") {
      this.startRun();
      this.elapsed = 18;
      window.setTimeout(() => {
        for (const city of this.cities) {
          city.destroy();
        }
        this.finishRun("gameover");
      }, 60);
    }
  }

  async startTopReplay(kind = "ai") {
    this.ui.setStatusLine(
      kind === "ai" ? "AI Top replay を読み込み中です。" : "Human Top replay を読み込み中です。",
    );

    try {
      const board = await fetchLeaderboard();
      const entries = kind === "human" ? board?.humanEntries ?? [] : board?.aiEntries ?? [];
      const topEntry = entries.find((entry) => entry?.replayAvailable && entry?.replayId);

      if (!topEntry) {
        this.showTitle();
        this.ui.setStatusLine(
          kind === "ai"
            ? "AI Top replay が見つからなかったため、タイトルに戻りました。"
            : "Human Top replay が見つからなかったため、タイトルに戻りました。",
        );
        return;
      }

      await this.startReplayFromEntry(topEntry);
    } catch (error) {
      this.showTitle();
      this.ui.setStatusLine("Top replay の読み込みに失敗しました。");
    }
  }

  allocateComboId() {
    const value = this.comboSeed;
    this.comboSeed += 1;
    return value;
  }

  setupShowcaseScene() {
    this.startRun();
    this.elapsed = 34;
    this.spawnAccumulator = 0;

    const [cityA, cityB, cityC, cityD] = this.cities;
    this.enemyMissiles = [
      new EnemyMissile({
        type: "split",
        startX: 220,
        startY: 112,
        targetX: cityB.x - 14,
        targetY: WORLD.groundY - 6,
        targetCityId: cityB.id,
        speed: 138,
        splitProgress: 0.96,
      }),
      new EnemyMissile({
        type: "fast",
        startX: 1020,
        startY: 98,
        targetX: cityC.x + 12,
        targetY: WORLD.groundY - 6,
        targetCityId: cityC.id,
        speed: 260,
        splitProgress: 1,
      }),
      new EnemyMissile({
        type: "armored",
        startX: 640,
        startY: 36,
        targetX: cityD.x - 20,
        targetY: WORLD.groundY - 6,
        targetCityId: cityD.id,
        speed: 130,
        splitProgress: 1,
      }),
      new EnemyMissile({
        type: "normal",
        startX: 840,
        startY: 122,
        targetX: cityA.x + 18,
        targetY: WORLD.groundY - 6,
        targetCityId: cityA.id,
        speed: 152,
        splitProgress: 1,
      }),
      new EnemyMissile({
        type: "normal",
        startX: 642,
        startY: 216,
        targetX: cityB.x,
        targetY: WORLD.groundY - 6,
        targetCityId: cityB.id,
        speed: 92,
        splitProgress: 1,
      }),
    ];

    // The showcase fires a few shots automatically so screenshots capture
    // active explosions, trails, and at least one chain reaction.
    window.setTimeout(() => this.queueLaunchRequest(420, 246), 240);
    window.setTimeout(() => this.queueLaunchRequest(874, 218), 360);
    window.setTimeout(() => this.queueLaunchRequest(980, 286), 520);
    window.setTimeout(() => addPlayerExplosion(this, 640, 210), 560);
    this.syncHud();
  }

  resetSimulationClocks() {
    this.lastTimestamp = 0;
    this.frameAccumulator = 0;
    this.playTicks = 0;
    this.deployTicks = 0;
    this.pendingLaunches = [];
  }

  syncTickCountersFromState() {
    const elapsedSeconds = Math.max(0, Number(this.elapsed) || 0);
    this.playTicks = Math.max(
      0,
      Math.round(Math.min(WORLD.gameDuration, elapsedSeconds) / this.fixedStepSeconds),
    );
    this.deployTicks = this.barrier?.active
      ? Math.max(0, Math.round((Number(this.barrier.elapsed) || 0) / this.fixedStepSeconds))
      : 0;
  }

  showTitle() {
    this.audio.stopMusic(0.2);
    this.replayRecorder.clear();
    this.replayPlayer = null;
    this.replayEntry = null;
    this.isDemoRun = false;
    this.state = "title";
    this.elapsed = 0;
    this.score = 0;
    this.maxChain = 0;
    this.spawnAccumulator = 0;
    this.screenShake = 0;
    this.aiShotCooldown = 0;
    this.enemyMissiles = [];
    this.interceptors = [];
    this.explosions = [];
    this.particles = [];
    this.comboCounts = new Map();
    this.cities = this.createCities();
    this.resetBarrierState();
    this.resetReplayTransientState();
    this.resetSimulationClocks();
    this.ui.showTitle(this.highScore);
    this.syncHud();
  }

  async startDemoRun({ preset = null } = {}) {
    if (preset || !this.demoAgent) {
      await this.initializeDemoAgent(preset);
    }

    this.startRun({ demo: true });
  }

  async startPreferredDemo() {
    try {
      const board = await fetchLeaderboard();
      const topAiReplay = (board?.aiEntries ?? []).find(
        (entry) => entry?.replayAvailable && entry?.replayId,
      );

      if (topAiReplay) {
        await this.startReplayFromEntry(topAiReplay);
        return;
      }
    } catch (error) {
      // Fall back to the live heuristic demo when the leaderboard is unavailable.
    }

    await this.startDemoRun({ preset: "edge-prediction" });
  }

  async startReplayFromEntry(entry) {
    const replayId = String(entry?.replayId || entry?.id || "").trim();
    if (!replayId) {
      this.ui.setStatusLine("Replay ID が見つからないため再生できません。");
      return;
    }

    const token = this.replayLoadToken + 1;
    this.replayLoadToken = token;
    this.audio.unlock();
    this.audio.stopMusic(0.12);
    this.ui.setSubmitStatus("");
    this.ui.setStatusLine("Replay を読み込み中です。");

    try {
      const replay = await fetchReplay(replayId);
      if (token !== this.replayLoadToken) {
        return;
      }

      const player = new ReplayPlayer(replay);
      if (!player.hasFrames()) {
        throw new Error("Replay has no frames");
      }

      this.replayRecorder.clear();
      this.replayPlayer = player;
      this.replayEntry = entry ?? null;
      this.isDemoRun = false;
      this.state = "replay";
      this.resetBarrierState();
      this.resetReplayTransientState();
      this.resetSimulationClocks();
      this.spawnAccumulator = 0;
      this.screenShake = 0;
      this.fireworkTimer = 0;
      player.reset();
      player.apply(this);
      this.syncTickCountersFromState();
      this.ui.showPlaying({
        replay: true,
        replayLabel: `${entry?.name ?? "Replay"} の replay を再生中です。Exit Replay で戻れます。`,
      });
      this.audio.startMusic(this.getAliveCities().length);
      this.syncHud();
    } catch (error) {
      this.replayPlayer = null;
      this.replayEntry = null;
      this.ui.setStatusLine("Replay の読み込みに失敗しました。Refresh 後にもう一度試してください。");
    }
  }

  exitReplay() {
    if (this.state !== "replay") {
      this.showTitle();
      return;
    }

    this.showTitle();
    this.ui.setStatusLine("Replay を終了しました。");
  }

  startRun({ demo = false } = {}) {
    this.audio.unlock();
    this.replayPlayer = null;
    this.replayEntry = null;
    this.isDemoRun = demo;
    this.state = "playing";
    this.elapsed = 0;
    this.score = 0;
    this.maxChain = 0;
    this.spawnAccumulator = 0.35;
    this.screenShake = 0;
    this.fireworkTimer = 0;
    this.aiShotCooldown = 0;
    this.enemyMissiles = [];
    this.interceptors = [];
    this.explosions = [];
    this.particles = [];
    this.comboCounts = new Map();
    this.cities = this.createCities();
    this.resetBarrierState();
    this.resetReplayTransientState();
    this.resetSimulationClocks();
    this.demoDecisionAccumulator = 0;
    this.demoAgent?.reset?.();
    this.replayRecorder.start(this, {
      kind: demo ? "ai" : "human",
      name: demo ? this.demoAgent?.policyName ?? "DEMO AI" : this.playerName,
      policyName: demo ? this.demoPolicy?.meta?.name ?? this.demoAgent?.policyName ?? "" : "",
      note: demo ? this.demoSource : "",
      source: demo ? this.demoSource : "human",
      gameVersion: this.gameVersion,
    });
    this.ui.showPlaying({ demo });
    this.ui.setSubmitStatus("");
    this.audio.startMusic(this.cities.length);
    this.ui.setAudioState({
      enabled: !this.audio.isMuted(),
      supported: this.audio.supported,
    });
    this.syncHud();
  }

  getTimeLeft() {
    return Math.max(0, WORLD.gameDuration - this.elapsed);
  }

  getReplayElapsed() {
    if (this.state === "deploying" && this.barrier?.active) {
      return WORLD.gameDuration + Math.max(0, Number(this.barrier.elapsed) || 0);
    }

    return this.elapsed;
  }

  resetBarrierState() {
    this.barrier = {
      active: false,
      elapsed: 0,
      progress: 0,
      stormAccumulator: 0,
    };
  }

  resetReplayTransientState() {
    this.replayFrameEvents = [];
    this.replayTransientParticles = [];
  }

  queueReplayEvent(type, payload = {}) {
    if (this.state !== "playing" && this.state !== "deploying") {
      return;
    }

    this.replayFrameEvents.push({ type, ...payload });
  }

  consumeReplayFrameEvents() {
    const events = Array.isArray(this.replayFrameEvents)
      ? this.replayFrameEvents.map((event) => ({ ...event }))
      : [];
    this.replayFrameEvents = [];
    return events;
  }

  getBarrierCountdownValue() {
    if (this.state !== "playing" && this.state !== "replay") {
      return null;
    }

    if (this.barrier?.active) {
      return null;
    }

    const timeLeft = this.getTimeLeft();
    if (timeLeft > BARRIER_BALANCE.countdownStart || timeLeft <= 0) {
      return null;
    }

    return Math.max(1, Math.ceil(timeLeft));
  }

  getBarrierSurfaceY(x) {
    if (!this.barrier?.active) {
      return WORLD.height + 80;
    }

    const centerX = WORLD.width * 0.5;
    const radiusX = WORLD.width * 0.5;
    const normalized = clamp((x - centerX) / radiusX, -1, 1);
    const dome = Math.sqrt(Math.max(0, 1 - normalized * normalized));
    const softenedDome = Math.pow(dome, 1.06);
    return BARRIER_BALANCE.edgeY - softenedDome * BARRIER_BALANCE.apexLift;
  }

  isBarrierBlocking() {
    return (
      this.state === "deploying" &&
      Boolean(this.barrier?.active) &&
      Number(this.barrier?.progress ?? 0) >= BARRIER_BALANCE.blockStartProgress
    );
  }

  absorbByBarrier(missile, force = false) {
    if (this.state !== "deploying" || !this.barrier?.active) {
      return false;
    }

    const barrierY = this.getBarrierSurfaceY(missile.x);
    if (!force && !this.isBarrierBlocking()) {
      return false;
    }

    if (!force && missile.y + missile.radius < barrierY) {
      return false;
    }

    addBarrierIntercept(this, missile.x, barrierY, missile.type);
    this.audio.playBarrierIntercept(missile.type);
    this.queueReplayEvent("barrier-intercept", {
      x: missile.x,
      y: barrierY,
      missileType: missile.type,
    });
    this.screenShake = Math.min(12, this.screenShake + 0.4);
    missile.active = false;
    return true;
  }

  startBarrierSequence() {
    if (this.state !== "playing" || this.getAliveCities().length === 0) {
      return;
    }

    this.state = "deploying";
    this.elapsed = WORLD.gameDuration;
    this.deployTicks = 0;
    this.barrier.active = true;
    this.barrier.elapsed = 0;
    this.barrier.progress = 0;
    this.barrier.stormAccumulator = 0;
    this.spawnAccumulator = 0;
    this.demoDecisionAccumulator = 0;
    this.aiShotCooldown = 0;
    addBarrierDeployWave(this);
    this.audio.playBarrierDeploy();
    this.queueReplayEvent("barrier-deploy");
    this.ui.setStatusLine("");
    this.syncHud();
  }

  getAliveCities() {
    return this.cities.filter((city) => city.alive);
  }

  findCityById(cityId) {
    return this.cities.find((city) => city.id === cityId) ?? null;
  }

  findCityAtImpactX(impactX) {
    return (
      this.cities.find(
        (city) => city.alive && impactX >= city.left && impactX <= city.right,
      ) ?? null
    );
  }

  createRandomImpactTarget({ preferredX = null, spread = null } = {}) {
    const minX = 28;
    const maxX = WORLD.width - 28;
    const targetX =
      Number.isFinite(preferredX) && Number.isFinite(spread)
        ? clamp(preferredX + randomRange(-spread, spread), minX, maxX)
        : randomRange(minX, maxX);
    const targetCity = this.findCityAtImpactX(targetX);
    return {
      targetX,
      targetCityId: targetCity?.id ?? null,
    };
  }

  launchInterceptor(x, y) {
    if (this.state !== "playing") {
      return;
    }

    this.audio.unlock();
    const clampedX = clamp(x, 28, WORLD.width - 28);
    const clampedY = clamp(y, 36, WORLD.groundY - 28);
    this.interceptors.push(new Interceptor(clampedX, clampedY));
    this.screenShake = Math.min(10, this.screenShake + 0.5);
    this.audio.playLaunch();
    this.queueReplayEvent("launch", { x: clampedX, y: clampedY });
  }

  queueLaunchRequest(x, y) {
    if (this.state !== "playing") {
      return;
    }

    this.audio.unlock();
    this.pendingLaunches.push({ x, y });
  }

  flushPendingLaunches() {
    if (this.state !== "playing" || this.pendingLaunches.length === 0) {
      return;
    }

    const launches = this.pendingLaunches.splice(0, this.pendingLaunches.length);
    for (const launch of launches) {
      this.launchInterceptor(launch.x, launch.y);
    }
  }

  getAiSnapshot() {
    return {
      width: WORLD.width,
      groundY: WORLD.groundY,
      timeLeft: this.getTimeLeft(),
      score: this.score,
      maxChain: this.maxChain,
      shotCooldownSeconds: this.aiShotCooldown,
      aliveCities: this.getAliveCities().length,
      cityCount: WORLD.cityCount,
      cities: this.cities.map((city) => ({
        id: city.id,
        index: city.index,
        x: city.x,
        y: city.y,
        width: city.width,
        height: city.height,
        alive: city.alive,
      })),
      enemyMissiles: this.enemyMissiles.map((missile) => ({
        id: missile.id,
        type: missile.type,
        x: missile.x,
        y: missile.y,
        targetX: missile.targetX,
        targetY: missile.targetY,
        targetCityId: missile.targetCityId,
        velocityX: missile.vx * missile.speed,
        velocityY: missile.vy * missile.speed,
        speed: missile.speed,
        progress: missile.progress,
        splitProgress: missile.splitProgress,
        visibleTicks: missile.visibleTicks,
        hitPoints: missile.hitPoints,
        radius: missile.radius,
        eta: Math.max(
          0,
          (missile.totalDistance - missile.distanceTravelled) / Math.max(1, missile.speed),
        ),
      })),
      explosions: this.explosions.map((explosion) => ({
        x: explosion.x,
        y: explosion.y,
        currentRadius: explosion.currentRadius,
        damaging: explosion.damaging,
        secondary: explosion.secondary,
      })),
    };
  }

  updateDemoAgent(dt) {
    if (!this.isDemoRun || !this.demoAgent || this.state !== "playing") {
      return;
    }

    this.aiShotCooldown = Math.max(0, this.aiShotCooldown - dt);
    this.demoDecisionAccumulator += dt;
    while (this.demoDecisionAccumulator >= this.demoDecisionInterval) {
      const action = this.demoAgent.nextAction(this.getAiSnapshot());
      const target = resolveAgentActionTarget(action);
      if (target && this.aiShotCooldown <= 0) {
        this.launchInterceptor(target.x, target.y);
        this.aiShotCooldown = AI_BALANCE.cooldownSeconds;
      }
      this.demoDecisionAccumulator -= this.demoDecisionInterval;
    }
  }

  spawnEnemy(forcedType = null) {
    const aliveCities = this.getAliveCities();
    if (aliveCities.length === 0) {
      return;
    }

    const progress = this.elapsed / WORLD.gameDuration;
    const type = forcedType ?? pickEnemyType(progress);
    const startX = randomRange(60, WORLD.width - 60);
    const { targetX, targetCityId } = this.createRandomImpactTarget();
    const missile = new EnemyMissile({
      type,
      startX,
      startY: -48,
      targetX,
      targetY: WORLD.groundY - 6,
      targetCityId,
      speed: getEnemySpeed(type),
      splitProgress: randomRange(0.34, 0.62),
    });

    this.enemyMissiles.push(missile);
  }

  spawnSplitChildren(missile) {
    const children = [];
    const childCount = 2;

    for (let index = 0; index < childCount; index += 1) {
      const direction = index === 0 ? -1 : 1;
      const childType = Math.random() < 0.62 ? "normal" : "fast";
      const preferredX = missile.x + direction * randomRange(180, 340);
      const { targetX, targetCityId } = this.createRandomImpactTarget({
        preferredX,
        spread: 180,
      });

      children.push(
        new EnemyMissile({
          type: childType,
          startX: missile.x,
          startY: missile.y,
          targetX,
          targetY: WORLD.groundY - 6,
          targetCityId,
          speed: getEnemySpeed(childType) * 0.96,
          splitProgress: 1,
        }),
      );
    }

    addSplitFlash(this, missile.x, missile.y);
    this.audio.playSplit();
    this.queueReplayEvent("split", { x: missile.x, y: missile.y });
    return children;
  }

  destroyCity(city, impactX) {
    if (!city || !city.destroy()) {
      addGroundImpact(this, impactX, WORLD.groundY - 4);
      return;
    }

    addGroundImpact(this, impactX, WORLD.groundY - 4);
    addCityCollapse(this, city);
    this.audio.playCityLost();
    this.queueReplayEvent("city-lost", {
      cityId: city.id,
      x: impactX,
      y: WORLD.groundY - 4,
    });
  }

  handleEnemyDestroyed(missile, explosion) {
    const previousCount = this.comboCounts.get(explosion.comboId) ?? 0;
    const chainCount = previousCount + 1;
    this.comboCounts.set(explosion.comboId, chainCount);
    this.maxChain = Math.max(this.maxChain, chainCount);

    this.score += getScoreGain(missile.type, chainCount);
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.saveHighScore();
    }

    this.audio.playEnemyDestroyed(missile.type, chainCount);
    this.queueReplayEvent("enemy-destroyed", {
      x: missile.x,
      y: missile.y,
      missileType: missile.type,
      chainCount,
    });
    addSecondaryExplosion(this, missile, explosion.comboId, explosion.chainDepth + 1);
  }

  finishRun(result) {
    if (this.state !== "playing") {
      if (this.state !== "deploying") {
        return;
      }
    }

    if (this.state === "deploying" && result !== "clear") {
      return;
    }

    this.queueReplayEvent("result", { result });
    const aliveCities = this.getAliveCities().length;
    const clearBonus = result === "clear" ? getClearCityBonus(aliveCities) : 0;
    if (clearBonus > 0) {
      this.score += clearBonus;
    }
    const replay = this.replayRecorder.finish(this, result);
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }
    this.state = result;
    this.enemyMissiles = [];
    this.interceptors = [];
    this.resetBarrierState();
    this.saveHighScore();
    this.audio.stopMusic(0.22);
    this.audio.playResult(result);
    this.ui.showResult(result, {
      score: this.score,
      maxChain: this.maxChain,
      aliveCities,
      highScore: this.highScore,
      demo: this.isDemoRun,
      clearBonus,
    });
    void this.submitRunResult(result, replay);
    this.syncHud();
  }

  async submitRunResult(result, replay) {
    const survivingCities = this.getAliveCities().length;
    if (this.score <= 0) {
      this.ui.setSubmitStatus("スコアが0のため leaderboard 送信は行いませんでした。");
      return;
    }

    const payload = {
      kind: this.isDemoRun ? "ai" : "human",
      name: this.isDemoRun ? this.demoAgent?.policyName ?? "DEMO AI" : this.playerName,
      score: this.score,
      maxChain: this.maxChain,
      survivingCities,
      clear: result === "clear",
      policyName: this.isDemoRun ? this.demoPolicy?.meta?.name ?? this.demoAgent?.policyName ?? "" : "",
      comment: this.isDemoRun ? this.demoSource : this.playerComment,
      note: this.isDemoRun ? this.demoSource : "",
      replay,
    };

    this.ui.setSubmitStatus(
      this.isDemoRun ? "AI スコアを leaderboard に送信中です。" : "スコアを leaderboard に送信中です。",
    );

    try {
      const response = await submitLeaderboardEntry(payload);
      await this.refreshLeaderboard();
      this.ui.setSubmitStatus(
        response?.keptInTop10 === false
          ? this.isDemoRun
            ? "AI スコアは送信されましたが、現時点では AI Top10 圏外のため replay は保持されませんでした。"
            : "スコアは送信されましたが、現時点では Human Top10 圏外のため replay は保持されませんでした。"
          : this.isDemoRun
            ? "AI スコアと replay を leaderboard に反映しました。"
            : "スコアと replay を leaderboard に反映しました。",
      );
    } catch (error) {
      this.ui.setSubmitStatus(
        "Leaderboardサーバーに接続できないため、ローカルのハイスコアのみ更新しました。",
      );
    }
  }

  updateCities(dt) {
    for (const city of this.cities) {
      city.update(dt);
    }
  }

  updateEnemyMissiles(dt) {
    const survivors = [];
    const spawnedChildren = [];

    for (const missile of this.enemyMissiles) {
      if (!missile.active) {
        continue;
      }

      const { reachedTarget } = missile.update(dt);

      if (this.absorbByBarrier(missile)) {
        continue;
      }

      if (missile.shouldSplit()) {
        missile.splitTriggered = true;
        spawnedChildren.push(...this.spawnSplitChildren(missile));
        continue;
      }

      if (reachedTarget) {
        if (this.state === "deploying") {
          this.absorbByBarrier(missile, true);
          continue;
        }
        const targetCity = this.findCityAtImpactX(missile.x);
        this.destroyCity(targetCity, missile.x);
        continue;
      }

      survivors.push(missile);
    }

    this.enemyMissiles = survivors.concat(spawnedChildren);
  }

  updateInterceptors(dt) {
    const survivors = [];

    for (const interceptor of this.interceptors) {
      if (interceptor.update(dt)) {
        addPlayerExplosion(this, interceptor.targetX, interceptor.targetY);
        this.audio.playPlayerExplosion();
        this.queueReplayEvent("player-explosion", {
          x: interceptor.targetX,
          y: interceptor.targetY,
        });
      } else {
        survivors.push(interceptor);
      }
    }

    this.interceptors = survivors;
  }

  updateExplosions(dt) {
    const activeExplosions = [];

    for (const explosion of this.explosions) {
      if (explosion.update(dt)) {
        activeExplosions.push(explosion);
      }
    }

    const destroyedIds = new Set();

    // Each explosion can only damage the same missile once, but overlapping
    // explosions still stack. That keeps armored targets readable and fair.
    for (const explosion of activeExplosions) {
      if (!explosion.damaging) {
        continue;
      }

      for (const missile of this.enemyMissiles) {
        if (!missile.active || destroyedIds.has(missile.id) || explosion.hitIds.has(missile.id)) {
          continue;
        }

        const distance = Math.hypot(missile.x - explosion.x, missile.y - explosion.y);
        if (distance > explosion.currentRadius + missile.radius) {
          continue;
        }

        explosion.hitIds.add(missile.id);
        const outcome = missile.takeHit();

        if (outcome.destroyed) {
          destroyedIds.add(missile.id);
          this.handleEnemyDestroyed(missile, explosion);
        } else {
          addArmorSparks(this, missile.x, missile.y);
          this.audio.playArmorHit();
          this.queueReplayEvent("armor-hit", { x: missile.x, y: missile.y });
        }
      }
    }

    this.explosions = activeExplosions;

    if (destroyedIds.size > 0) {
      this.enemyMissiles = this.enemyMissiles.filter((missile) => !destroyedIds.has(missile.id));
    }
  }

  updateParticles(dt) {
    this.particles = this.particles.filter((particle) => particle.update(dt));
  }

  processReplayFrameEvents(dt) {
    this.replayTransientParticles = this.replayTransientParticles.filter((particle) => particle.update(dt));
    this.particles = this.replayTransientParticles;

    const events = Array.isArray(this.replayFrameEvents) ? this.replayFrameEvents : [];
    this.replayFrameEvents = [];

    for (const event of events) {
      switch (event?.type) {
        case "launch":
          this.audio.playLaunch();
          break;
        case "player-explosion":
          this.audio.playPlayerExplosion();
          break;
        case "enemy-destroyed":
          this.audio.playEnemyDestroyed(event.missileType, event.chainCount);
          break;
        case "armor-hit":
          this.audio.playArmorHit();
          break;
        case "split":
          this.audio.playSplit();
          break;
        case "city-lost":
          this.audio.playCityLost();
          break;
        case "barrier-deploy":
          addBarrierDeployWave(this);
          this.audio.playBarrierDeploy();
          this.screenShake = Math.min(14, this.screenShake + 0.9);
          break;
        case "barrier-intercept":
          addReplayBarrierInterceptBurst(
            this,
            Number(event.x) || 0,
            Number(event.y) || 0,
            event.missileType,
          );
          this.audio.playBarrierIntercept(event.missileType);
          this.screenShake = Math.min(12, this.screenShake + 0.45);
          break;
        case "result":
          this.audio.stopMusic(0.18);
          this.audio.playResult(event.result);
          break;
        default:
          break;
      }
    }
  }

  spawnBarrierStorm(dt) {
    if (!this.barrier?.active || Number(this.barrier?.progress ?? 0) < BARRIER_BALANCE.blockStartProgress) {
      return;
    }

    const totalDuration = BARRIER_BALANCE.deployDuration + BARRIER_BALANCE.sustainDuration;
    const spawnCutoff = totalDuration - 1.35;
    if (this.barrier.elapsed >= spawnCutoff) {
      return;
    }

    const pressure = clamp(this.barrier.elapsed / Math.max(0.001, spawnCutoff), 0, 1);
    const stormRate = BARRIER_BALANCE.postDeploySpawnRate * (1.1 + pressure * 0.9);
    this.barrier.stormAccumulator += dt * stormRate;
    while (
      this.barrier.stormAccumulator >= 1 &&
      this.enemyMissiles.length < BARRIER_BALANCE.maxStormMissiles
    ) {
      this.barrier.stormAccumulator -= 1;
      let volleyCount = 1;
      if (Math.random() < BARRIER_BALANCE.stormBurstChance) {
        volleyCount += 1;
        if (Math.random() < 0.38 + pressure * 0.26) {
          volleyCount += 1;
        }
      }

      for (
        let index = 0;
        index < volleyCount && this.enemyMissiles.length < BARRIER_BALANCE.maxStormMissiles;
        index += 1
      ) {
        const roll = Math.random();
        const forcedType =
          roll < 0.22
            ? "fast"
            : roll < 0.47
              ? "split"
              : roll < 0.77
                ? "normal"
                : "armored";
        this.spawnEnemy(forcedType);
      }
    }
  }

  updatePlaying(dt) {
    this.playTicks += 1;
    this.elapsed = Math.min(WORLD.gameDuration, this.playTicks * this.fixedStepSeconds);
    this.audio.update(this.state, this.getAliveCities().length, this.getTimeLeft());
    this.flushPendingLaunches();
    this.updateDemoAgent(dt);

    // Spawn intensity ramps over the full 60 seconds, with occasional bursts
    // so the endgame feels denser without requiring a separate wave script.
    this.spawnAccumulator += dt * getSpawnRate(this.elapsed);
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnEnemy();

      if (Math.random() < getBurstChance(this.elapsed)) {
        this.spawnEnemy();
      }
    }

    this.updateCities(dt);
    this.updateEnemyMissiles(dt);
    this.updateInterceptors(dt);
    this.updateExplosions(dt);
    this.updateParticles(dt);
    this.replayRecorder.update(this);

    if (this.getAliveCities().length === 0) {
      this.finishRun("gameover");
      return;
    }

    if (this.playTicks >= Math.round(WORLD.gameDuration / this.fixedStepSeconds)) {
      this.startBarrierSequence();
      return;
    }

    this.syncHud();
  }

  updateDeploying(dt) {
    this.elapsed = WORLD.gameDuration;
    this.deployTicks += 1;
    this.barrier.elapsed = this.deployTicks * this.fixedStepSeconds;
    this.barrier.progress = clamp(this.barrier.elapsed / BARRIER_BALANCE.deployDuration, 0, 1);

    this.audio.update("deploying", this.getAliveCities().length, 0);
    this.spawnBarrierStorm(dt);
    this.updateCities(dt);
    this.updateEnemyMissiles(dt);
    this.updateInterceptors(dt);
    this.updateExplosions(dt);
    this.updateParticles(dt);
    this.replayRecorder.update(this);

    const stormFinished =
      this.barrier.elapsed >= BARRIER_BALANCE.deployDuration + BARRIER_BALANCE.sustainDuration;
    const noActiveThreats =
      this.enemyMissiles.length === 0 && this.interceptors.length === 0 && this.explosions.length === 0;

    if (stormFinished && noActiveThreats) {
      this.finishRun("clear");
      return;
    }

    this.syncHud();
  }

  updateReplay() {
    if (!this.replayPlayer) {
      this.showTitle();
      return;
    }

    const finished = this.replayPlayer.advance();
    this.replayPlayer.apply(this);
    this.syncTickCountersFromState();
    this.audio.update("replay", this.getAliveCities().length, this.getTimeLeft());
    this.processReplayFrameEvents(this.fixedStepSeconds);
    this.syncHud();

    if (finished) {
      const label = `${this.replayEntry?.name ?? "Replay"} の replay が終了しました。`;
      this.showTitle();
      this.ui.setStatusLine(label);
    }
  }

  updateAmbient(dt) {
    this.audio.update(this.state, this.getAliveCities().length, this.getTimeLeft());
    this.updateCities(dt);
    this.updateExplosions(dt);
    this.updateParticles(dt);

    if (this.state === "clear") {
      this.fireworkTimer -= dt;
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = randomRange(0.2, 0.55);
        addCelebrationFirework(
          this,
          randomRange(120, WORLD.width - 120),
          randomRange(110, WORLD.groundY - 180),
        );
      }
    }

    if (this.state === "gameover" && Math.random() < dt * 4) {
      addAmbientEmbers(this);
    }

    this.syncHud();
  }

  syncHud() {
    this.ui.updateHud({
      score: this.score,
      maxChain: this.maxChain,
      timeLeft: this.getTimeLeft(),
      aliveCities: this.getAliveCities().length,
      cityCount: WORLD.cityCount,
      highScore: this.highScore,
      state: this.state,
    });
  }

  frame(timestamp) {
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }

    const dt = Math.min(0.1, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    this.frameAccumulator = Math.min(
      this.fixedStepSeconds * this.maxFixedStepsPerFrame,
      this.frameAccumulator + dt,
    );

    let steps = 0;
    while (
      this.frameAccumulator >= this.fixedStepSeconds &&
      steps < this.maxFixedStepsPerFrame
    ) {
      this.screenShake = Math.max(0, this.screenShake - this.fixedStepSeconds * 18);

      if (this.state === "playing") {
        this.updatePlaying(this.fixedStepSeconds);
      } else if (this.state === "deploying") {
        this.updateDeploying(this.fixedStepSeconds);
      } else if (this.state === "replay") {
        this.updateReplay();
      } else {
        this.updateAmbient(this.fixedStepSeconds);
      }

      this.frameAccumulator -= this.fixedStepSeconds;
      steps += 1;
    }

    if (steps === 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 18);
    }

    this.renderer.render(this);
    requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }
}

if (typeof document !== "undefined") {
  new Game();
}
