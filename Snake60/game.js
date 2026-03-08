const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gameContainer = document.getElementById('game-container');

const uiLayer = document.getElementById('ui-layer');
const titleScreen = document.getElementById('title-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const gameOverTitle = document.getElementById('gameover-title');
const currentScoreEl = document.getElementById('current-score');
const timeLeftEl = document.getElementById('time-left');
const highScoreHUD = document.getElementById('high-score');
const finalScoreEl = document.getElementById('final-score');
const leaderboardList = document.getElementById('leaderboard-list');
const hsEntryForm = document.getElementById('highscore-entry');
const hsNameInput = document.getElementById('hs-name');
const hsMsgInput = document.getElementById('hs-message');
const hsSubmitBtn = document.getElementById('hs-submit');
const restartPrompt = document.getElementById('restart-prompt');
const replayExitBtn = document.getElementById('replay-exit');
const modeBanner = document.getElementById('mode-banner');

const GRID_SIZE = 20;
const TILE_COUNT_X = canvas.width / GRID_SIZE;
const TILE_COUNT_Y = canvas.height / GRID_SIZE;
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
const DIRECTION_VECTORS = {
    U: { x: 0, y: -1 },
    D: { x: 0, y: 1 },
    L: { x: -1, y: 0 },
    R: { x: 1, y: 0 },
};

let snake = [];
let velocity = { x: 1, y: 0 };
let lastInput = { x: 1, y: 0 };
let apples = [];
let deadBodyParts = [];
let particles = [];
let score = 0;
let highScore = Number(localStorage.getItem('websnake_highscore') || 0);
let speed = INITIAL_SPEED;
let timeLeft = START_TIME;
let gameSeed = 12345;
let topScores = [];
let currentGameState = 'TITLE';
let inputQueue = [];
let recordedDirections = [];
let replayPlayback = null;
let simulationAccumulator = 0;
let moveAccumulator = 0;
let frameTickCount = 0;
let straightMovesSinceTurn = 0;
let activeMinStraightMoves = HUMAN_MIN_STRAIGHT_MOVES;
let lastTime = 0;
let gameLoopId = null;
let loadingReplay = false;

function seededRandom() {
    let t = gameSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function directionCodeFromVector(vector) {
    if (vector.x === 0 && vector.y === -1) return 'U';
    if (vector.x === 0 && vector.y === 1) return 'D';
    if (vector.x === -1 && vector.y === 0) return 'L';
    return 'R';
}

function sanitizeName(value) {
    const cleaned = String(value || '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 5)
        .toUpperCase();
    return cleaned || 'ANON';
}

function sanitizeMessage(value) {
    return String(value || '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 30);
}

function setModeBanner(text) {
    if (!text) {
        modeBanner.textContent = '';
        modeBanner.classList.add('hidden');
        return;
    }
    modeBanner.textContent = text;
    modeBanner.classList.remove('hidden');
}

function formatTurnModeLabel(minStraightMoves) {
    return minStraightMoves > 0 ? `LOCK ${minStraightMoves}` : 'FREE TURN';
}

function setReplayControlsVisible(visible) {
    replayExitBtn.classList.toggle('hidden', !visible);
}

function resetCoreState() {
    snake = [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 },
        { x: 7, y: 10 },
        { x: 6, y: 10 },
        { x: 5, y: 10 },
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
    currentScoreEl.innerText = score;
    timeLeftEl.innerText = timeLeft;
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
    recordedDirections = [];
    replayPlayback = null;
    currentGameState = 'PLAYING';
    setModeBanner('FREE TURN');
    setReplayControlsVisible(false);
    synth.startBGM();
}

function applyDirectionCode(code) {
    const next = DIRECTION_VECTORS[code];
    if (!next) return;
    if (lastInput.x === -next.x && lastInput.y === -next.y) return;
    const sameDirection = velocity.x === next.x && velocity.y === next.y;
    if (!sameDirection && straightMovesSinceTurn < activeMinStraightMoves) return;
    velocity = { x: next.x, y: next.y };
    if (!sameDirection) {
        straightMovesSinceTurn = 0;
    }
}

function queueDirectionForGameplay(key) {
    let code = '';
    switch (key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            code = 'U';
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            code = 'D';
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            code = 'L';
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            code = 'R';
            break;
        default:
            return;
    }
    const lastQueued = inputQueue[inputQueue.length - 1] || directionCodeFromVector(velocity);
    if (code === lastQueued) return;
    inputQueue.push(code);
    if (inputQueue.length > 2) {
        inputQueue.shift();
    }
}

function playRunEndEffects() {
    const head = snake[0];
    if (head) {
        spawnParticles(head.x, head.y, '#ffffff', 50);
    }

    deadBodyParts = snake.map((segment, index) => {
        const angle = Math.random() * Math.PI * 2;
        const force = (Math.random() * 8) + 2;
        return {
            x: segment.x * GRID_SIZE,
            y: segment.y * GRID_SIZE,
            vx: Math.cos(angle) * force,
            vy: Math.sin(angle) * force,
            rotation: 0,
            vRot: (Math.random() - 0.5) * 0.5,
            color: index === 0 ? '#ffffff' : COLOR_SNAKE,
        };
    });

    snake = [];
    apples = [];
    gameContainer.classList.remove('shake');
    void gameContainer.offsetWidth;
    gameContainer.classList.add('shake-heavy');
}

function qualifiesForTop10(value) {
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
        highScoreHUD.innerText = highScore;
    }

    setReplayControlsVisible(false);
    setModeBanner(isReplay ? 'REPLAY COMPLETE' : '');

    const shouldSubmit = !isReplay && score > 0 && qualifiesForTop10(score);
    setTimeout(() => {
        finalScoreEl.innerText = score;
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
            hsNameInput.value = '';
            hsMsgInput.value = '';
            hsNameInput.focus();
        } else {
            hsEntryForm.classList.add('hidden');
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
}

async function fetchScores() {
    try {
        const res = await fetch('/api/scores');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        topScores = await res.json();
        renderLeaderboard();
        if (topScores.length > 0) {
            highScore = Number(topScores[0].score || 0);
            highScoreHUD.innerText = highScore;
        }
    } catch (error) {
        console.error('Failed to fetch scores', error);
        leaderboardList.innerHTML = '';
        const li = document.createElement('li');
        li.textContent = 'Leaderboard unavailable.';
        leaderboardList.appendChild(li);
    }
}

async function fetchReplay(replayId) {
    const res = await fetch(`/api/replays/${encodeURIComponent(String(replayId || ''))}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function buildReplayPayload() {
    if (recordedDirections.length === 0 || recordedDirections.length > MAX_REPLAY_TICKS) {
        return null;
    }
    return {
        version: REPLAY_VERSION,
        tickRate: REPLAY_TICK_RATE,
        minStraightMoves: activeMinStraightMoves,
        directions: recordedDirections.join(''),
    };
}

async function submitScore(name, message) {
    const replay = buildReplayPayload();
    if (!replay) return false;

    try {
        const res = await fetch('/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, message, replay }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        topScores = Array.isArray(payload.scores) ? payload.scores : [];
        renderLeaderboard();
        if (topScores.length > 0) {
            highScore = Number(topScores[0].score || 0);
            highScoreHUD.innerText = highScore;
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
        li.className = 'lb-row ' + (index === 0 ? 'highlight' : '');

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
            button.addEventListener('click', () => {
                void startReplayFromEntry(entry);
            });
            action.appendChild(button);
        } else {
            action.textContent = '--';
        }

        li.append(rank, name, scoreValue, message, action);
        leaderboardList.appendChild(li);
    });
}

async function startReplayFromEntry(entry) {
    if (loadingReplay) return;

    loadingReplay = true;
    setModeBanner('LOADING REPLAY');
    setReplayControlsVisible(false);

    try {
        const replay = await fetchReplay(entry.replayId || entry.id);
        if (!replay?.directions) {
            throw new Error('Replay payload is empty');
        }

        synth.init();
        resetCoreState();
        hideAllOverlays();
        activeMinStraightMoves = Math.max(0, Number(replay.minStraightMoves ?? 0));
        replayPlayback = {
            entry,
            directions: String(replay.directions),
            tickIndex: 0,
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
        let newApple = { x: 0, y: 0 };

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

        apples.push(newApple);
    }
}

function triggerScreenShake() {
    gameContainer.classList.remove('shake');
    void gameContainer.offsetWidth;
    gameContainer.classList.add('shake');
}

function spawnParticles(x, y, color, amount = 15) {
    for (let i = 0; i < amount; i += 1) {
        particles.push({
            x: x * GRID_SIZE + GRID_SIZE / 2,
            y: y * GRID_SIZE + GRID_SIZE / 2,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            life: 1,
            decay: 0.02 + Math.random() * 0.03,
            color,
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
    particles.forEach((particle) => {
        ctx.globalAlpha = particle.life;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 3 * particle.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 10;
        ctx.shadowColor = particle.color;
        ctx.fill();
        ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;
}

function updateLogic() {
    lastInput = { x: velocity.x, y: velocity.y };

    const newHead = {
        x: snake[0].x + velocity.x,
        y: snake[0].y + velocity.y,
    };

    if (newHead.x < 0) newHead.x = TILE_COUNT_X - 1;
    if (newHead.x >= TILE_COUNT_X) newHead.x = 0;
    if (newHead.y < 0) newHead.y = TILE_COUNT_Y - 1;
    if (newHead.y >= TILE_COUNT_Y) newHead.y = 0;

    for (let index = 0; index < snake.length; index += 1) {
        if (snake[index].x === newHead.x && snake[index].y === newHead.y) {
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
            currentScoreEl.innerText = score;
            speed = Math.max(30, speed - SPEED_INC);

            synth.playEatSound();
            triggerScreenShake();
            spawnParticles(apples[index].x, apples[index].y, COLOR_APPLE);

            apples.splice(index, 1);
            break;
        }
    }

    if (ateApple) {
        placeApples();
    } else {
        snake.pop();
    }

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
        timeLeftEl.innerText = timeLeft;

        if (timeLeft <= 10 && timeLeft > 0) {
            timeLeftEl.classList.add('time-warning');
            triggerScreenShake();
            synth.playMoveSound();
        }

        if (timeLeft <= 0) {
            timeLeft = 0;
            timeLeftEl.innerText = 0;
            finishRun();
            return;
        }
    }

    moveAccumulator += REPLAY_TICK_MS;
    if (moveAccumulator >= speed) {
        updateLogic();
        moveAccumulator = 0;
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
        applyDirectionCode(replayPlayback.directions[replayPlayback.tickIndex]);
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

function drawGame(renderTime) {
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
            ctx.globalAlpha = 1 - (index / (snake.length * 1.5));
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

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min(100, timestamp - lastTime);
    lastTime = timestamp;
    simulationAccumulator += dt;

    while (simulationAccumulator >= REPLAY_TICK_MS) {
        simulationAccumulator -= REPLAY_TICK_MS;
        updateSimulationFrame();
    }

    drawGame(timestamp);
    gameLoopId = requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (event) => {
    if (synth.ctx.state === 'suspended') {
        synth.init();
    }

    if (currentGameState === 'TITLE') {
        if (event.code === 'Space') {
            startGame();
        }
        return;
    }

    if (currentGameState === 'GAMEOVER' || currentGameState === 'REPLAY_OVER') {
        if (event.code === 'Space' || event.code === 'Escape') {
            returnToTitle();
        }
        return;
    }

    if (currentGameState === 'SUBMITTING') {
        if (event.code === 'Escape') {
            returnToTitle();
            return;
        }
        if (event.key === 'Enter') {
            hsSubmitBtn.click();
        }
        return;
    }

    if (currentGameState === 'REPLAY') {
        if (event.code === 'Escape' || event.code === 'Space') {
            returnToTitle();
        }
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
    if (submitted) {
        returnToTitle();
    } else {
        hsSubmitBtn.innerText = 'RETRY SUBMIT';
        hsSubmitBtn.disabled = false;
    }
});

replayExitBtn.addEventListener('click', () => {
    if (currentGameState === 'REPLAY') {
        returnToTitle();
    }
});

fetchScores();
highScoreHUD.innerText = highScore;
ctx.fillStyle = COLOR_BG;
ctx.fillRect(0, 0, canvas.width, canvas.height);
drawGrid();
gameLoopId = requestAnimationFrame(gameLoop);
