import { expect, test } from '@playwright/test';
import { inspectLane } from './helpers/workstationDock.js';

test('real dense physical batches recover at the same explicit boundary in desktop and worker execution', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await page.goto('/procgen-survey.html');
  const result = await page.evaluate(async () => {
    const { physicalBatchOverflow, physicalOverflowGraph, observePhysicalOverflow } = await import('/test/helpers/physicalBatchOverflow.js');
    const { createCausalMusicEngine } = await import('/js/app/procgen/workstation/CausalMusicEngine.js');
    const main = [1024, 1025].map(actorCount => physicalBatchOverflow({ actorCount }));
    const worker = new window.Worker('/e2e/helpers/physicalBatchOverflow.worker.js', { type: 'module' });
    const receiver = createCausalMusicEngine({ getGraph: () => physicalOverflowGraph }), received = [];
    try {
      const remote = await new Promise((resolve, reject) => {
        worker.onmessage = event => { const message = event.data; try {
          if (message.error) reject(new Error(message.error));
          else if (message.type === 'batch') received.push(observePhysicalOverflow(message.batch, receiver));
          else if (message.type === 'rearm') receiver.rearm({ discardUnknownHeldState: true });
          else if (message.type === 'result') resolve(message.result); else reject(new Error('Unknown physical worker message'));
        } catch (error) { reject(error); } };
        worker.onerror = event => reject(new Error(event.message)); worker.postMessage({ actorCount: 1025 });
      });
      return { main, remote, received };
    } finally { worker.terminate(); receiver.dispose(); }
  });
  expect(result.remote).toEqual(result.main[1]);
  expect(result.received).toEqual(result.remote.rows);
  for (const value of result.main) {
    expect(value.limits).toEqual({ facts: 4096, terminalFacts: 256 }); expect(value.listenerErrors).toBe(0);
    expect(value.rows.map(row => row.activeVoices)).toEqual([1, 0, 0, 1]); expect(value.rows.map(row => row.recoveryRequired)).toEqual([false, true, true, false]);
    expect(value.rows[1].actors).toBe(value.actorCount); expect(value.rows[1].completeness.status).toBe('incomplete'); expect(value.rows[2].completeness.status).toBe('complete');
    expect(value.rearm).toMatchObject({ status: 'rearmed', resumesHeldVoices: false });
  }
});

test('the desktop instrument exposes explicit recovery after real dense source overflow', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await page.goto('/procgen.html?e2e=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__; studio.transport.pause(); runtime.pause();
    const { LemmingStateType: State } = await import('/js/lemmings/LemmingStateType.js');
    const world = runtime.world; window.overflowUIWorld = world;
    while (world.actors.length < 1025) { const actor = world._spawn(0, false); actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8; }
    studio.transport.play(); runtime.step(1); studio.transport.pause();
  });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().physicalRecoveryRequired)).toBe(true);
  await inspectLane(page, 'Physical');
  const rearm = page.getByRole('button', { name: 'Discard unknown held state and rearm', exact: true });
  await expect(rearm).toBeVisible(); await expect(rearm).toBeEnabled();
  await expect(page.getByText('Physical source coverage was lost. Held voices remain disarmed until you explicitly discard unknown state.', { exact: true })).toBeVisible();
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__; for (const actor of runtime.world.actors.slice(1)) actor.remove(); studio.transport.play(); runtime.step(1); studio.transport.pause(); });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().physicalRecoveryRequired)).toBe(true);
  await rearm.click();
  expect(await page.evaluate(() => ({ recovery: window.__PROCGEN_STUDIO__.handlers.causalTakeState().physicalRecoveryRequired,
    sameWorld: window.overflowUIWorld === window.__PROCGEN_LANES__.world, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled })))
    .toEqual({ recovery: false, sameWorld: true, output: false });
});
