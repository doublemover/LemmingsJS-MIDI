import { expect } from 'chai';
import { getMidiAutomationTargetInfo } from '../../js/app/midi-ui/midiAutomationTargetHelp.js';
import { applyMidiAutomationSpanValues } from '../../js/midi/midi-mapping/MidiAutomationSpanValues.js';
describe('truthful automation output targets', () => {
  it('labels controller and note-off behavior by backend without pretending to change synth envelopes', () => {
    expect(getMidiAutomationTargetInfo('timbre', 'synth').label).to.include('ignored by synth');
    expect(getMidiAutomationTargetInfo('timbre', 'midi').help).to.include('response depends on the device');
    expect(getMidiAutomationTargetInfo('timbre', 'synth', 7).help).to.include('channel volume');
    expect(getMidiAutomationTargetInfo('release', 'synth').help).to.include('ignores note-off velocity');
    expect(getMidiAutomationTargetInfo('release', 'midi').help).to.include('may respond');
    expect(getMidiAutomationTargetInfo('attack').label).to.equal('Attack strength');
    expect(getMidiAutomationTargetInfo('sustain').help).to.include('gate duration');
  });
  it('keeps legacy lowering as note-off strength, attack reduction and gate multiplier', () => {
    const spec = { note: 60, velocity: 80, releaseVelocity: 40, durationTicks: 4 };
    const result = applyMidiAutomationSpanValues(spec, new Map([['release', { value: 1.5 }], ['decay', { value: 1 }], ['sustain', { value: 2 }]]),
      { velocityRange: { min: 1, max: 127 }, durationTicks: { min: 1, max: 960 } });
    expect(result).to.include({ velocity: 60, releaseVelocity: 90, durationTicks: 8 }); expect(spec).to.include({ velocity: 80, releaseVelocity: 40, durationTicks: 4 });
    expect(result).not.to.have.property('releaseSeconds'); expect(result).not.to.have.property('attackSeconds');
  });
});
