import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_DIR = join(__dirname, '../public/assets/thumbnails');

mkdirSync(OUTPUT_DIR, { recursive: true });

const GAMES = [
  { id: 'snake60', url: 'http://localhost:9090/games/snake60/?scene=demo', wait: 1000 },
  { id: 'missile-command', url: 'http://localhost:9090/games/missile-command/?scene=showcase', wait: 2000 },
  { id: 'asteroid', url: 'http://localhost:9090/games/asteroid/?scene=demo', wait: 1500 },
  { id: 'slot60', url: 'http://localhost:9090/games/slot60/', wait: 1000 },
  { id: 'stackfall', url: 'http://localhost:9090/games/stackfall/?scene=demo', wait: 1000 }
];

async function capture() {
  console.log('Starting Playwright...');
  // We specify executablePath to use the system Chrome/Chromium if possible, 
  // or see if playwright-core can find it. On mac, Chrome is usually at:
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: 450 },
    deviceScaleFactor: 2
  });

  for (const game of GAMES) {
    console.log(`Capturing ${game.id}...`);
    await page.goto(game.url);
    if (game.id === 'slot60') {
      // Try to click spin if possible to get a dynamic shot
      try {
        await page.click('button', { timeout: 1000 });
      } catch (e) {}
    }
    await page.waitForTimeout(game.wait);
    await page.screenshot({ path: join(OUTPUT_DIR, `${game.id}.jpg`), quality: 85, type: 'jpeg' });
  }

  await browser.close();
  console.log('Done!');
}

capture().catch(console.error);
