import { expect } from 'chai';
import { createRoutedInstrumentBackend } from '../../js/app/midi-ui/RoutedInstrumentBackend.js';
import { createInstrumentExecutionLifecycle } from '../../js/app/midi-ui/InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

describe('voice-owned lane instrument replacement', () => {
  const context = {};
  const renderer = () => {
    const voices = new Map(), calls = [], observers = new Set(); let disposed = false;
    const key = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
    const backend = createInstrumentExecutionLifecycle({ capabilities: {},
      setDisplayContext() {},
      observeDisplaySamples(listener, options) { const observer = { listener, options }; observers.add(observer); return () => observers.delete(observer); },
      begin(intent, frame, epoch) { calls.push(['begin', intent.voiceId]); voices.set(key(epoch, intent.voiceId), { voiceId: intent.voiceId, epoch }); return { status: 'accepted' }; },
      update(voiceId) { calls.push(['update', voiceId]); return { status: 'accepted' }; },
      end(voiceId) { calls.push(['end', voiceId]); return { status: 'accepted' }; },
      renewExecutionLease: () => ({ status: 'accepted' }),
      cancelGenerationWithReceipt(generation, epoch) { for (const [id, voice] of voices) if (voice.epoch === epoch) voices.delete(id); return { status: 'accepted', count: 0 }; },
      renderDiagnostics: () => ({ voices: voices.size }),
      dispose() { return createProcgenRetirementScope().retire([{ name: 'native', run: () => { disposed = true; voices.clear(); } }]); }
    }, { getContext: () => context, getGeneration: () => 0, isSettled: epoch => ![...voices.values()].some(voice => voice.epoch === epoch),
      isVoiceSettled: (voiceId, epoch) => !voices.has(key(epoch, voiceId)), forget: () => {} }).api;
    return { backend, calls, get disposed() { return disposed; }, emitDisplay() { for (const observer of observers) observer.listener({ ...observer.options.identity, actorId: 7 }); },
      finish(voiceId) { for (const [id, voice] of voices) if (voice.voiceId === voiceId) voices.delete(id); } };
  };
  const root = (backend, options = {}) => createRoutedInstrumentBackend({ defaultBackend: backend, getContext: () => context, getGeneration: () => 0, ...options });
  const onset = voiceId => ({ generation: 1, voiceId, laneId: 'lane-1' });
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
