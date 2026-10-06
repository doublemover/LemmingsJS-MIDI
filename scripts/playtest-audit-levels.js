import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.AUDIT_CHROMIUM, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.route(/https:\/\//, route => route.abort());
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto('http://127.0.0.1:8096/editor.html?e2e=1');
await page.waitForFunction(() => window.__E2E__?.getState()?.editor?.assets?.terrain?.length);
for (const slug of ['orchard-gate', 'hydro-triangle']) {
  const text = await fs.readFile(`evidence/levels/${slug}.nxlv`, 'utf8');
  const result = await page.evaluate(text => window.__E2E__.editorApply([
    { type: 'level.loadText', args: { text, resetHistory: true } },
    { type: 'level.save', args: { name: text.match(/TITLE (.*)/)?.[1] || 'Audit' } }
  ], { preview: { refresh: true }, returnState: 'full' }), text);
  assert.equal(result.ok, true);
  await fs.writeFile(`evidence/${slug}-load.json`, JSON.stringify(result, null, 2));
  await page.evaluate(() => window.__E2E__.setEditorPlaytest(true));
  await page.waitForFunction(() => window.__E2E__.getState().game?.timer?.running);
  await page.evaluate(() => window.__E2E__.pause());
  const frames = [];
  let bashed = false;
  for (let tick = 0; tick < 2400; tick += 5) {
    await page.evaluate(() => window.__E2E__.step(5));
    const state = await page.evaluate(() => window.__E2E__.getState());
    if (tick % 200 === 0) { frames.push(state.game); console.log(slug, tick, JSON.stringify(state.game.victory)); }
    if (!bashed && slug === 'orchard-gate') {
      const lemming = state.game.lemmings.find(l => !l.removed && l.lookRight && l.x >= 250 && l.x <= 255);
      if (lemming) {
        await page.evaluate(id => window.__E2E__.selectLemmingById(id), lemming.id);
        await page.keyboard.press('KeyW');
        await page.keyboard.press('KeyK');
        bashed = true;
        console.log('Basher applied', lemming);
      }
    }
    if (state.game.victory.survivorCount === 10) break;
  }
  const final = await page.evaluate(() => window.__E2E__.getState());
  assert.equal(final.game.victory.survivorCount, 10);
  if (slug === 'orchard-gate') assert.equal(final.game.skills.skills[6], 1);
  await fs.writeFile(`evidence/${slug}-playtest.json`, JSON.stringify({ frames, final: final.game, errors }, null, 2));
  await page.screenshot({ path: `evidence/${slug}-playtest.png`, fullPage: true });
  console.log('FINAL', slug, final.game.victory, final.game.lemmings.slice(0, 2));
  await page.evaluate(() => window.__E2E__.setEditorPlaytest(false));
  await page.waitForFunction(() => !window.__E2E__.getState().editor.playtest);
  const savedId = result.state.editor.savedLevels.find(item => item.name === result.state.editor.session.level.header.TITLE).id;
  await page.reload();
  await page.waitForFunction(() => window.__E2E__?.getState()?.editor?.assets?.terrain?.length);
  const reloaded = await page.evaluate(savedId => window.__E2E__.editorApply([
    { type: 'level.loadSaved', args: { savedId } },
    { type: 'level.export', args: { format: 'nxlv' } }
  ], { preview: { refresh: true }, returnState: 'full' }), savedId);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.state.editor.session.level.header.TITLE, result.state.editor.session.level.header.TITLE);
  await fs.writeFile(`evidence/${slug}-reloaded.json`, JSON.stringify(reloaded, null, 2));
  await page.evaluate(() => window.__E2E__.centerStageOn({x:320,y:80}));
  await page.screenshot({ path: `evidence/${slug}-editor.png`, fullPage: true });
}
await browser.close();
