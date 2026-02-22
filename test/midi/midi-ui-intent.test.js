import { expect } from 'chai';
import { createMidiIntentState, reduceMidiIntent } from '../../js/app/midi-ui/midiUiIntent.js';

describe('midiUiIntent', function () {
  it('merges and replaces overrides deterministically', function () {
    let state = createMidiIntentState({ overrides: { timing: { bpmBase: 120 } } });
    state = reduceMidiIntent(state, { type: 'overrides.merge', patch: { timing: { bpmBase: 90 } } });
    expect(state.overrides.timing.bpmBase).to.equal(90);
    state = reduceMidiIntent(state, { type: 'overrides.replace', overrides: { repeat: { enabled: true } } });
    expect(state.overrides).to.eql({ repeat: { enabled: true } });
  });

  it('tracks learn arm/capture/disarm flow', function () {
    let state = createMidiIntentState();
    state = reduceMidiIntent(state, { type: 'learn.arm', target: 'sfx:1:Note' });
    expect(state.learn.target).to.equal('sfx:1:Note');
    state = reduceMidiIntent(state, { type: 'learn.capture', value: 64 });
    expect(state.learn.lastCapture).to.equal(64);
    state = reduceMidiIntent(state, { type: 'learn.disarm' });
    expect(state.learn).to.equal(null);
  });

  it('rejects invalid intents and supports hard reset', function() {
    let state = createMidiIntentState({ overrides: { repeat: { enabled: true } } });
    const baselineRevision = state.revision;
    state = reduceMidiIntent(state, { type: 'overrides.merge', patch: null });
    expect(state.revision).to.equal(baselineRevision);
    state = reduceMidiIntent(state, { type: 'overrides.replace', overrides: [] });
    expect(state.revision).to.equal(baselineRevision);

    state = reduceMidiIntent(state, { type: 'learn.arm', target: '' });
    expect(state.learn).to.equal(null);
    state = reduceMidiIntent(state, { type: 'learn.capture', value: 999 });
    expect(state.learn).to.equal(null);

    state = reduceMidiIntent(state, { type: 'overrides.reset' });
    expect(state.overrides).to.eql({});
    expect(state.revision).to.equal(baselineRevision + 1);
  });
});
