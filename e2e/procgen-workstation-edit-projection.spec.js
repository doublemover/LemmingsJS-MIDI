import { expect, test } from '@playwright/test';

test('actual edits preserve navigation and launch cell ownership across a large ensemble', { tag: ['@boundary', '@workstation-queued-launch'] }, async ({ page }, testInfo) => {
  test.setTimeout(120000); await page.goto('/procgen.html?e2e=1&seed=42&lanes=128');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__; studio.transport.pause(); runtime.pause();
    const { createProcgenPattern } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js');
    for (const lane of studio.getProject().procgen.lanes) {
      const patterns = Array.from({ length: 4 }, (_, slot) => {
        const pattern = createProcgenPattern(lane.family, lane.role); pattern.steps[0] = { ...pattern.steps[0], enabled: slot === 1, note: 60 + slot };
        if (slot === 2) { pattern.length = 64; pattern.steps = Array.from({ length: 64 }, (_, index) => ({ ...pattern.steps[index % 16] })); } return pattern;
      });
      studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { mode: 'pattern', patternPurpose: 'Launch ownership fixture: complementary control', patterns } });
    }
    const initialNavigation = studio.getNavigationDiagnostics(), before = initialNavigation.organization.projection, physical = runtime.world.tickIndex;
    for (let index = 0; index < 64; index++) studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: index / 64 } });
    const currentNavigation = studio.getNavigationDiagnostics(), after = currentNavigation.organization.projection;
    const row = document.querySelector('.studio-sequence[data-lane-id="lane-2"]'), cell = row.children[0];
    cell.focus(); studio.dispatch({ type: 'procgen/launchedBatch', launches: studio.getProject().procgen.lanes.map(lane => ({ laneId: lane.id, slot: 1 })) });
    const retained = cell === document.querySelector('.studio-sequence[data-lane-id="lane-2"]').children[0], focusRetained = document.activeElement === cell;
    const updated = row.dataset.slot === '1' && cell.classList.contains('enabled');
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const lane = studio.getProject().procgen.lanes[1], clickCurrentSlot = !lane.patterns[1].steps[0].enabled && !lane.patterns[0].steps[0].enabled;
    studio.dispatch({ type: 'procgen/launchedBatch', launches: studio.getProject().procgen.lanes.map(lane => ({ laneId: lane.id, slot: 2 })) });
    const resized = document.querySelector('.studio-sequence[data-lane-id="lane-3"]');
    studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: .42 } }); const afterLaunch = studio.getNavigationDiagnostics().organization.projection;
    return { before, after, initialNavigation: initialNavigation.navigation, currentNavigation: currentNavigation.navigation, afterLaunch, retained, focusRetained, updated, clickCurrentSlot, resizedSlot: resized.dataset.slot, resizedCells: resized.children.length,
      physicalUnchanged: runtime.world.tickIndex === physical, output: studio.getPlaybackState().enabled };
  });
  await testInfo.attach('edit-projection.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.after.fullBuilds).toBe(result.before.fullBuilds); expect(result.after.rowVisits - result.before.rowVisits).toBe(64);
  expect(result.afterLaunch.fullBuilds).toBe(result.before.fullBuilds);
  expect(result.currentNavigation.syncBuilds).toBe(result.initialNavigation.syncBuilds); expect(result.currentNavigation.searchBuilds).toBe(result.initialNavigation.searchBuilds);
  expect(result.currentNavigation.summaryVisits).toBe(result.initialNavigation.summaryVisits);
  expect(result.retained).toBe(true); expect(result.focusRetained).toBe(true); expect(result.updated).toBe(true); expect(result.clickCurrentSlot).toBe(true);
  expect(result.resizedSlot).toBe('2'); expect(result.resizedCells).toBe(64); expect(result.physicalUnchanged).toBe(true); expect(result.output).toBe(false);
});
