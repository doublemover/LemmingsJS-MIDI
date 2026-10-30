import { expect, test } from '@playwright/test';

for (const laneCount of [8, 128]) test('actual canonical edits preserve unrelated mix state across ' + laneCount + ' lanes', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=' + laneCount);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__?.getPhysicalOutputDiagnostics()?.laneMix);
  const receipt = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    const physical = () => JSON.stringify({ tick: api.world.tickIndex, generation: api.world.generation, revision: api.world.terrainRevision,
      actors: api.world.actors.map(actor => [actor.id, actor.x, actor.y, actor.laneIndex]) });
    const beforePhysical = physical(), beforeProject = studio.getProject(), before = studio.getPhysicalOutputDiagnostics().laneMix;
    const laneId = beforeProject.procgen.lanes[0].id;
    studio.dispatch({ type: 'procgen/lane', laneId, patch: { name: 'Current source label' } }); const renamed = studio.getPhysicalOutputDiagnostics().laneMix;
    studio.dispatch({ type: 'procgen/lane', laneId, patch: { gain: .25, pan: 64 } }); const mixed = studio.getPhysicalOutputDiagnostics().laneMix;
    studio.dispatch({ type: 'procgen/lane', laneId, patch: { solo: true } }); const solo = studio.getPhysicalOutputDiagnostics().laneMix;
    studio.dispatch({ type: 'procgen/lane', laneId, patch: { solo: false } }); const returned = studio.getPhysicalOutputDiagnostics().laneMix;
    return { before, renamed, mixed, solo, returned, samePhysical: physical() === beforePhysical,
      sameNeighbor: beforeProject.procgen.lanes[1] === studio.getProject().procgen.lanes[1], mix: studio.laneMixView(laneId),
      neighbor: studio.laneMixView(beforeProject.procgen.lanes[1].id), output: studio.getPlaybackState().enabled };
  });
  await testInfo.attach('mix-delta-receipt.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
  expect(receipt.renamed.stateAllocations).toBe(receipt.before.stateAllocations);
  expect(receipt.mixed.stateAllocations - receipt.renamed.stateAllocations).toBe(1);
  expect(receipt.solo.fullBuilds - receipt.mixed.fullBuilds).toBe(1); expect(receipt.returned.fullBuilds - receipt.solo.fullBuilds).toBe(1);
  expect(receipt.mix.baseGain).toBe(.25); expect(receipt.neighbor.soloSuppressed).toBe(false);
  expect(receipt.sameNeighbor).toBe(true); expect(receipt.samePhysical).toBe(true); expect(receipt.output).toBe(false);
});
