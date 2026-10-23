import { expect } from 'chai';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createProcgenPhysicalPlayback } from '../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';

describe('ProcGen physical playback', () => {
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
