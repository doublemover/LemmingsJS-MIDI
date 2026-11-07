import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { pauseWorkstationWhenReady } from './helpers/workstationReady.js';
import { inspectLane } from './helpers/workstationDock.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';

test.use({ permissions: [] });
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('selected actor identity locks survive musical reroll, Undo and actual project restoration without physical edits', { tag: ['@boundary', '@workstation-typed-controls'] }, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await pauseWorkstationWhenReady(page, { timeout: 90000 });
  await page.locator('#procgenListen').click();
  await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; await studio.handlers.selectNativeSound(studio.getProject().procgen.lanes[0].id, 'forge.glass-rivet'); });
  await page.locator('#procgenListen').click();
  const dock = await inspectLane(page, 'Lane'), checkbox = dock.getByRole('checkbox', { name: 'Lock selected actor identity', exact: true });
  await expect(checkbox).toBeDisabled();
  const target = await page.evaluate(async () => {
    const api = window.__PROCGEN_LANES__, studio = window.__PROCGEN_STUDIO__, renderer = api.renderer;
    for (let count = 0; count < 64 && !renderer.presentation.getSnapshot()?.entities.some(entity => entity.kind === 'actor'); count++) api.step();
    renderer.render(true); const snapshot = renderer.presentation.getSnapshot(), actor = snapshot.entities.find(entity => entity.kind === 'actor'), region = actor.regions[0];
    const root = new URL('./', location.href);
    const [{ compileInstrumentPerformance }, { getNativeInstrumentCatalog }, locks, { captureProcgenCheckpoint }, { hashProcgenPhysicsCheckpoint }] = await Promise.all([
      import(new URL('js/midi/content/InstrumentPerformance.js', root)), import(new URL('js/app/midi-ui/NativeInstrumentSchema.js', root)),
      import(new URL('js/midi/content/InstrumentActorLocks.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root)),
      import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root))]);
    const lane = studio.getProject().procgen.lanes[0], definition = lane.instrumentRef.definition, catalog = await getNativeInstrumentCatalog();
    const descriptor = catalog.descriptors.find(value => value.engineId === definition.engineId && value.engineVersion === definition.engineVersion);
    const plan = compileInstrumentPerformance(definition, descriptor.parameters), identity = { worldId: api.world.worldId, generation: api.world.generation, actorId: actor.actorId, onsetId: 'actor-lock-comparison' };
    window.__actorLockFixture = { world: api.world, identity, plan, locks, captureProcgenCheckpoint, hashProcgenPhysicsCheckpoint,
      physics: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(api.world)), seed: lane.instrumentControls.variationSeed ?? definition.variation.seed,
      offsets: plan.resolve(lane.instrumentControls, 0, identity).deltas.filter(value => value.origin === 'identity') };
    return { actorId: actor.actorId, x: snapshot.rect.left + (region.x + region.width / 2) / snapshot.logicalSize.width * snapshot.rect.width,
      y: snapshot.rect.top + (region.y + region.height / 2) / snapshot.logicalSize.height * snapshot.rect.height };
  });
  await page.mouse.click(target.x, target.y);
  await expect(checkbox).toBeEnabled(); await checkbox.check(); await expect(checkbox).toBeChecked();
  await dock.getByRole('button', { name: 'Reroll timbre', exact: true }).click();
  const rerolled = await page.evaluate(async () => {
    const f = window.__actorLockFixture, studio = window.__PROCGEN_STUDIO__, project = studio.getProject(), lane = project.procgen.lanes[0];
    const controls = f.locks.actorTimbreControls(lane.instrumentControls, project.procgen.actorTimbreLocks, f.identity);
    const offsets = f.plan.resolve(controls, 0, f.identity).deltas.filter(value => value.origin === 'identity');
    const unlocked = f.plan.resolve(lane.instrumentControls, 0, f.identity).deltas.filter(value => value.origin === 'identity');
    return { seed: lane.instrumentControls.variationSeed, beforeSeed: f.seed, locks: project.procgen.actorTimbreLocks, before: f.offsets, offsets, unlocked,
      sameWorld: f.world === window.__PROCGEN_LANES__.world, samePhysics: f.physics === await f.hashProcgenPhysicsCheckpoint(f.captureProcgenCheckpoint(f.world)),
      playing: studio.transport.getState().playing, output: studio.getPlaybackState().enabled };
  });
  expect(rerolled.locks).toHaveLength(1); expect(rerolled.locks[0].actorId).toBe(target.actorId);
  expect(rerolled.offsets).toEqual(rerolled.before); expect(rerolled.unlocked).not.toEqual(rerolled.before);
  expect(rerolled.seed).not.toBe(rerolled.beforeSeed); expect(rerolled).toMatchObject({ sameWorld: true, samePhysics: true, playing: false, output: false });
  const undo = () => useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }), { button: 'Undo' }, 'click');
  await undo(); await expect(checkbox).toBeChecked();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentControls.variationSeed ?? window.__actorLockFixture.seed)).toBe(rerolled.beforeSeed);
  await undo(); await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  const restored = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, source = studio.capture(), locks = JSON.stringify(source.project.procgen.actorTimbreLocks);
    const accepted = await studio.handlers.import(new File([JSON.stringify(source)], 'actor-identity-lock.json', { type: 'application/json' }));
    return { accepted, replaced: window.__PROCGEN_LANES__.world !== window.__actorLockFixture.world, sameLocks: JSON.stringify(studio.getProject().procgen.actorTimbreLocks) === locks,
      playing: studio.transport.getState().playing, output: studio.getPlaybackState().enabled, operation: studio.getOperationState() };
  });
  expect(restored).toEqual({ accepted: true, replaced: true, sameLocks: true, playing: false, output: false, operation: null });
  await info.attach('native-actor-identity-locks.json', { body: JSON.stringify({ target, rerolled, restored, viewport: page.viewportSize(),
    scope: 'Real actor source-art pointer selection, native checkbox/reroll/Undo and worker-backed project import; canonical identity parameter comparison. No physical RNG mutation, PCM/listening or acoustic claim.' }), contentType: 'application/json' });
});
