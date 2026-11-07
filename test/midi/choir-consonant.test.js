import assert from 'node:assert/strict';
import { OwnedChoirSource } from '../../js/app/midi-ui/worklet/OwnedChoirProcessor.js';
import { CHOIR_LAYOUT, choirSourceBytes } from '../../js/app/midi-ui/OwnedSourceLayout.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';

const profile = getOwnedSourceProfile('worklet-choir'), parameters = { ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), breath01: 0.12 };
const command = (amount, milliseconds, seed = 1234) => { const result = new Float64Array(profile.width); for (const [field, value] of Object.entries(profile.beginFields({ ...parameters, consonant01: amount, consonantMilliseconds: milliseconds }, seed))) result[Number(field)] = value; return result; };
const source = rate => new OwnedChoirSource(rate, 1, fixedSourceBank('choir-v1'));

describe('finite actor-owned choir consonant onset', () => {
  for (const rate of [44100, 48000, 96000]) it('owns exactly the declared onset countdown and preserves zero-amount output at ' + rate, () => {
    const a = source(rate), b = source(rate), onset = source(rate), frames = Math.round(rate * 0.025);
    assert.equal(a.begin(0, 440, command(0, 5)), 1); assert.equal(b.begin(0, 440, command(0, 80)), 1); assert.equal(onset.begin(0, 440, command(0.6, 25)), 1);
    assert.equal(onset.state[38], frames); let differs = false;
    for (let frame = 0; frame < frames + 32; frame++) { const dry = a.sample(0, 440); assert.equal(b.sample(0, 440), dry); const wet = onset.sample(0, 440); differs ||= wet !== dry; }
    assert.equal(onset.state[38], 0); assert.equal(differs, true); assert.equal(onset.state[2], a.state[2]);
    assert.equal(onset.begin(0, 440, command(0.5, 0)), 0);
  });
  it('continues the actual finite source state during its consonant without rerolling noise', () => {
    const a = source(48000), b = source(48000); a.begin(0, 440, command(0.7, 40)); b.begin(0, 440, command(0.7, 40));
    for (let frame = 0; frame < 333; frame++) a.sample(0, 440);
    b.state.set(a.state); b.bands.set(a.bands); assert.equal(b.state[38], 1920 - 333);
    for (let frame = 0; frame < 2400; frame++) assert.equal(b.sample(0, 440), a.sample(0, 440));
  });
  it('reports applied formants separately from filter-state activity and accounts for model buffers', () => {
    const a = source(48000); a.begin(0, 440, command(0.4, 20)); for (let frame = 0; frame < 128; frame++) a.sample(0, 440); a.writeDisplay(0, 0);
    for (let band = 0; band < 3; band++) { assert.equal(a.displayData[band], a.bands[band * 8 + 6]); assert.ok(Number.isFinite(a.displayData[band + 3]) && a.displayData[band + 3] >= 0); }
    assert.equal(a.displayData.length, CHOIR_LAYOUT.displayVoices * CHOIR_LAYOUT.displayWidth);
    assert.ok(choirSourceBytes(48000, 1) >= a.state.byteLength + a.bands.byteLength + a.displayData.byteLength * 2 + a.table.byteLength);
  });
});
