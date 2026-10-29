import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseSmf } from '../test/support/smf.js';
import { revealWorkstationControl } from './helpers/workstationChrome.js';

const ready = async page => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const capture = async (page, count = 2) => page.evaluate(count => {
  const studio = window.__PROCGEN_STUDIO__; studio.handlers.record(true);
  for (let index = 0; index < count; index++) {
    const outputId = 'recorded-device-' + String(index + 1).padStart(2, '0'), program = index ? 45 : 10;
    const event = (type, beat, patch = {}) => studio.ports.recordEvent({ type, beat, timestamp: beat * 500, outputId, channel: 1, ...patch });
    event('program', 0, { value: program }); event('noteOn', 1, { note: 60, velocity: 100 });
    if (!index) event('noteOn', 1, { note: 60, velocity: 80 });
    event('noteOff', 2, { note: 60 }); if (!index) event('noteOff', 2, { note: 60 });
  }
  studio.handlers.record(false);
  return { tick: window.__PROCGEN_LANES__.world.tickIndex, revision: studio.getDocumentState().editRevision, count: studio.ports.getRecording().length };
}, count);
const prepare = page => page.evaluate(() => { window.__pendingRouteExport = window.__PROCGEN_STUDIO__.handlers.exportMidi(); });
const settle = page => page.evaluate(() => window.__pendingRouteExport);
const manifest = bytes => JSON.parse(new TextDecoder().decode(new Uint8Array(parseSmf(bytes).find(event => event.type === 1).data)));

test('native MIDI source and timing choices keep reused endpoint connections separate', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await ready(page);
  const before = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.handlers.record(true); studio.ports.clearRecording(); studio.ports.recordTempo(90, 8, 4000);
    for (const connectionEpoch of [7, 8]) {
      const outputId = 'same-recorded-device', routeRevision = connectionEpoch + 10;
      const event = (type, beat, patch = {}) => studio.ports.recordEvent({ type, beat, timestamp: beat * 500, outputId, channel: 1, ...patch }, { connectionEpoch, routeRevision });
      event('program', 8, { value: connectionEpoch === 7 ? 10 : 45 }); event('noteOn', 9, { note: 60, velocity: 100 }); event('noteOff', 11, { note: 60 });
    }
    studio.handlers.record(false);
    return { count: studio.ports.getRecording().length, physics: window.__PROCGEN_LANES__.world.tickIndex };
  });
  const source = page.getByRole('combobox', { name: 'MIDI export source', includeHidden: true }), timing = page.getByRole('combobox', { name: 'MIDI file timing', includeHidden: true });
  await revealWorkstationControl(page, source); await source.selectOption('intent-render'); await timing.selectOption('rebase-recording-start');
  const midi = page.locator('#procgenStudioFooter').getByRole('button', { name: 'MIDI', exact: true });
  await midi.click();
  const field = page.locator('.studio-midi-export-routes'); await expect(field).toBeVisible(); await expect(source).toBeDisabled(); await expect(timing).toBeDisabled();
  await expect(field.getByRole('button', { name: /connection 7 · route 17/ })).toBeVisible(); await expect(field.getByRole('button', { name: /connection 8 · route 18/ })).toBeVisible();
  const downloading = page.waitForEvent('download'); await field.getByRole('button', { name: /connection 8 · route 18/ }).click();
  const download = await downloading, bytes = await readFile(await download.path()), evidence = manifest(bytes), parsed = parseSmf(bytes);
  expect(evidence.evidence).toBe('intent-render'); expect(evidence.exportPlan).toMatchObject({ placement: 'rebase-recording-start', originBeat: 8, connectionEpoch: 8, routeRevision: 18, includedMessages: 3, excludedRouteMessages: 3 });
  expect(parsed.filter(event => event.status === 0xc0).map(event => event.data[0])).toEqual([45]);
  expect(parsed.filter(event => event.status === 0x90 || event.status === 0x80).map(event => event.tick)).toEqual([480, 1440]);
  await expect(source).toBeEnabled(); await expect(timing).toBeEnabled();
  const previous = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId);
  await revealWorkstationControl(page, source); await source.selectOption('api-accepted'); await midi.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().preparation)).toBeNull();
  const after = await page.evaluate(() => ({ artifact: window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId, count: window.__PROCGEN_STUDIO__.ports.getRecording().length, physics: window.__PROCGEN_LANES__.world.tickIndex }));
  expect(after).toEqual({ artifact: previous, count: before.count, physics: before.physics });
  await testInfo.attach('midi-source-time-epoch-choice', { body: JSON.stringify({ before, after, evidence, scope: 'Native source/time/epoch controls on authored MIDI capture; no submitted-output/receiver or raw-UMP capture claim.' }), contentType: 'application/json' });
});

test('native output choice exports same-channel devices separately and retains deliberate unisons', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await ready(page); const before = await capture(page), receipts = [];
  for (const [ordinal, program, onsets] of [[1, 10, 2], [2, 45, 1]]) {
    await prepare(page); const field = page.locator('.studio-midi-export-routes'); await expect(field).toBeVisible();
    await expect(field).toContainText('Authored MIDI intent'); await expect(page.getByRole('button', { name: 'Panic', exact: true })).toBeEnabled();
    const downloading = page.waitForEvent('download');
    await field.getByRole('button', { name: 'Prepare output ' + ordinal + ' · recorded-device-0' + ordinal + ' · connection unrecorded', exact: true }).click();
    const result = await settle(page), download = await downloading, bytes = await readFile(await download.path()), parsed = parseSmf(bytes), report = manifest(bytes);
    expect(result.retained).toBe(true); expect(download.suggestedFilename()).toContain('-output-' + ordinal);
    expect(parsed.filter(event => event.status === 0xc0).map(event => event.data[0])).toEqual([program]);
    expect(parsed.filter(event => event.status === 0x90)).toHaveLength(onsets); expect(parsed.filter(event => event.status === 0x80)).toHaveLength(onsets);
    expect(report.exportPlan.routeCount).toBe(2); expect(report.exportPlan.selectedRouteOrdinal).toBe(ordinal); expect(report.exportPlan.sourceLayer).toBe('intent-render');
    expect(bytes.includes(Buffer.from('recorded-device-'))).toBe(false); await expect(field).toBeHidden();
    receipts.push({ filename: download.suggestedFilename(), report, artifact: result });
  }
  const after = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision,
    count: window.__PROCGEN_STUDIO__.ports.getRecording().length })); expect(after).toEqual(before);
  await testInfo.attach('separate-recorded-output-files.json', { body: JSON.stringify({ before, after, receipts,
    scope: 'Production capture/export owner and worker, native desktop output-choice buttons and downloaded bytes. Authored MIDI intent is explicit; no physical receiver submission is claimed.' }, null, 2), contentType: 'application/json' });
});

test('paged output choice cancels and rejects retired source buttons while retaining the previous file', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await ready(page); await capture(page, 1); const downloading = page.waitForEvent('download');
  const previous = await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.exportMidi()); await downloading;
  await capture(page, 35); await prepare(page); const field = page.locator('.studio-midi-export-routes'); await expect(field).toBeVisible();
  expect(await field.getByRole('button').count()).toBeLessThanOrEqual(19);
  await field.getByRole('button', { name: 'Next recorded outputs', exact: true }).click(); await expect(field).toContainText('Outputs 17–32 of 35');
  await field.getByRole('searchbox', { name: 'Find recorded MIDI output' }).fill('device-35'); await expect(field).toContainText('Outputs 1–1 of 1');
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click(); await settle(page); await expect(field).toBeHidden();
  const canceled = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState()); expect(canceled.artifact.artifactId).toBe(previous.artifactId); expect(canceled.preparation).toBeNull();
  await prepare(page); await expect(field).toBeVisible();
  await page.evaluate(() => {
    const stale = document.querySelector('.studio-midi-export-routes button'); window.__PROCGEN_STUDIO__.handlers.clearMidiRecording(); stale.click();
  });
  await settle(page); await expect(field).toBeHidden();
  const retired = await page.evaluate(() => ({ exported: window.__PROCGEN_STUDIO__.getExportState(), recorded: window.__PROCGEN_STUDIO__.ports.getRecording().length }));
  expect(retired.exported.artifact.artifactId).toBe(previous.artifactId); expect(retired.exported.preparation).toBeNull(); expect(retired.recorded).toBe(0);
  await testInfo.attach('retired-output-choice.json', { body: JSON.stringify({ previous, canceled, retired,
    scope: 'Native filter/paging/cancel plus a deliberately invoked detached DOM button after real source retirement. No stale file publication.' }, null, 2), contentType: 'application/json' });
});
