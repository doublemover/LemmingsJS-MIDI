import { expect, test } from './fixtures.js';

test('PCM qualification rejects every nonfinite channel boundary and malformed comparison metric', async ({ page, nativeBrowser }, testInfo) => {
  await page.goto('/e2e-portable/fixtures/pcm-evidence.html');
  const result = await page.evaluate(async () => {
    const { comparePcmChannels } = await import('/js/app/midi-ui/PcmEvidence.js');
    const { measureSoundRender, compareSoundFeatures, matchSoundLevels } = await import('/js/midi/qualification/SoundRenderAnalysis.js');
    const planes = () => Array.from({ length: 2 }, () => Float32Array.from({ length: 512 }, (_, frame) => 0.1 * Math.sin(2 * Math.PI * 440 * frame / 48000)));
    const reference = planes(), metrics = measureSoundRender(reference, 48000), faults = [];
    for (const side of ['expected', 'actual']) for (const value of [NaN, Infinity, -Infinity]) for (const channel of [0, 1]) for (const frame of [0, 511]) {
      const invalid = planes(); invalid[channel][frame] = value; let rejected = false;
      try { comparePcmChannels(side === 'expected' ? invalid : reference, side === 'actual' ? invalid : reference); } catch (error) { rejected = /Nonfinite PCM/.test(error.message); }
      const measured = measureSoundRender(invalid, 48000);
      faults.push({ side, value: String(value), channel, frame, rejected, nonfiniteSamples: measured.nonfiniteSamples,
        comparison: compareSoundFeatures(metrics, measured).status });
    }
    let malformedMetricsRejected = 0;
    for (const value of [NaN, Infinity, -Infinity]) for (const field of ['rms', 'peak', 'spectralCentroidHz']) {
      const invalid = structuredClone(metrics); invalid[field] = value;
      for (const compare of [compareSoundFeatures, matchSoundLevels]) {
        try { compare(metrics, invalid); } catch (error) { if (/Sound measurement/.test(error.message)) malformedMetricsRejected++; }
      }
    }
    const zero = structuredClone(metrics); zero.normalizedFeatures.spectrum.fill(0);
    const degenerate = compareSoundFeatures(metrics, zero); let emptyRejected = false;
    try { comparePcmChannels([new Float32Array(0)], [new Float32Array(0)]); } catch { emptyRejected = true; }
    const Constructor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    let offline = { available: false, reason: 'native-OfflineAudioContext-absent' };
    if (typeof Constructor === 'function') {
      const context = new Constructor(2, 512, 48000), oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 440; gain.gain.value = 0.1; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(0); oscillator.stop(512 / context.sampleRate);
      const buffer = await context.startRendering(), channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const observed = measureSoundRender(channels, buffer.sampleRate), error = comparePcmChannels(channels, channels.map(plane => new Float32Array(plane)));
      oscillator.disconnect(); gain.disconnect();
      offline = { available: true, reason: null, sampleRate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels,
        nonfiniteSamples: observed.nonfiniteSamples, peak: observed.peak, rms: observed.rms, error, scope: 'native-offline-digital-PCM-no-real-time-or-device-capacity-claim' };
    }
    return { faults, malformedMetricsRejected, degenerate, emptyRejected, offline, viewport: { width: window.innerWidth, height: window.innerHeight } };
  });
  expect(result.viewport.width).toBeGreaterThanOrEqual(1920); expect(result.viewport.height).toBeGreaterThanOrEqual(1080);
  expect(result.faults).toHaveLength(24);
  for (const row of result.faults) expect(row).toMatchObject({ rejected: true, nonfiniteSamples: 1, comparison: 'unsupported' });
  expect(result.malformedMetricsRejected).toBe(18); expect(result.emptyRejected).toBe(true);
  expect(result.degenerate).toMatchObject({ status: 'unsupported', reason: 'degenerate-feature-vector', nearDuplicate: false });
  if (result.offline.available) {
    expect(result.offline).toMatchObject({ sampleRate: 48000, frames: 512, channels: 2, nonfiniteSamples: 0, error: 0 });
    expect(result.offline.rms).toBeGreaterThan(0); expect(result.offline.peak).toBeLessThan(0.11);
  } else expect(result.offline.reason).toBe('native-OfflineAudioContext-absent');
  await testInfo.attach('native-pcm-measurement.json', { contentType: 'application/json', body: JSON.stringify({ project: testInfo.project.name, browser: nativeBrowser.version(), result,
    scope: 'Injected numerical boundary checks plus native offline PCM when its constructor exists. No custom-processor fault, realtime deadline, listening, hardware or acoustic qualification.' }) });
});


test('main audio runtime reports actual requested profiles and rates and retires each native context', async ({ page, nativeBrowser }, testInfo) => {
  await page.goto('/e2e-portable/fixtures/pcm-evidence.html');
  const available = await page.evaluate(() => typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === 'function');
  const observations = [];
  if (available) {
    await page.evaluate(() => { const button = document.createElement('button'); button.textContent = 'Enable runtime profile'; document.body.append(button); });
    for (const runtimeConfig of [{ latencyProfile: 'performance' }, { latencyProfile: 'balanced', preferredSampleRate: 44100 }, { latencyProfile: 'performance', preferredSampleRate: 48000 }, { latencyProfile: 'robust', preferredSampleRate: 96000 }]) {
      await page.evaluate(async config => {
        const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js');
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        window.__runtimeOptions = null;
        window.__runtimePreview = new BrowserNotePreview({ runtimeConfig: config, performanceCoordinator: null, createAudioContext: options => {
          window.__runtimeOptions = options; return new Context(options);
        } });
        document.querySelector('button').onclick = () => { window.__runtimeEnabled = window.__runtimePreview.enable(); };
      }, runtimeConfig);
      await page.getByRole('button', { name: 'Enable runtime profile', exact: true }).click();
      const result = await page.evaluate(async () => {
        const enabled = await window.__runtimeEnabled, preview = window.__runtimePreview, context = preview.getAudioContext();
        const observation = preview.getAudioRuntimeObservation();
        let resetAvailable = false; try { resetAvailable = typeof context?.playbackStats?.resetLatency === 'function'; } catch {}
        const resetAccepted = preview.resetAudioLatencyStatistics(), afterReset = preview.getAudioRuntimeObservation();
        await preview.dispose();
        const retired = preview.getState(); window.__runtimePreview = null;
        return { enabled, requested: window.__runtimeOptions, observation, resetAvailable, resetAccepted, afterReset, retired: retired.retirement, closed: context?.state === 'closed' };
      });
      observations.push(result); expect(result.enabled).toBe(true); expect(result.closed).toBe(true);
      expect(result.retired).toMatchObject({ state: 'retired', outcome: 'complete' });
      expect(result.observation).toMatchObject({ schema: 'lemmings-audio-runtime-observation/v1', acousticMeasurement: false, estimatesAreAdditive: false });
      expect(result.observation.actualSampleRate).toBeGreaterThan(0);
      if (result.resetAvailable && result.observation.playbackStats.availability === 'available') {
        expect(result.resetAccepted).toBe(true); expect(result.afterReset.playbackStats.latencyRevision).toBe(1);
        expect(result.afterReset.playbackStats.cumulativeScope).toBe('context-lifetime-not-route-or-latency-reset');
      } else expect(result.resetAccepted).toBe(false);
      expect(result.observation.config.preferredSampleRate).toBe(runtimeConfig.preferredSampleRate ?? null);
      expect(result.requested.latencyHint).toBe({ performance: 'interactive', balanced: 'balanced', robust: 'playback' }[runtimeConfig.latencyProfile]);
      if (runtimeConfig.preferredSampleRate) expect(result.requested.sampleRate).toBe(runtimeConfig.preferredSampleRate);
      else expect(result.requested).not.toHaveProperty('sampleRate');
    }
  }
  await testInfo.attach('native-main-audio-runtime.json', { contentType: 'application/json', body: JSON.stringify({ project: testInfo.project.name, browser: nativeBrowser.version(), available,
    reason: available ? null : 'native-AudioContext-absent', observations, scope: 'Actual context construction, user activation, runtime observations and retirement; no audio workload, CPU tradeoff, sink-switch or acoustic measurement.' }) });
});

test('main audio runtime changes profiles transactionally and retires availability observers', async ({ page, nativeBrowser }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/e2e-portable/fixtures/pcm-evidence.html');
  const available = await page.evaluate(() => typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === 'function');
  const receipt = { schema: 'lemmings-native-runtime-transitions/v1', project: testInfo.project.name, browser: nativeBrowser.version(), available,
    reason: available ? null : 'native-AudioContext-absent', cycles: [], deviceSignal: null, final: null,
    scope: 'Actual native profile/rate context replacement and explicit enable. Separately controlled EventTarget device-availability signal; no physical unplug, per-device permission, DSP CPU or acoustic measurement.' };
  if (!available) { await testInfo.attach('native-runtime-transitions.json', { body: JSON.stringify(receipt), contentType: 'application/json' }); return; }
  await page.evaluate(async () => {
    const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js'), Native = globalThis.AudioContext || globalThis.webkitAudioContext;
    const contexts = [], devices = new globalThis.EventTarget();
    const preview = new BrowserNotePreview({ performanceCoordinator: null, mediaDevices: devices, createAudioContext: options => { const context = new Native(options); contexts.push({ context, options }); return context; } });
    const button = document.createElement('button'); button.textContent = 'Enable changed runtime'; button.onclick = () => { window.changedRuntimeEnable = preview.enable(); }; document.body.append(button);
    window.changedRuntime = { contexts, devices, preview };
  });
  const enable = async () => {
    await page.getByRole('button', { name: 'Enable changed runtime', exact: true }).click();
    expect(await page.evaluate(() => window.changedRuntimeEnable)).toBe(true);
  };
  try {
    await enable();
    receipt.deviceSignal = await page.evaluate(() => {
      const q = window.changedRuntime, context = q.preview.getAudioContext(), before = q.preview.getState();
      q.preview.output.channels[1].sendNoteOn(60, { rawAttack: 80, time: performance.now() + 10000 }); q.devices.dispatchEvent(new Event('devicechange'));
      const after = q.preview.getState(); return { controlled: true, beforeEpoch: before.contextEpoch, afterEpoch: after.contextEpoch,
        enabled: after.enabled, activeVoices: after.activeVoices, sameContext: context === q.preview.getAudioContext(), contexts: q.contexts.length };
    });
    expect(receipt.deviceSignal).toMatchObject({ controlled: true, enabled: false, activeVoices: 0, sameContext: true, contexts: 1 });
    expect(receipt.deviceSignal.afterEpoch).toBeGreaterThan(receipt.deviceSignal.beforeEpoch); await enable();
    for (const config of [{ latencyProfile: 'balanced', preferredSampleRate: 44100 }, { latencyProfile: 'performance', preferredSampleRate: 48000 }, { latencyProfile: 'robust', preferredSampleRate: 96000 }]) {
      const cycle = await page.evaluate(async next => {
        const q = window.changedRuntime, old = q.preview.getAudioContext(), count = q.contexts.length, before = q.preview.getAudioRuntimeObservation();
        q.preview.output.channels[1].sendNoteOn(60, { rawAttack: 80, time: performance.now() + 10000 });
        const start = performance.now(), result = await q.preview.configureAudioRuntime(next), wallMs = performance.now() - start;
        return { config: next, before, result, wallMs, contextsBefore: count, contextsAfter: q.contexts.length, oldClosed: old.state === 'closed', currentNull: q.preview.getAudioContext() === null,
          activeVoices: q.preview.getState().activeVoices, enabled: q.preview.getState().enabled };
      }, config);
      receipt.cycles.push(cycle); expect(cycle.result).toMatchObject({ status: 'rebuild-ready', requiresEnable: true });
      expect(cycle).toMatchObject({ oldClosed: true, currentNull: true, activeVoices: 0, enabled: false }); expect(cycle.contextsAfter).toBe(cycle.contextsBefore);
      await enable();
    }
  } finally {
    receipt.final = await page.evaluate(async () => {
      const q = window.changedRuntime, observation = q.preview.getAudioRuntimeObservation(); await q.preview.dispose();
      return { observation, retirement: q.preview.getState().retirement, contexts: q.contexts.map(({ context, options }) => ({ requested: options, actualSampleRate: context.sampleRate, closed: context.state === 'closed' })),
        outputWatch: q.preview.getAudioRuntimeSettingsState().outputWatch };
    });
    await testInfo.attach('native-runtime-transitions.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
  }
  expect(receipt.final.contexts).toHaveLength(4); expect(receipt.final.contexts.every(context => context.closed && context.actualSampleRate > 0)).toBe(true);
  expect(receipt.final.retirement).toMatchObject({ state: 'retired', outcome: 'complete' });
  expect(receipt.final.outputWatch).toMatchObject({ devicesListening: false, speakerPermission: 'retired' });
  expect(receipt.final.observation.config).toMatchObject({ latencyProfile: 'robust', preferredSampleRate: 96000 });
});
