import { expect } from 'chai';
import { admitMidiRepetition } from '../scripts/BenchmarkReceipt.js';
import { runMidiRouterBench, runMidiSchedulerBench } from '../scripts/bench-hotpaths/midiScenarios.js';

describe('MIDI fixed-work and rejection benchmark evidence', () => {
  for (const [source, run] of [['router', runMidiRouterBench], ['scheduler', runMidiSchedulerBench]]) {
    for (const workload of ['successful-fixed-work', 'saturated-rate-rejection']) {
      it(`retains complete per-repetition ${source} ${workload} evidence`, () => {
        const result = run({ iterations: 4, eventsPerIter: 3, notesPerIter: 3, repeats: 2, workload });
        expect(result.repetitions).to.have.length(2);
        for (const repetition of result.repetitions) {
          expect(admitMidiRepetition(repetition, { source, workload, attempts: 12 }).accepted).to.equal(true);
          expect(repetition.cpuElapsedMs).to.be.greaterThan(0);
          expect(repetition.submittedNoteOns).to.equal(workload === 'successful-fixed-work' ? 12 : 0);
        }
        expect(result.finalCleanup).to.deep.equal({ activeVoices: 0, pendingOnsets: 0, scheduledOffs: 0, timers: 0 });
        expect(result.warmup).not.to.equal(result.repetitions[0]);
      });
    }
  }

  it('rejects a successful row with zero actual submissions or missing terminal ownership', () => {
    const result = runMidiSchedulerBench({ iterations: 2, notesPerIter: 2, repeats: 1 });
    const receipt = result.repetitions[0], expected = { source: 'scheduler', workload: 'successful-fixed-work', attempts: 4 };
    for (const patch of [{ submittedNoteOns: 0 }, { submittedNoteOffs: 0 }, { activeVoices: 1 }, { admitted: 0 }, { clock: 'wall-clock' }]) {
      expect(admitMidiRepetition({ ...receipt, ...patch }, expected).accepted).to.equal(false);
    }
    expect(admitMidiRepetition({ ...receipt, attempted: 0, admitted: 0, submittedNoteOns: 0, submittedNoteOffs: 0 }, { ...expected, attempts: 0 }).accepted).to.equal(false);
  });
});
