import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { generateAcquisitionTrace, replayAcquisitionTrace } from './support/asset-acquisition-model.js';

describe('generated serial-reference asset acquisition schedules', function() {
  this.timeout(30000);
  for (const seed of [1, 2, 3, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff, 0x80000000, 0xffffffff])
    it('retains exact generations and ownership after every transition seed=' + seed, async () => {
      const trace = generateAcquisitionTrace(seed, { steps: 64 });
      try { const result = await replayAcquisitionTrace(trace); expect(result).to.include({ valid: true, complete: true, transitions: trace.length }); }
      catch (error) { error.message += '\nReplay: ' + JSON.stringify({ schema: 'asset-acquisition-model/v1', seed, trace: error.modelTrace }); throw error; }
    });
  it('separates clear/new request/old rejection from the accepted new generation', async () => {
    const trace = [
      { kind: 'load', id: 'old', url: 'a', mode: 'normal' }, { kind: 'clear' },
      { kind: 'load', id: 'new', url: 'a', mode: 'normal' }, { kind: 'respond', source: 2, status: 200 },
      { kind: 'respond', source: 1, status: 500 }, { kind: 'load', id: 'warm', url: 'a', mode: 'normal' },
      { kind: 'release', id: 'new' }, { kind: 'release', id: 'warm' }, { kind: 'dispose' }
    ];
    expect(await replayAcquisitionTrace(trace)).to.include({ valid: true, complete: true, sourceCount: 2 });
  });
  it('keeps old request epochs and pinned forks after newer cache publication and disposal', async () => {
    const trace = [
      { kind: 'load', id: 'old', url: 'a', mode: 'normal' }, { kind: 'clear' },
      { kind: 'load', id: 'new', url: 'a', mode: 'normal' }, { kind: 'respond', source: 2, status: 200 },
      { kind: 'respond', source: 1, status: 200 }, { kind: 'fork', id: 'old', reader: 'pinned' },
      { kind: 'transfer-copy', id: 'old' }, { kind: 'release', id: 'old' }, { kind: 'dispose' },
      { kind: 'release', id: 'new' }, { kind: 'release-reader', reader: 'pinned' }, { kind: 'dispose' }
    ];
    expect(await replayAcquisitionTrace(trace)).to.include({ valid: true, complete: true });
  });
  it('cancels only its consumer and keeps an acquired runtime alive until its own release', async () => {
    const trace = [
      { kind: 'borrow-runtime' }, { kind: 'load', id: 'cancel', url: 'a', mode: 'normal' },
      { kind: 'load', id: 'survive', url: 'a', mode: 'normal' }, { kind: 'cancel', id: 'cancel' },
      { kind: 'dispose' }, { kind: 'respond', source: 1, status: 200 },
      { kind: 'release-runtime' }, { kind: 'transfer-copy', id: 'survive' }, { kind: 'release', id: 'survive' }
    ];
    expect(await replayAcquisitionTrace(trace)).to.include({ valid: true, complete: true, sourceCount: 1 });
  });
  it('refuses empty and semantically invalid shrink candidates', async () => {
    expect(await replayAcquisitionTrace([])).to.include({ valid: false });
    expect(await replayAcquisitionTrace([{ kind: 'respond', source: 1, status: 200 }])).to.include({ valid: false });
  });
  it('replays the original request-epoch regression and its minimized prefix', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/asset-acquisition-request-epoch.json', import.meta.url)));
    expect(await replayAcquisitionTrace(fixture.trace)).to.include({ valid: true, complete: true });
    expect(await replayAcquisitionTrace(fixture.minimum)).to.include({ valid: true });
  });
});
