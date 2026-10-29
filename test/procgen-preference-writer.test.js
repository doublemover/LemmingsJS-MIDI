import { expect } from 'chai';
import { createProcgenPreferenceWriter } from '../js/app/procgen/workstation/ProcgenPreferenceWriter.js';
import { sealMidiProjectSnapshot } from '../js/midi/project/MidiProjectSnapshot.js';

describe('coalesced preference encoding ownership', () => {
  it('commits detached authored metadata and shares only verified project branches through the paged store', async () => {
    const commits = [], writes = []; let finish;
    const project = sealMidiProjectSnapshot({ procgen: { lanes: [{ note: 60 }] } });
    const writer = createProcgenPreferenceWriter({ getGeneration: () => 1, storage: { setItem() { writes.push(true); } },
      authoredStorage: { async savePreferences(value, options) { commits.push({ value, options }); await new Promise(resolve => { finish = resolve; }); return { durable: true, retirement: { state: 'partial', failures: ['release refused'] } }; }, getPreferenceDiagnostics: () => ({ encodedPages: 1 }) } });
    const source = { version: 1, project, ui: { tab: 'Lane' } }; writer.request(source, 4); source.ui.tab = 'changed';
    expect(commits[0].value.project).to.equal(project); expect(commits[0].value.ui.tab).to.equal('Lane'); finish(); await writer.dispose();
    expect(writes).to.deep.equal([]); expect(writer.state().durableRevision).to.equal(4); expect(writer.state().retirement.state).to.equal('partial');
    expect(writer.state().storage).to.deep.equal({ encodedPages: 1 });
  });
  it('refuses unacknowledged authored commits and forwards document retirement cancellation', async () => {
    let request; const writer = createProcgenPreferenceWriter({ getGeneration: () => 1,
      authoredStorage: { async savePreferences(_value, options) { request = options; return { durable: false }; } } });
    writer.request({ project: { procgen: { lanes: [] } } }, 0); await new Promise(resolve => setTimeout(resolve, 0));
    expect(writer.state().lastError.message).to.include('not acknowledged'); expect(writer.state().durableRevision).to.equal(-1);
    writer.request({ project: { procgen: { lanes: [] } } }, 1); await writer.dispose({ flush: false }); expect(request.signal.aborted).to.equal(true);
  });
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
  it('reports failed admission without a durable claim and clears the failure on successful retry', async () => {
    let fail = true; const writer = createProcgenPreferenceWriter({ key: 'project', getGeneration: () => 1, storage: { setItem() {} },
      jobs: { async compute() { if (fail) throw Object.assign(new Error('Input exceeds its admitted footprint'), { code: 'snapshot-transport' }); return { value: '{}', release() {} }; } } });
    writer.request({ project: { procgen: { lanes: [] } } }, 2); await Promise.resolve(); await Promise.resolve();
    expect(writer.state()).to.include({ requestedRevision: 2, durableRevision: -1, pendingRevision: null }); expect(writer.state().lastError.code).to.equal('snapshot-transport');
    fail = false; writer.request({ project: { procgen: { lanes: [] } } }, 3); await writer.dispose();
    expect(writer.state()).to.include({ requestedRevision: 3, durableRevision: 3, lastError: null });
  });
  it('keeps generation-local durability and refuses absent storage', async () => {
    let generation = 1; const jobs = { async compute() { return { value: '{}', release() {} }; } };
    const writer = createProcgenPreferenceWriter({ key: 'project', getGeneration: () => generation, storage: { setItem() {} }, jobs });
    writer.request({ project: { procgen: { lanes: [] } } }, 7); await Promise.resolve(); await Promise.resolve();
    expect(writer.state().durableRevision).to.equal(7); generation++; expect(writer.state()).to.include({ requestedRevision: null, durableRevision: -1, lastError: null }); await writer.dispose();
    const missing = createProcgenPreferenceWriter({ key: 'project', getGeneration: () => 1, jobs }); missing.request({ project: { procgen: { lanes: [] } } }, 1); await missing.dispose();
    expect(missing.state().durableRevision).to.equal(-1); expect(missing.state().lastError.message).to.include('storage is unavailable');
  });
  it('does not expose a retired pending revision or late failure in the current document', async () => {
    let generation = 1, reject; const states = [];
    const writer = createProcgenPreferenceWriter({ key: 'project', getGeneration: () => generation, onState: state => states.push(state),
      jobs: { compute: () => new Promise((_resolve, fail) => { reject = fail; }) } });
    writer.request({ project: { procgen: { lanes: [] } } }, 9); generation++;
    expect(writer.state()).to.include({ pendingRevision: null, requestedRevision: null, durableRevision: -1 });
    reject(new Error('Retired worker failed')); await writer.dispose(); expect(writer.state().lastError).to.equal(null);
    expect(states.map(state => state.state)).to.deep.equal(['saving']);
  });
});
