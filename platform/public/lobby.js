function formatScore(score) {
  return Number(score ?? 0).toLocaleString('ja-JP');
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

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const badge = document.createElement('span');
  badge.className = `device-badge ${game.supportsTouch ? 'touch' : 'desktop'}`;
  badge.textContent = game.supportsTouch ? 'PC / スマホ' : 'PC 優先';

  const replayBadge = document.createElement('span');
  replayBadge.className = 'device-badge replay';
  replayBadge.textContent = game.supportsReplay ? 'Replay 対応' : 'Replay なし';

  meta.append(badge, replayBadge);

  const title = document.createElement('h2');
  title.textContent = game.title;

  const description = document.createElement('p');
  description.className = 'card-copy';
  description.textContent = game.description;

  const scoreBlock = document.createElement('div');
  scoreBlock.className = 'score-block';
  scoreBlock.innerHTML = `
    <span class="score-label">現在の 1 位</span>
    <strong>${game.topEntry ? formatScore(game.topEntry.score) : '--'}</strong>
    <span class="score-sub">${game.topEntry ? `${game.topEntry.name} / ${game.topEntry.kind === 'ai' ? 'AI' : 'PLAYER'}` : 'まだ記録がありません'}</span>
  `;

  const actionRow = document.createElement('div');
  actionRow.className = 'action-row';

  const link = document.createElement('a');
  link.className = 'play-button';
  link.href = game.route;
  link.textContent = 'PLAY';

  actionRow.append(link);
  article.append(meta, title, description, scoreBlock, actionRow);
  return article;
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
void loadGames();
