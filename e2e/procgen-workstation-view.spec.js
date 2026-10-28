import { expect, test } from '@playwright/test';

const ready = async (page, count = 8, steps = 16) => {
  await page.goto('/README.md');
  await page.setContent('<style>.studio-stage{position:relative;width:800px;height:608px}.studio-cell{min-width:24px}.studio-sequences{position:absolute;inset:0}.studio-sequence{position:absolute;display:grid;width:100%}</style><header id="procgenTopbar"></header><canvas id="gameCanvas"></canvas>');
  await page.evaluate(async ({ count, steps }) => {
    const { createProcgenWorkstationView } = await import('/js/app/procgen/workstation/ProcgenWorkstationView.js');
    const { createProcgenWorkstationProject, createProcgenLane } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
    const { createMidiProject, reduceMidiProject } = await import('/js/midi/project/MidiProject.js');
    let project = createProcgenWorkstationProject(createMidiProject(), { lanes: Array.from({ length: count }, (_, index) =>
      createProcgenLane(index, { mode: 'pattern', patternPurpose: 'Complement the physical world in this view fixture',
        ...(steps === 16 ? {} : { patterns: Array.from({ length: 4 }, () => ({ length: steps })) }) })) });
    const state = { laneId: 'lane-1', slot: 0, step: 0, workspaceMode: 'inspect' }, calls = [], actions = [];
    const runtime = {};
    const handlers = Object.fromEntries(['copy', 'paste', 'undo', 'redo', 'observe', 'record'].map(name => [name, value => calls.push({ name, value })]));
    const dispatch = action => { actions.push(action); project = reduceMidiProject(project, action);
      if (action.type === 'procgen/step') view.patchStep(action);
      else if (action.type === 'procgen/launchedBatch') view.launched();
      else view.render(); };
    const view = createProcgenWorkstationView({ document, window, getProject: () => project, getRuntime: () => runtime, state, handlers, dispatch });
    view.render();
    window.workstationViewTest = { view, state, calls, actions, runtime, dispatch, handlers, getProject: () => project };
  }, { count, steps });
};

test('MIDI route diagnostics update inline without losing selector focus or silently choosing fallback @boundary', async ({ page }) => {
  await ready(page, 1);
  await page.evaluate(() => {
    const f = window.workstationViewTest;
    f.route = { outputId: 'zone', name: 'Test receiver', authorized: true, active: true, available: true, mpeReady: true,
      mpeEvidence: 'manual-zone-api-accepted', mpeZone: { zone: 'lower', managerChannel: 1, memberChannels: [2, 3], reservedChannels: [10], memberRange: { semitones: 48, cents: 0 }, managerRange: { semitones: 2, cents: 0 }, voicePolicy: 'reject' } };
    f.handlers.devices = () => ({ inputs: [], outputs: [{ id: 'zone', name: 'Test receiver' }] });
    f.handlers.midiRouteState = () => ({ noteOutputId: 'zone', outputRoutes: [f.route] });
    f.handlers.outputState = () => ({ selectedBackend: 'midi', enabled: true });
    f.handlers.midiRoutePolicy = value => f.calls.push({ name: 'policy', value });
    f.dispatch({ type: 'procgen/global', patch: { mpe: { enabled: true, voicePolicy: 'reject' } } });
    f.state.tab = 'MIDI'; f.view.render(); window.routeSelector = document.querySelector('[aria-label="Lane MIDI output"]');
  });
  const diagnostics = page.getByRole('region', { name: 'MIDI route diagnostics' });
  await expect(diagnostics).toContainText('Manual zone assumed'); await expect(diagnostics).toContainText('receiver unverified');
  await expect(diagnostics).toContainText('reserved channels 10');
  const selector = page.getByRole('combobox', { name: 'Lane MIDI output' }); await selector.focus();
  await page.evaluate(() => {
    const f = window.workstationViewTest; f.route = { ...f.route, mpeReady: false, active: false, mpeFailure: 'empty-mpe-zone', mpeEvidence: null };
    f.view.recording(false, f.handlers.midiRouteState());
  });
  await expect(diagnostics).toContainText('MIDI setup rejected: empty mpe zone'); await expect(selector).toBeFocused();
  expect(await page.evaluate(() => window.routeSelector === document.querySelector('[aria-label="Lane MIDI output"]'))).toBe(true);
  expect(await page.evaluate(() => window.workstationViewTest.calls)).toEqual([]);
  await diagnostics.getByRole('button', { name: 'Use shared MIDI 1 expression', exact: true }).click();
  expect(await page.evaluate(() => window.workstationViewTest.calls)).toEqual([{ name: 'policy', value: 'shared' }]);
  await page.evaluate(() => { const f = window.workstationViewTest, stale = [...document.querySelectorAll('.studio-midi-route button')].find(button => button.textContent === 'Steal oldest member'); f.view.dispose(); stale.click(); });
  expect(await page.evaluate(() => window.workstationViewTest.calls)).toHaveLength(1);
});

test('musical header agrees with real phrase launches in canonical non-4/4 meters @boundary', async ({ page }) => {
  await ready(page, 1);
  const results = await page.evaluate(async () => {
    const { createProcgenPatternEngine } = await import('/js/app/procgen/workstation/ProcgenPatternEngine.js');
    const f = window.workstationViewTest, results = [];
    for (const [beats, unit] of [[3, 4], [6, 8], [7, 8], [4, 4]]) {
      f.dispatch({ type: 'transport.set', transport: { timeSignature: { beats, unit } } });
      f.dispatch({ type: 'procgen/launched', laneId: 'lane-1', slot: 0 });
      f.dispatch({ type: 'procgen/launch', laneId: 'lane-1', slot: 1 });
      const engine = createProcgenPatternEngine({ getProject: f.getProject, emit: () => ({ status: 'rejected' }) });
      const boundary = beats * 4 / unit;
      engine.onBeat({ beat: 0.25, timestamp: 125, bpm: 120 });
      engine.onBeat({ beat: boundary, timestamp: boundary * 500, bpm: 120 });
      f.view.transport({ beat: boundary, bpm: 90, clockSource: 'external', clockStatus: 'locked', linked: true, speedMode: 'bpm' });
      await new Promise(resolve => {
        const observe = () => {
          if (document.querySelector('.studio-clock-status').title.startsWith(`${beats}/${unit} ·`) &&
              document.querySelector('.studio-clock-source-status').textContent === 'MIDI clock · locked') resolve();
          else requestAnimationFrame(observe);
        }; observe();
      });
      results.push({ meter: `${beats}/${unit}`, origin: engine.getLanePosition('lane-1').origin, boundary,
        label: document.querySelector('.studio-clock-status').textContent, health: document.querySelector('.studio-clock-source-status').textContent });
    }
    return results;
  });
  for (const result of results) {
    expect(result.origin, result.meter).toBe(result.boundary); expect(result.label).toBe('2 : 1'); expect(result.health).toBe('MIDI clock · locked');
  }
});

test('project picker ignores reversed searches and old continuation completions @boundary', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const f = window.workstationViewTest; f.requests = [];
    f.view.showProjectPage({ items: [], nextCursor: null }, async () => false,
      (cursor, query) => new Promise((resolve, reject) => f.requests.push({ cursor, query, resolve, reject })));
  });
  const search = page.getByRole('searchbox', { name: 'Search project names' });
  for (const query of ['alpha', 'beta']) { await search.fill(query); await search.dispatchEvent('change'); }
  await page.evaluate(() => window.workstationViewTest.requests[1].resolve({ items: [{ id: 'beta', name: 'Beta', savedAt: '2026-10-22' }], nextCursor: null }));
  await expect(page.locator('.studio-project-items')).toHaveText(/Beta/);
  await expect(page.locator('.studio-project-feedback')).toHaveText('');
  await page.evaluate(() => window.workstationViewTest.requests[0].resolve({ items: [{ id: 'alpha', name: 'Alpha', savedAt: '2026-10-22' }], nextCursor: 'alpha-next' }));
  await expect(page.locator('.studio-project-items')).toHaveText(/Beta/);
  await expect(page.getByRole('button', { name: 'More projects' })).toBeHidden();
  await search.fill('alpha'); await search.dispatchEvent('change');
  await page.evaluate(() => window.workstationViewTest.requests[2].resolve({ items: [{ id: 'alpha', name: 'Alpha', savedAt: '2026-10-22' }], nextCursor: 'alpha-next' }));
  await page.getByRole('button', { name: 'More projects' }).click();
  await search.fill('beta'); await search.dispatchEvent('change');
  await page.evaluate(() => window.workstationViewTest.requests[4].resolve({ items: [{ id: 'beta-new', name: 'Beta new', savedAt: '2026-10-22' }], nextCursor: null }));
  await page.evaluate(() => window.workstationViewTest.requests[3].resolve({ items: [{ id: 'alpha-next', name: 'Alpha next', savedAt: '2026-10-22' }], nextCursor: 'alpha-later' }));
  await expect(page.locator('.studio-project-items')).toHaveText(/Beta new/);
  await expect(page.locator('.studio-project-items')).not.toHaveText(/Alpha/);
  await expect(page.getByRole('button', { name: 'More projects' })).toBeHidden();
});

test('Escape cancels the picker once and late loads cannot close a newer picker @boundary', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const f = window.workstationViewTest; f.cancelCount = 0; f.handlers.cancelProjectPicker = () => f.cancelCount++;
    f.view.showProjectPage({ items: [{ id: 'target', name: 'Target', savedAt: '2026-10-22' }], nextCursor: null },
      () => new Promise(resolve => { f.finishLoad = resolve; }));
  });
  await page.getByRole('button', { name: /Target ·/ }).click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Saved projects' })).not.toBeVisible();
  expect(await page.evaluate(() => window.workstationViewTest.cancelCount)).toBe(1);
  await page.evaluate(() => {
    const f = window.workstationViewTest;
    f.view.showProjectPage({ items: [{ id: 'new', name: 'New owner', savedAt: '2026-10-22' }], nextCursor: null }, async () => false);
    f.finishLoad(true);
  });
  await expect(page.getByRole('dialog', { name: 'Saved projects' })).toBeVisible();
  await expect(page.locator('.studio-project-items')).toHaveText(/New owner/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => window.workstationViewTest.cancelCount)).toBe(2);
});

test('selecting another lane edits its displayed phrase and supports fixed note zero', async ({ page }) => {
  await ready(page);
  await page.locator('.studio-lane-header').nth(0).getByTitle('Launch phrase 3 on next bar').click();
  await page.locator('.studio-sequence').nth(1).locator('.studio-cell').nth(5).click();
  expect(await page.evaluate(() => ({ lane: window.workstationViewTest.state.laneId, slot: window.workstationViewTest.state.slot, step: window.workstationViewTest.state.step }))).toEqual({ lane: 'lane-2', slot: 0, step: 5 });
  await page.getByLabel('Fixed MIDI note').fill('0'); await page.getByLabel('Fixed MIDI note').dispatchEvent('change');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[1].patterns[0].steps[5].note)).toBe(0);
  await page.getByLabel('Fixed MIDI note').fill(''); await page.getByLabel('Fixed MIDI note').dispatchEvent('change');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[1].patterns[0].steps[5].note)).toBeNull();
});

test('palette changes preserve global key and expose direct CC editing and event masks', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Global key').selectOption('9');
  await page.getByLabel('Sound collection').selectOption('dirt');
  await expect(page.getByLabel('Global key')).toHaveValue('9');
  await page.getByLabel('build', { exact: true }).uncheck();
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].eventMask.build)).toBe(false);
  await page.getByRole('tab', { name: 'Automation', exact: true }).click();
  await page.getByRole('button', { name: 'Add CC curve' }).click();
  await page.getByLabel('Points', { exact: true }).fill('0:10, 2:120, 4:10'); await page.getByRole('button', { name: 'Apply curve', exact: true }).click();
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].ccAutomation[0].points[1])).toEqual({ beat: 2, value: 120 });
  await page.getByRole('button', { name: 'Remove curve' }).click();
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].ccAutomation)).toEqual([]);
});

test('keyboard editing excludes text inputs and transport pulses keep existing rows', async ({ page }) => {
  await ready(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => window.workstationViewTest.calls.map(call => call.name))).toEqual(['copy', 'paste', 'undo', 'redo']);
  await page.getByLabel('Name', { exact: true }).focus(); await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.workstationViewTest.calls.length)).toBe(4);
  expect(await page.evaluate(() => {
    const first = document.querySelector('.studio-sequence');
    for (let index = 0; index < 24; index++) window.workstationViewTest.view.transport({ beat: index / 24, bpm: 120, clockSource: 'internal', linked: true, speedMode: 'bpm' });
    return first === document.querySelector('.studio-sequence');
  })).toBe(true);
});

test('project renders retain the focused field buffer, caret and selected edit target', async ({ page }) => {
  await ready(page);
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('Uncommitted lane');
  await name.evaluate(input => { input.focus(); input.setSelectionRange(4, 4); });
  await page.evaluate(() => window.workstationViewTest.view.render());
  expect(await page.evaluate(() => ({ value: document.activeElement.value, caret: document.activeElement.selectionStart,
    lane: window.workstationViewTest.state.laneId, label: document.activeElement.closest('label')?.textContent }))).toEqual({
    value: 'Uncommitted lane', caret: 4, lane: 'lane-1', label: 'Name'
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.evaluate(() => window.workstationViewTest.view.renderInspector());
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.getByLabel('Name', { exact: true }).fill('Committed lane');
  await page.getByLabel('Name', { exact: true }).dispatchEvent('change');
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].name)).toBe('Committed lane');
});

test('fullscreen keeps the same instrument root, numeric draft and emergency controls', async ({ page }) => {
  await ready(page);
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('Uncommitted draft');
  await page.locator('.studio-transport-overflow summary').click();
  await page.getByRole('button', { name: 'Expand fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('procgenPresentationRoot');
  expect(await page.evaluate(() => ({ draft: document.activeElement.value, changes: window.workstationViewTest.actions.length,
    canvasCount: document.querySelectorAll('#gameCanvas').length, stop: !!document.getElementById('studioStopOutput'),
    rootCount: document.querySelectorAll('#procgenPresentationRoot').length }))).toEqual({
    draft: 'Uncommitted draft', changes: 0, canvasCount: 1, stop: true, rootCount: 1
  });
  await page.locator('#studioFullscreenExit').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(name).toHaveValue('Uncommitted draft');
  await page.evaluate(() => window.workstationViewTest.view.dispose());
  await expect(page.locator('#procgenPresentationRoot')).toHaveCount(0);
  await expect(page.locator('#gameCanvas')).toHaveCount(1);
});

test('single-step edits keep visible rows and other cells mounted', async ({ page }) => {
  await ready(page, 1024);
  await page.locator('.studio-sequence').first().locator('.studio-cell').nth(3).click();
  await page.evaluate(() => {
    window.editRow = document.querySelector('.studio-sequence');
    window.otherCell = window.editRow.children[2];
  });
  const note = page.getByLabel('Fixed MIDI note');
  await note.fill('64'); await note.dispatchEvent('change');
  expect(await page.evaluate(() => ({ row: window.editRow === document.querySelector('.studio-sequence'),
    cell: window.otherCell === document.querySelector('.studio-sequence').children[2],
    note: window.workstationViewTest.getProject().procgen.lanes[0].patterns[0].steps[3].note }))).toEqual({ row: true, cell: true, note: 64 });
  await expect(note).toBeFocused();
});

test('inspector arrow keys resize only the inspector and view disposal detaches its renderer callback', async ({ page }) => {
  await ready(page);
  const separator = page.getByRole('separator', { name: 'Resize instrument dock' });
  await separator.focus(); await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => ({ height: window.workstationViewTest.state.dockHeight,
    step: window.workstationViewTest.state.step, tab: window.workstationViewTest.state.tab }))).toEqual({ height: 304, step: 0, tab: 'Lane' });
  expect(await separator.getAttribute('aria-valuenow')).toBe('304');
  expect(await page.evaluate(() => {
    const { view, runtime } = window.workstationViewTest;
    const renderer = { resize() {} }; runtime.lanes = { renderer }; view.render();
    const attached = !!renderer.workstationLayout && typeof renderer.onWorkstationFrame === 'function';
    view.dispose(); view.dispose();
    return { attached, detached: renderer.workstationLayout == null && renderer.onWorkstationFrame == null };
  })).toEqual({ attached: true, detached: true });
});

test('virtualizes 1024 lanes and exposes observer controls without losing the canvas on disposal', async ({ page }) => {
  await ready(page, 1024);
  const visible = await page.locator('.studio-lane-header').count();
  expect(visible).toBeGreaterThan(0); expect(visible).toBeLessThanOrEqual(8);
  await expect(page.getByLabel('Visible lane range')).toHaveText(`1–${visible} of 1024`);
  await page.getByTitle('Show next lanes').click();
  await expect(page.getByLabel('Visible lane range')).toHaveText(`${visible + 1}–${visible * 2} of 1024`);
  await page.locator('.studio-lane-headers').focus(); await page.keyboard.press('PageUp');
  await expect(page.getByLabel('Visible lane range')).toHaveText(`1–${visible} of 1024`);
  await page.getByRole('tab', { name: 'World', exact: true }).click();
  await page.getByLabel('Observer mode').selectOption('director');
  expect(await page.evaluate(() => window.workstationViewTest.calls.at(-1))).toEqual({ name: 'observe', value: { mode: 'director' } });
  await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 50 });
  await expect(page.locator('.studio-lane-title').first()).toContainText('2');
  await page.evaluate(() => window.workstationViewTest.view.dispose());
  await expect(page.locator('#gameCanvas')).toHaveCount(1);
  await expect(page.locator('#procgenStudio')).toHaveCount(0);
});

test('draw and erase gestures commit one reducer action for an entire stroke', async ({ page }) => {
  await ready(page);
  const stroke = async tool => {
    await page.getByLabel('Step editing tool').selectOption(tool);
    await page.locator('.studio-sequence').first().locator('.studio-cell').first().scrollIntoViewIfNeeded();
    const first = await page.locator('.studio-sequence').first().locator('.studio-cell').nth(0).boundingBox();
    const last = await page.locator('.studio-sequence').first().locator('.studio-cell').nth(3).boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 10 }); await page.mouse.up();
  };
  await stroke('draw');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].patterns[0].steps.slice(0, 4).every(step => step.enabled))).toBe(true);
  expect(await page.evaluate(() => window.workstationViewTest.actions.map(action => action.type))).toEqual(['procgen/pattern']);
  await stroke('erase');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].patterns[0].steps.slice(0, 4).every(step => !step.enabled))).toBe(true);
  expect(await page.evaluate(() => window.workstationViewTest.actions.length)).toBe(2);
});

test('benchmark 64-step edit and simultaneous launch latency @benchmark', async ({ page }) => {
  test.skip(!process.env.LEMMINGS_BENCH, 'Run explicitly with LEMMINGS_BENCH=1');
  const results = [];
  for (const laneCount of [8, 128, 1024]) {
    await ready(page, laneCount, 64);
    results.push(await page.evaluate(async () => {
      const fixture = window.workstationViewTest, samples = [], launchSamples = [];
      const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
      for (let index = 0; index < 20; index++) fixture.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: index % 2 ? 60 : 61 } });
      const before = performance.memory?.usedJSHeapSize ?? null;
      for (let index = 0; index < 120; index++) {
        const start = performance.now();
        fixture.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: index % 2 ? 60 : 61 } });
        samples.push(performance.now() - start);
      }
      const after = performance.memory?.usedJSHeapSize ?? null;
      for (let index = 0; index < 120; index++) {
        const launches = fixture.getProject().procgen.lanes.map(lane => ({ laneId: lane.id, slot: index % 2 ? 1 : 0 }));
        const start = performance.now(); fixture.dispatch({ type: 'procgen/launchedBatch', launches });
        launchSamples.push(performance.now() - start);
      }
      const result = { lanes: fixture.getProject().procgen.lanes.length, steps: 64, scope: 'browser reducer/view and synthetic workstation host; no audio or IndexedDB',
        editMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99), over16: samples.filter(value => value > 16).length },
        launchMs: { p50: percentile(launchSamples, 0.5), p95: percentile(launchSamples, 0.95), p99: percentile(launchSamples, 0.99), over16: launchSamples.filter(value => value > 16).length },
        heapDeltaBytes: before == null || after == null || after === before ? null : after - before };
      const project = fixture.getProject(); fixture.view.dispose();
      window.localStorage.removeItem('lemmings.procgen.workstation.v1');
      const { createProcgenWorkstation } = await import('/js/app/procgen/workstation/ProcgenWorkstation.js');
      let legacyProject = project;
      const listeners = new Set(), runtime = { world: { laneCount: result.lanes, seed: 7, timer: { speedFactor: 1 }, frontiers: [100] }, lanes: { renderer: null }, view: {} };
      const legacy = { settings: { seed: 7, speed: 1, laneCount: result.lanes }, getProject: () => legacyProject,
        setProject(value) { legacyProject = value; for (const listener of listeners) listener(value); },
        subscribeProject(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        setPaused() {}, setSpeed() {}, local: { getState: () => ({ enabled: false, selectedBackend: 'synth' }) } };
      const studio = createProcgenWorkstation({ document, window, legacy, getRuntime: () => runtime, restart: async () => {},
        storage: { close() {} }, captureCheckpoint: () => ({ version: 1, laneCount: result.lanes, seed: 7 }),
        transportOptions: { driver: { start() {}, stop() {} }, lookaheadMs: 0 } });
      const controller = [];
      for (let index = 0; index < 20; index++) studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: index % 2 ? 60 : 61 } });
      for (let index = 0; index < 120; index++) {
        const start = performance.now();
        studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: index % 2 ? 60 : 61 } });
        controller.push(performance.now() - start);
      }
      result.controllerMs = { p50: percentile(controller, 0.5), p95: percentile(controller, 0.95), p99: percentile(controller, 0.99), over16: controller.filter(value => value > 16).length };
      studio.handlers.record(true);
      const captures = [];
      for (let index = 0; index < 120; index++) {
        const timestamp = performance.now(), start = timestamp;
        studio.ports.receiveMidi([0x90, 60 + index % 2, 90], timestamp);
        studio.ports.receiveMidi([0x80, 60 + index % 2, 0], timestamp + 10);
        captures.push(performance.now() - start);
      }
      result.captureMs = { p50: percentile(captures, 0.5), p95: percentile(captures, 0.95), p99: percentile(captures, 0.99), over16: captures.filter(value => value > 16).length };
      studio.dispose();
      return result;
    }));
  }
  console.log('ProcGen browser edit benchmark:', JSON.stringify(results));
  expect(results.map(result => result.lanes)).toEqual([8, 128, 1024]);
});

test('project pages replace bounded DOM and return through cursor history @boundary', async ({ page }) => {
  await ready(page, 1);
  await page.evaluate(() => {
    const f = window.workstationViewTest;
    const batch = index => ({ items: Array.from({ length: 24 }, (_, row) => ({ id: `page-${index}-${row}`, name: `Page ${index} item ${row}`, savedAt: '2026-10-24' })), nextCursor: index < 99 ? String(index + 1) : null });
    f.view.showProjectPage(batch(0), async () => false, async cursor => batch(Number(cursor || 0)));
  });
  for (let index = 1; index <= 8; index++) {
    await page.getByRole('button', { name: 'More projects' }).click();
    await expect(page.locator('.studio-project-items button')).toHaveCount(24);
    await expect(page.locator('.studio-project-items button').first()).toContainText(`Page ${index} item 0`);
  }
  await page.getByRole('button', { name: 'Previous projects' }).click();
  await expect(page.locator('.studio-project-items button').first()).toContainText('Page 7 item 0');
});

test('project naming retains invalid draft and keyboard cancellation returns no name @boundary', async ({ page }) => {
  await ready(page, 1);
  await page.evaluate(() => { const f = window.workstationViewTest; f.nameResult = 'pending'; f.view.requestProjectName({ value: '' }).then(value => { f.nameResult = value; }); });
  const dialog = page.getByRole('dialog', { name: 'Project name' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeVisible(); await expect(dialog.locator('output')).toContainText('Enter a project name');
  await dialog.getByRole('textbox').fill('Retained draft'); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workstationViewTest.nameResult)).toBe(null);
});

test('foreign pointer release cannot commit pattern painting and owner cancellation leaves zero edits @boundary', async ({ page }) => {
  await ready(page, 1); await page.getByLabel('Step editing tool').selectOption('draw');
  await page.evaluate(() => { const f = window.workstationViewTest; f.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { enabled: false } }); f.actions.length = 0;
    document.querySelector('.studio-sequences').addEventListener('pointerdown', event => { f.pointerId = event.pointerId; }, { once: true }); });
  const box = await page.locator('.studio-cell').first().boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99 })));
  expect(await page.evaluate(() => window.workstationViewTest.actions.length)).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.workstationViewTest.pointerId })));
  await page.mouse.up(); expect(await page.evaluate(() => window.workstationViewTest.actions.length)).toBe(0);
  await page.locator('.studio-cell').first().focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.workstationViewTest.actions.length)).toBe(1);
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].patterns[0].steps[0].enabled)).toBe(true);
});


test('keyed inspector fields, rows and faders keep exact DOM identity through full renders and IME', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); const name = page.getByLabel('Name', { exact: true }); await name.fill('Uncommitted lane');
  await name.evaluate(element => { window.stableField = element; element.setSelectionRange(4, 7); element.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true })); });
  await page.evaluate(() => { window.stableHeader = document.querySelector('.studio-lane-header'); window.stableFader = document.querySelector('.studio-lane-fader'); window.stableCell = document.querySelector('.studio-cell');
    window.workstationViewTest.dispatch({ type: 'procgen/lane', laneId: 'lane-2', patch: { name: 'Changed elsewhere' } }); window.workstationViewTest.view.render(); });
  await page.setViewportSize({ width: 2560, height: 1440 });
  expect(await name.evaluate(element => ({ same: element === window.stableField, value: element.value, caret: element.selectionStart,
    header: window.stableHeader === document.querySelector('.studio-lane-header'), fader: window.stableFader === document.querySelector('.studio-lane-fader'), cell: window.stableCell === document.querySelector('.studio-cell') }))).toEqual({ same: true, value: 'Uncommitted lane', caret: 4, header: true, fader: true, cell: true });
  await name.evaluate(element => { element.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(() => window.workstationViewTest.actions.filter(action => action.type === 'procgen/lane' && action.laneId === 'lane-1'))).toHaveLength(1);
});

test('external edits retain an explicit draft conflict and support both named resolutions', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); const name = page.getByLabel('Name', { exact: true }); await name.fill('My draft');
  await page.evaluate(() => window.workstationViewTest.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'External value' } }));
  await expect(name).toHaveValue('My draft'); await expect(name).toHaveAttribute('data-edit-conflict', 'true'); await name.dispatchEvent('change');
  expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].name)).toBe('External value');
  await page.getByRole('button', { name: 'Use current value', exact: true }).click(); await expect(name).toHaveValue('External value'); await expect(name).toBeFocused();
  await name.fill('Intentional overwrite'); await page.evaluate(() => window.workstationViewTest.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Later value' } }));
  await page.getByRole('button', { name: 'Keep my edit', exact: true }).click(); expect(await page.evaluate(() => window.workstationViewTest.getProject().procgen.lanes[0].name)).toBe('Intentional overwrite');
});

test('removing an active schema field announces focus return and fences its retired callback', async ({ page }) => {
  await ready(page); await page.locator('.studio-inspector-tabs').getByRole('tab', { name: 'Step', exact: true }).click(); const condition = page.getByLabel('Step condition', { exact: true });
  await condition.selectOption('event'); const every = page.getByLabel('Every', { exact: true }); await every.focus();
  await every.evaluate(element => { window.removedField = element; });
  await page.evaluate(() => window.workstationViewTest.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { condition: null } }));
  await expect(every).toHaveCount(0); await expect(page.locator('.studio-inspector-tabs').getByRole('tab', { name: 'Step', exact: true })).toBeFocused();
  const count = await page.evaluate(() => window.workstationViewTest.actions.length);
  await page.evaluate(() => { window.removedField.value = '9'; window.removedField.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(() => window.workstationViewTest.actions.length)).toBe(count); await expect(page.locator('.studio-status')).toContainText('no longer available');
});


test('view replacement retires A before B borrows its canvas and late A callbacks cannot erase B', { tag: '@boundary' }, async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(async () => {
    const f = window.workstationViewTest, first = f.view, canvas = document.getElementById('gameCanvas'), originalParent = document.body;
    const baseFrame = () => {}, baseLayout = { original: true }, renderer = { resize() {}, onWorkstationFrame: baseFrame, workstationLayout: baseLayout };
    f.runtime.lanes = { renderer }; first.render(); const oldFrame = renderer.onWorkstationFrame, oldInput = document.querySelector('[data-field-key="Lane:Name"] input');
    const { createProcgenWorkstationView } = await import('/js/app/procgen/workstation/ProcgenWorkstationView.js');
    let second; second = createProcgenWorkstationView({ document, window, getProject: f.getProject, getRuntime: () => f.runtime, state: { ...f.state }, handlers: f.handlers,
      dispatch: action => { f.dispatch(action); second.render(); } }); second.render(); const secondFrame = renderer.onWorkstationFrame, secondRoot = document.getElementById('procgenStudio');
    const before = f.actions.length; oldInput.value = 'Stale'; oldInput.dispatchEvent(new Event('change', { bubbles: true })); first.dispose(); oldFrame(20);
    const live = secondRoot.isConnected && renderer.onWorkstationFrame === secondFrame && renderer.workstationLayout === second.getProjection(), unchanged = f.actions.length === before;
    second.dispose(); second.dispose(); return { live, unchanged, detached: renderer.onWorkstationFrame === baseFrame && renderer.workstationLayout === baseLayout,
      restored: canvas.parentElement === originalParent, roots: document.querySelectorAll('.procgen-studio').length };
  })).toEqual({ live: true, unchanged: true, detached: true, restored: true, roots: 0 });
});

test('renderer replacement restores each previous attachment exactly once', async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => {
    const { view, runtime } = window.workstationViewTest, one = () => {}, two = () => {}, first = { resize() {}, onWorkstationFrame: one }, second = { resize() {}, onWorkstationFrame: two };
    runtime.lanes = { renderer: first }; view.render(); runtime.lanes.renderer = second; view.render(); const released = first.onWorkstationFrame === one && first.workstationLayout == null;
    view.dispose(); return { released, detached: second.onWorkstationFrame === two && second.workstationLayout == null };
  })).toEqual({ released: true, detached: true });
});
