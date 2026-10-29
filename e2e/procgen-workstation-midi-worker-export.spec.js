import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { readFile } from 'node:fs/promises';
import { exportProcgenMidi } from '../js/app/procgen/workstation/ProcgenMidiExport.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('recorded MIDI uses a bounded worker, cancels without blocking Panic and preserves the prepared file', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const downloading = page.waitForEvent('download');
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, tempo = studio.transport.getState();
    studio.handlers.record(true);
    for (let first = 0; first < 99990; first += 2048) {
      for (let index = first; index < Math.min(99990, first + 2048); index++) studio.ports.recordEvent({ type: 'cc', controller: 74, value: index % 128, beat: index / 480, timestamp: index });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    studio.handlers.record(false); const physics = window.__PROCGEN_LANES__.world.tickIndex;
    const prepared = await studio.handlers.exportMidi(); if (!prepared?.retained) throw new Error('MIDI worker did not prepare a file.');
    const first = studio.getExportState(), prefix = studio.ports.getRecording().length;
    if (first.preparationReceipt?.method !== 'dedicated-worker' || !first.preparationReceipt.inputTransport.packets ||
        first.preparationReceipt.outputTransport.ownedTransferredBytes !== prepared.byteLength) throw new Error('MIDI preparation did not use its admitted paged worker.');
    const pending = studio.handlers.exportMidi();
    if (!studio.getExportState().preparation || !studio.handlers.cancelExportDelivery()) throw new Error('MIDI preparation cannot be canceled.');
    const before = performance.now(); studio.handlers.stopOutput(); const panicOwnerMs = performance.now() - before; await pending;
    const after = studio.getExportState();
    if (after.artifact.artifactId !== first.artifact.artifactId || !after.artifact.retained || after.preparation) throw new Error('Cancel replaced or discarded the prepared file.');
    if (studio.ports.getRecording().length !== prefix || window.__PROCGEN_LANES__.world.tickIndex !== physics) throw new Error('Export changed recording history or paused physics.');
    const state = studio.ports.getState(); const manifest = { schema: 'procgen-recording-window/v1', complete: state.recordingComplete,
      reason: state.incompleteReason, reasons: state.incompleteReasons, evidence: 'intent-render', retainedRange: state.retainedRange,
      firstLostSequence: state.firstLostSequence, droppedRecords: state.droppedRecords, droppedCategories: state.droppedCategories, omittedOnsets: 0, omittedReleases: 0 };
    const options = { bpm: tempo.bpm, beatsPerBar: studio.getProject().transport?.timeSignature?.beats, beatUnit: studio.getProject().transport?.timeSignature?.unit };
    manifest.exportPlan = { schema: 'procgen-recorded-midi-export-plan/v1', sourceLayer: 'intent-render', timeDomain: 'recorded-score-beat', placement: 'retained-absolute-beat', originBeat: 0,
      endpointPolicy: 'single-recorded-output', channelPolicy: 'preserve-within-selected-output', protocol: 'captured-midi1-channel-bytes', routeIndex: 0, routeCount: 1, selectedRouteOrdinal: 1,
      includedMessages: 99990, excludedRouteMessages: 0, excludedOtherLayerMessages: 0, selectedOutputHash: null, ppq: 480,
      initialTempo: { source: 'captured-boundary', bpm: tempo.bpm, firstCapturedBeat: tempo.beat, unobservedPrefixBeats: tempo.beat } };
    return { events: prefix, byteLength: prepared.byteLength, panicOwnerMs, physics, worker: first.preparationReceipt, manifest, options, tempo: { bpm: tempo.bpm, beat: tempo.beat }, retainedAfterCancel: after.artifact.artifactId === first.artifact.artifactId,
      scope: 'actual-workstation-worker-preparation-and-cancellation;no-device-or-end-to-end-button-latency-claim' };
  });
  const download = await downloading, bytes = await readFile(await download.path());
  result.manifest.exportPlan.selectedOutputHash = await page.evaluate(async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ outputId: '' })), digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  });
  const records = [{ type: 'tempo', bpm: result.tempo.bpm, beat: result.tempo.beat }, ...Array.from({ length: 99990 }, (_, index) => ({ data: [0xb0, 74, index % 128], beat: index / 480 }))];
  expect(bytes.equals(Buffer.from(exportProcgenMidi(records, { ...result.options, manifest: result.manifest })))).toBe(true);
  expect(result.events).toBe(99991); expect(result.retainedAfterCancel).toBe(true);
  await testInfo.attach('recorded-midi-worker-export', { body: JSON.stringify(result), contentType: 'application/json' });
});
