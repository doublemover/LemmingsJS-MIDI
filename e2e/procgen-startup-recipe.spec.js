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

test('a malformed shared recipe leaves the prior recoverable setup untouched', async ({ page }) => {
  await page.goto('/README.md');
  await page.evaluate(() => localStorage.setItem('lemmings.procgen.workstation.v1', '{"version":1,"project":{"saved":"prior"}}'));
  await page.goto('/procgen.html?e2e=1&recipe=1&lanes=3');
  await expect(page.locator('#procgenRunStatus')).toContainText('requires its seed');
  expect(await page.evaluate(() => ({ saved: localStorage.getItem('lemmings.procgen.workstation.v1'),
    world: !!window.__PROCGEN_LANES__ }))).toEqual({ saved: '{"version":1,"project":{"saved":"prior"}}', world: false });
});
