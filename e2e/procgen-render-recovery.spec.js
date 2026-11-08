import { expect, test } from '@playwright/test';

const ready = async page => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready');
  for (let tick = 0; tick < 8; tick++) await page.locator('#procgenStep').click();
  await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__; api.pause(); window.__PROCGEN_STUDIO__?.transport.pause(); api.renderer.follow = false; api.renderer.render();
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
    window.__displayCctvPixels = async () => {
      const renderer = api.renderer, actors = [...renderer.actorVisibility.physicalActors(0)].filter(actor => !actor.failureReason && !actor.removed);
      const leader = actors.reduce((old, actor) => !old || actor.x > old.x ? actor : old, null);
      if (!leader) throw Error('CCTV source-art qualification requires a real living actor.');
      renderer.cctv.refresh(0, leader, actors, 1); const view = renderer.cctv.views.get(0);
      const pixels = view.bufferContext.getImageData(0, 0, view.buffer.width, view.buffer.height).data;
      const hash = await crypto.subtle.digest('SHA-256', pixels);
      return { width: view.buffer.width, height: view.buffer.height, leaderId: leader.id, actorCount: actors.length,
        pixelHash: Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('') };
    };
    window.__displayNativePixels = async () => {
      const canvas = api.renderer.canvas, pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels), layer = document.querySelector('.studio-causal-layer'), summary = document.querySelector('.studio-causal-summary');
      return { width: canvas.width, height: canvas.height, pixelHash: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
        overlay: { hidden: layer.hidden, text: summary.textContent, rect: summary.getBoundingClientRect().toJSON() } };
    };
  });
};

test('production paint failure recovers identical pixels without physical or output changes', { tag: '@boundary' }, async ({ page, browser }, testInfo) => {
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

for (const deviceScaleFactor of [1, 2]) test.describe('display recovery DPR ' + deviceScaleFactor, () => {
  test.use({ deviceScaleFactor });
  test('native surface and CCTV failures recover source pixels without changing physics', { tag: '@boundary' }, async ({ page }, testInfo) => {
    test.setTimeout(90000); await ready(page); const receipts = [];
    for (const phase of ['callback', 'canvas', 'buffer', 'terrainBuffer', 'objectBuffer', 'scenery', 'CCTV']) {
      await expect(page.locator('.studio-causal-layer')).toBeVisible();
      const cctvBefore = phase === 'CCTV' ? await page.evaluate(() => window.__displayCctvPixels()) : null;
      const before = await page.evaluate(() => window.__displayQualificationEvidence()), pixels = await page.locator('#gameCanvas').screenshot();
      const nativeBefore = await page.evaluate(() => window.__displayNativePixels());
      const failure = await page.evaluate(phase => {
        const renderer = window.__PROCGEN_LANES__.renderer, resources = renderer.resources;
        if (phase === 'callback') {
          const original = renderer.onWorkstationFrame; renderer.onWorkstationFrame = () => { throw Error('Injected workstation paint callback'); };
          window.__displayFaultUndo = () => { renderer.onWorkstationFrame = original; };
        } else if (['canvas', 'buffer', 'terrainBuffer', 'objectBuffer'].includes(phase)) {
          const canvas = renderer[phase], original = canvas.getContext; canvas.getContext = () => null;
          window.__displayFaultUndo = () => { canvas.getContext = original; };
        } else {
          if (phase === 'scenery' && !renderer.world.scenery) throw Error('Native scenery precondition missing');
          const original = resources.canvas;
          const failContext = work => {
            resources.canvas = function() { const canvas = original.call(this); canvas.getContext = () => null; return canvas; };
            try { return work(); } finally { resources.canvas = original; }
          };
          if (phase === 'CCTV') {
            const frame = renderer.onWorkstationFrame; renderer.onWorkstationFrame = () => failContext(() => renderer.cctv.createView());
            window.__displayFaultUndo = () => { renderer.onWorkstationFrame = frame; };
          } else {
            const scenery = renderer._drawScenery;
            renderer._drawScenery = function(...args) {
              if (this.sceneryBuffer) resources.release(this.sceneryBuffer);
              this.sceneryBuffer = this.sceneryContext = null;
              return failContext(() => scenery.apply(this, args));
            };
            window.__displayFaultUndo = () => { renderer._drawScenery = scenery; };
          }
        }
        const recovered = renderer.recover(), rendered = renderer.render();
        const first = renderer.getDisplayState(); renderer.recover(); const retried = renderer.render();
        return { recovered, rendered, retried, first, failedRetry: renderer.getDisplayState() };
      }, phase);
      expect(failure.rendered, phase).toBe(false); expect(failure.retried, phase).toBe(false);
      expect(failure.first.state, phase).toBe('recovering'); expect(failure.failedRetry.state, phase).toBe('recovering');
      if (['scenery', 'CCTV'].includes(phase)) expect(failure.first.reason).toContain(phase === 'scenery' ? 'Scenery' : 'CCTV');
      await expect(page.locator('.studio-display-status')).toContainText('Display recovering');
      await expect(page.getByRole('button', { name: 'Panic', exact: true })).toBeEnabled();
      const recovered = await page.evaluate(() => {
        window.__displayFaultUndo(); delete window.__displayFaultUndo;
        const renderer = window.__PROCGEN_LANES__.renderer;
        return { recovered: renderer.recover(), rendered: renderer.render(), display: renderer.getDisplayState() };
      });
      expect(recovered.recovered, phase).toBe(true); expect(recovered.rendered, phase).toBe(true); expect(recovered.display.state).toBe('ready');
      expect(recovered.display.estimatedBytes, phase).toBeLessThanOrEqual(64 * 1048576);
      await expect(page.locator('.studio-causal-layer')).toBeVisible();
      const cctvAfter = phase === 'CCTV' ? await page.evaluate(() => window.__displayCctvPixels()) : null;
      expect(cctvAfter).toEqual(cctvBefore);
      const after = await page.evaluate(() => window.__displayQualificationEvidence()); expect(after, phase).toEqual(before);
      const nativeAfter = await page.evaluate(() => window.__displayNativePixels());
      receipts.push({ phase, before, after, failure, recovered, cctvBefore, cctvAfter, nativeBefore, nativeAfter });
      await testInfo.attach('display-fault-' + phase + '.json', { body: JSON.stringify(receipts.at(-1), null, 2), contentType: 'application/json' });
      const afterPixels = await page.locator('#gameCanvas').screenshot();
      if (nativeAfter.pixelHash !== nativeBefore.pixelHash) {
        await testInfo.attach('display-before-' + phase + '.png', { body: pixels, contentType: 'image/png' });
        await testInfo.attach('display-after-' + phase + '.png', { body: afterPixels, contentType: 'image/png' });
      }
      expect(nativeAfter, phase + ' exact native source pixels and overlay geometry').toEqual(nativeBefore);
    }
    await testInfo.attach('native-display-fault-matrix.json', { body: JSON.stringify({ deviceScaleFactor, receipts,
      scope: 'Actual desktop canvas/context allocation and production paint callbacks with injected API failures. CCTV construction is invoked at the owned frame callback; the workstation projection stays authoritative. Native GPU reset and acoustic output are not measured.' }, null, 2), contentType: 'application/json' });
  });
});

test('one hundred native display rebuild and desktop raster resize cycles retire accounted surfaces', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(90000); await ready(page);
  await expect(page.locator('.studio-causal-layer')).toBeVisible();
  const session = await context.newCDPSession(page); await session.send('Performance.enable');
  const heap = async () => { await session.send('HeapProfiler.collectGarbage'); const { metrics } = await session.send('Performance.getMetrics'); return metrics.find(value => value.name === 'JSHeapUsedSize').value; };
  const initialHeap = await heap(), before = await page.evaluate(() => {
      const renderer = window.__PROCGEN_LANES__.renderer; window.__displayInitialSize = { width: renderer.surfaceWidth, height: renderer.surfaceHeight };
      return window.__displayQualificationEvidence();
    }), samples = [];
  const pixels = await page.locator('#gameCanvas').screenshot(), nativeBefore = await page.evaluate(() => window.__displayNativePixels());
  for (let batch = 0; batch < 10; batch++) {
    const cycles = await page.evaluate(batch => {
      const renderer = window.__PROCGEN_LANES__.renderer, results = [];
      for (let offset = 0; offset < 10; offset++) {
        const cycle = batch * 10 + offset, width = cycle % 2 ? 3840 : 1920, height = cycle % 2 ? 2160 : 1080;
        const released = [...renderer.resources.entries.keys()].filter(value => value instanceof HTMLCanvasElement && value !== renderer.canvas);
        renderer.recover();
        const retiredBeforeResize = released.every(canvas => canvas.width === 0 && canvas.height === 0);
        renderer.resize({ width, height });
        const dimensions = [renderer.canvas.width, renderer.canvas.height], allocations = renderer.resources.allocations;
        const repeated = renderer.resize({ width, height });
        results.push({ cycle, width, height, dimensions, retiredBeforeResize, repeated, allocationsUnchanged: allocations === renderer.resources.allocations, display: renderer.getDisplayState() });
      }
      return results;
    }, batch);
    for (const cycle of cycles) {
      expect(cycle.retiredBeforeResize).toBe(true); expect(cycle.repeated).toBe(false); expect(cycle.allocationsUnchanged).toBe(true);
      expect(cycle.display.state).toBe('ready'); expect(cycle.display.estimatedBytes).toBeLessThanOrEqual(64 * 1048576); expect(cycle.display.unreleasedEstimatedBytes).toBe(0);
    }
    samples.push({ cycles, heapAfterGc: await heap() });
  }
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.waitForFunction(() => {
    const renderer = window.__PROCGEN_LANES__.renderer;
    return renderer.surfaceWidth >= 3000 && renderer.surfaceHeight >= 1500 && renderer.getDisplayState().state === 'ready';
  });
  const largeWindow = await page.evaluate(() => { const renderer = window.__PROCGEN_LANES__.renderer; return { width: window.innerWidth, height: window.innerHeight, display: renderer.getDisplayState() }; });
  expect(largeWindow.display.estimatedBytes).toBeLessThanOrEqual(64 * 1048576);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => {
    const renderer = window.__PROCGEN_LANES__.renderer;
    return renderer.surfaceWidth === window.__displayInitialSize.width && renderer.surfaceHeight === window.__displayInitialSize.height && renderer.getDisplayState().state === 'ready';
  });
  await page.evaluate(() => { const renderer = window.__PROCGEN_LANES__.renderer; renderer.recover(); renderer.resize(window.__displayInitialSize); });
  await expect(page.locator('.studio-causal-layer')).toBeVisible();
  const afterPixels = await page.locator('#gameCanvas').screenshot(), nativeAfter = await page.evaluate(() => window.__displayNativePixels());
  if (nativeAfter.pixelHash !== nativeBefore.pixelHash) {
    await testInfo.attach('cycles-before.png', { body: pixels, contentType: 'image/png' });
    await testInfo.attach('cycles-after.png', { body: afterPixels, contentType: 'image/png' });
  }
  expect(nativeAfter).toEqual(nativeBefore);
  const after = await page.evaluate(() => window.__displayQualificationEvidence()); expect(after).toEqual(before);
  const finalHeap = await heap(); expect(finalHeap - initialHeap).toBeLessThan(32 * 1048576);
  await testInfo.attach('native-display-100-cycles.json', { body: JSON.stringify({ before, after, nativeBefore, nativeAfter, initialHeap, finalHeap, samples, largeWindow,
    heapScope: 'Chromium JavaScript heap after explicit CDP garbage collection; renderer RGBA ledger excludes GPU/driver copies and process memory.' }, null, 2), contentType: 'application/json' });
  await session.detach();
});

test('production context-loss state keeps transport and Panic available and retries on the same canvas', { tag: '@boundary' }, async ({ page }, testInfo) => {
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

test('retired production surfaces stay retired after late restore and explicit redraw requests', { tag: '@boundary' }, async ({ page }) => {
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
