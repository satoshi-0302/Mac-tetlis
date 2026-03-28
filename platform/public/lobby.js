function formatScore(score) {
  return Number(score ?? 0).toLocaleString('ja-JP');
}

function shouldPreferMobileRoute() {
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const narrowViewport =
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
  return coarsePointer || narrowViewport;
}

function resolveRoute(game, mode = 'auto') {
  if (mode === 'desktop' && game.desktopRoute) {
    return game.desktopRoute;
  }
  if (mode === 'mobile' && game.mobileRoute) {
    return game.mobileRoute;
  }
  if (shouldPreferMobileRoute()) {
    return game.mobileRoute || game.route;
  }
  return game.desktopRoute || game.route;
}

let deferredInstallPrompt = null;

function updateInstallStatus(message) {
  const status = document.getElementById('installStatus');
  if (status instanceof HTMLElement) {
    status.textContent = message;
  }
}

function toggleInstallButton(visible) {
  const button = document.getElementById('installButton');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  button.classList.toggle('hidden', !visible);
}

async function registerPwaSupport() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.error('Service worker registration failed', error);
    }
  }

  const installButton = document.getElementById('installButton');
  if (!(installButton instanceof HTMLButtonElement)) {
    return;
  }

  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      updateInstallStatus('この端末では共有メニューから「ホーム画面に追加」を選んでください。');
      return;
    }

    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      updateInstallStatus('ホーム画面への追加を開始しました。');
    } else {
      updateInstallStatus('あとで追加できます。必要なときにもう一度押してください。');
    }
    deferredInstallPrompt = null;
    toggleInstallButton(false);
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    toggleInstallButton(true);
    updateInstallStatus('ホーム画面に追加すると、60秒ゲームをすぐ起動できます。');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    toggleInstallButton(false);
    updateInstallStatus('ホーム画面に追加されました。アプリのように開けます。');
  });
}

function renderGameCard(game) {
  const article = document.createElement('article');
  article.className = 'game-card';

  const media = document.createElement('div');
  media.className = 'card-media';

  const thumb = document.createElement('img');
  thumb.className = 'card-thumb';
  thumb.src = `/static/assets/thumbnails/${game.id}.png`;
  thumb.alt = `${game.title} thumbnail`;
  thumb.loading = 'lazy';

  const scoreLine = document.createElement('div');
  scoreLine.className = 'score-line';
  scoreLine.innerHTML = `
    <span class="score-label">BEST ${game.topEntry ? formatScore(game.topEntry.score) : '--'}</span>
    <span class="score-sub">${game.topEntry ? game.topEntry.name : 'NO RECORD'}</span>
  `;

  const content = document.createElement('div');
  content.className = 'card-content';

  const primaryLink = document.createElement('a');
  primaryLink.className = 'play-button';
  const urlParams = new URLSearchParams(window.location.search);
  const currentMode = urlParams.get('mode') || (shouldPreferMobileRoute() ? 'mobile' : 'desktop');
  primaryLink.href = resolveRoute(game, currentMode);
  primaryLink.textContent = 'PLAY';

  media.append(thumb, scoreLine);
  content.append(primaryLink);
  article.append(media, content);
  return article;
}

function initModeSwitcher() {
  const toggleBtn = document.getElementById('modeToggleButton');
  const toggleText = document.getElementById('toggleText');
  if (!toggleBtn || !toggleText) return;

  const urlParams = new URLSearchParams(window.location.search);
  const currentMode = urlParams.get('mode');
  const isMobile = currentMode === 'mobile' || (!currentMode && shouldPreferMobileRoute());

  toggleText.textContent = isMobile ? 'SWITCH TO DESKTOP' : 'SWITCH TO MOBILE';

  toggleBtn.addEventListener('click', () => {
    const nextMode = isMobile ? 'desktop' : 'mobile';
    urlParams.set('mode', nextMode);
    window.location.search = urlParams.toString();
  });
}

async function loadGames() {
  const grid = document.getElementById('gameGrid');
  if (!(grid instanceof HTMLElement)) {
    return;
  }

  try {
    const response = await fetch('/api/games', {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const payload = await response.json();
    const games = Array.isArray(payload?.games) ? payload.games : [];

    grid.replaceChildren();
    if (games.length === 0) {
      const emptyCard = document.createElement('article');
      emptyCard.className = 'game-card loading-card';
      emptyCard.textContent = '公開中のゲームはまだありません。';
      grid.append(emptyCard);
      return;
    }

    for (const game of games) {
      grid.append(renderGameCard(game));
    }
  } catch (error) {
    grid.replaceChildren();
    const errorCard = document.createElement('article');
    errorCard.className = 'game-card loading-card';
    errorCard.textContent = 'ゲーム一覧の読み込みに失敗しました。';
    grid.append(errorCard);
  }
}

void registerPwaSupport();
void initModeSwitcher();
void loadGames();
