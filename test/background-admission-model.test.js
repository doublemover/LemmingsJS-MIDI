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
  for (const budget of ['shared', 'external']) for (const when of ['before', 'after']) for (const kind of ['resize-failure', 'release-failure']) for (const retained of [false, true]) {
    if (kind === 'resize-failure' && retained) continue;
    it('retains both full estimates after ' + kind + ' ' + when + ' ' + budget + ' from ' + (retained ? 'computed' : 'running'), async () => {
      const trace = [{ kind: 'acquire', id: 'owner', priority: 'interactive', inputBytes: 128, peak: 16384 },
        ...(retained ? [{ kind: 'finish', id: 'owner', retained: 4096 }] : []),
        { kind, id: 'owner', budget, when }, { kind: 'acquire', id: 'waiting', priority: 'recovery', inputBytes: 64, peak: 8192 },
        { kind: 'release', id: 'owner' }, { kind: 'advance', ms: 1500 }, { kind: 'confirm', id: 'owner' }, { kind: 'release', id: 'waiting' }, { kind: 'dispose' }];
      expect(await replayAdmissionTrace(trace, { maxWorkers: 1 })).to.include({ valid: true, jobs: 2 });
    });
  }
  for (const budget of ['shared', 'external']) for (const when of ['before', 'after']) it('keeps the worker slot charged after failed confirmation ' + when + ' ' + budget, async () => {
    const trace = [{ kind: 'acquire', id: 'owner', priority: 'interactive', inputBytes: 128, peak: 16384 }, { kind: 'unknown', id: 'owner' },
      { kind: 'acquire', id: 'waiting', priority: 'recovery', inputBytes: 64, peak: 8192 }, { kind: 'confirmation-failure', id: 'owner', budget, when },
      { kind: 'release', id: 'owner' }, { kind: 'advance', ms: 500 }, { kind: 'confirm', id: 'owner' }, { kind: 'release', id: 'waiting' }, { kind: 'dispose' }];
    expect(await replayAdmissionTrace(trace, { maxWorkers: 1 })).to.include({ valid: true, jobs: 2 });
  });
  it('refuses budget-failure commands without the relevant live owner or exact fault frontier', async () => {
    const acquire = { kind: 'acquire', id: 'owner', priority: 'interactive', inputBytes: 0, peak: 8192 };
    for (const suffix of [[{ kind: 'resize-failure', id: 'owner', budget: 'third', when: 'before' }], [{ kind: 'release-failure', id: 'missing', budget: 'shared', when: 'after' }],
      [{ kind: 'finish', id: 'owner', retained: 4096 }, { kind: 'resize-failure', id: 'owner', budget: 'shared', when: 'before' }]]) expect(await replayAdmissionTrace([acquire, ...suffix])).to.include({ valid: false });
  });
  it('shrinks a readable valid failure signature without accepting missing-owner traces', async () => {
    const trace = [{ kind: 'advance', ms: 30 }, { kind: 'acquire', id: 'a' }, { kind: 'advance', ms: 50 }, { kind: 'finish', id: 'a' }, { kind: 'dispose' }];
    const result = await shrinkAdmissionTrace(trace, async candidate => {
      const acquire = candidate.findIndex(command => command.kind === 'acquire'), finish = candidate.findIndex(command => command.kind === 'finish'); return acquire >= 0 && finish > acquire;
    });
    expect(result.trace).to.deep.equal([trace[1], trace[3]]); expect(result.attempts).to.be.greaterThan(0);
  });
});
