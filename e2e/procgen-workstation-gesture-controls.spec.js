import { expect, test } from '@playwright/test';

const setup = async (page, kind) => {
  if (kind === 'terrain') {
    await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=1&output=midi');
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
    await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  } else {
    await page.goto('/README.md');
    await page.setContent('<style>body{margin:40px}svg{display:block;width:600px;height:270px}circle{fill:orange}.fixture-shell{height:800px}#fixture-resize{display:block;width:600px;height:30px;background:#aaa}</style>');
  }
  await page.evaluate(async kind => {
    const { getPointerGestureArbiter } = await import('/js/app/controls/PointerGestureArbiter.js');
    const arbiter = getPointerGestureArbiter(document), calls = [], events = [], originalIdentity = {};
    let identity = originalIdentity;
    const f = window.controlsFixture = { kind, calls, events, arbiter, getIdentity: () => identity };
    if (kind === 'curve') {
      const { createAutomationCurveEditor } = await import('/js/app/controls/AutomationCurveEditor.js');
      const curve = { id: 'native-curve', length: 4, axis: 'beat', mode: 'linear', points: [{ beat: 0, value: 32 }, { beat: 2, value: 100 }, { beat: 4, value: 32 }] };
      f.widget = createAutomationCurveEditor({ document, window, curve, getIdentity: f.getIdentity, commit: points => { calls.push({ kind: 'curve', points }); return true; } });
      document.body.append(f.widget.element); f.widget.update(curve); f.target = f.widget.element.querySelector('svg');
      f.value = () => f.widget.inspect().draftText;
      f.changeSource = () => { identity = {}; f.widget.update(curve); identity = originalIdentity; f.widget.update(curve); };
      f.dispose = () => f.widget.dispose();
    } else if (kind === 'dock') {
      const { createWorkstationDock } = await import('/js/app/procgen/workstation/WorkstationDock.js');
      const shell = document.createElement('main'), inspector = document.createElement('section'), resize = document.createElement('div'), tabs = document.createElement('div'), fields = document.createElement('div');
      shell.className = 'fixture-shell'; resize.id = 'fixture-resize'; resize.tabIndex = 0; resize.setAttribute('role', 'separator'); inspector.append(tabs, fields); shell.append(resize, inspector); document.body.append(shell);
      const state = { workspaceMode: 'inspect', dockHeight: 288 };
      f.widget = createWorkstationDock({ document, window, shell, inspector, resize, tabs, fields, state, getIdentity: f.getIdentity, getContext: () => ({ laneId: 'lane-1', editorKind: 'Automation' }), onOpen() {}, onClose() {}, onLayout() {}, onPreferences: () => calls.push({ kind: 'preferences', height: state.dockHeight }) });
      f.widget.update(); f.target = resize; f.value = () => state.dockHeight;
      f.changeSource = () => { identity = {}; f.widget.update(); identity = originalIdentity; f.widget.update(); };
      f.dispose = () => f.widget.dispose();
    } else {
      const { createPhysicalAuthoringView } = await import('/js/app/procgen/workstation/PhysicalAuthoringView.js');
      let project = window.__PROCGEN_STUDIO__.getProject();
      const originalProject = project;
      f.widget = createPhysicalAuthoringView({ document, getWorld: () => window.__PROCGEN_LANES__.world, getProject: () => project,
        previewTerrain: input => { calls.push({ kind: 'preview', input }); return input; }, applyTerrain: input => { calls.push({ kind: 'terrain', input }); return input; } });
      f.widget.open(); f.target = document.querySelector('dialog[aria-label="Physical terrain and fragment authoring"] canvas');
      f.target.focus(); f.target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      f.value = () => null;
      f.changeSource = () => { project = { ...project, procgen: { ...project.procgen, revision: project.procgen.revision + 1 } }; f.widget.refresh(); project = originalProject; f.widget.refresh(); };
      f.dispose = () => f.widget.dispose();
    }
    for (const type of ['pointerdown', 'pointerup', 'gotpointercapture', 'lostpointercapture', 'pointercancel']) f.target.addEventListener(type, event => events.push({ type, id: event.pointerId, pointerType: event.pointerType, buttons: event.buttons, trusted: event.isTrusted, owner: arbiter.inspect()?.pointerId ?? null, calls: calls.length }));
    f.before = f.value();
  }, kind);
  expect(page.viewportSize()).toEqual({ width: 1920, height: 1080 });
};

const start = async (page, kind, { captureFailure = false, pending = false } = {}) => {
  const point = kind === 'curve' ? page.locator('.studio-curve-editor circle[data-point="1"]') : kind === 'dock' ? page.locator('#fixture-resize') : page.getByRole('dialog', { name: 'Physical terrain and fragment authoring' }).locator('canvas');
  await point.scrollIntoViewIfNeeded();
  const box = await point.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (captureFailure) await page.evaluate(() => { window.controlsFixture.target.setPointerCapture = () => { throw new window.DOMException('Controlled capture rejection', 'NotFoundError'); }; });
  await page.mouse.move(x, y); await page.mouse.down(); if (!pending) await page.mouse.move(x + 12, y - 35, { steps: 3 });
  if (!captureFailure && !pending) {
    await expect.poll(() => page.evaluate(() => window.controlsFixture.events.some(event => event.type === 'gotpointercapture' && event.trusted))).toBe(true);
    expect(await page.evaluate(() => window.controlsFixture.arbiter.inspect())).not.toBe(null);
    if (kind !== 'terrain') expect(await page.evaluate(() => window.controlsFixture.value())).not.toEqual(await page.evaluate(() => window.controlsFixture.before));
  }
  return { x: x + 12, y: y - 35 };
};

const retainedTerrainSelection = async page => {
  await page.getByRole('button', { name: 'Preview terrain', exact: true }).click();
  return page.evaluate(() => window.controlsFixture.calls.at(-1).input.spans.reduce((sum, span) => sum + span.x2 - span.x1, 0));
};

const recoverCamera = async page => {
  await page.evaluate(async () => {
    const f = window.controlsFixture; f.dispose(); document.getElementById('interrupting-modal')?.remove();
    const { createProcgenCameraController } = await import('/js/app/procgen/ProcgenCameraController.js');
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 180; canvas.style.cssText = 'position:fixed;left:1300px;top:750px;width:400px;height:180px;background:#234;z-index:100000'; document.body.append(canvas);
    const renderer = { canvas, window, world: { width: 6000, height: 4000, generation: 1, actors: [] }, scale: 3, cameraX: 0, cameraY: 0, follow: false, render() {} };
    f.camera = { renderer, controller: createProcgenCameraController(renderer) };
  });
  await page.mouse.move(1500, 840); await page.mouse.down(); await page.mouse.move(1400, 840); await page.mouse.up();
  expect(await page.evaluate(() => window.controlsFixture.camera.renderer.cameraX)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.controlsFixture.arbiter.inspect())).toBe(null);
  await page.evaluate(() => window.controlsFixture.camera.controller.dispose());
};

const receipt = async (page, testInfo, mode) => testInfo.attach('desktop-control-gesture.json', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(mode => {
  const f = window.controlsFixture;
  return { kind: f.kind, mode, viewport: { width: window.innerWidth, height: window.innerHeight }, events: f.events, calls: f.calls, owner: f.arbiter.inspect(), recoveredCameraX: f.camera?.renderer.cameraX ?? null, evidence: 'Real controls and browser-injected native desktop mouse/pen. Terrain preview reads the actual paused game world; commit callbacks in this isolated control fixture are observed boundaries, not physical history or device qualification.' };
}, mode)) });

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && await page.evaluate(() => !!window.controlsFixture).catch(() => false)) await receipt(page, testInfo, 'failure-diagnostic');
});

for (const kind of ['terrain', 'curve', 'dock']) {
  for (const interruption of ['capture-loss', 'Escape', 'blur', 'modal', 'source-A-B-A', 'removal', 'disposal', 'capture-rejection']) {
    test(kind + ' native gesture cancels on ' + interruption + ' @boundary @gesture-controls', async ({ page }, testInfo) => {
      await setup(page, kind); await start(page, kind, { captureFailure: interruption === 'capture-rejection' });
      if (interruption === 'capture-loss') await page.evaluate(() => { const f = window.controlsFixture; f.target.releasePointerCapture(f.arbiter.inspect().pointerId); });
      else if (interruption === 'Escape') await page.keyboard.press('Escape');
      else if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (interruption === 'modal') await page.evaluate(() => { const modal = document.createElement('dialog'); modal.id = 'interrupting-modal'; document.body.append(modal); modal.showModal(); });
      else if (interruption === 'source-A-B-A') await page.evaluate(() => window.controlsFixture.changeSource());
      else if (interruption === 'removal') await page.evaluate(() => window.controlsFixture.target.remove());
      else if (interruption === 'disposal') await page.evaluate(() => window.controlsFixture.dispose());
      await page.mouse.move(1100, 800); await page.mouse.up();
      await expect.poll(() => page.evaluate(() => window.controlsFixture.arbiter.inspect())).toBe(null);
      expect(await page.evaluate(() => window.controlsFixture.calls)).toEqual([]);
      if (!['disposal', 'removal', 'modal'].includes(interruption)) {
        if (kind === 'terrain') expect(await retainedTerrainSelection(page)).toBe(1);
        else expect(await page.evaluate(() => window.controlsFixture.value())).toEqual(await page.evaluate(() => window.controlsFixture.before));
      }
      await recoverCamera(page); await receipt(page, testInfo, interruption);
    });
  }
  test(kind + ' concurrent native contacts preserve one transaction and fresh input @boundary @gesture-controls', async ({ page }, testInfo) => {
    await setup(page, kind); await start(page, kind, { pending: true });
    const target = kind === 'curve' ? page.locator('.studio-curve-editor circle[data-point="1"]') : kind === 'dock' ? page.locator('#fixture-resize') : page.getByRole('dialog', { name: 'Physical terrain and fragment authoring' }).locator('canvas');
    const bounds = await target.boundingBox(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2, session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' });
      await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, pointerType: 'pen', button: 'left', buttons: 1, clickCount: 1, force: 0.5 });
      const down = await page.evaluate(() => window.controlsFixture.events.filter(event => event.type === 'pointerdown'));
      expect(down.map(event => event.pointerType)).toEqual(['mouse', 'pen']); expect(down.every(event => event.trusted)).toBe(true); expect(new Set(down.map(event => event.id)).size).toBe(2);
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1 });
      expect(await page.evaluate(() => window.controlsFixture.arbiter.inspect().pointerId)).toBe(down[0].id);
      expect(await page.evaluate(() => window.controlsFixture.calls.length)).toBe(0);
      await page.mouse.move(x + 12, y - (kind === 'dock' ? 8 : 35), { steps: 3 }); await page.mouse.up();
      expect(await page.evaluate(() => window.controlsFixture.arbiter.inspect())).toBe(null);
      if (kind === 'curve') { await page.getByRole('button', { name: 'Apply curve', exact: true }).click(); expect(await page.evaluate(() => window.controlsFixture.calls)).toHaveLength(1); }
      else if (kind === 'terrain') { expect(await retainedTerrainSelection(page)).toBeGreaterThan(1); await page.getByRole('button', { name: 'Apply terrain + physical Undo', exact: true }).click(); expect(await page.evaluate(() => window.controlsFixture.calls.filter(call => call.kind === 'terrain'))).toHaveLength(1); }
      else expect(await page.evaluate(() => window.controlsFixture.calls)).toHaveLength(1);
      await recoverCamera(page); await receipt(page, testInfo, 'concurrent-mouse-pen');
    } finally { await session.detach(); }
  });
}

test('production native terrain selection applies once and retains physical Undo and Redo @boundary @gesture-controls', async ({ page }, testInfo) => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=1&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_STUDIO__.handlers.openPhysicalAuthoring(); });
  const dialog = page.getByRole('dialog', { name: 'Physical terrain and fragment authoring' });
  await dialog.getByLabel('World X', { exact: true }).fill('100'); await dialog.getByLabel('World Y', { exact: true }).fill('4');
  await dialog.getByLabel('Width', { exact: true }).fill('8'); await dialog.getByLabel('Height', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Inspect region', exact: true }).click();
  const canvas = dialog.locator('canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const before = await page.evaluate(() => ({ solid: window.__PROCGEN_LANES__.world.hasGroundAt(104, 6), tick: window.__PROCGEN_LANES__.world.tickIndex, revision: window.__PROCGEN_LANES__.world.physicalAuthoring.revision }));
  expect(before.solid).toBe(false);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 2, y + 2); await page.mouse.up();
  await dialog.getByRole('button', { name: 'Apply terrain + physical Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.hasGroundAt(104, 6))).toBe(true);
  const applied = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, revision: window.__PROCGEN_LANES__.world.physicalAuthoring.revision, paused: !window.__PROCGEN_STUDIO__.transport.getState().playing, command: window.__PROCGEN_LANES__.world.physicalAuthoring.lastApplied }));
  expect(applied.tick).toBe(before.tick + 1); expect(applied.revision).toBe(before.revision + 1); expect(applied.paused).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.undo());
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.hasGroundAt(104, 6))).toBe(false);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.redo());
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.hasGroundAt(104, 6))).toBe(true);
  await testInfo.attach('production-terrain-history.json', { contentType: 'application/json', body: JSON.stringify({ viewport: page.viewportSize(), before, applied, undo: 'restored empty cell', redo: 'restored authored solid cell', evidence: 'Production native mouse selection, real physical boundary, real project/history restoration; no audio/device claim.' }) });
});

test('dock unhandled native release outside cleared pending capture retires without preferences @boundary @gesture-controls', async ({ page }, testInfo) => {
  await setup(page, 'dock'); await start(page, 'dock', { pending: true });
  const box = await page.locator('#fixture-resize').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2, session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, pointerType: 'pen', button: 'left', buttons: 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1 });
    await page.mouse.move(1100, 800); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.controlsFixture.arbiter.inspect())).toBe(null);
    expect(await page.evaluate(() => window.controlsFixture.calls)).toEqual([]);
    expect(await page.evaluate(() => window.controlsFixture.value())).toBe(288);
    await recoverCamera(page); await receipt(page, testInfo, 'native-pending-capture-release-outside');
  } finally { await session.detach(); }
});
