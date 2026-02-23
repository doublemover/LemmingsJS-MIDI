import { expect } from 'chai';
import { createMidiLearnController } from '../js/app/midi-ui/midiUiLearn.js';

describe('midiUiLearn controller', function () {
  it('arms learn mode and captures a note once', function () {
    const intents = [];
    let captureHandler = null;
    const state = { learn: { target: null } };
    const controller = createMidiLearnController({
      runMidiIntent(intent) {
        intents.push(intent);
        if (intent.type === 'learn.arm') state.learn.target = intent.target;
        if (intent.type === 'learn.disarm') state.learn.target = null;
      },
      setNoteCapture(handler) {
        captureHandler = handler;
      },
      getIntentState() {
        return state;
      }
    });

    const captured = [];
    expect(controller.armMidiLearn('target.note', (value) => {
      captured.push(value);
      return true;
    })).to.equal(true);

    expect(typeof captureHandler).to.equal('function');
    expect(captureHandler({ note: 64 })).to.equal(true);
    expect(captured).to.deep.equal([{ note: 64 }]);
    expect(intents).to.deep.include.members([
      { type: 'learn.arm', target: 'target.note' },
      { type: 'learn.capture', value: { note: 64 } },
      { type: 'learn.disarm', target: 'target.note' }
    ]);
    expect(captureHandler).to.equal(null);
  });

  it('keeps learn mode armed when capture handler declines value', function () {
    let captureHandler = null;
    const state = { learn: { target: null } };
    const controller = createMidiLearnController({
      runMidiIntent(intent) {
        if (intent.type === 'learn.arm') state.learn.target = intent.target;
      },
      setNoteCapture(handler) {
        captureHandler = handler;
      },
      getIntentState() {
        return state;
      }
    });

    controller.armMidiLearn('target.note', () => false);
    expect(captureHandler({ note: 10 })).to.equal(false);
    expect(typeof captureHandler).to.equal('function');
    expect(state.learn.target).to.equal('target.note');
  });

  it('rejects disarm requests for a mismatched target', function () {
    const state = { learn: { target: 'active.target' } };
    const controller = createMidiLearnController({
      getIntentState() {
        return state;
      }
    });

    expect(controller.disarmMidiLearn('other.target')).to.equal(false);
    expect(controller.disarmMidiLearn('active.target')).to.equal(true);
  });
});
