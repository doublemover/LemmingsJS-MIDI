import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

const ready = async page => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.locator('#procgenListen').click(); await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.ports.configure({ recording: true }); window.__PROCGEN_LANES__.resume(); window.__PROCGEN_STUDIO__.play(); });
};
const freeze = async (page, dense = false) => {
  await expect.poll(() => page.locator('.studio-causal-mark').evaluateAll((nodes, dense) => nodes.some(node => !node.closest('[hidden]') && (!dense || Number(node.dataset.count) > 1)), dense), { timeout: 20000 }).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_LANES__.pause(); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.renderer.render(true); });
  await page.locator('#procgenPanic').click(); await expect(page.locator('.studio-causal-mark').first()).toBeVisible();
};
const ownerState = page => page.evaluate(async () => {
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'); const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)), midi: window.__WEBMIDI_STUB__.metrics().sent };
});

test('actual physical causes project through the accepted world frame and open exact read-only evidence', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page);
  const capture = await page.waitForFunction(async () => {
    const { projectCausalHistory } = await import('/js/app/procgen/workstation/CausalVisualProjection.js'), studio = window.__PROCGEN_STUDIO__, renderer = window.__PROCGEN_LANES__.renderer;
    const snapshot = renderer.presentation.getSnapshot(), values = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id)), model = projectCausalHistory({ displays: values, presentation: snapshot });
    const button = document.querySelector('.studio-causal-mark'); if (!snapshot || !button || button.closest('[hidden]') || button.dataset.projectionRevision !== String(snapshot.projectionRevision)) return false;
    const mark = model.marks.find(value => value.causes[0].eventId === button.dataset.eventId); if (!mark) return false; const rect = button.getBoundingClientRect();
    const intent = mark.causes[0].intents[0];
    return { accepted: renderer.presentation.valid(snapshot), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, expectedX: mark.x, expectedY: mark.y, eventId: button.dataset.eventId, sourceIds: mark.causes.map(value => value.eventId), geometrySubscribers: renderer.presentation.geometryListeners.size, entitySubscribers: renderer.presentation.listeners.size, width: rect.width, height: rect.height, font: window.getComputedStyle(button).fontSize, graphRevision: intent.graphRevision, mappingRevision: intent.mappingRevision, mappingEvidence: intent.mappingEvidence, producerTime: intent.scoreTime };
  });
  const geometry = await capture.jsonValue(); await capture.dispose();
  expect(geometry).toMatchObject({ accepted: true, geometrySubscribers: 1, entitySubscribers: 1, width: 44, height: 44, font: '14px' }); expect(geometry.x).toBeCloseTo(geometry.expectedX, 0); expect(geometry.y).toBeCloseTo(geometry.expectedY, 0); expect(geometry.sourceIds).toContain(geometry.eventId);
  expect(geometry.mappingEvidence).toBe('canonical-intent-construction'); expect(Number.isSafeInteger(geometry.graphRevision)).toBe(true); expect(Number.isSafeInteger(geometry.mappingRevision)).toBe(true); expect(geometry.mappingRevision).toBeLessThanOrEqual(geometry.graphRevision);
  expect(geometry.producerTime.epoch).toBeTruthy(); expect(Number.isSafeInteger(geometry.producerTime.simTick)).toBe(true); expect(geometry.producerTime.sourceTickDurationMs).toBeGreaterThan(0);
  const before = await ownerState(page); const mark = page.locator('.studio-causal-mark').first(); await mark.focus(); await mark.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Physical cause explanation' }); await expect(dialog).toBeVisible(); await expect(dialog).toContainText(geometry.eventId); await expect(dialog).toContainText('Source binding:'); await expect(dialog).toContainText('frozen pitch'); await expect(dialog).toContainText('API submission is not acoustic evidence');
  await expect(dialog).toContainText(`Producer score time: epoch ${geometry.producerTime.epoch}`); await expect(dialog).toContainText(`simulation tick ${geometry.producerTime.simTick} + ${geometry.producerTime.subTick}`);
  await expect(dialog.getByRole('button', { name: 'Panic', exact: true })).toBeVisible(); await dialog.getByRole('button', { name: 'Refresh retained evidence' }).click();
  await dialog.getByRole('button', { name: 'Close cause explanation' }).click(); expect(await ownerState(page)).toEqual(before);
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1920, 1080]);
  await page.screenshot({ path: test.info().outputPath('desktop-causal-marks.png') });
});

test('same-seed replay retires old projected sources and stale detached marks cannot inspect the new run', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page);
  const before = await page.evaluate(() => {
    window.__oldCausalMark = document.querySelector('.studio-causal-mark'); window.__oldCausalWorld = window.__PROCGEN_LANES__.world;
    const studio = window.__PROCGEN_STUDIO__, values = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id));
    return { worldId: window.__oldCausalWorld.worldId, generation: window.__oldCausalWorld.generation, sources: values.flatMap(value => value.evidence.history.map(event => event.sourceKey)) };
  });
  await page.evaluate(async () => { await window.__PROCGEN_STUDIO__.handlers.replay(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.renderer.render(true); });
  const after = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, values = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id));
    window.__oldCausalMark.click(); return { replaced: world !== window.__oldCausalWorld, worldId: world.worldId, generation: world.generation, sources: values.flatMap(value => value.evidence.history.map(event => event.sourceKey)), dialogOpen: document.querySelector('.studio-causal-dialog').open };
  });
  expect(after.replaced).toBe(true); expect(after.worldId).toBe(before.worldId); expect(after.generation).toBe(before.generation); expect(after.sources.every(source => !before.sources.includes(source))).toBe(true); expect(after.dialogOpen).toBe(false);
});

test('adopting a saved physical session admits only its new document owner provenance and sink receipts', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page);
  const before = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; window.__savedCausalSession = studio.capture();
    return studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id)).flatMap(value => value.evidence.history.map(event => event.sourceKey));
  });
  expect(before.length).toBeGreaterThan(0);
  await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; await studio.loadSession(window.__savedCausalSession); window.__PROCGEN_LANES__.pause(); studio.transport.pause(); });
  if (await page.locator('#procgenListen').getAttribute('aria-pressed') === 'true') { await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); }
  await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.ports.getOperationalState().outputRoutes.some(route => route.outputId === 'pw-output-1' && route.active))).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_LANES__.resume(); window.__PROCGEN_STUDIO__.play(); });
  const captured = await page.waitForFunction(() => {
    const studio = window.__PROCGEN_STUDIO__, displays = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id));
    for (const value of displays) for (const event of value.evidence.history) if (event.mappingEvidence === 'canonical-intent-construction' && event.receipts.some(receipt => receipt.stage === 'submitted')) {
      window.__PROCGEN_LANES__.pause(); studio.transport.pause(); return { sourceKey: event.sourceKey, graphRevision: event.graphRevision, mappingRevision: event.mappingRevision, receipts: event.receipts };
    }
    return false;
  }, null, { timeout: 20000 });
  const value = await captured.jsonValue(); await captured.dispose(); expect(before).not.toContain(value.sourceKey); expect(Number.isSafeInteger(value.graphRevision)).toBe(true); expect(Number.isSafeInteger(value.mappingRevision)).toBe(true); await page.locator('#procgenPanic').click();
});

test('reduced-motion dense causes retain counted identities and keyboard drilldown without animations', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page); await freeze(page, true);
  const bundled = page.locator('.studio-causal-mark:not([data-count="1"])').first(); await expect(bundled).toBeVisible();
  const count = Number(await bundled.getAttribute('data-count')); expect(count).toBeGreaterThan(1); await bundled.focus(); await bundled.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Physical cause explanation' }); await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('Retained physical cause').locator('option')).toHaveCount(count);
  const ids = await dialog.getByLabel('Retained physical cause').locator('option').evaluateAll(options => options.map(option => option.value)); expect(new Set(ids).size).toBe(count);
  await dialog.getByLabel('Retained physical cause').selectOption(ids.at(-1)); await expect(dialog).toContainText('Physical fact:'); await expect(dialog).toContainText('individual PCM/audibility unrecorded');
  expect(await page.locator('.studio-causal-mark').evaluateAll(nodes => nodes.every(node => window.getComputedStyle(node).animationName === 'none' && window.getComputedStyle(node).transitionDuration === '0s'))).toBe(true);
});

test('actual shared convolution tail output cannot upgrade an uncorrelated actor cause to individual render evidence', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page); const before = await ownerState(page);
  const result = await page.evaluate(async () => {
    const { projectCausalHistory, explainCausalVisual } = await import('/js/app/procgen/workstation/CausalVisualProjection.js'), studio = window.__PROCGEN_STUDIO__;
    const read = () => projectCausalHistory({ displays: studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id)) });
    const model = read(), text = model.causes.map(cause => explainCausalVisual(cause));
    const context = new window.OfflineAudioContext(1, 24000, 48000), shared = context.createConvolver(), impulse = context.createBuffer(1, 9600, 48000), values = impulse.getChannelData(0);
    values[0] = 0.5; values[2400] = 0.25; values[4800] = -0.125; shared.normalize = false; shared.buffer = impulse; shared.connect(context.destination);
    const sources = [];
    for (const time of [0, 0.02]) { const source = context.createBufferSource(), buffer = context.createBuffer(1, 1, 48000); buffer.getChannelData(0)[0] = 0.5; source.buffer = buffer; source.connect(shared); source.start(time); sources.push(source); }
    const rendered = await context.startRendering(), samples = rendered.getChannelData(0); let tailEnergy = 0;
    for (let index = 1920; index < samples.length; index++) tailEnergy += samples[index] * samples[index];
    for (const source of sources) source.disconnect(); shared.disconnect(); shared.buffer = null;
    return { tailEnergy, causes: text.length, unchanged: JSON.stringify(text) === JSON.stringify(read().causes.map(cause => explainCausalVisual(cause))), allUnknown: text.every(value => value.includes('individual PCM/audibility unrecorded') && value.includes('Shared-body/tail output cannot be attributed') && value.includes('Receiver/measured sink: unrecorded')) };
  });
  expect(result.causes).toBeGreaterThan(0); expect(result.tailEnergy).toBeGreaterThan(0); expect(result.unchanged).toBe(true); expect(result.allUnknown).toBe(true); expect(await ownerState(page)).toEqual(before);
});

test('an actual mapping replacement retains its unrooted old-voice end in native text history without inventing a world mark', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1,
      instruments: [{ id: 'held-lineage', sourceKind: 'MotionCommitted', pitchCents: 6000, velocity01: 0.75, role: 'held', route: 'local', articulation: { spacingPixels: 10, sustain: true, lifetimeScope: 'actorJourney' } }] } });
    studio.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(8); window.__PROCGEN_LANES__.renderer.render(true);
  });
  await page.waitForFunction(() => { const studio = window.__PROCGEN_STUDIO__; return studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id)).some(value => value.evidence.history.some(event => event.mappingId === 'held-lineage' && event.kind === 'begin')); });
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, graph = studio.getProject().procgen.physicalGraph; studio.dispatch({ type: 'procgen/physicalGraph', graph: { ...graph, revision: graph.revision + 1, instruments: graph.instruments.map(value => ({ ...value, pitchCents: 7200 })) } });
    window.__PROCGEN_LANES__.step(1); window.__PROCGEN_LANES__.renderer.render(true);
  });
  const capture = await page.waitForFunction(async () => {
    const { projectCausalHistory } = await import('/js/app/procgen/workstation/CausalVisualProjection.js'), studio = window.__PROCGEN_STUDIO__;
    const model = projectCausalHistory({ displays: studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id)) });
    const reference = model.causes.find(cause => cause.referenceKind === 'intent-only' && cause.intents.some(event => event.mappingId === 'held-lineage' && event.terminationReason === 'mapping-changed'));
    return reference ? { key: reference.key, intentId: reference.intents[0].intentId, voiceId: reference.intents[0].voiceId } : false;
  });
  const value = await capture.jsonValue(); await capture.dispose(); await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); }); await page.locator('#procgenPanic').click(); const before = await ownerState(page);
  await page.locator('summary').filter({ hasText: 'View actions' }).click(); await page.getByRole('button', { name: /^Cause history/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Physical cause explanation' }); await dialog.getByLabel('Retained physical cause').selectOption(value.key);
  await expect(dialog.getByRole('heading', { name: 'Intent without a retained physical source' })).toBeVisible(); await expect(dialog).toContainText(value.intentId); await expect(dialog).toContainText(value.voiceId); await expect(dialog).toContainText('termination mapping-changed'); await expect(dialog).toContainText('no physical event is invented');
  await dialog.getByRole('button', { name: 'Close cause explanation' }).click(); expect(await ownerState(page)).toEqual(before);
});
