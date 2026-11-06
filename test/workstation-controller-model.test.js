import { expect } from 'chai';
import { generateControllerTrace, replayControllerTrace } from './support/workstation-controller-model.js';

describe('coupled document, history, save and transport controller reference', function() {
  this.timeout(30000);
  for (const seed of [1, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff]) it('preserves document/history/transport owners across mixed actions seed=' + seed, async () => {
    const result = await replayControllerTrace(generateControllerTrace(seed, { steps: 48 })); expect(result).to.include({ valid: true, complete: true });
  });
  it('preserves a newer paused document and its history when a prior save acknowledges late', async () => {
    const trace = [{ kind: 'gain', value: 0.5 }, { kind: 'play' }, { kind: 'save', id: 'old', name: 'Older project' }, { kind: 'new', seed: 91 }, { kind: 'pause' }, { kind: 'gain', value: 0.75 },
      { kind: 'settle-save', id: 'old', outcome: 'success' }, { kind: 'undo' }, { kind: 'redo' }, { kind: 'save', id: 'current', name: 'Current project' }, { kind: 'gain', value: 0.875 },
      { kind: 'settle-save', id: 'current', outcome: 'success' }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, documents: 2, generations: 1 });
  });
  it('retains a failed replacement’s current history and adopts fresh identity before optional presentation fails', async () => {
    const trace = [{ kind: 'gain', value: 0.25 }, { kind: 'save', id: 'named', name: 'Named source' }, { kind: 'settle-save', id: 'named', outcome: 'success' },
      { kind: 'gain', value: 0.5 }, { kind: 'new-refused', seed: 91 }, { kind: 'undo' }, { kind: 'redo' }, { kind: 'new-presentation-error', seed: 92 }, { kind: 'gain', value: 0.75 }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, generations: 1 });
  });
  it('settles old native writes after disposal without republishing the document or resuming transport', async () => {
    const trace = [{ kind: 'play' }, { kind: 'save', id: 'retired', name: 'Retired save' }, { kind: 'dispose' }, { kind: 'settle-save', id: 'retired', outcome: 'success' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, documents: 1 });
  });
  it('rejects deleted-owner and unchanged-gain traces during minimization', async () => {
    expect(await replayControllerTrace([{ kind: 'settle-save', id: 'missing', outcome: 'success' }])).to.include({ valid: false });
    expect(await replayControllerTrace([{ kind: 'gain', value: 1 }])).to.include({ valid: false });
  });
});
