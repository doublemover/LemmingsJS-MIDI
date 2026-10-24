import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const finite = (value, minimum, maximum) => Number.isFinite(value) && value >= minimum && value <= maximum;
export const fmIndexToDeviation = (index, modulatorHz) => {
  if (!finite(index, 0, 8) || !finite(modulatorHz, 0.1, 192000)) throw new RangeError('FM index and modulator frequency require declared dimensionless/Hz bounds.');
  return index * modulatorHz;
};

export function planNativeFmSource({ fundamentalHz, sampleRate, parameters, pitchOffsetCents = 0 } = {}) {
  if (!finite(fundamentalHz, 0.1, 40000) || !finite(sampleRate, 8000, 384000) || !parameters || ![0, 1].includes(parameters.dualPair) ||
      !finite(parameters.maxBendCents, 0, 1200) || !finite(pitchOffsetCents, -parameters.maxBendCents, parameters.maxBendCents) ||
      !finite(parameters.indexSeconds, 0.001, 4) || !finite(parameters.pitchSettleCents, -1200, 1200) || !finite(parameters.pitchSettleSeconds, 0.001, 1) ||
      !finite(parameters.secondaryMix01, 0, 1) || !parameters.dualPair && parameters.secondaryMix01 !== 0)
    throw new RangeError('The requested FM source exceeds its declared topology, bend or envelope profile.');
  const upperTranspose = 2 ** ((parameters.maxBendCents + Math.max(0, parameters.pitchSettleCents)) / 1200),
    lowerTranspose = 2 ** ((-parameters.maxBendCents + Math.min(0, parameters.pitchSettleCents)) / 1200), guardHz = sampleRate * 0.4;
  const pair = (carrierRatio, modulatorRatio, firstIndex, lastIndex, mix) => {
    if (!finite(carrierRatio, 0.125, 8) || !finite(modulatorRatio, 0.125, 12) || !finite(firstIndex, 0, 8) || !finite(lastIndex, 0, 8)) throw new RangeError('Invalid FM ratio or modulation-index envelope.');
    const carrierHz = fundamentalHz * carrierRatio, modulatorHz = fundamentalHz * modulatorRatio;
    if (carrierHz * upperTranspose >= guardHz || modulatorHz * upperTranspose >= guardHz || Math.min(carrierHz, modulatorHz) * lowerTranspose < 0.1)
      throw new RangeError('The requested FM ratios exceed the selected sample-rate register.');
    const indexLimit = Math.max(0, (guardHz - carrierHz * upperTranspose) / (modulatorHz * upperTranspose) - 1),
      indexStart = Math.min(firstIndex, indexLimit), indexEnd = Math.min(lastIndex, indexLimit);
    return Object.freeze({ carrierHz, modulatorHz, indexStart, indexEnd, indexLimit, requestedIndexStart: firstIndex, requestedIndexEnd: lastIndex,
      deviationStartHz: fmIndexToDeviation(indexStart, modulatorHz), deviationEndHz: fmIndexToDeviation(indexEnd, modulatorHz), mix01: mix,
      indexLimited: indexStart !== firstIndex || indexEnd !== lastIndex });
  };
  const pairs = [pair(parameters.carrierRatio, parameters.modulatorRatio, parameters.indexStart, parameters.indexEnd, parameters.dualPair ? 1 - parameters.secondaryMix01 : 1)];
  if (parameters.dualPair) pairs.push(pair(parameters.secondaryCarrierRatio, parameters.secondaryModulatorRatio, parameters.secondaryIndexStart, parameters.secondaryIndexEnd, parameters.secondaryMix01));
  return Object.freeze({ schema: 'lemmings-owned-native-fm/v1', fundamentalHz, sampleRate, pairs: Object.freeze(pairs),
    sourceCost: pairs.length * 2 + Number(parameters.pitchSettleCents !== 0), maxBendCents: parameters.maxBendCents,
    indexSeconds: parameters.indexSeconds, pitchSettleCents: parameters.pitchSettleCents, pitchSettleSeconds: parameters.pitchSettleSeconds,
    feedback: 'unsupported', quality: 'conservative-sideband-estimate-not-spectral-qualified', indexLimited: pairs.some(pair => pair.indexLimited) });
}

// Native nodes are allocated only by prepare(), after the caller owns a source lease.
export function createNativeFmSourceOwner(context, plan, start) {
  if (!context?.createOscillator || !context.createGain || !plan || plan.schema !== 'lemmings-owned-native-fm/v1' || !Number.isFinite(start) || start < 0)
    throw new TypeError('Invalid FM source owner.');
  const sources = [], nodes = [], pitched = [], retirement = createProcgenRetirementScope(); let output = null, primary = null, prepared = false, started = false, callback = null;
  const forEvery = (list, action) => {
    const failures = []; for (const entry of list) { try { action(entry); } catch (error) { failures.push(error); } }
    if (failures.length) throw new AggregateError(failures, 'An owned FM child operation could not be acknowledged.');
  };
  const detune = Object.freeze({
    setValueAtTime(value, at) { forEvery(pitched, source => source.detune.setValueAtTime(value, at)); return detune; },
    linearRampToValueAtTime(value, at) { forEvery(pitched, source => source.detune.linearRampToValueAtTime(value, at)); return detune; },
    cancelScheduledValues(at) { forEvery(pitched, source => source.detune.cancelScheduledValues(at)); return detune; },
    cancelAndHoldAtTime(at) { forEvery(pitched, source => { if (source.detune.cancelAndHoldAtTime) source.detune.cancelAndHoldAtTime(at); else source.detune.cancelScheduledValues(at); }); return detune; }
  });
  const facade = Object.freeze({ type: 'owned-fm', detune,
    frequency: Object.freeze({ setValueAtTime(value) { if (value !== plan.fundamentalHz) throw new Error('FM fundamental changes use the owned detune controls.'); } }),
    get onended() { return callback; }, set onended(value) { callback = value; if (primary) primary.onended = value; },
    prepare() {
      if (prepared) throw new Error('FM source preparation has already started.'); prepared = true;
      output = context.createGain(); nodes.push(output); output.gain.setValueAtTime(1, start);
      for (const pair of plan.pairs) {
        const carrier = context.createOscillator(); sources.push(carrier); pitched.push(carrier); if (!primary) primary = carrier;
        const modulator = context.createOscillator(); sources.push(modulator); pitched.push(modulator);
        const index = context.createGain(); nodes.push(index); const mix = context.createGain(); nodes.push(mix);
        carrier.type = modulator.type = 'sine'; carrier.frequency.setValueAtTime(pair.carrierHz, start); modulator.frequency.setValueAtTime(pair.modulatorHz, start);
        index.gain.setValueAtTime(pair.deviationStartHz, start); index.gain.linearRampToValueAtTime(pair.deviationEndHz, start + plan.indexSeconds);
        mix.gain.setValueAtTime(pair.mix01, start); modulator.connect(index); index.connect(carrier.frequency); carrier.connect(mix); mix.connect(output);
      }
      if (plan.pitchSettleCents !== 0) {
        if (typeof context.createConstantSource !== 'function') throw new Error('This FM pitch-settle recipe needs ConstantSourceNode support.');
        const settling = context.createConstantSource(); sources.push(settling);
        settling.offset.setValueAtTime(plan.pitchSettleCents, start); settling.offset.linearRampToValueAtTime(0, start + plan.pitchSettleSeconds);
        for (const source of pitched) settling.connect(source.detune);
      }
      primary.onended = callback; return facade;
    },
    connect(target) { if (!output) throw new Error('FM source is not prepared.'); return output.connect(target); },
    start(at) { if (!prepared || started || retirement.getReceipt()) throw new Error('FM source cannot start.'); started = true; forEvery(sources, source => source.start(at)); },
    stop(at) { forEvery(sources, source => { try { if (at == null) source.stop(); else source.stop(at); } catch (error) { if (error.name !== 'InvalidStateError') throw error; } }); },
    disconnect() {
      const receipt = retirement.retire([
        ...sources.map((source, index) => ({ name: 'fm-source-' + index, run: () => { source.onended = null; source.disconnect(); } })),
        ...nodes.map((node, index) => ({ name: 'fm-node-' + index, run: () => node.disconnect() }))
      ]);
      if (receipt.outcome !== 'complete') throw Object.assign(new Error('FM source disconnection remains unresolved.'), { retirement: receipt });
    }, diagnostics: () => Object.freeze({ prepared, started, sources: sources.length, sourceCost: plan.sourceCost, plan,
      retirement: retirement.getReceipt() ? Object.freeze({ state: retirement.getReceipt().state, outcome: retirement.getReceipt().outcome }) : null })
  }); return facade;
}
