import { expect } from '@playwright/test';
import { inspectLane } from './workstationDock.js';

export const enableComplementaryPatterns = async page => {
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__;
    studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    for (const lane of studio.getProject().procgen.lanes) studio.dispatch({ type: 'procgen/lane', laneId: lane.id,
      patch: { mode: 'pattern', patternPurpose: 'A complementary phrase for the browser editing and transport fixture' } });
  });
};

export const selectNativePatternInstrument = async page => {
  const dock = await inspectLane(page, 'Lane');
  await dock.getByRole('button', { name: 'Select Soft triangle fallback', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef?.patchId)).toBe('foundation.soft-triangle');
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__;
    for (const [index, lane] of studio.getProject().procgen.lanes.entries()) studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { mute: index > 0 } });
  });
};
