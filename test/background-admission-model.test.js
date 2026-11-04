import { expect } from 'chai';
import fs from 'node:fs/promises';
import { generateAdmissionTrace, replayAdmissionTrace, shrinkAdmissionTrace } from './support/background-admission-model.js';

describe('generated serial-reference background ownership schedules', function() {
  this.timeout(30000);
  for (const seed of [1, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff]) for (const maxWorkers of [1, 2]) it(`preserves every owner after each transition seed=${seed} workers=${maxWorkers}`, async () => {
    const trace = generateAdmissionTrace(seed, { steps: 128, maxWorkers });
    try { expect(await replayAdmissionTrace(trace, { maxWorkers })).to.include({ valid: true, transitions: 129 }); }
    catch (error) { error.message += '\nReplay: ' + JSON.stringify({ seed, maxWorkers, trace: error.modelTrace }); throw error; }
  });
  for (const budget of ['shared', 'external']) for (const when of ['before', 'after']) for (const interrupt of ['abort', 'release', 'unknown', 'dispose']) it(`fences ${interrupt} ${when} ${budget} result resizing`, async () => {
    const { trace } = JSON.parse(await fs.readFile(new URL('./fixtures/background-admission-resize-cancel.json', import.meta.url)));
    trace[1] = { ...trace[1], budget, when, interrupt }; expect(await replayAdmissionTrace(trace, { maxWorkers: 1 })).to.include({ valid: true });
  });
  it('shrinks a readable valid failure signature without accepting missing-owner traces', async () => {
    const trace = [{ kind: 'advance', ms: 30 }, { kind: 'acquire', id: 'a' }, { kind: 'advance', ms: 50 }, { kind: 'finish', id: 'a' }, { kind: 'dispose' }];
    const result = await shrinkAdmissionTrace(trace, async candidate => {
      const acquire = candidate.findIndex(command => command.kind === 'acquire'), finish = candidate.findIndex(command => command.kind === 'finish'); return acquire >= 0 && finish > acquire;
    });
    expect(result.trace).to.deep.equal([trace[1], trace[3]]); expect(result.attempts).to.be.greaterThan(0);
  });
});
