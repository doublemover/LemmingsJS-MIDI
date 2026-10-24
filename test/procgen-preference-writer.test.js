import { expect } from 'chai';
import { createProcgenPreferenceWriter } from '../js/app/procgen/workstation/ProcgenPreferenceWriter.js';

describe('coalesced preference encoding ownership', () => {
  it('retains one active and only the latest pending authored revision', async () => {
    const jobs = [], writes = [], states = []; let generation = 1;
    const writer = createProcgenPreferenceWriter({ key: 'project', getGeneration: () => generation,
      storage: { setItem: (key, value) => writes.push(value) }, onState: value => states.push(value),
      jobs: { compute: request => new Promise(resolve => jobs.push(async () => resolve({ value: JSON.stringify(await request.prepareInput()), release() { request.releasePreparedInput(); } }))) } });
    const value = note => ({ project: { procgen: { lanes: [{ note }] } } });
    writer.request(value(1), 1); writer.request(value(2), 2); writer.request(value(3), 3);
    expect(jobs).to.have.length(1); await jobs.shift()(); await Promise.resolve(); await Promise.resolve();
    expect(jobs).to.have.length(1); await jobs.shift()(); await writer.dispose();
    expect(writes.map(text => JSON.parse(text).project.procgen.lanes[0].note)).to.deep.equal([1, 3]);
    expect(states.at(-1).durableRevision).to.equal(3); generation++;
  });
  it('does not publish an encoded source after a document replacement', async () => {
    let complete, generation = 1, writes = 0;
    const writer = createProcgenPreferenceWriter({ key: 'project', getGeneration: () => generation, storage: { setItem() { writes++; } },
      jobs: { compute: () => new Promise(resolve => { complete = () => resolve({ value: '{}', release() {} }); }) } });
    writer.request({ project: { procgen: { lanes: [] } } }, 0); generation++; complete(); await writer.dispose();
    expect(writes).to.equal(0);
  });
});
