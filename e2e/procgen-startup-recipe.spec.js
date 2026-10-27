import { expect, test } from '@playwright/test';

test('a shared recipe opens its declared world with an unrelated saved two-lane setup present', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/README.md');
  await page.evaluate(async () => {
    const { createMidiProject } = await import('/js/midi/project/MidiProject.js');
    const { createProcgenWorkstationProject } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
    const project = createProcgenWorkstationProject(createMidiProject(), { seed: 12, lanes: [{}, {}] });
    localStorage.setItem('lemmings.procgen.workstation.v1', JSON.stringify({ version: 1, project,
      transport: { bpm: 60, gameSpeed: 0.5, speedMode: 'bpm' } }));
  });
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=999&lanes=3&speed=2&pack=4');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
    const result = { mode: studio.getStartupPlan().mode, projectLanes: studio.getProject().procgen.lanes.length,
      worldLanes: world.laneCount, seed: world.seed, speed: world.timer.speedFactor,
      bpm: studio.transport.getState().bpm, gameSpeed: studio.transport.getState().gameSpeed,
      speedMode: studio.transport.getState().speedMode,
      outputs: studio.getProject().procgen.lanes.map(lane => lane.outputId) };
    studio.transport.pause(); return result;
  });
  expect(result).toMatchObject({ mode: 'recipe', projectLanes: 3, worldLanes: 3,
    seed: 999, speed: 2, bpm: 240, gameSpeed: 2, speedMode: 'game', outputs: [null, null, null] });
});

test('a malformed shared recipe leaves the prior recoverable setup untouched', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/README.md');
  await page.evaluate(() => localStorage.setItem('lemmings.procgen.workstation.v1', '{"version":1,"project":{"saved":"prior"}}'));
  await page.goto('/procgen.html?e2e=1&recipe=1&lanes=3');
  await expect(page.locator('#procgenRunStatus')).toContainText('requires its seed');
  expect(await page.evaluate(() => ({ saved: localStorage.getItem('lemmings.procgen.workstation.v1'),
    world: !!window.__PROCGEN_LANES__ }))).toEqual({ saved: '{"version":1,"project":{"saved":"prior"}}', world: false });
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  expect(await page.evaluate(() => ({ mode: window.__PROCGEN_STUDIO__.getStartupPlan().mode, lanes: window.__PROCGEN_LANES__.world.laneCount,
    recipe: new URLSearchParams(location.search).has('recipe') }))).toEqual({ mode: 'fresh', lanes: 8, recipe: false });
});

test('document and recovery startup restore their artifact paused and reject conflicting physical overrides', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=12&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const saved = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause();
    const session = studio.capture(), { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const store = createProcgenSessionStorage(indexedDB);
    try {
      const receipt = await store.saveDocument('doc:startup-e2e', 0, session, 'startup-e2e-commit');
      await store.saveRecovery(session);
      return { revision: receipt.revision, tick: session.world.graph.owners.find(owner => owner.name === 'world').props.tickIndex };
    } finally { store.close(); }
  });
  await page.goto('/procgen.html?e2e=1&startup=document&document=doc%3Astartup-e2e&documentRevision=' + saved.revision);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const reopened = await page.evaluate(() => ({ plan: window.__PROCGEN_STUDIO__.getStartupPlan().mode,
    document: window.__PROCGEN_STUDIO__.getDocumentState(), seed: window.__PROCGEN_LANES__.world.seed,
    lanes: window.__PROCGEN_LANES__.world.laneCount, tick: window.__PROCGEN_LANES__.world.tickIndex,
    playing: window.__PROCGEN_STUDIO__.transport.getState().playing }));
  expect(reopened).toMatchObject({ plan: 'document', document: { id: 'doc:startup-e2e', revision: saved.revision }, seed: 12, lanes: 2, tick: saved.tick, playing: false });
  await page.goto('/procgen.html?e2e=1&startup=recovery');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  expect(await page.evaluate(() => ({ mode: window.__PROCGEN_STUDIO__.getStartupPlan().mode,
    seed: window.__PROCGEN_LANES__.world.seed, playing: window.__PROCGEN_STUDIO__.transport.getState().playing }))).toEqual({ mode: 'recovery', seed: 12, playing: false });
  await page.goto('/procgen.html?e2e=1&startup=document&document=doc%3Astartup-e2e&seed=999');
  await expect(page.locator('#procgenRunStatus')).toContainText('conflicts with physical recipe');
  expect(await page.evaluate(() => !!window.__PROCGEN_LANES__)).toBe(false);
});
