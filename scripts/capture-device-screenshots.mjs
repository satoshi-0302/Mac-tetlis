import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);

function readFlag(flag, fallback = '') {
  const index = args.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function normalizeRequestedUrls() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--device' || value === '--out-dir' || value === '--base-url') {
      index += 1;
      continue;
    }
    if (value === '--landscape' || value === '--full-page') {
      continue;
    }
    values.push(value);
  }
  return values;
}

const DEFAULT_BASE_URL = 'https://codex-web-platform.yqs01140.workers.dev';
const deviceName = readFlag('--device', 'iPhone 14');
const outDir = resolve(readFlag('--out-dir', './docs/screenshots/generated'));
const baseUrl = readFlag('--base-url', DEFAULT_BASE_URL).replace(/\/+$/, '');
const landscape = hasFlag('--landscape');
const fullPage = hasFlag('--full-page');

const defaultTargets = [
  { slug: 'lobby', path: '/' },
  { slug: 'snake60-mobile', path: '/games/snake60/?mode=mobile' },
  { slug: 'missile-command-mobile', path: '/games/missile-command/?mode=mobile' },
  { slug: 'asteroid-mobile', path: '/games/asteroid/?mode=mobile' },
  { slug: 'slot60-mobile', path: '/games/slot60/?mode=mobile' }
];

function buildTargets(urls) {
  if (urls.length === 0) {
    return defaultTargets.map((target) => ({
      ...target,
      url: `${baseUrl}${target.path}`
    }));
  }

  return urls.map((value, index) => {
    const url = value.startsWith('http://') || value.startsWith('https://') ? value : `${baseUrl}${value}`;
    const parsed = new URL(url);
    const slugBase = `${parsed.pathname}${parsed.search}`
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'page';
    return {
      slug: `${String(index + 1).padStart(2, '0')}-${slugBase}`,
      url
    };
  });
}

function normalizeDescriptor(name) {
  const descriptor = devices[name];
  if (!descriptor) {
    throw new Error(`Unknown Playwright device: ${name}`);
  }

  if (!landscape) {
    return descriptor;
  }

  const width = descriptor.viewport.height;
  const height = descriptor.viewport.width;

  return {
    ...descriptor,
    viewport: { width, height },
    screen: { width, height },
    isMobile: true,
    hasTouch: true
  };
}

async function main() {
  const descriptor = normalizeDescriptor(deviceName);
  const targets = buildTargets(normalizeRequestedUrls());
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...descriptor,
    locale: 'ja-JP',
    colorScheme: 'dark'
  });

  try {
    for (const target of targets) {
      const page = await context.newPage();
      await page.goto(target.url, { waitUntil: 'networkidle' });
      await page.screenshot({
        path: resolve(outDir, `${target.slug}${landscape ? '-landscape' : ''}.png`),
        fullPage
      });
      await page.close();
      console.log(`Captured: ${target.url}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
