import { expect } from 'chai';
import { createMidiProject, sanitizeMidiProject, reduceMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createProcgenPhysicalPlayback } from '../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';

describe('ProcGen physical playback', () => {
  it('keeps source declarations and mix allocations stable through unrelated canonical edits', async () => {
    let project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject())); const declared = [];
    const playback = createProcgenPhysicalPlayback({ audio: { createSession: () => ({ getState: () => ({ enabled: false }), configureLaneSources: ids => declared.push(ids), stop() {}, dispose() {} }), getState: () => ({ enabled: false }) },
      getLanes: () => project.procgen.lanes, getGraph: () => project.procgen.physicalGraph, scoreTimeline: createProcgenPhysicalScoreClock(), now: () => 0 });
    try {
      playback.synchronizeLaneMix(); const before = playback.diagnostics().laneMix, count = declared.length;
      project = reduceMidiProject(project, { type: 'procgen/lane', laneId: project.procgen.lanes[0].id, patch: { name: 'New label' } }); playback.synchronizeLaneMix();
      expect(declared.length).to.equal(count); expect(playback.diagnostics().laneMix.stateAllocations).to.equal(before.stateAllocations);
      project = reduceMidiProject(project, { type: 'procgen/lane', laneId: project.procgen.lanes[0].id, patch: { gain: .25 } }); playback.synchronizeLaneMix();
      expect(declared.length).to.equal(count); expect(playback.diagnostics().laneMix.stateAllocations).to.equal(before.stateAllocations + 1);
      project = reduceMidiProject(project, { type: 'procgen/addLane' }); playback.synchronizeLaneMix(); expect(declared.length).to.equal(count + 1);
    } finally { await playback.dispose().completion; }
  });
  it('retires the session and backend even when its state subscription and Stop throw', async () => {
    const project = createProcgenWorkstationProject(createMidiProject()), calls = [];
    const backend = { prepare: async () => ({ status: 'ready' }), dispose() { calls.push('backend'); } };
    const session = { getState: () => ({ enabled: false }), enable: async () => false,
      createInstrumentBackend: () => backend, stop() { calls.push('stop'); throw new Error('Stop failed'); }, dispose() { calls.push('session'); } };
    const playback = createProcgenPhysicalPlayback({ audio: { createSession: () => session, getState: () => ({ enabled: false }),
      subscribe: () => () => { calls.push('unsubscribe'); throw new Error('Unsubscribe failed'); } },
    getGraph: () => project.procgen.physicalGraph, scoreTimeline: createProcgenPhysicalScoreClock(), now: () => 0 });
    await playback.ready(); const receipt = playback.dispose(); await receipt.completion;
    expect(receipt.outcome).to.equal('partial'); expect(calls).to.deep.equal(['unsubscribe', 'stop', 'backend', 'session']);
    expect(playback.dispose()).to.equal(receipt); expect(calls).to.have.length(4);
  });
  it('routes a committed builder fact to the owned local semantic backend without a phrase cell', async () => {
    const project = createProcgenWorkstationProject(createMidiProject()), timeline = createProcgenPhysicalScoreClock();
    const calls = [], context = { state: 'running', currentTime: 1, sampleRate: 48000 };
    let disposed = false;
    const backend = { prepare: async () => ({ status: 'ready' }),
      begin(intent, frame, epoch) { calls.push({ kind: 'begin', intent, frame, epoch }); return { status: 'accepted', stage: 'scheduled' }; },
      end(voiceId, release, frame, epoch) { calls.push({ kind: 'end', voiceId, release, frame, epoch }); return { status: 'accepted', stage: 'scheduled' }; },
      cancelGeneration() {}, dispose() { disposed = true; } };
    const session = { getState: () => ({ enabled: true }), enable: async () => true, stop() {}, dispose() {},
      createInstrumentBackend: () => backend };
    const audio = { createSession: () => session, getAudioContext: () => context, getState: () => ({ enabled: true }), subscribe: () => () => {} };
    const playback = createProcgenPhysicalPlayback({ audio, getGraph: () => project.procgen.physicalGraph,
      scoreTimeline: timeline, now: () => 1000 });
    expect(await playback.ready()).to.equal(true);
    const batch = { version: 1, batchId: 'builder-1', worldId: 'world-1', generation: 1, tick: 1,
      sourceTimeMs: 60, tickDurationMs: 60, completeness: { status: 'complete', dropped: 0 },
      facts: [{ kind: 'TerrainWorkCommitted', eventId: 'brick-1', causalSequence: 1,
        actorId: 1, laneId: 0, operationKind: 'build' }] };
    const position = timeline.observe(batch, { bpm: 120 });
    playback.processBatch(batch, { bpm: 120, playing: true, position });
    expect(calls.map(call => call.kind)).to.deep.equal(['begin', 'end']);
    expect(calls[0].intent.mappingId).to.equal('brick-work');
    expect(calls[0].frame).to.be.greaterThan(48000);
    expect(project.procgen.lanes[0].patterns).to.have.length(0);
    playback.dispose(); expect(disposed).to.equal(true);
  });
});


describe('physical clock rearm without transport changes', () => {
  it('reanchors after disable and same-rate context replacement at the next committed batch', async () => {
    const project = createProcgenWorkstationProject(createMidiProject()), timeline = createProcgenPhysicalScoreClock(), calls = [];
    let context = { state: 'running', currentTime: 1, sampleRate: 48000 }, enabled = true, notify, host = 1000;
    const backend = { prepare: async () => ({ status: 'ready' }), begin: (...args) => { calls.push(args); return { status: 'accepted', stage: 'scheduled' }; },
      end: () => ({ status: 'accepted', stage: 'scheduled' }), cancelGeneration() {}, dispose() {} };
    const session = { getState: () => ({ enabled }), enable: async () => enabled, stop() {}, dispose() {}, createInstrumentBackend: () => backend };
    const audio = { createSession: () => session, getAudioContext: () => context, getState: () => ({ enabled }), subscribe: fn => { notify = fn; return () => {}; } };
    const playback = createProcgenPhysicalPlayback({ audio, getGraph: () => project.procgen.physicalGraph, scoreTimeline: timeline, now: () => host }); await playback.ready();
    const step = tick => { const batch = { version: 1, batchId: 'b' + tick, worldId: 'world', generation: 1, tick, sourceTimeMs: tick * 60, tickDurationMs: 60,
      completeness: { status: 'complete', dropped: 0 }, facts: [{ kind: 'TerrainWorkCommitted', eventId: 'e' + tick, causalSequence: tick, actorId: 1, laneId: 0, operationKind: 'build' }] };
    playback.processBatch(batch, { bpm: 120, position: timeline.observe(batch, { bpm: 120 }) }); };
    step(1); enabled = false; notify({ enabled }); host += 60; context.currentTime += 0.06; enabled = true; notify({ enabled }); step(2);
    host += 60; context = { ...context, currentTime: 2 }; notify({ enabled }); step(3);
    expect(calls).to.have.length(3); expect(playback.diagnostics().clock.rebases).to.equal(3);
    expect(playback.diagnostics().rejected).to.equal(0); await playback.dispose().completion;
  });
});
