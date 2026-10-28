import { expect, test } from './helpers/workstationValidation.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';

const ready = async (page, count = 64) => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=' + count + '&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const scope = page => page.evaluate(async () => {
  const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'), { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { tick: world.tickIndex, hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)), project: JSON.stringify(studio.getProject()), document: studio.getDocumentState(), routes: studio.ports.getState().outputRoutes,
    routeRevision: studio.ports.getRouteRevision(), inputLease: studio.getInputEditLease(), midi: window.__WEBMIDI_STUB__.metrics() };
});

test('benchmark ten-minute 1024-lane navigation retains bounded DOM, surfaces, history and listeners', { tag: '@benchmark' }, async ({ page, context }, testInfo) => {
  test.skip(process.env.LEMMINGS_NAVIGATION_SOAK !== '1', 'Explicit ten-minute production navigation qualification.'); test.setTimeout(750000); await ready(page, 1024);
  const session = await context.newCDPSession(page), before = await scope(page), samples = [], heaps = [];
  const sample = () => page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, renderer = window.__PROCGEN_LANES__.renderer;
    return { elapsed: window.performance.now(), domNodes: document.querySelectorAll('*').length, results: document.querySelectorAll('[data-jump-lane-id]').length, navigation: studio.getNavigationDiagnostics(), display: studio.getDisplayDiagnostics(), renderer: renderer.getDisplayState(),
      rasterReservation: { bytes: renderer.resources.bytes + renderer.resources.unreleasedBytes, budget: renderer.resources.budgetBytes } };
  });
  try {
    await session.send('HeapProfiler.collectGarbage'); const baseline = await sample(), started = Date.now(), deadline = started + 600000; let index = 0;
    while (Date.now() < deadline) {
      const cost = await page.evaluate(index => {
        const start = window.performance.now(), input = document.querySelector('[aria-label="Lane search"]'); input.value = ['Lane 1024', 'no matching lane anywhere', '', 'lead'][index % 4]; input.dispatchEvent(new Event('input', { bubbles: true }));
        if (index % 8 === 0) document.querySelector('[aria-label="Move selected lane down"]').click();
        if (index % 12 === 0) document.querySelector('[aria-label="Pin selected lane"]').click(); return window.performance.now() - start;
      }, index++);
      const current = await sample(); samples.push({ ...current, interactionMs: cost });
      expect(current.navigation.mountedHeads).toBeLessThanOrEqual(8); expect(current.navigation.mountedPans).toBeLessThanOrEqual(8); expect(current.navigation.mountedDisplays).toBeLessThanOrEqual(8); expect(current.results).toBeLessThanOrEqual(16);
      expect(current.navigation.retainedDrafts).toBeLessThanOrEqual(16); expect(current.navigation.organization.retainedBytes).toBeLessThanOrEqual(256 * 1024); expect(current.renderer.projectedRowSurfaces).toBeLessThanOrEqual(8);
      expect(current.rasterReservation.bytes).toBeLessThanOrEqual(current.rasterReservation.budget);
      expect(current.display.registered).toBe(baseline.display.registered); expect(current.domNodes).toBeLessThanOrEqual(baseline.domNodes + 128);
      if (index % 60 === 0) { await session.send('HeapProfiler.collectGarbage'); heaps.push({ elapsedMs: Date.now() - started, ...await session.send('Runtime.getHeapUsage') }); }
      await page.waitForTimeout(Math.min(1000, Math.max(1, deadline - Date.now())));
    }
    await page.evaluate(() => { const input = document.querySelector('[aria-label="Lane search"]'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(await scope(page)).toEqual(before); await session.send('HeapProfiler.collectGarbage'); const final = await sample();
    const costs = samples.map(sample => sample.interactionMs).sort((a, b) => a - b), percentile = value => costs[Math.min(costs.length - 1, Math.floor((costs.length - 1) * value))];
    await testInfo.attach('ten-minute-navigation-qualification', { body: JSON.stringify({ elapsedMs: Date.now() - started, hardwareConcurrency: await page.evaluate(() => window.navigator.hardwareConcurrency), browser: context.browser().version(), viewport: page.viewportSize(), method: 'Real wall-clock ten-minute production-page DOM-input and organization-command soak, including arbitrary lead-role rows; paused physics and note output off. Separate native pointer/key journeys qualify interactions.',
      baseline, final, count: samples.length, interactionMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }, heaps, samples, before }), contentType: 'application/json' });
  } finally { await session.detach(); }
});

test('search and offscreen return navigate the real ensemble without changing music, routes, output or physics', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(60000); await ready(page); const before = await scope(page), search = page.getByLabel('Lane search', { exact: true });
  await useWorkstationControl(page, search, {}, 'fill', 'Lane 64'); await expect(page.getByRole('group', { name: 'Matching lanes' }).getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: '64 · Lane 64', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(page.locator('.studio-lane-header')).toHaveCount(1); await expect(page.locator('.studio-lane-header.selected')).toHaveAttribute('data-lane-id', 'lane-64');
  await useWorkstationControl(page, search, {}, 'fill', ''); await page.keyboard.press('Escape'); await expect(page.locator('.studio-lane-header')).toHaveCount(8);
  await page.getByRole('button', { name: 'Jump to offscreen lane' }).click();
  await expect(page.getByLabel('Visible lane range')).toHaveText('57–64 of 64');
  await page.getByTitle('Show previous lanes').click(); await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toContainText('Selected offscreen');
  await page.getByRole('button', { name: 'Jump to offscreen lane' }).click(); await expect(page.getByLabel('Visible lane range')).toHaveText('57–64 of 64');
  await expect(page.locator('.studio-lane-header.selected .studio-lane-title')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toBeHidden();
  expect(await scope(page)).toEqual(before); await page.screenshot({ path: testInfo.outputPath('large-ensemble-stable-jump.png') });
  await testInfo.attach('navigation-invariance', { body: JSON.stringify({ before, after: await scope(page), mountedHeaders: await page.locator('.studio-lane-header').count(), mountedDisplays: await page.locator('.studio-lane-header .studio-lane-display').count() }), contentType: 'application/json' });
});

const organization = (page, name, action = 'click', ...args) => useWorkstationControl(page, page.getByRole('button', { name, exact: true, includeHidden: true }), {}, action, ...args);
const rasterRows = page => page.evaluate(() => {
  const r = window.__PROCGEN_LANES__.renderer, hash = (context, y, width, height) => {
    const bytes = context.getImageData(0, y, width, height).data; let value = 2166136261; for (const byte of bytes) value = Math.imul(value ^ byte, 16777619); return (value >>> 0).toString(16);
  };
  return r.workstationLayout.laneIndices.map((lane, row) => ({ lane, hash: r.projectedRows.active ? hash(r.projectedRows.views[row].bufferContext, 0, r.projectedRows.views[row].buffer.width, r.projectedRows.views[row].buffer.height) : hash(r.bufferContext, row * r.laneHeight / r.rasterStep, r.buffer.width, r.laneHeight / r.rasterStep) }));
});

test('visual reorder preserves an owned MIDI hold, physical raster rows, stable colors and canonical source receipts', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(90000); await ready(page, 8);
  await page.evaluate(() => { const r = window.__PROCGEN_LANES__.renderer; for (let i = 0; i < 24; i++) r.world.step(); r.render(true); });
  await page.locator('#procgenListen').click(); await useWorkstationControl(page, page.locator('#procgenMidiDevice'), {}, 'selectOption', 'pw-output-1'); await page.locator('#procgenListen').click();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.ports.sendNote({ outputId: 'pw-output-1', channel: 1, note: 60, velocity: 0.75, durationMs: 0 }, { voiceId: 'navigation-owned-hold', laneId: 'lane-8', onsetId: 'navigation-owned-onset', intentId: 'navigation-api-fixture' }))).toBe(true);
  const before = await scope(page), rows = await rasterRows(page), colors = await page.locator('.studio-lane-header').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.dataset.laneId, element.style.getPropertyValue('--lane-color')])));
  await page.locator('.studio-lane-header[data-lane-id="lane-8"] .studio-lane-title').click();
  for (let i = 0; i < 7; i++) await organization(page, 'Move selected lane up'); await page.keyboard.press('Escape');
  const reordered = await rasterRows(page); expect(reordered.map(row => row.lane)).toEqual([7, 0, 1, 2, 3, 4, 5, 6]); expect(Object.fromEntries(reordered.map(row => [row.lane, row.hash]))).toEqual(Object.fromEntries(rows.map(row => [row.lane, row.hash])));
  expect(await page.locator('.studio-lane-header').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.dataset.laneId, element.style.getPropertyValue('--lane-color')])))).toEqual(colors);
  expect(await scope(page)).toEqual(before); expect(await page.evaluate(() => window.__PROCGEN_LANES__.renderer.getDisplayState())).toMatchObject({ state: 'ready', projectedRowSurfaces: 8 });
  await page.screenshot({ path: testInfo.outputPath('organized-physical-rows.png') });
  for (let i = 0; i < 7; i++) await organization(page, 'Undo lane organization'); await page.keyboard.press('Escape'); expect(await rasterRows(page)).toEqual(rows);
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.renderer.getDisplayState().projectedRowSurfaces)).toBe(0); expect(await scope(page)).toEqual(before);
  await testInfo.attach('organized-raster-invariance', { body: JSON.stringify({ rows, reordered, colors, before, heldNoteEvidence: 'Owned WebMIDI API submission remains held across organization; receiver/acoustic state is unknown. Fixture is not claimed as a physical causal note.' }), contentType: 'application/json' });
  await page.locator('#procgenPanic').click(); expect(await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().messages.some(message => (message.bytes[0] & 240) === 128 && message.bytes[1] === 60))).toBe(true);
});

test('group collapse, pins, unknown search and offscreen draft restoration remain presentation-only', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(90000); await ready(page, 8); await page.locator('#procgenListen').click(); await expect(page.locator('#procgenMidiDevice option[value="pw-output-1"]')).toHaveCount(1);
  expect(await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, { createProcgenLane } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
    const complement = createProcgenLane(0, { mode: 'pattern', patternPurpose: 'Complement the physical world for fixed armed-lane navigation qualification' });
    studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { mode: complement.mode, patternPurpose: complement.patternPurpose, patterns: complement.patterns } });
    studio.handlers.input('pw-input-1'); return studio.handlers.learn();
  })).toBe(true);
  const visibleBefore = await page.locator('.studio-lane-header').count();
  const before = await scope(page), row = page.locator('.studio-lane-header[data-lane-id="lane-1"]');
  await row.getByRole('button', { name: 'Edit Pan value' }).click(); const oldEntry = row.getByLabel('Pan numeric value'); await oldEntry.fill('-32'); await page.locator('#procgenPause').focus();
  await useWorkstationControl(page, page.getByLabel('Lane group name', { exact: true }), {}, 'fill', 'Strings'); await organization(page, 'Create lane group'); await organization(page, 'Assign selected lane'); await organization(page, 'Toggle lane group visibility');
  await expect(page.locator('.studio-lane-header')).toHaveCount(7); await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toContainText('Selected offscreen'); await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toContainText('Armed 1'); expect(await scope(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toHaveAccessibleName(/Selected offscreen.*Armed 1 offscreen/);
  await organization(page, 'Pin selected lane'); await expect(page.locator('.studio-lane-header')).toHaveCount(visibleBefore); await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'Edit Pan value' }).click(); const restored = row.getByLabel('Pan numeric value'); await expect(restored).toHaveValue('-32'); await restored.press('Escape'); await restored.press('Escape');
  expect(await scope(page)).toEqual(before);
  const search = page.getByLabel('Lane search', { exact: true }); await useWorkstationControl(page, search, {}, 'fill', 'no matching lane anywhere'); await expect(page.locator('.studio-lane-header')).toHaveCount(0); await expect(page.getByLabel('Visible lane range')).toContainText('No matching rows');
  await search.fill('Lane 8'); await expect(page.locator('.studio-lane-header')).toHaveCount(1); await search.fill(''); await expect(page.locator('.studio-lane-header')).toHaveCount(visibleBefore); await page.keyboard.press('Escape');
  expect(await scope(page)).toEqual(before); await page.screenshot({ path: testInfo.outputPath('grouped-pinned-draft-restored.png') });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.cancelLearn());
});

test('native wheel accumulation and search focus survive unrelated canonical edits with bounded matches', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); const search = page.getByLabel('Lane search', { exact: true });
  await useWorkstationControl(page, search, {}, 'fill', 'Lane'); await search.evaluate(element => { window.__navigatorSearch = element; element.setSelectionRange(2, 2); });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/lane', laneId: 'lane-40', patch: { name: 'A renamed distant lane' } }));
  expect(await search.evaluate(element => ({ same: element === window.__navigatorSearch, active: element === document.activeElement, start: element.selectionStart, value: element.value }))).toEqual({ same: true, active: true, start: 2, value: 'Lane' });
  await expect(page.getByRole('group', { name: 'Matching lanes' }).getByRole('button')).toHaveCount(16);
  await page.keyboard.press('Escape'); const range = page.getByLabel('Visible lane range'), before = await range.textContent();
  for (let i = 0; i < 5; i++) await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 1 });
  await expect(range).toHaveText(before); await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 50 }); await expect(range).toHaveText('2–9 of 64');
  await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 100, ctrlKey: true }); await expect(range).toHaveText('2–9 of 64');
});
