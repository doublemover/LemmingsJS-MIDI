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
