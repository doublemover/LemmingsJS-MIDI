import { expect } from 'chai';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

describe('MIDI ingress callback retirement and owned packet bytes', function() {
  for (const selected of [false, true]) for (const boundary of ['monitor', 'transport', 'record', 'learn'])
    it('stops after ' + boundary + ' disposes its ' + (selected ? 'selected' : 'null') + ' source', async () => {
      const calls = []; let ports, retirement;
      const observe = name => { calls.push(name); if (name === boundary) retirement = ports.dispose(); };
      ports = createProcgenMidiPorts({ now: () => 0, transport: { panic() {}, getState: () => ({ beat: 0, bpm: 120 }), receiveMidi() { observe('transport'); } },
        onMonitor: () => observe('monitor'), onRecord: () => observe('record'), onLearn: () => observe('learn') });
      if (selected) ports.setInput({ id: 'input', state: 'connected' });
      ports.configure({ recording: true }); ports.learnNext();
      expect(ports.receiveMidi([0x90, 60, 90], 0)).to.equal(false); await retirement.completion;
      const order = ['monitor', 'transport', 'record', 'learn']; expect(calls).to.deep.equal(order.slice(0, order.indexOf(boundary) + 1));
      expect(retirement.outcome).to.equal('complete'); expect(ports.getState().learning).to.equal(false);
      expect(ports.receiveMidi([0x90, 61, 90], 0)).to.equal(false); expect(calls).to.deep.equal(order.slice(0, order.indexOf(boundary) + 1));
    });
  it('shares the same receipt and closes admission during a reentrant cleanup callback', async () => {
    const budget = createResourceBudget(), attempts = [], reads = []; let ports, nested, panicCalls = 0;
    const closedPort = { get id() { reads.push('id'); return 'late'; } }, closedSpec = { get outputId() { reads.push('outputId'); return 'late'; } };
    ports = createProcgenMidiPorts({ now: () => 0, resourceBudget: budget, transport: { getState: () => ({ beat: 0, bpm: 120 }), receiveMidi() {},
      panic() {
        panicCalls++; nested = ports.dispose();
        attempts.push(ports.receiveMidi([0x90, 60, 90], 0), ports.recordEvent({ type: 'noteOn', note: 60 }), ports.recordOutput({ note: 60 }), ports.sendNote({ note: 60 }), ports.sendEvent({ type: 'noteOn', note: 60 }));
        ports.setInput(closedPort); ports.setNoteOutput(closedPort); ports.setNoteOutputs([closedPort]); ports.setActiveNoteOutputs([closedSpec]); ports.setClockOutput(closedPort);
        expect(ports.bindControllerBaseline(closedSpec).ok).to.equal(false); expect(ports.beginOwnedVoice(closedSpec).status).to.equal('rejected'); expect(ports.updateOwnedVoice(null, closedSpec).status).to.equal('rejected');
        ports.learnNext(() => { throw new Error('Retired Learn callback'); }); ports.configure({ recording: true }); ports.clearRecording();
        expect(() => ports.createRecordingExportSource()).to.throw('retired');
      } } });
    ports.configure({ recording: true }); const receipt = ports.dispose(); await receipt.completion;
    expect(nested).to.equal(receipt); expect(ports.dispose()).to.equal(receipt); expect(panicCalls).to.equal(1);
    expect(attempts).to.deep.equal([false, false, false, false, false]); expect(reads).to.deep.equal([]); expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  for (const typed of [false, true]) it('keeps one accepted packet when callbacks mutate its ' + (typed ? 'typed' : 'array') + ' caller buffer', async () => {
    const input = typed ? Uint8Array.of(0x90, 60, 90) : [0x90, 60, 90], seen = []; let immutable = false;
    const ports = createProcgenMidiPorts({ now: () => 1000, transport: { panic() {}, getState: () => ({ beat: 2, bpm: 120 }), receiveMidi(data) { seen.push([...data]); immutable = Object.isFrozen(data); } }, onMonitor() { input.fill(255); } });
    ports.configure({ recording: true }); expect(ports.receiveMidi(input, 1000)).to.equal(true);
    expect(seen).to.deep.equal([[0x90, 60, 90]]); expect(immutable).to.equal(true);
    expect(ports.getRecording().map(row => ({ source: row.source, data: row.data }))).to.deep.equal([{ source: 'input', data: [0x90, 60, 90] }]);
    await ports.dispose().completion;
  });
  it('keeps clock selection retired when a coordinated owner receives a late device choice', async () => {
    const coordinator = { state: () => ({}), register: () => ({ isCurrent: () => false, canRelease: () => false, acquire: async () => null,
      release: async () => true, dispose: async () => true, setDocumentIdentity() {} }) };
    const ports = createProcgenMidiPorts({ now: () => 0, performanceCoordinator: coordinator, transport: { pause() {}, getState: () => ({ beat: 0, bpm: 120 }) } });
    const retirement = ports.dispose(); await retirement.completion;
    ports.setClockOutput({ id: 'late-clock', state: 'connected' });
    expect(retirement.outcome).to.equal('complete'); expect(ports.getState().clockOutputId).to.equal(null);
  });
  for (const boundary of ['clear', 'transport']) for (const action of ['dispose', 'replace'])
    it('does not publish an old clock after ' + boundary + ' callbacks ' + action + ' its owner', async () => {
      const delivered = [], newer = { id: 'newer-clock' }; let ports, enabled = false, fired = false;
      const interrupt = () => { if (!enabled || fired) return; fired = true; if (action === 'dispose') ports.dispose(); else ports.setClockOutput(newer); };
      const prior = { id: 'prior-clock', clear() { if (boundary === 'clear') interrupt(); } };
      ports = createProcgenMidiPorts({ now: () => 0, performanceCoordinator: null, transport: { panic() {}, getState: () => ({ beat: 0, bpm: 120 }), setClockOutput(port) { delivered.push(port.id); if (boundary === 'transport') interrupt(); } } });
      ports.setClockOutput(prior); enabled = true; ports.setClockOutput({ id: 'obsolete-clock' });
      expect(fired).to.equal(true); expect(ports.getState().clockOutputId).to.equal(action === 'dispose' ? null : newer.id);
      if (boundary === 'clear') expect(delivered).not.to.include('obsolete-clock');
      const receipt = ports.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete');
    });
});
