import { expect } from 'chai';
import { createAudioIntervalAdmission, audioIntervalStorageBytes } from '../../js/app/midi-ui/AudioIntervalAdmission.js';
import { createAudioCommandQueue } from '../../js/app/midi-ui/AudioCommandQueue.js';

const voice = (start, end, renderCost = 1, workloadClass = 'live') => ({ start, end, releaseAt: end - 0.1, renderCost, workloadClass });

describe('bounded committed audio intervals', () => {
  it('detects a previously admitted future source anywhere inside a new interval', () => {
    const index = createAudioIntervalAdmission({ maxIntervals: 4 });
    const result = index.inspect({ voices: [voice(2, 10)], first: 1, last: 9, limit: 1, cost: 1, mode: 'gate' });
    expect(result).to.include({ accepted: false, peak: 2, reason: 'reserved-interval-capacity' });
    expect(index.storageBytes).to.equal(audioIntervalStorageBytes(4));
  });
  it('handles coincident releases before starts and gives permutation-independent peak accounting', () => {
    const index = createAudioIntervalAdmission({ maxIntervals: 8 }), records = [voice(0, 1), voice(1, 2), voice(2, 3)];
    for (const order of [records, [...records].reverse(), [records[1], records[2], records[0]]])
      expect(index.inspect({ voices: order, first: 0, last: 3, limit: 1 })).to.include({ accepted: true, peak: 1 });
    expect(index.inspect({ voices: records, first: 0, last: 3, cost: 1, limit: 1 })).to.include({ accepted: false, peak: 2 });
  });
  it('charges source layers and tails separately from semantic gates and cue workloads', () => {
    const index = createAudioIntervalAdmission({ maxIntervals: 4 }), source = voice(1, 5, 2); source.releaseAt = 2;
    expect(index.inspect({ voices: [source], first: 2, last: 4, cost: 1, limit: 1, mode: 'gate' }).accepted).to.equal(true);
    expect(index.inspect({ voices: [source], first: 2, last: 4, cost: 1, limit: 2 }).accepted).to.equal(false);
    expect(index.inspect({ voices: [source, voice(0, 5, 2, 'cue')], first: 2, last: 4, limit: 2, workload: 'live' }).peak).to.equal(2);
    expect(index.inspect({ voices: [source], first: 1, last: 4, limit: 1, semantic: true }).peak).to.equal(1);
  });
  it('does not reopen an ended semantic gate when a later choke shortens its remaining source tail', () => {
    const index = createAudioIntervalAdmission({ maxIntervals: 4 }), source = { ...voice(1, 5, 2), releaseAt: 3, semanticRelease: { at: 2 } };
    expect(index.inspect({ voices: [source], first: 2.1, last: 2.9, cost: 1, limit: 1, mode: 'gate' }).accepted).to.equal(true);
    expect(index.inspect({ voices: [source], first: 2.1, last: 2.9, cost: 1, limit: 2 }).accepted).to.equal(false);
    expect(index.inspect({ voices: [source], first: 2.1, last: 2.9, cost: 1, limit: 1, mode: 'gate',
      overrides: new Map([[source, { end: 6, releaseAt: 5 }]]) }).accepted).to.equal(true);
  });
  it('preflights extension replacements without changing committed voice records', () => {
    const index = createAudioIntervalAdmission({ maxIntervals: 4 }), held = voice(0, 2), future = voice(3, 6), records = [held, future];
    const result = index.inspect({ voices: records, first: 1, last: 7, limit: 1, mode: 'gate',
      overrides: new Map([[held, { end: 7, releaseAt: 6.9 }]]) });
    expect(result).to.include({ accepted: false, peak: 2 }); expect(held).to.include({ end: 2, releaseAt: 1.9 });
    expect(index.inspect({ voices: records, first: 1, last: 7, limit: 1, mode: 'gate' }).accepted).to.equal(true);
  });
  it('refuses unknown records and excessive interval inventories within fixed storage', () => {
    const index = createAudioIntervalAdmission({ maxIntervals: 1 });
    expect(index.inspect({ voices: [{ start: 0 }], first: 0, last: 1, limit: 1 }).reason).to.equal('unknown-source-interval');
    expect(index.inspect({ voices: [voice(0, 2), voice(0, 3)], first: 0, last: 1, limit: 1 }).reason).to.equal('interval-index-capacity');
  });
});

describe('atomic owned audio command batches', () => {
  const command = (sequence, frame = 0) => ({ opcode: 6, sequence, frame });
  it('preserves terminal space and changes no queue entries on a rejected lease batch', () => {
    const queue = createAudioCommandQueue({ capacity: 4, terminalReserve: 1 }); queue.enqueue(command(1), 0);
    expect(queue.enqueueMany([command(2), command(3), command(4)], 0).status).to.equal('rejected');
    expect(queue.diagnostics()).to.include({ queued: 1, accepted: 1 });
    expect(queue.enqueueMany([command(2), command(3)], 0).status).to.equal('accepted');
    expect(queue.enqueue({ ...command(4), opcode: 3 }, 0).status).to.equal('accepted'); expect(queue.diagnostics().queued).to.equal(4);
  });
  it('validates the complete batch before commit and preserves frame/sequence order', () => {
    const queue = createAudioCommandQueue({ capacity: 8, terminalReserve: 1 });
    expect(queue.enqueueMany([command(1), command(2, NaN)], 0).status).to.equal('rejected'); expect(queue.diagnostics().queued).to.equal(0);
    queue.enqueueMany([command(3, 2), command(2, 1), command(1, 1)], 0);
    expect(queue.drainThrough(10).map(item => item.sequence)).to.deep.equal([1, 2, 3]);
  });
});
