import { test, expect } from '@playwright/test';

test('native delayed self-FM changes actual PCM and retires with its parent source @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); await page.goto('/README.md');
  const results = await page.evaluate(async () => {
    const { planNativeFmSource, createNativeFmSourceOwner } = await import('/js/app/midi-ui/NativeFmSource.js');
    const { NATIVE_FM_PARAMETERS } = await import('/js/app/midi-ui/NativeInstrumentSchema.js');
    const defaults = Object.fromEntries(Object.entries(NATIVE_FM_PARAMETERS).map(([id, spec]) => [id, spec.default])), results = [];
    for (const rate of [44100, 48000, 96000]) for (const note of [36, 60, 84]) {
      const render = async (feedbackIndex, indexStart) => {
        const context = new globalThis.OfflineAudioContext(1, Math.round(rate * 0.5), rate);
        const plan = planNativeFmSource({ fundamentalHz: 440 * 2 ** ((note - 69) / 12), sampleRate: rate,
          parameters: { ...defaults, modulatorRatio: 1.414, indexStart, indexEnd: indexStart, feedbackIndex } });
        const source = createNativeFmSourceOwner(context, plan, 0); source.prepare(); source.connect(context.destination); source.start(0); source.stop(0.35);
        const data = new Float32Array((await context.startRendering()).getChannelData(0)); source.disconnect();
        return { data, plan, retired: source.diagnostics().retirement };
      };
      const dry = await render(0, 2), wet = await render(0.12, 2), neutral = await render(0.12, 0), pure = await render(0, 0);
      let peak = 0, difference = 0, neutralError = 0, tail = 0, finite = true;
      for (let frame = 0; frame < wet.data.length; frame++) {
        const value = wet.data[frame]; finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value));
        if (frame > rate * 0.05 && frame < rate * 0.3) difference += (value - dry.data[frame]) ** 2;
        neutralError = Math.max(neutralError, Math.abs(neutral.data[frame] - pure.data[frame]));
        if (frame > rate * 0.36) tail = Math.max(tail, Math.abs(value));
      }
      results.push({ rate, note, finite, peak, differenceRms: Math.sqrt(difference / (rate * 0.25)), neutralError, tail,
        feedback: wet.plan.feedback, retired: wet.retired.outcome });
    }
    return results;
  });
  await testInfo.attach('delayed-self-fm-pcm', { contentType: 'application/json', body: JSON.stringify(results, null, 2) });
  expect(results).toHaveLength(9);
  for (const result of results) {
    expect(result.finite, JSON.stringify(result)).toBe(true); expect(result.peak).toBeLessThanOrEqual(1.00001);
    expect(result.differenceRms).toBeGreaterThan(0.0001); expect(result.neutralError).toBeLessThan(0.000002);
    expect(result.tail).toBe(0); expect(result.retired).toBe('complete'); expect(result.feedback.delayFrames).toBe(128);
  }
});
