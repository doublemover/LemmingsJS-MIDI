import { expect } from 'chai';
import {
  MIDI_FLAG_TRIGGER_BASE,
  MIDI_FLAG_TRIGGER_MAX,
  clampMidiFlagId,
  fromMidiFlagTriggerType,
  isMidiFlagTriggerType,
  toMidiFlagTriggerType
} from '../../js/midi/MidiFlagTriggers.js';

describe('MidiFlagTriggers', () => {
  it('clamps and validates midi flag ids', () => {
    expect(clampMidiFlagId(Number.NaN)).to.equal(null);
    expect(clampMidiFlagId(0)).to.equal(null);
    expect(clampMidiFlagId(2.9)).to.equal(2);
    expect(clampMidiFlagId(MIDI_FLAG_TRIGGER_MAX + 100)).to.equal(MIDI_FLAG_TRIGGER_MAX);
  });

  it('converts flag ids to trigger types and back', () => {
    expect(toMidiFlagTriggerType(7)).to.equal(MIDI_FLAG_TRIGGER_BASE + 7);
    expect(toMidiFlagTriggerType(0)).to.equal(null);
    expect(fromMidiFlagTriggerType(MIDI_FLAG_TRIGGER_BASE + 7)).to.equal(7);
    expect(fromMidiFlagTriggerType(MIDI_FLAG_TRIGGER_BASE)).to.equal(null);
  });

  it('detects midi flag trigger types', () => {
    const triggerType = toMidiFlagTriggerType(9);
    expect(isMidiFlagTriggerType(triggerType)).to.equal(true);
    expect(isMidiFlagTriggerType(3)).to.equal(false);
  });
});
