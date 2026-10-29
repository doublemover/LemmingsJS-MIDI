import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { revealWorkstationControl } from './helpers/workstationChrome.js';

test.use({ permissions: [] });

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

const prepareFileDelivery = async page => {
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle('owned-performance.mid', { create: true }), writer = await handle.createWritable();
    await writer.write('existing origin-private canary'); await writer.close();
    const { nativeExportDeliveryDiagnostics } = await import(new URL('js/app/export/NativeExportDeliveryOwner.js', window.location.href).href);
    const fixture = window.fileDeliveryFixture = { mode: 'cancel', handle, clicks: [], requests: [], writeEntered: false, nativeExportDeliveryDiagnostics,
      nativeHandle: handle instanceof window.FileSystemFileHandle, nativeStream: writer instanceof window.FileSystemWritableFileStream };
    document.addEventListener('click', event => {
      if (event.target.closest?.('button')?.textContent === 'Save file') fixture.clicks.push({ trusted: event.isTrusted, active: navigator.userActivation.isActive });
    }, true);
    window.showSaveFilePicker = async options => {
      fixture.requests.push({ options, active: navigator.userActivation.isActive, mode: fixture.mode });
      if (fixture.mode === 'cancel') throw new window.DOMException('Controlled picker cancellation', 'AbortError');
      if (fixture.mode === 'permission') throw new window.DOMException('Controlled permission loss', 'NotAllowedError');
      if (fixture.mode === 'save') return handle;
      return { async createWritable(options) {
        const stream = await handle.createWritable(options);
        return { async write(chunk) {
          await stream.write(chunk); fixture.writeEntered = true;
          if (fixture.mode === 'write') throw new Error('Controlled write rejection');
          if (fixture.mode === 'defer') await new Promise(resolve => { fixture.finishWrite = resolve; });
        }, close() { if (fixture.mode === 'close') throw new Error('Controlled close rejection'); return stream.close(); }, abort() { return stream.abort(); } };
      } };
    };
  });
  const downloading = page.waitForEvent('download');
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.handlers.record(true);
    studio.ports.recordEvent({ type: 'noteOn', channel: 1, note: 60, velocity: 100, beat: 0, timestamp: performance.now() });
    studio.ports.recordEvent({ type: 'noteOff', channel: 1, note: 60, beat: 1, timestamp: performance.now() });
    studio.handlers.record(false); await studio.handlers.exportMidi();
  });
  const bytes = await readFile(await (await downloading).path());
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getExportState().artifact?.digestState === 'ready');
  const before = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__;
    window.fileDeliveryFixture.world = window.__PROCGEN_LANES__.world;
    return { artifact: studio.getExportState().artifact, tick: window.__PROCGEN_LANES__.world.tickIndex, project: JSON.stringify(studio.getProject()),
      native: window.fileDeliveryFixture.nativeExportDeliveryDiagnostics() };
  });
  expect(before.artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const save = page.getByRole('button', { name: 'Save file', exact: true, includeHidden: true }); await revealWorkstationControl(page, save);
  return { before, bytes, save };
};
const deliveryState = page => page.evaluate(async () => {
  const studio = window.__PROCGEN_STUDIO__, fixture = window.fileDeliveryFixture, file = await fixture.handle.getFile();
  return { ...studio.getExportState(), clicks: fixture.clicks, requests: fixture.requests, native: fixture.nativeExportDeliveryDiagnostics(),
    nativeHandle: fixture.nativeHandle, nativeStream: fixture.nativeStream, bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    sameWorld: fixture.world === window.__PROCGEN_LANES__.world, tick: window.__PROCGEN_LANES__.world.tickIndex, project: JSON.stringify(studio.getProject()) };
});
const expectSourcePreserved = (current, before) => {
  expect(current.artifact).toMatchObject({ artifactId: before.artifact.artifactId, sha256: before.artifact.sha256, byteLength: before.artifact.byteLength, retained: true });
  expect(current.sameWorld).toBe(true); expect(current.tick).toBe(before.tick); expect(current.project).toBe(before.project);
};

test('Playwright save gestures cancel then retry into a real origin-private file without changing prepared bytes @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const { before, bytes, save } = await prepareFileDelivery(page);
  await save.click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().delivery?.state)).toBe('canceled');
  const canceled = await deliveryState(page); expectSourcePreserved(canceled, before);
  expect(Buffer.from(canceled.bytes).toString()).toBe('existing origin-private canary');
  expect(canceled.delivery).toMatchObject({ sinkKind: 'file-picker', bytesWritten: 0, evidence: 'picker-result' });
  await page.evaluate(() => { window.fileDeliveryFixture.mode = 'save'; }); await save.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().delivery?.state)).toBe('close-acknowledged');
  const saved = await deliveryState(page); expectSourcePreserved(saved, before);
  expect(saved.nativeHandle).toBe(true); expect(saved.nativeStream).toBe(true); expect(Buffer.from(saved.bytes)).toEqual(bytes);
  expect(saved.clicks).toEqual([{ trusted: true, active: true }, { trusted: true, active: true }]); expect(saved.requests.every(request => request.active)).toBe(true);
  expect(saved.requests.map(request => request.options.suggestedName)).toEqual([before.artifact.suggestedFilename, before.artifact.suggestedFilename]);
  expect(saved.delivery).toMatchObject({ sinkKind: 'file-handle', evidence: 'writable-close-resolved', bytesWritten: bytes.length, nativeRetirement: 'released', nativePendingCalls: 0 });
  expect(saved.native).toEqual(before.native);
  await testInfo.attach('playwright-origin-private-file-delivery', { body: JSON.stringify({ before, canceled, saved,
    scope: 'Trusted Playwright clicks, controlled picker outcomes, actual browser OPFS FileSystemFileHandle/write/close/read-back and actual anchor bytes. No native OS dialog, user-visible filesystem permission or power-loss durability qualification.' }), contentType: 'application/json' });
});

for (const mode of ['write', 'close']) test('Playwright ' + mode + ' rejection aborts the real origin-private transaction and retains the prepared file @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const { before, bytes, save } = await prepareFileDelivery(page);
  await page.evaluate(mode => { window.fileDeliveryFixture.mode = mode; }, mode); await save.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().delivery?.state)).toBe('failed');
  const failed = await deliveryState(page); expectSourcePreserved(failed, before);
  expect(failed.delivery).toMatchObject({ evidence: mode === 'write' ? 'writing' : 'closing', bytesWritten: mode === 'write' ? 0 : bytes.length, abortAttempted: true, abortAcknowledged: true,
    nativeRetirement: 'released', nativePendingCalls: 0 });
  expect(Buffer.from(failed.bytes).toString()).toBe('existing origin-private canary'); expect(failed.native).toEqual(before.native);
  await testInfo.attach('playwright-origin-private-' + mode + '-fault', { body: JSON.stringify({ before, failed,
    scope: 'Controlled rejection around an actual browser OPFS transaction; real abort rollback and source retirement. No OS disk/permission fault claim.' }), contentType: 'application/json' });
});

test('Playwright cancellation retains the delivery lease until a pending writable promise settles @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const { before, save } = await prepareFileDelivery(page);
  await page.evaluate(() => { window.fileDeliveryFixture.mode = 'defer'; }); await save.click(); await page.waitForFunction(() => window.fileDeliveryFixture.writeEntered);
  await page.getByRole('button', { name: 'Cancel delivery', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().delivery?.state)).toBe('canceled');
  const pending = await deliveryState(page); expectSourcePreserved(pending, before);
  expect(pending.delivery).toMatchObject({ bytesWritten: 0, abortAcknowledged: true, nativeRetirement: 'pending-native-settlement', nativePendingCalls: 1 });
  expect(pending.native).toMatchObject({ activeOwners: before.native.activeOwners + 1, pendingCalls: before.native.pendingCalls + 1 });
  expect(Buffer.from(pending.bytes).toString()).toBe('existing origin-private canary');
  await page.evaluate(() => window.fileDeliveryFixture.finishWrite());
  await expect.poll(() => page.evaluate(() => window.fileDeliveryFixture.nativeExportDeliveryDiagnostics())).toEqual(before.native);
  const settled = await deliveryState(page); expectSourcePreserved(settled, before);
  await testInfo.attach('playwright-pending-delivery-retirement', { body: JSON.stringify({ before, pending, settled,
    scope: 'A controlled pending write acknowledgement around real OPFS write/abort. Source lease survives cancellation until actual promise settlement; no OS I/O latency claim.' }), contentType: 'application/json' });
});

test('Playwright picker permission and unsupported paths retain the actual anchor retry @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const { before, bytes, save } = await prepareFileDelivery(page);
  await page.evaluate(() => { window.fileDeliveryFixture.mode = 'permission'; }); await save.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().delivery?.state)).toBe('failed');
  const denied = await deliveryState(page); expectSourcePreserved(denied, before); expect(denied.delivery.sinkKind).toBe('file-picker'); expect(denied.native).toEqual(before.native);
  await page.evaluate(async () => { window.showSaveFilePicker = undefined; await window.__PROCGEN_STUDIO__.handlers.savePreparedExport(); });
  await expect(save).toBeDisabled(); const unsupported = await deliveryState(page); expectSourcePreserved(unsupported, before);
  expect(unsupported.delivery).toMatchObject({ state: 'unsupported', errorKind: 'unsupported-sink' });
  const retry = page.getByRole('button', { name: 'Retry file', exact: true, includeHidden: true }); await revealWorkstationControl(page, retry);
  const downloading = page.waitForEvent('download'); await retry.click(); expect(await readFile(await (await downloading).path())).toEqual(bytes);
  await testInfo.attach('playwright-picker-capability-fallback', { body: JSON.stringify({ before, denied, unsupported,
    scope: 'Controlled picker capability/permission outcomes and real browser anchor retry. No native OS permission prompt or user filesystem grant.' }), contentType: 'application/json' });
});
test('native archive preparation can be superseded, canceled and discarded without replacing the current file', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    await studio.handlers.startCausalTake({ takeName: 'Export ownership fixture' }); window.__PROCGEN_LANES__.step(2); await studio.stopCausalTake();
    const send = window.Worker.prototype.postMessage;
    window.Worker.prototype.postMessage = function(message, ...args) {
      if (window.holdNextArchive && message.type === 'input-start' && message.kind === 'verify-stored-causal-sources') {
        window.holdNextArchive = false; window.archiveWorkerHeld = true; return;
      }
      return send.call(this, message, ...args);
    };
    window.exportWorld = window.__PROCGEN_LANES__.world; window.exportTick = window.exportWorld.tickIndex;
  });
  const hold = async () => {
    await page.evaluate(() => {
      window.archiveWorkerHeld = false; window.holdNextArchive = true;
      window.pendingArchive = window.__PROCGEN_STUDIO__.handlers.prepareCausalArchive();
    });
    await page.waitForFunction(() => window.archiveWorkerHeld === true);
    await expect(page.getByRole('button', { name: 'Cancel preparation', exact: true })).toBeEnabled();
  };
  for (const replacement of ['project', 'archive']) {
    await hold();
    const current = await page.evaluate(async kind => {
      const studio = window.__PROCGEN_STUDIO__;
      const newer = kind === 'project' ? await studio.handlers.export() : await studio.handlers.prepareCausalArchive();
      return { newer, earlier: await window.pendingArchive, final: studio.getExportState() };
    }, replacement);
    expect(current.earlier).toMatchObject({ status: 'superseded' });
    expect(current.newer.retained).toBe(true); expect(current.final.artifact.artifactId).toBe(current.newer.artifactId);
    expect(current.final.preparation).toBeNull();
  }
  await hold(); const retained = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId);
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  expect(await page.evaluate(() => window.pendingArchive)).toMatchObject({ status: 'superseded' });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId)).toBe(retained);
  await hold(); await page.getByRole('button', { name: 'Discard file', exact: true }).click();
  expect(await page.evaluate(() => window.pendingArchive)).toMatchObject({ status: 'superseded' });
  expect(await page.evaluate(() => ({ artifact: window.__PROCGEN_STUDIO__.getExportState().artifact,
    sameWorld: window.exportWorld === window.__PROCGEN_LANES__.world, sameTick: window.exportTick === window.exportWorld.tickIndex,
    output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }))).toEqual({ artifact: null, sameWorld: true, sameTick: true, output: false });
});
