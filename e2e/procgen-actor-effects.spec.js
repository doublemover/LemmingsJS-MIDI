import { expect, test } from '@playwright/test';

for (const deviceScaleFactor of [1, 2]) test.describe(`actor effect presentation at DPR ${deviceScaleFactor}`, () => {
  test.use({ deviceScaleFactor });
  test('qualified fixture samples affect action art while physical picking and event state stay unchanged', async ({ page, browser }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
    await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready' && window.__PROCGEN_STUDIO__?.getWorldInspector?.());
    const before = await page.evaluate(() => {
      const api = window.__PROCGEN_LANES__; api.pause(); api.renderer.follow = false; api.renderer.render();
      for (let tick = 0; tick < 512 && !api.renderer.presentation.getSnapshot()?.entities.some(entity => entity.kind === 'actor'); tick++) api.step();
      const target = api.renderer.presentation.getSnapshot().entities.find(entity => entity.kind === 'actor'); window.__effectTarget = target;
      window.__effectState = () => ({ generation: api.world.generation, tick: api.world.tickIndex, terrainRevision: api.world.terrainRevision, sequence: api.world.soundEvents._causalSequence,
        actor: api.world.actors.filter(actor => !actor.removed).map(actor => [actor.id, actor.x, actor.y, actor.frameIndex, actor.action?.actionName]),
        document: window.__PROCGEN_STUDIO__.getDocumentState(), playback: window.__PROCGEN_STUDIO__.getPlaybackState() });
      return window.__effectState();
    });
    const pixels = await page.locator('#gameCanvas').screenshot();
    const receipt = await page.evaluate(() => {
      const api = window.__PROCGEN_LANES__, renderer = api.renderer, target = window.__effectTarget, actor = renderer.actorVisibility.renderActor(target.actorId), manager = renderer.actorEffects;
      if (!actor) throw new Error('The completed presentation must resolve to its current physical actor.');
      const beforeDistances = [-6, 0, 6].map(dx => actor.getClickDistance(actor.x + dx, actor.y - 5));
      const now = performance.now(), frame = Math.round(now * 48), identity = { worldId: api.world.worldId, generation: api.world.generation, executionEpoch: 'synthetic-render-qualification', contextEpoch: 1, graphRevision: 1, routeRevision: 1 };
      manager.setEpoch({ ...identity, owner: 'synthetic-render-fixture#1' }); manager.setProfile({ version: 1, enabled: true, intensity: 1, smoothingMs: 0, holdMs: 250, decayMs: 1000, bindings: [
        ['x', 'pitch-modulation'], ['y', 'y-modulation'], ['scale', 'amplitude-envelope'], ['inner', 'drive-amount'], ['outer', 'filter-amount'], ['trail', 'delay-tap-envelope']
      ].map(([channel, quantity]) => ({ channel, quantity, effectId: 'synthetic-qualification-source' })) });
      const accepted = manager.ingestAudioDisplaySample({ ...identity, owner: 'synthetic-render-fixture#1', scope: 'actorVoice', actorId: actor.id, voiceId: `fixture-v${actor.id}`, onsetId: `fixture-o${actor.id}`, nodeId: 'synthetic-qualification-source', sequence: 1,
        appliedFrame: frame, windowStartFrame: frame - 128, windowEndFrame: frame, validUntilFrame: frame + 48000,
        quantities: [['pitch-modulation', .75, 'normalized-signed'], ['y-modulation', .4, 'normalized-signed'], ['amplitude-envelope', .8, 'normalized'], ['drive-amount', .8, 'normalized'], ['filter-amount', .7, 'normalized'], ['delay-tap-envelope', .5, 'normalized']].map(([name, value, unit]) => ({ name, value, unit, evidenceClass: 'measured', tapId: 'actual-fixture-tap', sourcePosition: { x: actor.x - 5, y: actor.y } })),
        processingState: { bypassed: false, tail: true }, routeState: { muted: false }, coverage: 'complete' }, { ...identity, audioFrame: frame, sampleRate: 48000, presentationMs: now, uncertaintyMs: 1 });
      const terrainBefore = renderer.terrainRebuilds; renderer.render(false);
      const afterTarget = renderer.presentation.getSnapshot().entities.find(entity => entity.id === target.id);
      return { accepted, target, afterTarget, beforeDistances, afterDistances: [-6, 0, 6].map(dx => actor.getClickDistance(actor.x + dx, actor.y - 5)),
        visual: manager.evaluate(actor.id, now), drawPasses: renderer.actorEffectPass.drawPasses, terrainRebuilds: renderer.terrainRebuilds - terrainBefore, evidence: 'Supplied synthetic samples qualifying the production renderer; no DSP or audible-output measurement.' };
    });
    expect(receipt.accepted).toBe(true); expect(receipt.drawPasses).toBeGreaterThan(0); expect(receipt.afterDistances).toEqual(receipt.beforeDistances);
    expect(receipt.afterTarget.bounds).toEqual(receipt.target.bounds); expect(receipt.terrainRebuilds).toBe(0); expect(await page.evaluate(() => window.__effectState())).toEqual(before);
    expect(await page.locator('#gameCanvas').screenshot()).not.toEqual(pixels);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.evaluate(() => { const renderer = window.__PROCGEN_LANES__.renderer; renderer.render(); return renderer.actorEffects.evaluate(window.__effectTarget.actorId, performance.now(), { reducedMotion: true }); });
    expect(reduced.x).toBe(0); expect(reduced.y).toBe(0); expect(reduced.scale).toBe(1); expect(reduced.trails).toEqual([]);
    expect(await page.evaluate(() => window.__effectState())).toEqual(before);
    await testInfo.attach('actor-effects.png', { body: await page.locator('#gameCanvas').screenshot(), contentType: 'image/png' });
    await testInfo.attach('actor-effects-receipt.json', { body: JSON.stringify({ browser: browser.version(), deviceScaleFactor, before, receipt, reduced }, null, 2), contentType: 'application/json' });
  });
});
