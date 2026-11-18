// Neon Harbor screenshot runner: loads each staged shot in headless Chromium
// (SwiftShader WebGL, same flags as the DUSTFALL entry) and saves a JPEG.
import { chromium } from 'playwright-core';

const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const BASE = process.env.GAME_URL || 'http://localhost:8080';

const shots = [
  ['chase', 'screenshots/1-cover.jpg'],
  ['driving', 'screenshots/2-driving.jpg'],
  ['mission', 'screenshots/3-mission.jpg'],
  ['onfoot', 'screenshots/4-onfoot.jpg'],
];

for (const [name, out] of shots) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`${BASE}/?shot=${name}&seed=7`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__shotReady, null, { timeout: 30000 });
    console.log(name, 'READY');
  } catch {
    console.log(name, 'NOT READY');
  }
  await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
  console.log(name, 'errors:', JSON.stringify(errors));
  await browser.close();
}
console.log('done');
