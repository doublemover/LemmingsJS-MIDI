import assert from 'node:assert/strict';
import { OwnedPluckSource } from '../../js/app/midi-ui/worklet/OwnedPluckProcessor.js';
import { OwnedSpectrumSource } from '../../js/app/midi-ui/worklet/OwnedSpectrumProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';

const command = (id, extra = {}) => { const profile = getOwnedSourceProfile(id), values = { ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), ...extra }, result = new Float64Array(profile.width); for (const [field, value] of Object.entries(profile.beginFields(values, 1234))) result[Number(field)] = value; return result; };
describe('effective source inspection without DSP changes', () => {
  it('retains actual pluck excitation and loss values while leaving subsequent samples identical', () => {
    const a = new OwnedPluckSource(48000, 1), b = new OwnedPluckSource(48000, 1), input = command('worklet-pluck', { pluckPosition01: 0.31, excitationBrightness01: 0.62 });
    assert.equal(a.begin(0, 440, input, 0), 1); assert.equal(b.begin(0, 440, input, 0), 1);
    for (let frame = 0; frame < 256; frame++) assert.equal(a.sample(0, 440), b.sample(0, 440));
    const before = a.state.slice(); for (let count = 0; count < 20; count++) a.writeDisplay(0, 0); assert.deepEqual(a.state, before);
    assert.equal(a.displayData[0], 0.31); assert.equal(a.displayData[1], 0.62); assert.equal(a.displayData[2], a.state[3]); assert.equal(a.displayData[4], a.state[9]);
    for (let frame = 0; frame < 512; frame++) assert.equal(a.sample(0, 440), b.sample(0, 440));
  });
  for (const sourceMode of [0, 1, 2]) it('reports current spectrum mode/support without advancing phase in mode ' + sourceMode, () => {
    const a = new OwnedSpectrumSource(48000, 1, fixedSourceBank('spectrum-v1')), b = new OwnedSpectrumSource(48000, 1, fixedSourceBank('spectrum-v1')), input = command('worklet-spectrum', { sourceMode });
    assert.equal(a.begin(0, 440, input, 0), 1); assert.equal(b.begin(0, 440, input, 0), 1);
    for (let frame = 0; frame < 256; frame++) assert.equal(a.sample(0, 440, frame), b.sample(0, 440, frame));
    const state = a.state.slice(), partials = a.partials.slice(); for (let count = 0; count < 20; count++) a.writeDisplay(0, 0);
    assert.deepEqual(a.state, state); assert.deepEqual(a.partials, partials); assert.equal(a.displayData[0], sourceMode); assert.ok(a.displayData.slice(0, 6).every(Number.isFinite));
    assert.ok(a.displayData[2] >= 0 && a.displayData[2] <= 16); assert.ok(a.displayData[3] >= 0 && a.displayData[4] <= 48000 * 0.4); assert.equal(a.displayData[1], sourceMode === 2 ? a.circular[0].state[0] : a.state[8] * 15);
    for (let frame = 256; frame < 768; frame++) assert.equal(a.sample(0, 440, frame), b.sample(0, 440, frame));
  });
});
