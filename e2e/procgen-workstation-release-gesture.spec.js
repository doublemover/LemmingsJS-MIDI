import { expect, test } from '@playwright/test';

for (const capacity of [128, 8]) test('release controls save without performing and admit finite physical slots at capacity ' + capacity, { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const before = await page.evaluate(async cap => {
    const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__, world = runtime.world; studio.transport.pause(); runtime.pause();
    world.maxActors = cap;
    if (cap === 8) while (world.activeCount < cap) world._spawn(world.activeCount % world.laneCount, false);
    const { createCausalMusicEngine } = await import('/js/app/procgen/workstation/CausalMusicEngine.js');
    const graph = { version: 1, revision: 1, instruments: [{ id: 'actual-travel-gate', sourceKind: 'MotionCommitted', gateX: 37, crossingDirection: 'positive', pitchCents: 6000, velocity01: 0.5, role: 'gate', route: 'local' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }), births = new Map();
    window.releaseQualification = { births: [], misses: [], attacks: [], error: null }; window.releaseWorld = world;
    world.soundEvents.onBatch.on(batch => { try {
      for (const fact of batch.facts) {
        if (fact.kind === 'ActorBorn' && fact.releaseGesture?.id === 'release-gesture') {
          births.set(`${batch.generation}:${fact.actorId}`, fact); window.releaseQualification.births.push({ actorId: fact.actorId, tick: fact.spawnTick, commandId: fact.releaseGesture.sourceCommandId });
        }
        if (fact.kind === 'BirthAdmissionMissed' && fact.gestureId === 'release-gesture') window.releaseQualification.misses.push({ tick: batch.tick });
      }
      for (const intent of engine.processBatch(batch)) {
        const birth = births.get(`${batch.generation}:${intent.actorId}`);
        if (intent.kind === 'begin' && birth) window.releaseQualification.attacks.push({ actorId: intent.actorId, tick: batch.tick, birthTick: birth.spawnTick, commandId: birth.releaseGesture.sourceCommandId, sourceEventIds: intent.sourceEventIds });
      }
    } catch (error) { window.releaseQualification.error = error.message; } });
    return { tick: world.tickIndex, population: JSON.stringify(world.population.snapshot()), actors: world.activeCount };
  }, capacity);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.openReleaseGestures());
  const dialog = page.getByRole('dialog', { name: 'Physical release gestures', exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByLabel('Gap', { exact: true }).fill('17'); await dialog.getByLabel('Spread', { exact: true }).fill('4');
  await dialog.getByLabel('Attempt count (empty = continuous)', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.releaseGesture?.nominalGapTicks)).toBe(17);
  expect(await page.evaluate(() => ({ tick: window.releaseWorld.tickIndex, population: JSON.stringify(window.releaseWorld.population.snapshot()), actors: window.releaseWorld.activeCount }))).toEqual(before);
  const perform = async () => {
    await dialog.getByRole('button', { name: 'Perform release', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.releaseWorld.interventionState.pending.filter(value => value.kind === 'set-release-gesture').length)).toBe(1);
    return page.evaluate(() => window.releaseWorld.interventionState.pending.find(value => value.kind === 'set-release-gesture').id);
  };
  const first = await perform(); await page.evaluate(() => window.__PROCGEN_LANES__.step(160));
  const outcome = await page.evaluate(() => ({ ...window.releaseQualification, run: window.releaseWorld.population.gestureRun }));
  expect(outcome.error).toBeNull(); expect(outcome.births.length + outcome.misses.length).toBe(5); expect(outcome.run.status).toBe('exhausted');
  if (capacity === 128) { expect(outcome.births).toHaveLength(5); expect(outcome.attacks).toHaveLength(5); }
  else {
    expect(outcome.births).toHaveLength(0); expect(outcome.misses).toHaveLength(5); expect(outcome.attacks).toHaveLength(0);
    await page.evaluate(() => { window.releaseWorld.maxActors = 128; window.__PROCGEN_LANES__.step(80); });
    expect(await page.evaluate(() => window.releaseQualification.births.length)).toBe(0);
    const retry = await perform(); expect(retry).not.toBe(first); await page.evaluate(() => window.__PROCGEN_LANES__.step(160));
    expect(await page.evaluate(() => window.releaseQualification.births.map(value => value.commandId))).toEqual(Array(5).fill(retry));
  }
  const final = await page.evaluate(() => ({ ...window.releaseQualification, sameWorld: window.releaseWorld === window.__PROCGEN_LANES__.world, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }));
  expect(final.error).toBeNull(); expect(final.sameWorld).toBe(true); expect(final.output).toBe(false);
  expect(final.attacks).toHaveLength(5); expect(final.attacks.every(value => value.tick > value.birthTick && value.sourceEventIds.length > 0)).toBe(true);
});
