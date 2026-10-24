import { test, expect } from '@playwright/test';

test('native ADSR releases preserve the preceding constant-source PCM at 44.1/48/96k (#1256)', async ({ page }) => {
  await page.goto('/index.html');
  const results = await page.evaluate(async () => {
    const { scheduleNativeHeldEnvelope } = await import('/js/app/midi-ui/NativeAdsrEnvelope.js');
    const { releaseNativeVoice } = await import('/js/app/midi-ui/NativeVoiceLifetime.js');
    const output = [];
    for (const rate of [44100, 48000, 96000]) for (const [attack, decay, sustain, relative] of [
      [0.2, 0.25, 0.4, 0], [0.2, 0.25, 0.4, 0.05], [0.2, 0.25, 0.4, 0.2], [0.2, 0.25, 0.4, 0.3],
      [0.2, 0.25, 0.4, 0.45], [0.2, 0.25, 0.4, 0.6], [0, 0.25, 0.4, 0.1], [0.2, 0, 0.4, 0.2], [0, 0, 0, 0.1]
    ]) {
      const start = 0.1, cutFrame = Math.round((start + relative) * rate), cut = cutFrame / rate;
      const render = async mode => {
        const context = new globalThis.OfflineAudioContext(1, rate, rate), source = context.createConstantSource(), gain = context.createGain();
        source.offset.value = 1; source.connect(gain); gain.connect(context.destination);
        const voice = { start, attack, decay, sustain, peak: 0.8, release: 0.1, releaseAt: 2, end: 2.1, released: false, gain, oscillator: source, startMs: 100 };
        const host = { _voices: new Set([voice]), _observe() {}, _emitPlayback() {}, _destroyVoice() {} };
        scheduleNativeHeldEnvelope(voice); source.start(start); source.stop(2.1);
        const release = () => releaseNativeVoice.call(host, voice, cut);
        if (mode === 'ahead') release();
        const pause = mode === 'suspended' ? context.suspend((Math.max(128, Math.floor(cutFrame / 2 / 128) * 128) - 0.25) / rate) : null;
        const completed = context.startRendering();
        if (pause) { await pause; release(); await context.resume(); }
        return (await completed).getChannelData(0);
      };
      const baseline = await render('baseline'), ahead = await render('ahead'), suspended = await render('suspended');
      let prefixError = 0, schedulingError = 0, tailError = 0;
      for (let frame = 0; frame < rate; frame++) {
        if (frame < cutFrame) prefixError = Math.max(prefixError, Math.abs(ahead[frame] - baseline[frame]));
        schedulingError = Math.max(schedulingError, Math.abs(ahead[frame] - suspended[frame]));
        if (frame >= cutFrame) tailError = Math.max(tailError, Math.abs(ahead[frame] - baseline[cutFrame] * Math.max(0, 1 - (frame - cutFrame) / (rate * 0.1))));
      }
      output.push({ rate, attack, decay, sustain, relative, prefixError, schedulingError, tailError });
    }
    return output;
  });
  expect(results).toHaveLength(27);
  for (const result of results) {
    expect(result.prefixError, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.schedulingError, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.tailError, JSON.stringify(result)).toBeLessThan(0.000002);
  }
});
