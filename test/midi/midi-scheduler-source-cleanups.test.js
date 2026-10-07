import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';

const makeScheduler = () => new MidiScheduler({ mpe: { enabled: false }, limits: { maxEventsPerSecond: 1000, maxBytesPerSecond: 100000 } });
const entry = (timeMs, count = 1) => ({ timeMs, count, bytes: count * 3, sfxId: 'spawn', priority: 2, trackId: 'lead', outputId: 'local', voiceBudget: 4 });

describe('MIDI rate-accounting work removal', () => {
  it('matches detailed totals across exact rolling-window boundaries without building share maps', () => {
    for (const now of [0, 1, 999, 1000, 1001, 1999, 2000, 4000]) {
      const scheduler = makeScheduler();
      scheduler._rateSent = [-2000, -1000, -1, 0, 1].map(time => entry(time, 2));
      scheduler._ratePlanned = [-2000, -1, 0, 999, 1000, 1001, 2000, 5000].map(time => entry(time, 3));
      const detailed = scheduler.getRateSnapshot(now), totals = scheduler.getRateSnapshot(now, false);
      for (const period of ['past', 'next']) {
        expect(totals[period].count).to.equal(detailed[period].count);
        expect(totals[period].bytes).to.equal(detailed[period].bytes);
        expect(totals[period].bySfx).to.equal(null); expect(totals[period].byTrack).to.equal(null); expect(totals[period].byOutput).to.equal(null);
        expect(detailed[period].bySfx).to.be.instanceOf(Map);
      }
    }
  });

  it('uses the totals-only path for send-rate checks but keeps public detailed snapshots', () => {
    const scheduler = makeScheduler(), sum = scheduler._sumRate.bind(scheduler), modes = [];
    scheduler._sumRate = (...args) => { modes.push(args[3]); return sum(...args); };
    scheduler._checkByteRate(1000); expect(modes).to.deep.equal([false, false]);
    modes.length = 0; scheduler.getRateSnapshot(1000); expect(modes).to.deep.equal([true, true]);
  });

  it('prunes once for a synchronous reservation while retaining metadata, limits and shares', () => {
    const scheduler = makeScheduler(), prune = scheduler._pruneRateEntries.bind(scheduler);
    let prunes = 0;
    scheduler._pruneRateEntries = now => { prunes++; prune(now); };
    scheduler._rateSent = [entry(-1000), entry(500, 2)];
    scheduler._ratePlanned = [entry(-1000), entry(900), entry(1500)];
    const meta = { sfxId: 'build', priority: 3, trackId: 'brass', outputId: 'device', voiceBudget: 5 };
    const result = scheduler.reserve({ entries: [entry(-1), entry(0), entry(999), entry(1000), entry(1999), entry(2000)] }, meta, 1000);
    expect(result.ok).to.equal(true); expect(prunes).to.equal(1);
    const snapshot = scheduler.getRateSnapshot(1000);
    expect(snapshot.past.count).to.equal(5); expect(snapshot.next.count).to.equal(3);
    expect(snapshot.past.byTrack.get('brass')).to.include({ count: 2, bytes: 6, priority: 3, voiceBudget: 5 });
    expect(snapshot.next.byOutput.get('device')).to.include({ count: 2, bytes: 6, priority: 3, voiceBudget: 5 });
    expect([...scheduler._rateSent, ...scheduler._ratePlanned].every(row => row.timeMs >= 0)).to.equal(true);
    const rejected = scheduler.canSchedule({ on: entry(1100) }, 1000, { maxMessagesPerSecond: 8 });
    expect(rejected.ok).to.equal(false); expect(rejected.reason).to.equal('count-limit');
    expect(scheduler.getUsageShare('next', 1000).find(share => share.sfxId === 'build').priority).to.equal(3);
  });

  it('still prunes separately reserved evaluations and standalone records at their own times', () => {
    const scheduler = makeScheduler(), plan = { on: entry(1100), off: entry(2100) };
    const evaluation = scheduler.canSchedule(plan, 1000);
    scheduler._rateSent.push(entry(-1000)); scheduler._ratePlanned.push(entry(500));
    const reserved = scheduler.reserveEvaluation(evaluation, plan, { sfxId: 'exit', priority: 4 }, 2000);
    expect(reserved.ok).to.equal(true); expect(scheduler._rateSent.some(row => row.timeMs < 1000)).to.equal(false);
    const before = scheduler._rateSent.length + scheduler._ratePlanned.length;
    scheduler.reserveEvaluation(reserved, plan, {}, 2000);
    expect(scheduler._rateSent.length + scheduler._ratePlanned.length).to.equal(before);
    scheduler._recordPlanned(entry(3000), 3000);
    expect(scheduler._rateSent.every(row => row.timeMs >= 2000)).to.equal(true);
    expect(scheduler._ratePlanned).to.deep.equal([entry(3000)]);
  });
});
