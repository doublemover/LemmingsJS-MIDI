import { expect, test } from './helpers/workstationValidation.js';

test('cold startup can disclose an unavailable display and retry it without replacing the admitted world', { tag: '@boundary' }, async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext; window.__denyStartupDisplay = true;
    HTMLCanvasElement.prototype.getContext = function(...args) { return this.id === 'gameCanvas' && window.__denyStartupDisplay ? null : getContext.apply(this, args); };
  });
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { const api = window.__PROCGEN_LANES__; window.__PROCGEN_STUDIO__.transport.pause(); api.pause(); api.step(16); window.__startupDisplayWorld = api.world; window.__startupDisplayProject = window.__PROCGEN_STUDIO__.getProject(); });
  await expect(page.getByRole('button', { name: 'Retry display', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__denyStartupDisplay = false; }); await page.getByRole('button', { name: 'Retry display', exact: true }).click();
  await expect(page.locator('#gameCanvas')).toHaveAttribute('data-display-state', 'ready');
  expect(await page.evaluate(() => window.__startupDisplayWorld === window.__PROCGEN_LANES__.world && window.__startupDisplayProject === window.__PROCGEN_STUDIO__.getProject())).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry display', exact: true })).toBeHidden();
});

test('failed candidate display preserves the complete live session and a later explicit retry can commit', { tag: ['@boundary', '@workstation-world-rollback'] }, async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause(); api.step(16);
    const session = studio.capture(), project = studio.getProject(), world = api.world, checkpoint = JSON.stringify(session.world);
    const history = JSON.stringify(studio.handlers.historyState()), identity = JSON.stringify(studio.getDocumentState());
    const route = () => { const state = studio.ports.getState(); return JSON.stringify({ inputId: state.inputId, noteOutputId: state.noteOutputId, clockOutputId: state.clockOutputId, activeNoteOutputIds: state.activeNoteOutputIds }); };
    const previousRoute = route(), getContext = HTMLCanvasElement.prototype.getContext; let denied = 0;
    HTMLCanvasElement.prototype.getContext = function(...args) { if (this.id === 'gameCanvas') { denied++; return null; } return getContext.apply(this, args); };
    let accepted;
    try { accepted = await studio.handlers.import(new File([JSON.stringify(session)], 'rollback-control.json', { type: 'application/json' })); }
    finally { HTMLCanvasElement.prototype.getContext = getContext; }
    const state = { accepted: accepted === true, denied, sameProject: studio.getProject() === project, sameWorld: window.__PROCGEN_LANES__.world === world,
      sameCheckpoint: JSON.stringify(studio.capture().world) === checkpoint, sameHistory: JSON.stringify(studio.handlers.historyState()) === history,
      sameIdentity: JSON.stringify(studio.getDocumentState()) === identity, sameRoute: route() === previousRoute, playing: studio.transport.getState().playing };
    window.__rollbackRetrySession = session; window.__rollbackPreviousWorld = world; window.__PROCGEN_LANES__.renderer.render(true); return state;
  });
  expect(result.denied).toBeGreaterThan(0);
  expect(result).toMatchObject({ accepted: false, sameProject: true, sameWorld: true, sameCheckpoint: true, sameHistory: true, sameIdentity: true, sameRoute: true, playing: false });
  await expect(page.locator('.studio-status')).toContainText('candidate display is unavailable');
  const retry = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, session = window.__rollbackRetrySession;
    const accepted = await studio.handlers.import(new File([JSON.stringify(session)], 'explicit-retry.json', { type: 'application/json' }));
    return { accepted, replaced: window.__PROCGEN_LANES__.world !== window.__rollbackPreviousWorld, seed: window.__PROCGEN_LANES__.world.seed, playing: studio.transport.getState().playing };
  });
  expect(retry).toEqual({ accepted: true, replaced: true, seed: 42, playing: false });
});

test('committed native camera refusal keeps later physical lane edits and a coherent recovery copy', { tag: ['@boundary', '@workstation-world-rollback'] }, async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, initial = window.__PROCGEN_LANES__; studio.transport.pause(); initial.pause();
    studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.75 } });
    const session = studio.capture(), oldWorld = initial.world, sourceGeneration = studio.getDocumentState().editRevision;
    session.camera = { ...session.camera };
    Object.defineProperty(session.camera, 'scale', { enumerable: true, get() { throw new Error('Controlled native camera-state read failure'); } });
    let failure; try { await studio.loadSession(session); } catch (error) { failure = error.message; }
    const current = window.__PROCGEN_LANES__, world = current.world, historyAfterFailure = studio.handlers.historyState();
    studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.25 } });
    const captured = studio.capture(), beforeTick = world.tickIndex; current.step(2);
    return { failure, committed: world !== oldWorld, sameWorldAfterEdit: world === window.__PROCGEN_LANES__.world,
      gain: studio.getProject().procgen.lanes[0].gain, physicalGain: studio.laneMixView('lane-1').baseGain,
      capturedGain: captured.project.procgen.lanes[0].gain, coherentLaneCount: captured.world.laneCount === captured.project.procgen.lanes.length,
      stepped: world.tickIndex - beforeTick, playing: studio.transport.getState().playing, output: studio.getPlaybackState().enabled,
      historyAfterFailure, operation: studio.getOperationState(), sourceGeneration, editRevision: studio.getDocumentState().editRevision };
  });
  expect(result).toMatchObject({ failure: 'Controlled native camera-state read failure', committed: true, sameWorldAfterEdit: true,
    gain: 0.25, physicalGain: 0.25, capturedGain: 0.25, coherentLaneCount: true, stepped: 2, playing: false, output: false, operation: null });
  expect(result.editRevision).toBeGreaterThan(result.sourceGeneration);
  expect(result.historyAfterFailure).toMatchObject({ undo: 0, redo: 0 });
  await info.attach('native-committed-camera-handback.json', { body: JSON.stringify({ ...result, viewport: page.viewportSize(),
    scope: 'Actual prepared native world/camera binding and committed physical steps with a controlled camera-state getter failure; no native graphics failure or acoustic claim.' }), contentType: 'application/json' });
});
