import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import JZZ from 'jzz';
import installSmf from 'jzz-midi-smf';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { revealWorkstationControl } from './helpers/workstationChrome.js';
import { parseSmf } from '../test/support/smf.js';
installSmf(JZZ);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

test('native physical take MIDI revoice uses recorded clocks and independent melodic channels without live output @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    window.physicalMidiRequests = 0;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.physicalMidiRequests++; throw new Error('Unexpected MIDI permission request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1,
      instruments: [{ id: 'midi-crossing', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 6012.34567,
        velocity01: 0.8, role: 'crossing', route: 'local' }] } });
    await studio.handlers.startCausalTake({ takeName: 'Actual physical MIDI revoice' });
    studio.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(96); studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    await studio.handlers.stopCausalTake();
    const state = studio.handlers.causalTakeState(); if (!state.last?.takeId) throw new Error('Physical take did not finalize.');
    const capturedBpm = studio.transport.getState().bpm; studio.transport.configure({ bpm: 17 });
    return { project: JSON.stringify(studio.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, takeId: state.last.takeId, capturedBpm, uiBpm: studio.transport.getState().bpm };
  });
  const program = page.getByRole('spinbutton', { name: 'Physical take MIDI program', includeHidden: true }); await revealWorkstationControl(page, program); await program.fill('25');
  const exportButton = page.getByRole('button', { name: 'Physical take MIDI1', exact: true }); await revealWorkstationControl(page, exportButton);
  const downloading = page.waitForEvent('download'); await exportButton.click(); const download = await downloading, bytes = await readFile(await download.path()), parsed = parseSmf(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.find(row => row.type === 1).data))), independent = new JZZ.MIDI.SMF(bytes);
  const notes = parsed.filter(row => (row.status & 0xf0) === 0x90);
  expect(notes.length).toBeGreaterThan(0); expect(manifest.takeId).toBe(before.takeId); expect(manifest.lowering.program).toBe(24);
  expect(manifest.lowering.evidence).toBe('new-midi1-revoice-not-submitted-output'); expect(manifest.timing.liveLatenessApplied).toBe(false);
  const tempoBytes = parsed.find(row => row.type === 0x51).data, initialTempo = tempoBytes[0] * 65536 + tempoBytes[1] * 256 + tempoBytes[2];
  expect(initialTempo).toBe(Math.round(60000000 / before.capturedBpm)); expect(initialTempo).not.toBe(Math.round(60000000 / before.uiBpm)); expect(manifest.lowering.losses.originalTimbreReplaced).toBe(true);
  expect(parsed.at(-1).tick).toBe(manifest.timing.endTick); expect(parsed.at(-1).tick).toBeGreaterThanOrEqual(notes.at(-1).tick);
  expect(Array.from(independent[0]).filter(row => (row[0] & 0xf0) === 0x90).map(row => row.tt)).toEqual(notes.map(row => row.tick));
  const after = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, before = studio.getExportState();
    const pending = studio.handlers.exportPhysicalTakeMidi(); studio.handlers.cancelExportDelivery(); await pending;
    await studio.handlers.exportPhysicalTakeMidi({ program: 999 });
    return { tick: window.__PROCGEN_LANES__.world.tickIndex, project: JSON.stringify(studio.getProject()), requests: window.physicalMidiRequests,
      preparationReceipt: before.preparationReceipt, previousRetained: before.artifact.artifactId === studio.getExportState().artifact.artifactId };
  });
  expect(after.tick).toBe(before.tick); expect(after.project).toBe(before.project); expect(after.requests).toBe(0); expect(after.previousRetained).toBe(true);
  expect(after.preparationReceipt.method).toBe('dedicated-worker'); expect(after.preparationReceipt.outputTransport.ownedTransferredBytes).toBe(bytes.length);
  await testInfo.attach('actual-physical-take-midi-revoice', { body: JSON.stringify({ before, after, manifest, independentReader: 'jzz-midi-smf@1.9.9/jzz@1.9.6',
    scope: 'Actual captured desktop physical phrase projected from verified semantic journal, captured clock, owned worker and MIDI1 revoice. No historical submitted trace, MPE/CI Profile, physical receiver or hardware setup/playback qualification.' }), contentType: 'application/json' });
});
