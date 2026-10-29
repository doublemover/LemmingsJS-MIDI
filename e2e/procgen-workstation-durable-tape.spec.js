import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
for (const ticks of [64, 10000]) test('durable physical tape replays, seeks and branches ' + ticks + ' committed ticks without changing its source', { tag: ticks === 64 ? '@boundary' : '@benchmark' }, async ({ page, context }, testInfo) => {
  test.skip(ticks === 10000 && process.env.LEMMINGS_LONG_TAPE !== '1', 'Explicit long physical-tape qualification.'); test.setTimeout(ticks === 10000 ? 600000 : 150000);
  await page.addInitScript(() => {
    window.__tapeAudioOpens = 0; window.__tapeMidiRequests = 0; const Context = window.AudioContext;
    window.__tapeWorkerConstructions = 0; const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(url, options) { super(url, options); window.__tapeWorkerConstructions++; } };
    window.AudioContext = class extends Context { constructor(options) { window.__tapeAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__tapeMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.exposeFunction('__tapeOffline', () => context.setOffline(true));
  await page.exposeFunction('__tapeProgress', progress => { if (ticks === 10000) console.log('Durable tape: ' + JSON.stringify(progress)); });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  try {
    const result = await page.evaluate(async ticks => {
      const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__, world = api.world, root = new URL('./', location.href);
      const comparisons = [];
      const compare = async options => {
        const startedAt = performance.now(), workers = window.__tapeWorkerConstructions;
        const timer = ticks === 10000 ? setInterval(() => { void window.__tapeProgress(studio.handlers.causalTakeState().workbench?.progress || { phase: 'preparing-comparison' }); }, 5000) : null;
        try {
          const result = await studio.handlers.compareCausalTake(options);
          const measurement = { durationMs: performance.now() - startedAt, workerConstructions: window.__tapeWorkerConstructions - workers,
            throughSequence: options?.throughSequence ?? null, ticksExecuted: result?.receipt?.ticksExecuted ?? null };
          comparisons.push(measurement); await window.__tapeProgress({ phase: 'comparison-complete', ...measurement }); return result;
        } finally { if (timer) clearInterval(timer); }
      };
      const { captureProcgenCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root));
      const { hashProcgenPhysicsCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root));
      const { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root));
      const { LemmingStateType } = await import(new URL('js/lemmings/LemmingStateType.js', root));
      studio.transport.pause(); api.pause(); api.step(64);
      const falling = world.actors.find(actor => actor.laneIndex === 0);
      if (falling) { falling.y = world.laneHeight - 1; falling.setAction(world.actions[LemmingStateType.FALLING]); }
      studio.play(); api.pause();
      if (!await studio.handlers.startCausalTake({ takeName: 'Durable tape ' + ticks })) throw new Error('Take admission failed.'); api.pause();
      const initialTick = world.tickIndex, half = Math.floor(ticks / 2); let completed = 0, midpoint = null, midpointHash = null, reported = 0;
      const drain = async () => {
        const deadline = performance.now() + 30000;
        const initial = studio.handlers.causalTakeState().active;
        if (!initial || initial.captureStopped || initial.failure) throw new Error('Take capture stopped before its declared window.');
        while (studio.handlers.causalTakeState().active?.pendingBytes) {
          const state = studio.handlers.causalTakeState().active;
          if (state.captureStopped || state.failure || performance.now() > deadline) throw new Error('Take lost its durable prefix: ' + JSON.stringify({
            state: state.state, durableSequence: state.durableSequence, admittedSequence: state.admittedSequence, pendingBytes: state.pendingBytes, failure: state.failure }));
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      };
      while (completed < ticks) {
        const count = Math.min(32, ticks - completed, completed < half ? half - completed : 32); api.step(count); completed += count; await drain();
        if (completed === half) {
          const marker = await studio.handlers.markCausalTake('Durable midpoint', { checkpoint: true });
          if (!marker?.checkpoint || marker.checkpoint.status !== 'durable') throw new Error('The midpoint did not acquire a durable component checkpoint.');
          midpoint = marker.checkpoint.sequence;
          midpointHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
          studio.transport.pause(); studio.play(); api.pause(); await drain();
        }
        window.__durableTapeProgress = { completed, ticks, state: studio.handlers.causalTakeState().active?.state };
        if (Math.floor(completed / 1000) > reported) { reported = Math.floor(completed / 1000); await window.__tapeProgress({ phase: 'recording', completed, ticks }); }
      }
      studio.transport.pause(); api.pause(); const stopped = await studio.handlers.stopCausalTake();
      if (!stopped?.takeId || world.tickIndex - initialTick !== ticks) throw new Error('The recorded physical window changed.');
      const store = createProcgenSessionStorage(), parent = await store.loadCausalTake(stopped.takeId), original = JSON.stringify(parent), project = JSON.stringify(studio.getProject());
      try {
        if (parent.state !== 'finalized' || parent.complete !== true || parent.durableSequence !== parent.admittedSequence) throw new Error('The recorded window did not acquire a complete durable prefix.');
        await window.__tapeProgress({ phase: 'full-replay', completed, ticks });
        const first = await compare(); if (!first?.receipt?.compatibilityMatch || first.receipt.ticksExecuted !== ticks) throw new Error('Full stored replay failed: ' + JSON.stringify(first) + ' ' + document.querySelector('.studio-status')?.textContent?.slice(0, 512));
        const sourceHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
        if (first.receipt.actualPhysicsHash !== sourceHash || first.receipt.finalWorldParity !== 'matched-at-captured-component-checkpoint') throw new Error('Full replay physical state diverged.');
        await window.__tapeOffline();
        const repeated = await compare(); if (!repeated?.receipt?.compatibilityMatch || repeated.receipt.ticksExecuted !== 0) throw new Error('Validated final checkpoint was not reused.');
        const seek = await compare({ throughSequence: midpoint });
        if (!seek?.receipt?.compatibilityMatch || seek.receipt.actualPhysicsHash !== midpointHash || seek.receipt.ticksExecuted !== 0) throw new Error('Stored midpoint seek diverged or failed to reuse its validated component: ' + JSON.stringify(seek));
        await window.__tapeProgress({ phase: 'branch', completed, ticks });
        const branch = await studio.handlers.prepareCausalBranch({ throughSequence: midpoint, takeName: 'Alternate durable prefix' });
        if (!branch?.active) throw new Error('Branch preparation failed: ' + JSON.stringify(branch));
        const stepped = await studio.handlers.advanceCausalBranch({ ticks: 32 }); if (!stepped) throw new Error('Branch stepping failed.');
        const child = await studio.handlers.finishCausalBranch(); if (!child?.takeId || child.takeId === stopped.takeId) throw new Error('The branch did not acquire an independent take.');
        if (JSON.stringify(await store.loadCausalTake(stopped.takeId)) !== original || world.tickIndex !== initialTick + ticks || JSON.stringify(studio.getProject()) !== project || api.world !== world)
          throw new Error('Seek/branch changed the original take or live project.');
        const childManifest = await store.loadCausalTake(child.takeId);
        if (childManifest.prefix?.throughSequence !== midpoint) throw new Error('Child prefix boundary changed.');
        store.close(); const reopened = createProcgenSessionStorage();
        try { if (JSON.stringify(await reopened.loadCausalTake(stopped.takeId)) !== original) throw new Error('Reopened parent changed.'); } finally { reopened.close(); }
        return { ticks, initialTick, durableSequence: parent.durableSequence, admittedSequence: parent.admittedSequence, parentState: parent.state, parentComplete: parent.complete,
          parentTakeId: stopped.takeId, parentCanonicalHash: parent.canonicalHash, comparisons,
          childTakeId: child.takeId, childPrefix: childManifest.prefix, sourceHash, midpointHash, first: first.receipt, repeated: repeated.receipt, seek: seek.receipt,
          cache: repeated.checkpointCache, sourceUnchanged: true, offlineReopen: true, audioContexts: window.__tapeAudioOpens, midiRequests: window.__tapeMidiRequests,
          scope: 'actual-IDB-physical-compatibility-replay-and-immutable-branch;exact-archived-execution-and-acoustic-output-remain-unqualified' };
      } finally { store.close(); }
    }, ticks);
    expect(result.sourceUnchanged).toBe(true); expect(result.audioContexts).toBe(0); expect(result.midiRequests).toBe(0);
    expect(result.first.exactQualified).toBe(false); expect(result.repeated.ticksExecuted).toBe(0);
    await testInfo.attach('durable-physical-tape-' + ticks, { body: JSON.stringify(result), contentType: 'application/json' });
  } finally { await context.setOffline(false); }
});
