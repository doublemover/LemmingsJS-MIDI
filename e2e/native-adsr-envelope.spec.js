import { test, expect } from '@playwright/test';

test('native ADSR releases preserve the preceding constant-source PCM at 44.1/48/96k (#1256) @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); await page.goto('/README.md');
  const results = await page.evaluate(async () => {
    const { scheduleNativeHeldEnvelope } = await import('/js/app/midi-ui/NativeAdsrEnvelope.js');
    const { releaseNativeVoice } = await import('/js/app/midi-ui/NativeVoiceLifetime.js');
    const output = [];
    for (const rate of [44100, 48000, 96000]) for (const [attack, decay, sustain, requested] of [
      [0.2, 0.25, 0.4, 0], [0.2, 0.25, 0.4, 0.05], [0.2, 0.25, 0.4, 0.2], [0.2, 0.25, 0.4, 0.3],
      [0.2, 0.25, 0.4, 0.45], [0.2, 0.25, 0.4, 0.6], [0, 0.25, 0.4, 0.1], [0.2, 0, 0.4, 0.2], [0, 0, 0, 0.1],
      [0.2, 0.25, 0.4, -0.05], [0.2, 0.25, 0.4, [0.4, 0.05, 0.2]], [0.2, 0.25, 0.4, [0.05, 0.05, 0.2]],
      [0, 0.25, 0.4, 0], [0.2, 0, 0, 0.1], [0, 0, 0.4, 0], [0, 0.25, 0, 0.1]
    ]) {
      const requests = Array.isArray(requested) ? requested : [requested], relative = Math.max(0, Math.min(...requests));
      const start = 0.1, cutFrame = Math.round((start + relative) * rate), cut = cutFrame / rate;
      const render = async mode => {
        const context = new globalThis.OfflineAudioContext(1, rate, rate), source = context.createConstantSource(), gain = context.createGain();
        source.offset.value = 1; source.connect(gain); gain.connect(context.destination);
        const voice = { start, attack, decay, sustain, peak: 0.8, release: 0.1, releaseAt: 2, end: 2.1, released: false, gain, oscillator: source, startMs: 100 };
        const host = { _voices: new Set([voice]), _observe() {}, _emitPlayback() {}, _destroyVoice() {} };
        scheduleNativeHeldEnvelope(voice); source.start(start); source.stop(2.1);
        const release = () => { for (const request of requests) releaseNativeVoice.call(host, voice, Math.round((start + request) * rate) / rate); };
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
      output.push({ rate, attack, decay, sustain, requests, relative, prefixError, schedulingError, tailError });
    }
    return output;
  });
  expect(results).toHaveLength(48);
  console.log('NATIVE_ADSR_PCM_RECEIPT ' + JSON.stringify(results));
  await testInfo.attach('native-adsr-pcm-receipt', { contentType: 'application/json', body: JSON.stringify(results, null, 2) });
  for (const result of results) {
    expect(result.prefixError, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.schedulingError, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.tailError, JSON.stringify(result)).toBeLessThan(0.000002);
  }
});

test('production native oscillator, default FM and modal sources keep prefix PCM, exact release frames and retired ownership @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); await page.goto('/README.md');
  const results = await page.evaluate(async () => {
    const { renderNativeOfflineGraph } = await import('/js/app/midi-ui/NativeOfflineDriver.js');
    const { CAUSAL_RENDER_SOURCES } = await import('/js/app/midi-ui/CausalTakeAudioRender.js');
    const { createAudioResourceLeases } = await import('/js/app/midi-ui/AudioResourceLeases.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const { createBackgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
    const results = [];
    for (const rate of [44100, 48000, 96000]) for (const engine of ['native-oscillator', 'native-fm', 'native-modal']) {
      const patch = structuredClone(CAUSAL_RENDER_SOURCES.find(source => source.id === engine).definition);
      if (engine === 'native-oscillator') patch.parameters.attackSeconds = 0.2;
      const startFrame = Math.round(rate * 0.1), cutFrame = Math.round(rate * (engine === 'native-fm' ? 0.25 : 0.15)), release = 0.04;
      const intent = { version: 1, kind: 'begin', voiceId: 'voice', generation: 1, onsetId: 'onset', intentId: 'intent',
        sourceEventIds: [], actorId: null, pitch: { cents: 6900, referenceHz: 440 }, velocity01: 0.8, expression: {} };
      const run = async mode => {
        const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission();
        const begin = { kind: 'begin', frame: startFrame, voiceId: 'voice', intent, releaseFrame: Math.round(rate * 0.7), releaseSeconds: release };
        const events = [begin];
        if (mode === 'suspended') for (let index = 0; index < 32; index++) events.push({ kind: 'update', frame: startFrame + (index + 1) * 32,
          voiceId: 'voice', expression: { pressure01: 1 } });
        if (mode !== 'baseline') events.push({ kind: 'end', frame: cutFrame, voiceId: 'voice', releaseSeconds: release });
        events.sort((a, b) => a.frame - b.frame);
        const rendered = await renderNativeOfflineGraph({ patch, events, frames: rate, sampleRate: rate }, { resources, resourceBudget: budget, admission });
        const pcm = rendered.buffer.getChannelData(0).slice(), receipt = rendered.receipt, held = resources.diagnostics();
        rendered.release(); const released = resources.diagnostics(), accounted = budget.diagnostics().accountedBytes;
        await resources.dispose().completion; admission.dispose();
        return { pcm, receipt, held, released, accounted };
      };
      const baseline = await run('baseline'), ahead = await run('ahead'), suspended = await run('suspended');
      const level = at => {
        const relative = at - startFrame / rate, { attackSeconds: attack, decaySeconds: decay, sustain01: sustain } = patch.parameters;
        return relative < 0 ? 0 : relative < attack ? relative / attack : relative < attack + decay ? 1 - (1 - sustain) * (relative - attack) / decay : sustain;
      };
      let prefixError = 0, schedulingError = 0, tailError = 0, afterEndPeak = 0, energy = 0;
      const endFrame = cutFrame + Math.round(release * rate), cutLevel = level(cutFrame / rate);
      for (let frame = 0; frame < rate; frame++) {
        if (frame < cutFrame) prefixError = Math.max(prefixError, Math.abs(ahead.pcm[frame] - baseline.pcm[frame]));
        schedulingError = Math.max(schedulingError, Math.abs(ahead.pcm[frame] - suspended.pcm[frame]));
        if (frame >= cutFrame && frame < endFrame) {
          const expected = baseline.pcm[frame] * cutLevel / level(frame / rate) * Math.max(0, 1 - (frame - cutFrame) / (rate * release));
          tailError = Math.max(tailError, Math.abs(ahead.pcm[frame] - expected));
        }
        if (frame > endFrame) afterEndPeak = Math.max(afterEndPeak, Math.abs(ahead.pcm[frame]));
        energy += ahead.pcm[frame] ** 2;
      }
      results.push({ rate, engine, attackSeconds: patch.parameters.attackSeconds, decaySeconds: patch.parameters.decaySeconds,
        startFrame, cutFrame, endFrame, prefixError, schedulingError, tailError, afterEndPeak, rms: Math.sqrt(energy / rate),
        suspendedBatches: suspended.receipt.batches, heldPcmBytes: ahead.held.exactBytes,
        retired: [baseline, ahead, suspended].every(run => run.released.exactBytes === 0 && run.released.estimatedBytes === 0 && run.accounted === 0) });
    }
    return results;
  });
  console.log('NATIVE_PRODUCTION_ADSR_PCM_RECEIPT ' + JSON.stringify(results));
  await testInfo.attach('native-production-adsr-pcm-receipt', { contentType: 'application/json', body: JSON.stringify(results, null, 2) });
  expect(results).toHaveLength(9);
  for (const result of results) {
    expect(result.prefixError, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.schedulingError, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.tailError, JSON.stringify(result)).toBeLessThan(0.00002);
    expect(result.afterEndPeak, JSON.stringify(result)).toBeLessThan(0.000002);
    expect(result.rms).toBeGreaterThan(0.001); expect(result.suspendedBatches).toBeGreaterThan(1); expect(result.retired).toBe(true);
    if (result.engine === 'native-fm') expect(result.decaySeconds).toBe(1.4);
  }
});

test('production sample release children retain PCM across earlier ends, rebuilds, chokes and forced attack/tail cleanup @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); await page.goto('/README.md');
  const results = await page.evaluate(async () => {
    const { renderNativeOfflineGraph } = await import('/js/app/midi-ui/NativeOfflineDriver.js');
    const { createAudioResourceLeases } = await import('/js/app/midi-ui/AudioResourceLeases.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const { createBackgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
    const { DECODER_VERSION } = await import('/js/app/midi-ui/AudioAssetRef.js');
    const { singleSampleMap } = await import('/test/helpers/sampleMap.js');
    const results = [];
    for (const rate of [44100, 48000, 96000]) {
      const hash = 'a'.repeat(64), frame = seconds => Math.round(seconds * rate);
      const run = async ({ child = false, delayed = false, start = 0.1, releaseAt = 0.2, releaseSeconds = 0.04, forcedAt = null, choke = false } = {}) => {
        const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission();
        const buffer = new globalThis.AudioBuffer({ numberOfChannels: 1, length: rate, sampleRate: rate }); buffer.getChannelData(0).fill(1);
        const ref = { contentHash: hash, kind: 'sample', bytes: rate * 4 + 44, frames: rate, sourceSampleRate: rate, channels: 1 }; let pins = 0;
        const makePin = () => { pins++; let active = true; return { ref, variant: { contentHash: hash, targetSampleRate: rate, decoderVersion: DECODER_VERSION },
          get buffer() { if (!active) throw new Error('Retired fixture PCM pin.'); return buffer; }, isActive: () => active,
          retain() { if (!active) throw new Error('Retired fixture PCM pin.'); return makePin(); }, release() { if (active) { active = false; pins--; } } }; };
        const pin = makePin(), map = singleSampleMap(hash, { frames: rate });
        if (child) map.zones[0].releaseRegion = { assetHash: hash, onsetFrame: 0, endFrame: frame(0.2), rootCents: 6000, gain01: 0.8, tuningCents: 0,
          pitchRange: { minCents: 5400, maxCents: 6600, maxTransposeCents: 600 } };
        const patch = { id: 'constant-pcm-fixture', revision: 1, engineId: 'native-sample', engineVersion: 1,
          parameters: { attackSeconds: 0.2, decaySeconds: 0.25, sustain01: 0.4, releaseSeconds: 0.04, gain01: 0.8 },
          mix: { gain01: 0.8, pan01: 0 }, voicePolicy: { maxVoices: 8, steal: 'reject' }, sampleRefs: [{ sha256: hash, bytes: ref.bytes, required: true }], sampleMap: map };
        const onset = (id, at, end, seconds) => ({ kind: 'begin', frame: frame(at), voiceId: id, releaseFrame: frame(end), releaseSeconds: seconds,
          intent: { version: 1, kind: 'begin', voiceId: id, generation: 1, onsetId: 'onset:' + id, intentId: 'intent:' + id,
            actorId: null, sourceEventIds: [], pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.8, expression: {} } });
        const events = [onset('a', start, 0.7, releaseSeconds)];
        if (delayed) for (let index = 0; index < 32; index++) events.push({ kind: 'update', frame: frame(start) + (index + 1) * 32,
          voiceId: 'a', expression: { pressure01: 1 } });
        events.push({ kind: 'end', frame: frame(releaseAt), voiceId: 'a', releaseSeconds });
        if (forcedAt != null) events.push({ kind: 'end', frame: frame(forcedAt), voiceId: 'a', releaseSeconds: 0.005, force: true });
        if (choke) events.push(onset('b', 0.3, 0.5, 0.04));
        events.sort((a, b) => a.frame - b.frame);
        const rendered = await renderNativeOfflineGraph({ patch, events, frames: rate, sampleRate: rate, assets: [pin] }, { resources, resourceBudget: budget, admission });
        const pcm = rendered.buffer.getChannelData(0).slice(), receipt = rendered.receipt;
        rendered.release(); pin.release(); const retired = resources.diagnostics(), accounted = budget.diagnostics().accountedBytes;
        await resources.dispose().completion; admission.dispose();
        return { pcm, receipt, retired: retired.exactBytes === 0 && retired.estimatedBytes === 0 && accounted === 0 && pins === 0 };
      };
      const main = await run(), child = await run({ child: true }), delayed = await run({ child: true, delayed: true });
      const mainChoked = await run({ releaseAt: 0.3, releaseSeconds: 0.005 }), next = await run({ child: true, start: 0.3, releaseAt: 0.5 });
      const choked = await run({ child: true, releaseAt: 0.4, choke: true });
      const forceAttackAt = frame(0.2025) / rate, forceTailAt = frame(0.3975) / rate;
      const attack = await run({ child: true, forcedAt: forceAttackAt }), tail = await run({ child: true, forcedAt: forceTailAt });
      const plateau = child.pcm[frame(0.25)], childStart = frame(0.2) / rate, childEnd = childStart + frame(0.2) / rate;
      let schedulingError = 0, childEnvelopeError = 0, chokeError = 0, forceAttackError = 0, forceTailError = 0, finalPeak = 0;
      for (let index = 0; index < rate; index++) {
        const time = index / rate, relative = time - childStart;
        const envelope = relative < 0 ? 0 : relative < 0.005 ? relative / 0.005 : time < childEnd - 0.005 ? 1 : Math.max(0, (childEnd - time) / 0.005);
        schedulingError = Math.max(schedulingError, Math.abs(child.pcm[index] - delayed.pcm[index]));
        childEnvelopeError = Math.max(childEnvelopeError, Math.abs(child.pcm[index] - main.pcm[index] - plateau * envelope));
        chokeError = Math.max(chokeError, Math.abs(choked.pcm[index] - mainChoked.pcm[index] - next.pcm[index]));
        const forced = at => time < at ? child.pcm[index] : child.pcm[frame(at)] * Math.max(0, (Math.min(childEnd, at + 0.005) - time) / (Math.min(childEnd, at + 0.005) - at));
        forceAttackError = Math.max(forceAttackError, Math.abs(attack.pcm[index] - forced(forceAttackAt)));
        forceTailError = Math.max(forceTailError, Math.abs(tail.pcm[index] - forced(forceTailAt)));
        if (time > 0.71) finalPeak = Math.max(finalPeak, Math.abs(choked.pcm[index]));
      }
      results.push({ rate, fixture: 'native constant AudioBuffer with explicit fixture pin; no decoder qualification', schedulingError, childEnvelopeError, chokeError,
        forceAttackError, forceTailError, finalPeak, childPlateau: plateau, suspendedBatches: delayed.receipt.batches,
        retired: [main, child, delayed, mainChoked, next, choked, attack, tail].every(result => result.retired) });
    }
    return results;
  });
  console.log('NATIVE_SAMPLE_ADSR_PCM_RECEIPT ' + JSON.stringify(results));
  await testInfo.attach('native-sample-adsr-pcm-receipt', { contentType: 'application/json', body: JSON.stringify(results, null, 2) });
  for (const result of results) {
    for (const field of ['schedulingError', 'childEnvelopeError', 'chokeError', 'forceAttackError', 'forceTailError', 'finalPeak'])
      expect(result[field], JSON.stringify(result)).toBeLessThan(0.00002);
    expect(result.childPlateau).toBeGreaterThan(0.001); expect(result.suspendedBatches).toBeGreaterThan(1); expect(result.retired).toBe(true);
  }
});
