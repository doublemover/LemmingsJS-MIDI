import { expect } from 'chai';
import { createTimedControlTimeline } from '../../js/app/midi-ui/TimedControlTimeline.js';

describe('bounded timed controller state', () => {
  it('resolves distinct timestamps independently of delivery order and preserves equal-time sequence', () => {
    const run = reversed => {
      const timeline = createTimedControlTimeline();
      const events = [{ time: 3, kind: 'volume', value: 0.5 }, { time: 2, kind: 'expression', value: 0.5 }];
      for (const event of reversed ? events.reverse() : events) timeline.insert(event.time, event.kind, event.value);
      return [timeline.at(2).volume * timeline.at(2).expression, timeline.at(3).volume * timeline.at(3).expression];
    };
    expect(run(false)).to.deep.equal([0.5, 0.25]);
    expect(run(true)).to.deep.equal(run(false));
    const timeline = createTimedControlTimeline();
    timeline.insert(4, 'program', 12); timeline.insert(4, 'program', 38);
    expect(timeline.at(4).program).to.equal(38);
  });

  it('retains only the elapsed baseline and rejects excess future commands', () => {
    const timeline = createTimedControlTimeline({ maxEvents: 2 });
    timeline.insert(1, 'bend', 0.25); timeline.insert(3, 'bend', 0.5);
    expect(timeline.insert(4, 'bend', 1)).to.equal(null);
    timeline.retainFrom(2);
    expect(timeline.at(2).bend).to.equal(0.25);
    expect(timeline.insert(4, 'bend', 1)).not.to.equal(null);
    expect(() => timeline.at(1)).to.throw('outside retained');
    expect(timeline.at(4).bend).to.equal(1);
    timeline.clear(); expect(timeline.at(0).bend).to.equal(0);
  });
});
