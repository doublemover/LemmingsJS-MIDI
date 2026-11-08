import { expect, test } from './helpers/workstationValidation.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';
import { inspectLane } from './helpers/workstationDock.js';

const ready = async page => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await expect(page.getByRole('region', { name: 'World, music and output status', exact: true })).toContainText('World paused');
};
const scope = page => page.evaluate(async () => {
  const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__, world = runtime.world;
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'), { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { worldId: world.worldId, generation: world.generation, tick: world.tickIndex, seed: world.seed, hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)),
    project: JSON.stringify(studio.getProject()), document: studio.getDocumentState(), routes: studio.ports.getState().outputRoutes, enabled: studio.getPlaybackState().enabled, midi: window.__WEBMIDI_STUB__.metrics() };
});

test('one presentation policy owns DOM, actor effects and automatic views without editing paused music or physics', { tag: ['@boundary', '@workstation-motion'] }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await ready(page); const before = await scope(page); expect(Number.isSafeInteger(before.tick)).toBe(true);
  const control = page.getByLabel('Instrument motion', { exact: true }), observations = [];
  for (const [requested, presented] of [['reduce', 'reduced'], ['freeze', 'frozen'], ['system', 'frozen']]) {
    await useWorkstationControl(page, control, {}, 'selectOption', requested); await expect(page.locator('body')).toHaveAttribute('data-instrument-motion', presented);
    const value = await page.evaluate(() => {
      const r = window.__PROCGEN_LANES__.renderer, state = r.motionPolicy.getState();
      return { state, sharedActorPolicy: r.actorEffects.motionPolicy === r.motionPolicy, sharedRendererPolicy: r.reducedMotion === r.motionPolicy, automaticCamera: r.motionPolicy.automaticCamera, simulation: window.__PROCGEN_STUDIO__.handlers.operationalState().simulation };
    });
    expect(value.state).toMatchObject({ mode: requested, state: presented, paused: true, activeTransitions: 0, subscribers: 2 }); expect(value.sharedActorPolicy).toBe(true); expect(value.sharedRendererPolicy).toBe(true); expect(value.automaticCamera).toBe(false); expect(value.simulation.state).toBe('paused');
    expect(await scope(page)).toEqual(before); observations.push(value);
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#procgenPanic')).toBeVisible(); await expect(page.locator('#procgenDeepDock')).toBeHidden();
  await testInfo.attach('motion-policy-owners', { body: JSON.stringify({ before, observations }), contentType: 'application/json' }); await page.screenshot({ path: testInfo.outputPath('paused-shared-motion-policy.png') });
});

test('live system reduction repaints a paused display and restores its selected preference without resuming output', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await ready(page); const before = await scope(page);
  await page.evaluate(() => {
    const renderer = window.__PROCGEN_LANES__.renderer, render = renderer.render; window.__motionForceRenders = 0;
    renderer.render = function(force) { if (force === true) window.__motionForceRenders++; return render.call(this, force); };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(page.locator('body')).toHaveAttribute('data-instrument-motion', 'reduced');
  await expect.poll(() => page.evaluate(() => window.__motionForceRenders)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.renderer.motionPolicy.getState())).toMatchObject({ mode: 'system', state: 'reduced', systemPreference: 'reduce', paused: true, subscribers: 2 }); expect(await scope(page)).toEqual(before);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await expect(page.locator('body')).toHaveAttribute('data-instrument-motion', 'frozen'); expect(await scope(page)).toEqual(before);
  await page.emulateMedia({ forcedColors: 'active' }); await page.screenshot({ path: testInfo.outputPath('motion-policy-forced-colors.png') }); await page.emulateMedia({ forcedColors: 'none' });
});

test('regeneration retires the old policy and late preference changes cannot reach its replacement', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await useWorkstationControl(page, page.getByLabel('Instrument motion', { exact: true }), {}, 'selectOption', 'reduce');
  await page.evaluate(() => { window.__oldMotionPolicy = window.__PROCGEN_LANES__.renderer.motionPolicy; window.__oldMotionWorld = window.__PROCGEN_LANES__.world; });
  await inspectLane(page, 'World'); await page.getByRole('button', { name: 'Replay seed', exact: true }).click();
  await page.waitForFunction(() => window.__oldMotionWorld !== window.__PROCGEN_LANES__.world && window.__oldMotionPolicy !== window.__PROCGEN_LANES__.renderer.motionPolicy && window.__PROCGEN_LANES__.renderer.motionPolicy.getState().mode === 'reduce');
  const result = await page.evaluate(() => {
    const old = window.__oldMotionPolicy, current = window.__PROCGEN_LANES__.renderer.motionPolicy, before = document.body.dataset.instrumentMotion;
    const accepted = old.configure({ mode: 'system' }); return { old: old.getState(), current: current.getState(), accepted, before, after: document.body.dataset.instrumentMotion, enabled: window.__PROCGEN_STUDIO__.getPlaybackState().enabled, sent: window.__WEBMIDI_STUB__.metrics().sent };
  });
  expect(result.old).toMatchObject({ retired: true, subscribers: 0, activeTransitions: 0, retainedBytes: 0 }); expect(result.current).toMatchObject({ mode: 'reduce', state: 'reduced', subscribers: 2 }); expect(result.accepted).toBe(false); expect(result.after).toBe(result.before); expect(result.enabled).toBe(false); expect(result.sent).toBe(0);
});
