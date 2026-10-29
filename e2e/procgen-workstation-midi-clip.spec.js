import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JZZ from 'jzz';
import installSmf from 'jzz-midi-smf';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
installSmf(JZZ);

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('native worker Clip encoding/import preserves 100000 UMP events and retires a canceled source @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const result = await page.evaluate(async () => {
    const { createBackgroundJobService } = await import(new URL('js/app/resources/BackgroundJobService.js', window.location.href).href);
    const { createBackgroundWorkerAdmission } = await import(new URL('js/app/resources/BackgroundWorkerAdmission.js', window.location.href).href);
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission });
    const count = 100000, ticks = new Float64Array(count), offsets = new Uint32Array(count + 1), words = new Uint32Array(count * 2);
    for (let index = 0; index < count; index++) { ticks[index] = index * 2; offsets[index + 1] = (index + 1) * 2; words[index * 2] = 0x40b14a00 + index % 16 * 0x1000000; words[index * 2 + 1] = (0xfedc0000 + index) >>> 0; }
    const input = { ppq: 65535, configurationEndTick: 0, endTick: count * 2 + 65535, sequence: { ticks, offsets, words } };
    const request = { ownerId: 'native-clip', ownerEpoch: 1, sourceRevision: 'original-ump:1', maxBytes: 8 * 1048576, estimatedPeakBytes: 128 * 1048576 };
    let encoded, decoded, turns = 0, failure; const timer = setInterval(() => { turns++; }, 10), physics = window.__PROCGEN_LANES__.world.tickIndex;
    try {
      encoded = await jobs.compute({ ...request, kind: 'encode-midi-clip', prepareInput: () => input });
      const bytes = encoded.value.bytes, digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), byte => byte.toString(16).padStart(2, '0')).join('');
      const fileHash = await digest(bytes), sourceWordHash = await digest(words);
      decoded = await jobs.compute({ ...request, kind: 'decode-midi-clip', prepareInput: () => ({ bytes }) });
      if (await digest(decoded.value.sequence.words) !== sourceWordHash || decoded.value.endTick !== input.endTick ||
          decoded.value.sequence.ticks.length !== count || decoded.value.sequence.ticks[count - 1] !== ticks[count - 1]) throw new Error('Native Clip import changed original UMP or time.');
      const abort = new AbortController(); let canceled = false;
      const pending = jobs.compute({ ...request, sourceRevision: 'retired-ump:2', kind: 'encode-midi-clip', prepareInput: () => input, signal: abort.signal,
        onProgress: () => { abort.abort(new Error('Clip source replaced')); } });
      try { await pending; } catch (error) { failure = error; canceled = true; }
      if (!canceled) throw new Error('Retired Clip source published an artifact.');
      await failure.backgroundRetirementCompletion;
      if (await digest(bytes) !== fileHash || window.__PROCGEN_LANES__.world.tickIndex !== physics) throw new Error('Canceled Clip preparation changed its prior artifact or paused physics.');
      const encodedReceipt = encoded.receipt, decodedReceipt = decoded.receipt;
      const binary = Array.from(bytes.subarray(0, 200), byte => byte.toString(16).padStart(2, '0')).join('');
      const fileBytes = bytes.length, retainedBeforeRelease = admission.diagnostics().memory.accountedBytes;
      const outputBase64 = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
      encoded.release(); decoded.release(); encoded = decoded = null;
      return { count, fileBytes, fileHash, sourceWordHash, binary, outputBase64, turns, physics, canceled, retainedBeforeRelease, viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        accountedAfterRelease: admission.diagnostics().memory.accountedBytes, encodedReceipt, decodedReceipt,
        scope: 'native-source-bound-file-codec-worker; synthetic-original-UMP-fixture; no capture UI, hardware setup, DAW or receiver claim' };
    } finally { clearInterval(timer); encoded?.release(); decoded?.release(); jobs.dispose(); admission.dispose(); }
  });
  const bytes = Buffer.from(result.outputBase64, 'base64'); delete result.outputBase64;
  const independent = new JZZ.MIDI.Clip(bytes); expect(independent.validate()).toBeUndefined(); expect(independent.ppqn).toBe(65535);
  expect(independent.length).toBe(100001); expect(independent.at(-1).tt).toBe(265535);
  const sourceWords = Buffer.alloc(100000 * 8), independentWords = Buffer.alloc(100000 * 8);
  for (let index = 0; index < 100000; index++) {
    const message = independent[index]; if (message.tt !== index * 2) throw new Error('Independent tick mismatch at event ' + index);
    sourceWords.writeUInt32LE((0x40b14a00 + index % 16 * 0x1000000) >>> 0, index * 8); sourceWords.writeUInt32LE((0xfedc0000 + index) >>> 0, index * 8 + 4);
    Buffer.from(Array.from(message)).copy(independentWords, index * 8);
  }
  const hostBytes = Buffer.alloc(independentWords.length);
  for (let at = 0; at < independentWords.length; at += 4) hostBytes.writeUInt32LE(independentWords.readUInt32BE(at), at);
  expect(hostBytes.equals(sourceWords)).toBe(true); expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.fileHash);
  expect(result.turns).toBeGreaterThan(0); expect(result.accountedAfterRelease).toBe(0); expect(result.canceled).toBe(true);
  expect(result.encodedReceipt.method).toBe('dedicated-worker'); expect(result.decodedReceipt.method).toBe('dedicated-worker');
  expect(result.encodedReceipt.outputTransport.ownedTransferredBytes).toBe(result.fileBytes);
  await testInfo.attach('native-midi-clip-worker', { body: JSON.stringify({ ...result, independentReader: 'jzz-midi-smf@1.9.9/jzz@1.9.6', exactIndependentWordsAndTicks: 100000 }), contentType: 'application/json' });
});
