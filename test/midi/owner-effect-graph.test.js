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
