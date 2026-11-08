import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export const modalAmplitudeAt = (seconds, modeT60Seconds) => {
  if (!finite(seconds, 0, 1000000) || !finite(modeT60Seconds, 0.0002, 4)) throw new RangeError('Modal amplitude requires seconds and positive T60 seconds.');
  return Math.exp(-Math.log(1000) * seconds / modeT60Seconds);
};

export function planNativeModalSource({ fundamentalHz, sampleRate, parameters, pitchOffsetCents = 0 } = {}) {
  if (!finite(fundamentalHz, 0.1, 40000) || !finite(sampleRate, 8000, 384000) || !parameters || !Number.isInteger(parameters.modeCount) || !finite(parameters.modeCount, 4, 8) ||
      !finite(parameters.bodyT60Seconds, 0.02, 2.5) || !finite(parameters.strikePosition01, 0, 1) || !finite(parameters.maxBendCents, 0, 1200) ||
      !finite(parameters.bodySizeRatio, 0.5, 2) ||
      !finite(pitchOffsetCents, -parameters.maxBendCents, parameters.maxBendCents)) throw new RangeError('Modal body exceeds its onset, decay or bend profile.');
  const upperTranspose = 2 ** (parameters.maxBendCents / 1200), guardHz = sampleRate * 0.4, modes = [], omittedModes = []; let gainSum = 0, longestT60 = 0;
  for (let index = 0; index < parameters.modeCount; index++) {
    const ratio = parameters['mode' + index + 'Ratio'], t60Scale = parameters['mode' + index + 'T60Scale'],
      first = parameters['mode' + index + 'GainA'], second = parameters['mode' + index + 'GainB'];
    if (!finite(ratio, 0.125, 16) || !finite(t60Scale, 0.01, 1) || !finite(first, 0, 1) || !finite(second, 0, 1)) throw new RangeError('Invalid authored modal frequency, gain or T60 scale.');
    const frequencyHz = fundamentalHz * ratio / parameters.bodySizeRatio, topHz = frequencyHz * upperTranspose,
      taper = Math.max(0, Math.min(1, (guardHz - topHz) / (guardHz * 0.1))), gain = (first + (second - first) * parameters.strikePosition01) * taper;
    if (topHz >= guardHz || gain < 1e-8) { omittedModes.push(Object.freeze({ index, reason: topHz >= guardHz ? 'above-register' : 'inaudible-authored-gain' })); continue; }
    const modeT60Seconds = parameters.bodyT60Seconds * t60Scale;
    modes.push({ index, frequencyHz, gain01: gain, modeT60Seconds, tapered: taper < 1 }); gainSum += gain; longestT60 = Math.max(longestT60, modeT60Seconds);
  }
  if (!modes.length || !Number.isFinite(gainSum) || gainSum <= 0) throw new RangeError('No audible modal body remains in the declared register.');
  // Fixed per-onset L1 normalization bounds the sum without sample-wise AGC.
  for (const mode of modes) { mode.gain01 /= Math.max(1, gainSum); Object.freeze(mode); }
  return Object.freeze({ schema: 'lemmings-owned-native-modal/v1', fundamentalHz, sampleRate, modes: Object.freeze(modes), omittedModes: Object.freeze(omittedModes),
    sourceCost: modes.length, maxBendCents: parameters.maxBendCents, longestT60Seconds: longestT60,
    oneShotHoldSeconds: Math.min(4, Math.max(0.04, longestT60 * 1.5)), quality: 'native-sine-bank-register-taper-not-render-qualified',
    excitation: 'authored-damped-sine-impulse-response', strikeMap: 'interpolated-authored-site-gains-not-geometric-pickup', normalization: 'fixed-onset-L1',
    decayFloor: 'mode-gain-times-1e-6-after-two-T60-until-owned-release' });
}

export function createNativeModalSourceOwner(context, plan, start) {
  if (!context?.createOscillator || !context.createGain || plan?.schema !== 'lemmings-owned-native-modal/v1' || !finite(start, 0, Number.MAX_SAFE_INTEGER)) throw new TypeError('Invalid modal source owner.');
  const sources = [], gains = [], retirement = createProcgenRetirementScope(); let output = null, prepared = false, started = false, callback = null;
  const each = (entries, operation) => { const errors = []; for (const entry of entries) try { operation(entry); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'An owned modal child operation is unresolved.'); };
  const detune = Object.freeze({
    setValueAtTime(value, at) { each(sources, source => source.detune.setValueAtTime(value, at)); return detune; },
    linearRampToValueAtTime(value, at) { each(sources, source => source.detune.linearRampToValueAtTime(value, at)); return detune; },
    cancelScheduledValues(at) { each(sources, source => source.detune.cancelScheduledValues(at)); return detune; },
    cancelAndHoldAtTime(at) { each(sources, source => source.detune.cancelAndHoldAtTime ? source.detune.cancelAndHoldAtTime(at) : source.detune.cancelScheduledValues(at)); return detune; }
  });
  const facade = Object.freeze({ type: 'owned-modal', detune,
    frequency: Object.freeze({ setValueAtTime(value) { if (value !== plan.fundamentalHz) throw new Error('Modal pitch changes use owned detune controls.'); } }),
    get onended() { return callback; }, set onended(value) { callback = value; if (sources[0]) sources[0].onended = value; },
    prepare() {
      if (prepared || retirement.getReceipt()) throw new Error('Modal preparation already started.'); prepared = true;
      output = context.createGain(); gains.push(output); output.gain.setValueAtTime(1, start);
      for (const mode of plan.modes) {
        const source = context.createOscillator(); sources.push(source); const envelope = context.createGain(); gains.push(envelope);
        source.type = 'sine'; source.frequency.setValueAtTime(mode.frequencyHz, start);
        envelope.gain.setValueAtTime(mode.gain01, start);
        envelope.gain.exponentialRampToValueAtTime(mode.gain01 * 0.000001, start + mode.modeT60Seconds * 2);
        source.connect(envelope); envelope.connect(output);
      }
      sources[0].onended = callback; return facade;
    },
    connect(target) { if (!output) throw new Error('Modal source is not prepared.'); return output.connect(target); },
    start(at) { if (!prepared || started || retirement.getReceipt()) throw new Error('Modal source cannot start.'); started = true; each(sources, source => source.start(at)); },
    stop(at) { each(sources, source => { try { if (at == null) source.stop(); else source.stop(at); } catch (error) { if (error.name !== 'InvalidStateError') throw error; } }); },
    disconnect() {
      const receipt = retirement.retire([...sources.map((source, index) => ({ name: 'modal-source-' + index, run: () => { source.onended = null; source.disconnect(); } })),
        ...gains.map((gain, index) => ({ name: 'modal-gain-' + index, run: () => gain.disconnect() }))]);
      if (receipt.outcome !== 'complete') throw Object.assign(new Error('Modal source retirement remains unresolved.'), { retirement: receipt });
    },
    diagnostics: () => Object.freeze({ prepared, started, sources: sources.length, sourceCost: plan.sourceCost,
      retirement: retirement.getReceipt() ? Object.freeze({ state: retirement.getReceipt().state, outcome: retirement.getReceipt().outcome }) : null })
  }); return facade;
}
