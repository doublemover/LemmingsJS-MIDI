import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const output = 'temp/live-instrument';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.LEMMINGS_CHROMIUM_PATH ? { executablePath: process.env.LEMMINGS_CHROMIUM_PATH } : {}),
  headless: true
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.LEMMINGS_E2E_BASE_URL || 'http://127.0.0.1:8080';
  await page.goto(`${base}/?e2e=1&midi=1`);
  await page.waitForFunction(() => window.__E2E__?.getState?.().game?.timer);
  await page.evaluate(() => window.__E2E__.pause());
  await page.locator('#midiWorkspaceToggle').click();
  await page.locator('[data-game-event-id="20"]').click();
  const receipts = [];
  for (const layout of ['Focus', 'Split', 'Overlay']) {
    await page.locator(`#midiLayout${layout}`).click();
    if (await page.locator('canvas').count() !== 1) throw new Error('Expected one persistent game canvas');
    await page.screenshot({ path: `${output}/${layout.toLowerCase()}.png`, fullPage: true });
    receipts.push({ layout,
      canvas: await page.locator('#gameCanvas').boundingBox(),
      workspace: await page.locator('#midiSequencerWorkspace').boundingBox(),
      state: await page.evaluate(() => window.__LEMMINGS_MIDI_UI__.getWorkbenchState())
    });
  }
  const report = { errors, receipts };
  await fs.writeFile(`${output}/browser-receipt.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
