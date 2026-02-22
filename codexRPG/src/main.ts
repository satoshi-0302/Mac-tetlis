// App bootstrap for the canvas roguelike MVP.

import './style.css';
import { RoguelikeGame } from './game/game';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app element was not found.');
}
const appRoot = root;

function renderFatal(error: unknown): void {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  appRoot.innerHTML = `<pre class="fatal-error">初期化に失敗しました\n${message}</pre>`;
}

try {
  const game = new RoguelikeGame(appRoot);
  game.init().catch((error: unknown) => {
    renderFatal(error);
  });
} catch (error: unknown) {
  renderFatal(error);
}
