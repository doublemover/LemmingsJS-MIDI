import { expect, test } from '@playwright/test';

const ready = async page => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready');
  await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__; api.pause(); api.renderer.follow = false; api.renderer.render();
    const events = []; api.world.soundEvents.onEvent.on(event => { if (events.length < 64) events.push(event); });
    window.__displayQualificationEvidence = async () => {
      const world = api.world, studio = window.__PROCGEN_STUDIO__;
      const physical = { generation: world.generation, tick: world.tickIndex, eventTimeMs: world.eventTimeMs, simulationTimeMs: world.simulationTimeMs,
        actors: world.actors.map(actor => ({ id: actor.id, lane: actor.laneIndex, x: actor.x, y: actor.y, direction: actor.direction, frame: actor.frameIndex,
          action: actor.action?.constructor?.name, removed: actor.removed, failure: actor.failureReason })),
        generatedThrough: Array.from(world.generatedThrough), frontiers: Array.from(world.frontiers), terrainRevision: world.terrainRevision,
        causalSequence: world.soundEvents._causalSequence, events };
      const bytes = new TextEncoder().encode(JSON.stringify(physical)), digest = await crypto.subtle.digest('SHA-256', bytes);
      return { physicalAndEventHash: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
        document: studio?.getDocumentState?.(), playback: studio?.getPlaybackState?.(), canvasCount: document.querySelectorAll('canvas.gameCanvas').length };
    };
  });
};

test('production paint failure recovers identical pixels without physical or output changes', async ({ page, browser }, testInfo) => {
  await ready(page);
  const canvas = page.locator('#gameCanvas'), pixels = await canvas.screenshot(), before = await page.evaluate(() => window.__displayQualificationEvidence());
  const failure = await page.evaluate(() => {
    const renderer = window.__PROCGEN_LANES__.renderer;
    window.__displayOriginalUpload = renderer.terrainContext.putImageData;
    renderer.terrainContext.putImageData = () => { throw new globalThis.DOMException('Injected terrain upload failure', 'InvalidStateError'); };
    renderer.lastTerrainKey = ''; renderer.lastGeometryKey = '';
    const rendered = renderer.render(); return { rendered, display: renderer.getDisplayState() };
  });
  expect(failure.rendered).toBe(false); expect(failure.display.state).toBe('recovering');
  await expect(page.locator('.studio-display-status')).toContainText(/recovering|unavailable/);
  await page.evaluate(() => {
    const renderer = window.__PROCGEN_LANES__.renderer;
    renderer.terrainContext.putImageData = window.__displayOriginalUpload; renderer.recover(); renderer.render();
  });
  await expect(page.locator('.studio-display-status')).toHaveText('Display ready');
  expect(await canvas.screenshot()).toEqual(pixels);
  const after = await page.evaluate(() => window.__displayQualificationEvidence());
  expect(after).toEqual(before);
  await testInfo.attach('display-recovery-receipt.json', { body: JSON.stringify({ browser: browser.version(), dpr: await page.evaluate(() => globalThis.devicePixelRatio),
    failure: failure.display, before, after, qualification: 'Production CSS, real source art, injected 2D terrain upload failure; not an operating-system GPU reset.' }, null, 2), contentType: 'application/json' });
});

test('production context-loss state keeps transport and Panic available and retries on the same canvas', async ({ page }, testInfo) => {
  await ready(page);
  const before = await page.evaluate(() => window.__displayQualificationEvidence());
  const pixels = await page.locator('#gameCanvas').screenshot();
  await page.evaluate(() => {
    window.__displayOriginalCanvas = window.__PROCGEN_LANES__.renderer.canvas;
    window.__displayOriginalCanvas.dispatchEvent(new Event('contextlost', { cancelable: true }));
  });
  await expect(page.locator('.studio-display-status')).toContainText('Display lost');
  await expect(page.locator('#procgenPause')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Panic', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry display', exact: true }).click();
  await expect(page.locator('.studio-display-status')).toHaveText('Display ready');
  await page.waitForFunction(() => !!window.__PROCGEN_LANES__.renderer.lastFrameKey && window.__PROCGEN_LANES__.renderer.canvas.width > 0);
  expect(await page.evaluate(() => window.__displayOriginalCanvas === document.getElementById('gameCanvas'))).toBe(true);
  expect(await page.locator('#gameCanvas').screenshot()).toEqual(pixels);
  const after = await page.evaluate(() => window.__displayQualificationEvidence()); expect(after).toEqual(before);
  await testInfo.attach('context-event-recovery-receipt.json', { body: JSON.stringify({ before, after,
    qualification: 'Production DOM and real canvas, synthetic contextlost event exercising recovery admission; not proof of native GPU-reset support.' }, null, 2), contentType: 'application/json' });
});

test('retired production surfaces stay retired after late restore and explicit redraw requests', async ({ page }) => {
  await ready(page);
  const receipt = await page.evaluate(async () => {
    const renderer = window.__PROCGEN_LANES__.renderer, before = await window.__displayQualificationEvidence();
    const owned = [...renderer.resources.entries.keys()].filter(value => value instanceof HTMLCanvasElement);
    const restore = renderer.contextListeners.find(([event]) => event === 'contextrestored')[1];
    renderer.dispose(); restore(); renderer.canvas.dispatchEvent(new Event('contextrestored'));
    const rendered = renderer.render(), resized = renderer.resize(), recovered = renderer.recover();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { before, after: await window.__displayQualificationEvidence(), rendered, resized, recovered, display: renderer.getDisplayState(),
      surfaces: owned.map(surface => ({ width: surface.width, height: surface.height })), worldReference: renderer.world };
  });
  expect(receipt.after).toEqual(receipt.before); expect(receipt.rendered).toBe(false); expect(receipt.resized).toBe(false); expect(receipt.recovered).toBe(false);
  expect(receipt.display.state).toBe('disposed'); expect(receipt.display.estimatedBytes).toBe(0); expect(receipt.worldReference).toBeNull();
  expect(receipt.surfaces.every(surface => surface.width === 0 && surface.height === 0)).toBe(true);
});
