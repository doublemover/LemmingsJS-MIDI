import assert from 'node:assert/strict';
import { OwnedSpectrumSource, OwnedSpectrumKernel } from '../../js/app/midi-ui/worklet/OwnedSpectrumProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { SPECTRUM_LAYOUT, SPECTRUM_DRAWBAR_BITS } from '../../js/app/midi-ui/OwnedSourceLayout.js';
import { ownedSourceStateBytes, writeOwnedSourceState, restoreOwnedSourceState } from '../../js/app/midi-ui/worklet/OwnedSourceState.js';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';

const profile = getOwnedSourceProfile('worklet-spectrum');
const identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 4 };
const parameters = extra => ({ ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), ...extra });
const onset = (values, slot = 0) => { const row = new Float64Array(profile.width); row.set([0, 0, slot + 1, 1, slot, slot + 1, 440, 0.5, 1, 0, 0, 0, 1, 200, 0, 0, 48000, 0]); for (const [field, value] of Object.entries(profile.beginFields(values, 1234))) row[Number(field)] = value; return row; };
const render = (kernel, count, start) => { const left = new Float32Array(count), right = new Float32Array(count); kernel.render(left, right, start); return { left, right }; };

describe('retained spectrum color and independent drawbars', () => {
  it('reserves polynomial harmonic headroom and restores the actual resonant integrators', () => {
    for (const rate of [44100, 48000, 96000]) {
      const values = parameters({ resonance01: 0.64, drive01: 0.28 }), a = new OwnedSpectrumSource(rate, 1, fixedSourceBank('spectrum-v1')), b = new OwnedSpectrumSource(rate, 1, fixedSourceBank('spectrum-v1'));
      assert.equal(a.begin(0, 440, onset(values), 0), 1);
      for (let frame = 0; frame < 257; frame++) assert.ok(Number.isFinite(a.sample(0, 440, frame)));
      a.writeDisplay(0, 0); assert.ok(a.displayData[4] * 3 <= rate * 0.4); assert.ok(a.state[41] !== 0 || a.state[42] !== 0);
      b.state.set(a.state); b.partials.set(a.partials); b.drawbars.set(a.drawbars); b.rehydrateState(new Uint8Array([1]));
      for (let frame = 257; frame < 1024; frame++) assert.equal(a.sample(0, 440, frame), b.sample(0, 440, frame));
    }
  });
  it('changes only one same-pitch voice and keeps the reserved authored gain independent', () => {
    const values = parameters({ sourceMode: 1 }), a = new OwnedSpectrumKernel(48000, 2, fixedSourceBank('spectrum-v1'));
    const rows = new Float64Array(profile.width * 2); rows.set(onset(values)); rows.set(onset(values, 1), profile.width); a.accept(rows, 2, 1); render(a, 128, 0);
    const update = new Float64Array(profile.width); update.set([0, 128, 3, 2, 0, 1]); update[14] = 800; update[15] = SPECTRUM_DRAWBAR_BITS[15] | 65536; update[7] = 0.25; update[56] = 0.7;
    a.accept(update, 1, 2); render(a, 128, 128);
    assert.equal(a.source.drawbars[15], 0.7); assert.equal(a.source.drawbars[31], values.partial15Gain); assert.ok(a.gainControl[1] > 0);
    assert.equal(a.voice[15], 0); assert.equal(a.voice[28 + 15], 0); assert.equal(a.active[0], 1); assert.equal(a.active[1], 1);
    assert.ok(a.source.partials[15 * 6 + 1] > values.partial15Gain && a.source.partials[15 * 6 + 1] < 0.7);
    const bytes = new Uint8Array(ownedSourceStateBytes(a)); writeOwnedSourceState(a, bytes, identity); const b = new OwnedSpectrumKernel(48000, 2, fixedSourceBank('spectrum-v1')); restoreOwnedSourceState(b, bytes, identity);
    assert.deepEqual(b.source.drawbars, a.source.drawbars); assert.deepEqual(render(a, 1024, 256), render(b, 1024, 256)); assert.equal(a.source.state[16], 0); assert.equal(a.source.partials[15 * 6 + 1], 0.7);
  });
  it('refuses unimplemented color and inactive drawbars before publishing a control', () => {
    assert.equal(profile.acceptsParameters(parameters({ sourceMode: 2, resonance01: 0.1 })), false);
    assert.equal(profile.acceptsParameters(parameters({ sourceMode: 2, drive01: 0.1 })), false);
    for (const sourceMode of [0, 2]) assert.equal(profile.writeUpdate({ partial0Gain: 0.5 }, { sourceValues: parameters({ sourceMode }) }, {}), null);
    assert.equal(profile.writeUpdate({ partial15Gain: 0.5 }, { sourceValues: parameters({ sourceMode: 1, partialCount: 8 }) }, {}), null);
    assert.equal(SPECTRUM_DRAWBAR_BITS.some(bit => bit & 65536), false); assert.equal(SPECTRUM_LAYOUT.width, profile.width);
  });
});
