import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { createCausalMidiSink } from '../../js/app/procgen/workstation/CausalMidiSink.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createProcgenPhysicalPlayback } from '../../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';
import { createProcgenPhysicalScoreClock } from '../../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createProcgenLane } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { makeOutput } from './midi-output.js';

export async function createPhysicalPlaybackFixture({ masks, clock, graph, world = new ProcgenLaneWorld({ masks, laneHeight: 192, assists: false, worldId: 'held-actions' }), timeline = createProcgenPhysicalScoreClock() }) {
  const calls = [], receipts = [], batches = [], intents = [];
  const lanes = Array.from({ length: world.laneCount }, (_, index) => createProcgenLane(index, { mode: 'physical', role: 'lead', channel: 1, externalPercussion: false, externalProgram: null }));
  const ports = createProcgenMidiPorts({ now: () => clock.now, schedulerConfig: { mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3, 4, 5, 6, 7, 8], pitchBendRange: { semitones: 2 } } } });
  const output = makeOutput(Array.from({ length: 8 }, (_, index) => index + 1), calls, 'held-actions-device');
  for (const [id, channel] of Object.entries(output.channels)) {
    channel.sendProgramChange = (value, options) => calls.push({ type: 'program', id: Number(id), value, options });
    channel.sendChannelAftertouch = (value, options) => calls.push({ type: 'pressure', id: Number(id), value, options });
  }
  ports.setNoteOutputs([output]); ports.setNoteOutput(output); calls.length = 0;
  const midi = createCausalMidiSink({ ports, getLanes: () => lanes, now: () => clock.now, isEnabled: () => true });
  const playback = createProcgenPhysicalPlayback({ audio: null, world, getGraph: () => graph, getLanes: () => lanes, scoreTimeline: timeline, now: () => clock.now, additionalOutputs: [midi], onReceipt: receipt => receipts.push(receipt) });
  await playback.ready();
  const listener = batch => { batches.push(batch); intents.push(...playback.processBatch(batch, { bpm: 120, position: timeline.observe(batch, { bpm: 120 }) })); };
  world.soundEvents.onBatch.on(listener);
  let closing = null;
  return { world, graph, lanes, timeline, calls, receipts, batches, intents, midi, ports, playback,
    step(count = 1) { for (let index = 0; index < count; index++) { world.step(); clock.tick(world.timer.frameTime); } return batches.at(-1); },
    close() {
      if (closing) return closing;
      world.soundEvents.onBatch.off(listener);
      const receipt = playback.dispose();
      closing = receipt.completion.then(async () => { ports.dispose(); const worldReceipt = world.dispose(); if (worldReceipt?.completion) await worldReceipt.completion; return receipt; });
      return closing;
    }
  };
}
