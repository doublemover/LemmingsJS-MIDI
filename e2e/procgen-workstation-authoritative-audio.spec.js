import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.use({ permissions: [] });
test.setTimeout(120000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

test('explicit owned worker performance advances through a desktop UI stall and parks with its private native context closed', { tag: ['@boundary', '@workstation-local-audio', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.directWorkerContexts = []; window.directWorkerSources = []; window.directWorkerMidiRequests = 0; window.directWorkerMicrophoneRequests = 0;
    const NativeContext = window.AudioContext, NativeWorklet = window.AudioWorkletNode;
    window.AudioContext = class extends NativeContext { constructor(options) { super(options); window.directWorkerContexts.push(this); } };
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context, name, options) {
        super(context, name, options);
        if (name === 'lemmings-owned-sine-v1') {
          const analyser = context.createAnalyser(), pull = context.createGain(); analyser.fftSize = 2048; pull.gain.value = 0;
          this.connect(analyser); analyser.connect(pull); pull.connect(context.destination); window.directWorkerSources.push({ context, analyser, pull });
        }
      }
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.directWorkerMidiRequests++; throw new Error('Unexpected MIDI request'); } });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.directWorkerMicrophoneRequests++; throw new Error('Unexpected microphone request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1, instruments: [
      { id: 'direct-worker-travel', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 6012.34567, velocity01: .73, role: 'travel', route: 'local', articulation: { spacingPixels: 8, sustain: true, lifetimeScope: 'actorJourney' } }
    ] } });
  });
  await inspectLane(page, 'Physical');
  const before = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, worldId: window.__PROCGEN_LANES__.world.worldId, contexts: window.directWorkerContexts.length }));
  await page.getByRole('button', { name: 'Prepare worker performance · owned reference sine', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState().phase), { timeout: 45000 }).toBe('paused');
  const staged = await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState());
  expect(staged.output).toBe('independent-owned-audio-worker'); expect(staged.worker.paused).toBe(true); expect(staged.worker.tick).toBe(before.tick);
  expect(await page.evaluate(() => window.directWorkerContexts.length)).toBe(before.contexts + 1);
  await page.getByRole('button', { name: 'Run independent owned reference sine', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState().outputState?.worker?.source?.renderedCommands || 0), { timeout: 30000 }).toBeGreaterThan(0);
  const observation = await page.evaluate(() => {
    const source = window.directWorkerSources.at(-1), samples = new Float32Array(2048), state = window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState(), start = performance.now();
    let peak = 0, latePeak = 0, reads = 0;
    while (performance.now() - start < 450) {
      source.analyser.getFloatTimeDomainData(samples); let value = 0; for (const sample of samples) value = Math.max(value, Math.abs(sample)); peak = Math.max(peak, value);
      if (performance.now() - start > 300) latePeak = Math.max(latePeak, value); reads++;
    }
    return { elapsedMs: performance.now() - start, peak, latePeak, reads, beforeWorkerTick: state.worker.tick, beforeApplied: state.outputState.worker.source.renderedCommands, mainTick: window.__PROCGEN_LANES__.world.tickIndex };
  });
  expect(observation.elapsedMs).toBeGreaterThanOrEqual(450); expect(observation.peak).toBeGreaterThan(.00001); expect(observation.latePeak).toBeGreaterThan(.00001);
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState().worker?.tick || 0)).toBeGreaterThan(observation.beforeWorkerTick + 3);
  const running = await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState());
  expect(running.failure).toBeNull(); expect(running.outputState.worker.source.peakPending).toBeLessThanOrEqual(512); expect(running.outputState.worker.source.renderedCommands).toBeGreaterThanOrEqual(observation.beforeApplied);
  await page.getByRole('button', { name: 'Park output · paused checkpoint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState().checkpointHeld), { timeout: 45000 }).toBe(true);
  const after = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState(), project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, worldId: window.__PROCGEN_LANES__.world.worldId,
    privateContext: window.directWorkerContexts.at(-1).state, playing: window.__PROCGEN_STUDIO__.transport.getState().playing, midi: window.directWorkerMidiRequests, microphone: window.directWorkerMicrophoneRequests }));
  expect(after.project).toBe(before.project); expect(after.tick).toBe(before.tick); expect(after.worldId).toBe(before.worldId); expect(observation.mainTick).toBe(before.tick); expect(after.playing).toBe(false);
  expect(after.privateContext).toBe('closed'); expect(after.midi).toBe(0); expect(after.microphone).toBe(0); expect(after.state.active).toBe(false); expect(after.state.failure).toBeNull(); expect(after.state.checkpointReceipt.tick).toBeGreaterThan(before.tick);
  await testInfo.attach('independent-owned-worker-digital-observation.json', { body: JSON.stringify({ source: 'actual-pinned-audio-worklet-through-transferred-port', scope: 'source-PCM-and-render-control-receipts;not-acoustic-listening-or-default-worker-performance-qualification', observation, running, parked: after.state, privateContext: after.privateContext }), contentType: 'application/json' });
  await page.getByRole('button', { name: 'Discard retained worker checkpoint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.simulationWorkbenchState().checkpointHeld)).toBe(false);
});
