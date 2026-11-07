export const enableComplementaryPatterns = async page => {
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__;
    studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    for (const lane of studio.getProject().procgen.lanes) studio.dispatch({ type: 'procgen/lane', laneId: lane.id,
      patch: { mode: 'pattern', patternPurpose: 'A complementary phrase for the browser editing and transport fixture' } });
  });
};
