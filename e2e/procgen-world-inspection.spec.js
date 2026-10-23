import { expect, test } from '@playwright/test';

const ready = async page => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready' && window.__PROCGEN_STUDIO__?.getWorldInspector?.());
  await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__; api.pause(); api.renderer.follow = false; api.renderer.render();
    for (let tick = 0; tick < 512 && !api.renderer.presentation.getSnapshot()?.entities.some(entity => entity.kind === 'actor'); tick++) api.step();
  });
  await page.waitForFunction(() => window.__PROCGEN_LANES__.renderer.presentation.getSnapshot()?.entities.some(entity => entity.kind === 'actor'));
};
const landmark = page => page.evaluate(() => {
  const renderer = window.__PROCGEN_LANES__.renderer, snapshot = renderer.presentation.getSnapshot(), actor = snapshot.entities.find(entity => entity.kind === 'actor'), region = actor.regions[0];
  return { id: actor.id, actorId: actor.actorId, generation: snapshot.generation, projectionRevision: snapshot.projectionRevision,
    x: snapshot.rect.left + (region.x + region.width / 2) / snapshot.logicalSize.width * snapshot.rect.width,
    y: snapshot.rect.top + (region.y + region.height / 2) / snapshot.logicalSize.height * snapshot.rect.height,
    rect: snapshot.rect, logicalSize: snapshot.logicalSize, backingSize: snapshot.backingSize };
});
const state = page => page.evaluate(() => {
  const api = window.__PROCGEN_LANES__, studio = window.__PROCGEN_STUDIO__;
  return { generation: api.world.generation, tick: api.world.tickIndex, terrainRevision: api.world.terrainRevision,
    sequence: api.world.soundEvents._causalSequence, document: studio.getDocumentState(), playback: studio.getPlaybackState() };
});

for (const deviceScaleFactor of [1, 2]) test.describe(`world inspection at DPR ${deviceScaleFactor}`, () => {
  test.use({ deviceScaleFactor });
  test('matches actual cropped source art with pointer and keyboard inspection without issuing edits', async ({ page, browser }, testInfo) => {
    await ready(page); const target = await landmark(page), before = await state(page);
    await page.mouse.click(target.x, target.y);
    const selected = await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection);
    expect(selected.actorId).toBe(target.actorId); expect(selected.generation).toBe(target.generation);
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    const entry = page.locator('.studio-world-entities button').filter({ hasText: `Actor ${target.actorId} ·` }).first();
    await entry.focus(); await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection.actorId)).toBe(target.actorId);
    expect(await state(page)).toEqual(before);
    await testInfo.attach('world-inspection.png', { body: await page.locator('#gameCanvas').screenshot(), contentType: 'image/png' });
    await testInfo.attach('world-inspection-receipt.json', { body: JSON.stringify({ browser: browser.version(), deviceScaleFactor, target, selected, before,
      qualification: 'Production CSS, natural source-art actor, real canvas, pointer and native keyboard button; inspection emits no physical, document or transport change.' }, null, 2), contentType: 'application/json' });
  });
});

test('CSS-scaled and translated host maps through its content extent and cancels a stale-rect gesture', async ({ page }, testInfo) => {
  await ready(page);
  await page.evaluate(() => { const canvas = document.getElementById('gameCanvas'); canvas.style.transformOrigin = '0 0'; canvas.style.transform = 'translate(13px, 7px) scale(.5)'; window.__PROCGEN_LANES__.renderer.render(false); });
  const target = await landmark(page), before = await state(page);
  await page.mouse.click(target.x, target.y);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection.actorId)).toBe(target.actorId);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().clear());
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await page.evaluate(() => { document.getElementById('gameCanvas').style.transform = 'translate(23px, 7px) scale(.5)'; });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection)).toBeNull();
  expect(await state(page)).toEqual(before);
  await testInfo.attach('css-transform-inspection-receipt.json', { body: JSON.stringify({ target, before, qualification: 'Translated half-size CSS host, actual DOM content rect, stale gesture cancellation.' }, null, 2), contentType: 'application/json' });
});

test('display loss and generation reset invalidate inspection identity without invisible edits', async ({ page }) => {
  await ready(page); const target = await landmark(page), before = await state(page);
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await page.evaluate(() => document.getElementById('gameCanvas').dispatchEvent(new Event('contextlost', { cancelable: true })));
  await page.mouse.up(); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection)).toBeNull();
  await expect(page.locator('.studio-world-capability')).toContainText(/preparing|display|inspection/i); expect(await state(page)).toEqual(before);
  await page.getByRole('button', { name: 'Retry display', exact: true }).click();
  await page.waitForFunction(() => window.__PROCGEN_LANES__.renderer.presentation.getSnapshot()?.entities.some(entity => entity.kind === 'actor'));
  const recovered = await landmark(page); await page.mouse.click(recovered.x, recovered.y);
  await page.evaluate(() => { const api = window.__PROCGEN_LANES__; api.world.generation++; api.renderer.render(); });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection)).toBeNull();
});
