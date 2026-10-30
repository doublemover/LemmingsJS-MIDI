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
