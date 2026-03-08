function formatScore(score) {
  return Number(score ?? 0).toLocaleString('ja-JP');
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

void loadGames();
