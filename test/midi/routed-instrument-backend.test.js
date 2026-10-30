import { expect } from 'chai';
import { createRoutedInstrumentBackend } from '../../js/app/midi-ui/RoutedInstrumentBackend.js';
import { createInstrumentExecutionLifecycle } from '../../js/app/midi-ui/InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

describe('voice-owned lane instrument replacement', () => {
  const context = {};
  const renderer = () => {
    const voices = new Map(), calls = [], routeCalls = [], observers = new Set(); let disposed = false;
    const key = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
    const backend = createInstrumentExecutionLifecycle({ capabilities: {},
      setDisplayContext() {},
      observeDisplaySamples(listener, options) { const observer = { listener, options }; observers.add(observer); return () => observers.delete(observer); },
      begin(intent, frame, epoch) { calls.push(['begin', intent.voiceId]); voices.set(key(epoch, intent.voiceId), { voiceId: intent.voiceId, epoch }); return { status: 'accepted' }; },
      updateLaneMix(voiceId, mix, frame, epoch, laneId) { calls.push(['mix', voiceId, mix.gain, mix.pan]); routeCalls.push({ voiceId, frame, laneId }); return { status: 'accepted', targetFrame: frame }; },
      update(voiceId) { calls.push(['update', voiceId]); return { status: 'accepted' }; },
      end(voiceId) { calls.push(['end', voiceId]); return { status: 'accepted' }; },
      renewExecutionLease: () => ({ status: 'accepted' }),
      cancelGenerationWithReceipt(generation, epoch) { for (const [id, voice] of voices) if (voice.epoch === epoch) voices.delete(id); return { status: 'accepted', count: 0 }; },
      renderDiagnostics: () => ({ voices: voices.size }),
      dispose() { return createProcgenRetirementScope().retire([{ name: 'native', run: () => { disposed = true; voices.clear(); } }]); }
    }, { getContext: () => context, getGeneration: () => 0, isSettled: epoch => ![...voices.values()].some(voice => voice.epoch === epoch),
      isVoiceSettled: (voiceId, epoch) => !voices.has(key(epoch, voiceId)), forget: () => {} }).api;
    return { backend, calls, routeCalls, get disposed() { return disposed; }, emitDisplay() { for (const observer of observers) observer.listener({ ...observer.options.identity, actorId: 7 }); },
      finish(voiceId) { for (const [id, voice] of voices) if (voice.voiceId === voiceId) voices.delete(id); } };
  };
  const root = (backend, options = {}) => createRoutedInstrumentBackend({ defaultBackend: backend, getContext: () => context, getGeneration: () => 0, ...options });
  const onset = voiceId => ({ generation: 1, voiceId, laneId: 'lane-1' });
  it('accepts only an explicitly resolved current shared topology body and preserves its scheduled excitation evidence', async () => {
    const fallback = renderer(), receipts = []; let selected = null;
    const router = root(fallback.backend, { resolveSharedTopologyBody: () => selected, onTopologyBody: value => receipts.push(value) }), execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'shared-body' }).execution;
    const source = { ...onset('shared'), intentId: 'shared-source', sourceEventIds: ['actual-wall'], topologyBinding: { bodyId: 'original.clay', boundTopologyRevision: 7, dampingMacroId: null } };
    try { expect(router.backend.begin(source, 100, execution).reason).to.equal('topology-body-or-macro-unavailable'); selected = { bodyId: 'original.clay', bodyRevision: 1, boundTopologyRevision: 7, ownerRouteRevision: 2, graphDefinitionHash: 'a'.repeat(64), bodyIdentityHash: 'b'.repeat(64) };
      expect(router.backend.begin(source, 101, execution).status).to.equal('accepted'); expect(receipts[0].topologyBody).to.deep.equal(selected); expect(receipts[0].sourceEventIds).to.deep.equal(['actual-wall']); expect(receipts[0].targetFrame).to.equal(101); expect(source.topologyBinding.bodyId).to.equal('original.clay');
      selected = { ...selected, boundTopologyRevision: 8 }; expect(router.backend.begin({ ...source, voiceId: 'stale' }, 102, execution).reason).to.equal('topology-body-or-macro-unavailable');
      selected = { ...selected, boundTopologyRevision: 7 }; expect(router.backend.begin({ ...source, voiceId: 'macro', topologyBinding: { ...source.topologyBinding, dampingMacroId: 'unimplemented' } }, 102, execution).reason).to.equal('topology-body-or-macro-unavailable');
    } finally { const retired = router.dispose(); await retired.completion; }
  });
  it('rolls back a candidate synchronously while each held voice keeps its original renderer', async () => {
    const fallback = renderer(), old = renderer(), candidate = renderer(), router = root(fallback.backend);
    router.assign('lane-1', 'old', old.backend); const previous = router.retainAssignment('lane-1');
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'preview' }).execution;
    router.backend.begin(onset('old-held'), 100, execution);
    const receipt = router.assign('lane-1', 'candidate', candidate.backend); router.backend.begin(onset('preview-held'), 101, execution);
    expect(previous.restore(receipt)).to.include({ status: 'restored', key: 'old' }); previous.release();
    router.backend.begin(onset('restored'), 102, execution); router.backend.end('preview-held', { seconds: 0.1 }, 103, execution);
    expect(old.calls).to.deep.equal([['begin', 'old-held'], ['begin', 'restored']]);
    expect(candidate.calls).to.deep.equal([['begin', 'preview-held'], ['end', 'preview-held']]); expect(candidate.disposed).to.equal(false);
    candidate.finish('preview-held'); router.collect(); expect(candidate.disposed).to.equal(true); await router.dispose().completion;
  });
  it('never lets a stale preview restore over a newer selection even when its renderer key is identical', async () => {
    const fallback = renderer(), old = renderer(), next = renderer(), router = root(fallback.backend);
    router.assign('lane-1', 'old', old.backend); const previous = router.retainAssignment('lane-1'), stale = router.assign('lane-1', 'next', next.backend);
    const winner = router.assign('lane-1', 'next', next.backend); expect(winner.revision).to.be.greaterThan(stale.revision);
    expect(previous.restore(stale)).to.deep.equal({ status: 'superseded', restoresNewerSelection: false }); previous.release();
    expect(router.assignment('lane-1')).to.equal('next'); expect(old.disposed).to.equal(true); await router.dispose().completion;
  });
  it('restores an unassigned default or an explicit blocked requirement without inventing a fallback assignment', async () => {
    const fallback = renderer(), next = renderer(), router = root(fallback.backend);
    const empty = router.retainAssignment('lane-1'), first = router.assign('lane-1', 'next', next.backend);
    expect(empty.restore(first)).to.include({ status: 'restored', key: null }); empty.release(); expect(router.assignment('lane-1')).to.equal(null);
    router.block('lane-1', 'missing-source'); const blocked = router.retainAssignment('lane-1'), other = renderer();
    const receipt = router.assign('lane-1', 'other', other.backend); blocked.restore(receipt); blocked.release();
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'blocked' }).execution;
    expect(router.backend.begin(onset('silent'), 100, execution).reason).to.equal('missing-source'); expect(fallback.calls).to.have.length(0); await router.dispose().completion;
  });
  it('requires the prepared authored body and damping macro for topology excitation', () => {
    const fallback = renderer(), child = renderer(), router = root(fallback.backend);
    router.assign('lane-1', 'body-pack', child.backend, { bodyId: 'modal:clay', macroIds: ['damping'] });
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'topology' }).execution;
    expect(router.backend.begin({ ...onset('wrong'), topologyBinding: { bodyId: 'modal:metal' } }, 100, execution).reason).to.equal('topology-body-or-macro-unavailable');
    expect(router.backend.begin({ ...onset('missing'), topologyBinding: { bodyId: 'modal:clay', dampingMacroId: 'missing' } }, 100, execution).reason).to.equal('topology-body-or-macro-unavailable');
    expect(router.backend.begin({ ...onset('right'), topologyBinding: { bodyId: 'modal:clay', dampingMacroId: 'damping' } }, 100, execution).status).to.equal('accepted');
    expect(child.calls.filter(call => call[0] === 'begin')).to.have.length(1); router.backend.dispose();
  });
  it('routes carried voices through destination lane mix while retaining their original renderer', async () => {
    const fallback = renderer(), child = renderer(); let muted = false;
    const router = root(fallback.backend, { getLaneMix: lane => ({ gain: muted ? 0 : lane === 'lane-2' ? 0.25 : 1, pan: lane === 'lane-2' ? 1 : 0, muted }) });
    router.assign('lane-1', 'source', child.backend);
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'mix' }).execution;
    router.backend.begin(onset('held'), 100, execution);
    expect(router.backend.transferVoiceLane('held', 'lane-2', 200, execution).status).to.equal('accepted');
    expect(child.calls.at(-1)).to.deep.equal(['mix', 'held', 0.25, 1]); expect(fallback.calls).to.have.length(0);
    muted = true; expect(router.synchronizeLaneMix(300).status).to.equal('accepted'); expect(child.calls.at(-1)).to.deep.equal(['mix', 'held', 0, 1]);
    expect(router.backend.begin({ ...onset('silent'), laneId: 'lane-2' }, 301, execution).reason).to.equal('lane-muted');
    await router.dispose().completion;
  });

  it('schedules an identity transfer even between lanes with identical faders', async () => {
    const fallback = renderer(), router = root(fallback.backend), execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'same-mix' }).execution;
    router.backend.begin(onset('carried'), 100, execution);
    expect(router.backend.transferVoiceLane('carried', 'lane-2', 200, execution).status).to.equal('accepted');
    expect(fallback.routeCalls).to.deep.equal([{ voiceId: 'carried', frame: 200, laneId: 'lane-2' }]);
    expect(router.synchronizeLaneMix(150).status).to.equal('accepted'); expect(fallback.routeCalls).to.have.length(1);
    await router.dispose().completion;
  });

  it('shares one prepared renderer across 1024 lane assignments while retaining an explicit route bound', async () => {
    const budget = createResourceBudget(), fallback = renderer(), child = renderer(), router = root(fallback.backend, { resourceBudget: budget });
    for (let lane = 0; lane < 1024; lane++) router.assign('lane-' + lane, 'shared', child.backend);
    const diagnostics = router.backend.renderDiagnostics(); expect(diagnostics).to.include({ assignments: 1024, maxLanes: 1024, children: 2 });
    expect(diagnostics.metadata.enabled).to.equal(true); expect(() => router.assign('overflow', 'shared', child.backend)).to.throw('capacity');
    await router.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('does not fall back to a basic renderer when a project requires an unprepared pinned instrument', async () => {
    const fallback = renderer(), child = renderer(); let desired = 'pinned';
    const router = root(fallback.backend, { requiredInstrumentKey: () => desired }), execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'pinned' }).execution;
    expect(router.backend.begin(onset('missing'), 100, execution)).to.include({ status: 'rejected', reason: 'pinned-instrument-not-prepared' });
    router.assign('lane-1', 'pinned', child.backend); expect(router.backend.begin(onset('ready'), 101, execution).status).to.equal('accepted'); desired = 'different-revision';
    expect(router.backend.begin(onset('stale'), 102, execution).reason).to.equal('pinned-instrument-not-prepared');
    expect(router.backend.end('ready', { seconds: 0.1 }, 103, execution).status).to.equal('accepted'); expect(fallback.calls).to.have.length(0); await router.dispose().completion;
  });
  it('connects observers to later renderer children and translates both execution layers', () => {
    const fallback = renderer(), child = renderer(), router = root(fallback.backend), received = [];
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'public-route' }).execution;
    router.backend.renewExecutionLease(1, execution, 1000);
    const stop = router.backend.observeDisplaySamples(sample => received.push(sample), { execution, identity: { executionEpoch: 'public-route', generation: 1 } });
    router.assign('lane-1', 'child', child.backend); router.backend.begin(onset('voice'), 100, execution); child.emitDisplay();
    expect(received).to.have.length(1); expect(received[0]).to.include({ executionEpoch: 'public-route', actorId: 7 });
    stop(); child.emitDisplay(); expect(received).to.have.length(1); router.dispose();
  });
  it('keeps held updates, releases and actual tails on the old renderer while routing future attacks to the new one', () => {
    const fallback = renderer(), old = renderer(), next = renderer(), router = root(fallback.backend);
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'fixture' }).execution;
    router.assign('lane-1', 'old', old.backend); router.backend.begin(onset('held'), 100, execution);
    router.assign('lane-1', 'next', next.backend); router.backend.update('held', { pressure01: 0.9 }, 110, execution);
    router.backend.end('held', { seconds: 1 }, 120, execution); router.backend.begin(onset('new'), 121, execution);
    router.collect(); expect(old.disposed).to.equal(false);
    expect(old.calls).to.deep.equal([['begin', 'held'], ['update', 'held'], ['end', 'held']]); expect(next.calls).to.deep.equal([['begin', 'new']]);
    old.finish('held'); router.collect(); expect(old.disposed).to.equal(true); expect(next.disposed).to.equal(false);
    expect(router.backend.update('new', { pressure01: 0.2 }, 130, execution).status).to.equal('accepted'); router.dispose();
  });
  it('pins a prepared candidate through assignment races and admits no extra renderer when real tails occupy capacity', () => {
    const fallback = renderer(), old = renderer(), next = renderer(), router = root(fallback.backend, { maxChildren: 3 });
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'fixture' }).execution;
    router.assign('lane-1', 'old', old.backend); const pin = router.retain('old'); router.unassign('lane-1');
    expect(old.disposed).to.equal(false); router.assign('lane-1', 'old', pin.backend); pin.release();
    router.backend.begin(onset('held'), 100, execution); router.assign('lane-1', 'next', next.backend);
    expect(router.canAssign('third')).to.equal(false); expect(old.disposed).to.equal(false);
    old.finish('held'); router.collect(); expect(router.canAssign('third')).to.equal(true); router.dispose();
  });
  it('keeps missing pinned requirements explicit while retaining the previous held voice owner', () => {
    const fallback = renderer(), old = renderer(), router = root(fallback.backend);
    const execution = router.backend.registerExecution({ generation: 1, executionEpoch: 'fixture' }).execution;
    router.assign('lane-1', 'old', old.backend); router.backend.begin(onset('held'), 100, execution);
    router.block('lane-1', 'engine-revision-mismatch');
    expect(router.backend.begin(onset('unavailable'), 101, execution)).to.include({ status: 'rejected', reason: 'engine-revision-mismatch' });
    expect(router.backend.end('held', { seconds: 1 }, 102, execution).status).to.equal('accepted'); expect(fallback.calls).to.deep.equal([]); router.dispose();
  });
});
