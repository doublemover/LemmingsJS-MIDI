import { expect } from 'chai';
import { createAudioObservationLeases } from '../../js/app/midi-ui/AudioObservationLeases.js';

const recorder = () => {
  const records = [];
  return { records, record(stage, fields) { records.push({ stage, ...fields }); return records.length; } };
};

describe('Audio observation leases', () => {
  it('keeps owner contexts and recipients immutable across replacement and late callbacks', () => {
    const observers = createAudioObservationLeases(), a = recorder(), b = recorder(), mix = recorder();
    let document = 'A';
    const detachA = observers.attach(a, () => ({ projectId: document }), 'owner-a');
    const detachB = observers.attach(b, { projectId: 'B' }, 'owner-b');
    observers.attach(mix, { aggregate: true });
    const oldVoice = observers.stamp({ voiceId: 'same', generation: 1 }, 'owner-a');
    document = 'next'; detachB();
    observers.emit('scheduled', oldVoice);
    expect(a.records).to.have.length(1);
    expect(a.records[0]).to.include({ projectId: 'A', owner: 'owner-a', observationScope: 'owner', acousticReceipt: false });
    expect(b.records).to.have.length(0);
    expect(mix.records[0]).to.include({ aggregate: true, owner: 'owner-a', observationScope: 'mix' });
    detachA();
    const replacement = recorder(); observers.attach(replacement, { projectId: 'new' }, 'owner-a');
    observers.emit('late-end', oldVoice);
    expect(a.records).to.have.length(1); expect(replacement.records).to.have.length(0);
    expect(mix.records).to.have.length(2);
  });

  it('deduplicates an explicitly shared observer and bounds its context projection', () => {
    const observers = createAudioObservationLeases({ maxLeases: 2 }), shared = recorder();
    observers.attach(shared, { scaleDegrees: Array.from({ length: 40 }, (_, i) => i), nested: { pitch: 1 } }, 'a');
    observers.attach(shared, {});
    expect(() => observers.attach(recorder(), {})).to.throw(RangeError);
    observers.emit('scheduled', observers.stamp({}, 'a'));
    expect(shared.records).to.have.length(1);
    expect(shared.records[0].scaleDegrees).to.have.length(32);
    expect(shared.records[0]).not.to.have.property('nested');
    expect(shared.records[0].contextProjection).to.include({ omittedFieldCount: 1, canonicalJournal: false });
    expect(shared.records[0].contextProjection.truncatedFields).to.deep.equal(['scaleDegrees']);
    expect(shared.records[0].contextProjection.omittedFields).to.deep.equal(['nested']);
    expect(observers.diagnostics()).to.include({ leases: 2, canonicalJournal: false, contextProjection: 'bounded-scalars-and-arrays' });
    observers.clear(); expect(observers.enabled()).to.equal(false);
  });
});
