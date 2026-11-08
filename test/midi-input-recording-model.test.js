import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { generateInputRecordingTrace, replayInputRecordingTrace } from './support/midi-input-recording-model.js';

describe('generated input and recording callback ownership', function() {
  this.timeout(30000);
  for (const seed of [1, 2, 3, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff, 0x80000000, 0xffffffff])
    it('keeps recording prefixes, source epochs and callbacks aligned seed=' + seed, async () => {
      const trace = generateInputRecordingTrace(seed);
      try { expect(await replayInputRecordingTrace(trace)).to.include({ valid: true, complete: true, transitions: trace.length }); }
      catch (error) { error.message += '\nReplay: ' + JSON.stringify({ schema: 'midi-input-recording-model/v1', seed, trace: error.modelTrace }); throw error; }
    });
  it('replays the original null-source disposal and caller-byte alias regressions', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/midi-input-callback-ownership.json', import.meta.url)));
    for (const trace of fixture.traces) for (const commands of [trace.commands, trace.minimum]) expect(await replayInputRecordingTrace(commands)).to.include({ valid: true });
  });
  it('keeps a stopped prefix incomplete and immutable when its later input release arrives', async () => {
    expect(await replayInputRecordingTrace([
      { kind: 'arm' }, { kind: 'packet', data: [0x90, 60, 90] }, { kind: 'stop' },
      { kind: 'advance', ms: 10 }, { kind: 'packet', data: [0x80, 60, 17] }, { kind: 'dispose' }
    ])).to.include({ valid: true, complete: true });
  });
  it('distinguishes repeated source IDs by connection epoch and refuses queued old ingress', async () => {
    expect(await replayInputRecordingTrace([
      { kind: 'source', slot: 1 }, { kind: 'arm' }, { kind: 'packet', data: [0x90, 60, 90] },
      { kind: 'source', slot: 2 }, { kind: 'packet', data: [0x90, 61, 90], staleEpoch: true },
      { kind: 'packet', data: [0x90, 61, 90] }, { kind: 'clear' }, { kind: 'dispose' }
    ])).to.include({ valid: true, complete: true });
  });
  it('refuses empty or malformed replay commands even after retirement', async () => {
    for (const trace of [[], [{}], [{ kind: 'dispose' }, {}], [{ kind: 'dispose' }, { kind: 'packet' }]]) expect(await replayInputRecordingTrace(trace)).to.include({ valid: false });
  });
});
