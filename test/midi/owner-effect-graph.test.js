import { expect } from 'chai';
import { createOwnerEffectGraphHost } from '../../js/app/midi-ui/OwnerEffectGraphHost.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

const node = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
describe('owner effect transitions and producer lifetime (API doubles)', () => {
  it('caps active/tailing graphs and holds route/storage reservations until every producer acknowledges retirement', async () => {
    const resources = createAudioResourceLeases(), context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: node }, producers = [];
    const prepareGraph = async definition => {
      let release; const complete = new Promise(resolve => { release = resolve; }), scope = createProcgenRetirementScope(); producers.push(release);
      return { hash: definition.id, update: (nodeId, values) => ({ status: 'accepted', graphDefinitionHash: definition.id, nodeId, values, appliedFrame: null }), plan: { inputs: ['input'], outputs: ['output'], maximumTailFrames: 48000 }, diagnostics: () => ({ id: definition.id }),
        getInput: node, getOutput: node, confirmReady: async () => {}, checkPublication() {}, panic() {}, dispose: () => scope.retire([{ name: 'producer', run: () => complete }]) };
    };
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'owner-a', prepareGraph });
    await host.prepare({ id: 'first' }); const oldGesture = host.update('send', { gain01: 0.3 }); await host.prepare({ id: 'second' });
    expect(() => host.update('send', { gain01: 0 }, undefined, oldGesture)).to.throw('earlier owner route');
    expect(host.state()).to.include({ retiringGraphs: 1, maximumConcurrentGraphs: 2 });
    let error; try { await host.prepare({ id: 'third' }); } catch (value) { error = value; } expect(error.code).to.equal('effect-transition-capacity');
    const receipt = host.dispose(); await turn(); expect(receipt.outcome).to.equal('pending'); expect(resources.diagnostics().reservations).to.be.greaterThan(0);
    producers[0](); await turn(); expect(resources.diagnostics().reservations).to.be.greaterThan(0);
    producers[1](); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(resources.diagnostics().reservations).to.equal(0);
    await resources.dispose().completion;
  });
  it('preserves the committed graph when a candidate fails before activation', async () => {
    const resources = createAudioResourceLeases(), context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: node };
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'owner', prepareGraph: async definition => {
      if (definition.id === 'broken') throw new Error('missing processor');
      return { plan: { inputs: ['input'], outputs: ['output'], maximumTailFrames: 0 }, diagnostics: () => ({ id: definition.id }), getInput: node, getOutput: node, confirmReady: async () => {}, checkPublication() {}, panic() {},
        dispose: () => createProcgenRetirementScope().retire() };
    } });
    await host.prepare({ id: 'working' }); try { await host.prepare({ id: 'broken' }); } catch { /* Expected candidate failure. */ }
    expect(host.state().activeGraph.id).to.equal('working'); expect(host.state().mode).to.equal('active');
    await host.dispose().completion; expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
  it('activates candidate sources before replacing the committed graph and detaches them before tailing', async () => {
    const resources = createAudioResourceLeases(), context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: node }, events = [];
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'owner', prepareGraph: async definition => ({
      plan: { inputs: ['input'], outputs: ['output'], maximumTailFrames: 0 }, diagnostics: () => ({ id: definition.id }), getInput: node, getOutput: node, confirmReady: async () => {}, checkPublication() {}, panic() {},
      activateSidechains() { events.push('activate-' + definition.id); if (definition.id === 'invalid-source') throw new Error('foreign owner'); },
      deactivateSidechains() { events.push('detach-' + definition.id); }, dispose: () => createProcgenRetirementScope().retire() }) });
    await host.prepare({ id: 'old' });
    let error; try { await host.prepare({ id: 'invalid-source' }); } catch (caught) { error = caught; }
    expect(error.message).to.equal('foreign owner'); expect(host.state().activeGraph.id).to.equal('old'); expect(events).not.to.include('detach-old');
    await host.prepare({ id: 'new' }); expect(events.indexOf('activate-new')).to.be.lessThan(events.indexOf('detach-old'));
    await host.dispose().completion; expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });

});


describe('effect candidate publication fence', () => {
  for (const stage of ['ready', 'sidechain']) it('preserves the active graph when the staged graph faults at ' + stage, async () => {
    const resources = createAudioResourceLeases(), context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: node };
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'fault-owner',
      prepareGraph: async definition => {
        let fault = null;
        return { plan: { inputs: ['in'], outputs: ['out'], maximumTailFrames: 0 }, getInput: node, getOutput: node, diagnostics: () => ({ id: definition.id }), panic() {},
          async confirmReady() { if (definition.id === 'candidate' && stage === 'ready') throw new Error('staged processor fault'); },
          async activateSidechains() { if (definition.id === 'candidate' && stage === 'sidechain') fault = new Error('staged processor fault'); },
          checkPublication() { if (fault) throw fault; }, dispose: () => createProcgenRetirementScope().retire() };
      } });
    await host.prepare({ id: 'active' }); let caught;
    try { await host.prepare({ id: 'candidate' }); } catch (error) { caught = error; }
    expect(caught.message).to.equal('staged processor fault'); expect(host.state().activeGraph.id).to.equal('active');
    await host.dispose().completion; expect(resources.diagnostics().reservations).to.equal(0);
  });
});


describe('sidechain staging publication', () => {
  it('keeps candidate output silent across asynchronous source activation and gates old donors into their tail', async () => {
    const resources = createAudioResourceLeases(), gains = [], events = []; let resolveActivation;
    const gainNode = () => { let value = 1; const output = { gain: { setValueAtTime(next) { value = next; }, linearRampToValueAtTime(next) { value = next; }, cancelScheduledValues() {}, get value() { return value; } }, connect() {}, disconnect() {} }; gains.push(output); return output; };
    const context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: gainNode };
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'staged-donor-owner', prepareGraph: async definition => ({
      hash: definition.id, plan: { inputs: ['in'], outputs: ['out'], maximumTailFrames: 48000 }, diagnostics: () => ({ id: definition.id }), getInput: node, getOutput: node,
      confirmReady: async () => {}, checkPublication() {}, panic() {},
      activateSidechains(options) { events.push([definition.id, 'activate', options.silent]); if (definition.id === 'candidate') return new Promise(resolve => { resolveActivation = resolve; }); },
      gateSidechains(value, time, duration) { events.push([definition.id, 'gate', value, time, duration]); }, deactivateSidechains() { events.push([definition.id, 'detach']); },
      dispose: () => createProcgenRetirementScope().retire() }) });
    await host.prepare({ id: 'old' }); const preparation = host.prepare({ id: 'candidate' }); await turn();
    expect(host.state().activeGraph.id).to.equal('old'); expect(gains.at(-1).gain.value).to.equal(0); expect(events).to.deep.include(['candidate', 'activate', true]); expect(events.some(event => event[0] === 'candidate' && event[1] === 'gate' && event[2] === 1)).to.equal(false);
    resolveActivation(); await preparation;
    expect(gains.at(-1).gain.value).to.equal(1); expect(events).to.deep.include(['candidate', 'gate', 1, 0, 0.02]); expect(events).to.deep.include(['old', 'gate', 0, 0, 0.02]);
    expect(events).not.to.deep.include(['old', 'detach']); await host.dispose().completion; expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
});


describe('published effect lifetime', () => {
  it('survives completion of its preparation UI token and a later graph request', async () => {
    const resources = createAudioResourceLeases(), context = { sampleRate: 48000, currentTime: 0, state: 'running', createGain: node }, predicates = new Map(); let selected = 'first';
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'publication-lifetime', prepareGraph: async (definition, options) => {
      predicates.set(definition.id, options.isCurrent);
      const check = () => { if (!options.isCurrent()) throw new Error('stale graph lifetime'); };
      return { hash: definition.id, plan: { inputs: ['in'], outputs: ['out'], maximumTailFrames: 100 }, getInput: node, getOutput: node, diagnostics: () => ({ id: definition.id }), confirmReady: async () => {}, checkPublication: check,
        gateSidechains() { check(); }, activateSidechains: async () => {}, deactivateSidechains() {}, update() { check(); return { status: 'accepted' }; }, panic() {}, dispose: () => createProcgenRetirementScope().retire() };
    } });
    await host.prepare({ id: 'first' }, { isCurrent: () => selected === 'first' }); selected = null;
    expect(host.update('send', { gain01: 0.2 }).status).to.equal('accepted'); expect(predicates.get('first')()).to.equal(true);
    selected = 'second'; await host.prepare({ id: 'second' }, { isCurrent: () => selected === 'second' }); selected = null;
    expect(predicates.get('first')()).to.equal(true); expect(host.update('send', { gain01: 0.3 }).status).to.equal('accepted');
    await host.dispose().completion; expect(predicates.get('first')()).to.equal(false); await resources.dispose().completion;
  });
});
