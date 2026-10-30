import assert from 'node:assert/strict';
import { MidiScheduler } from '../js/midi/MidiScheduler.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';

const argument = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const name = argument('name', 'midi');
const notes = Math.max(1, Math.min(20000, Math.trunc(Number(argument('notes', '10000')) || 10000)));
const capacity = 4096;
let hostMs = 0, acceptedSubmissions = 0;
const output = { id: 'benchmark', send() { acceptedSubmissions++; return true; }, channels: {} };
output.channels[1] = {
  sendNoteOn(note, options) { output.send([0x90, note, options.rawAttack], { time: options.time }); },
  sendNoteOff(note, options = {}) { output.send([0x80, note, options.rawRelease ?? 64], { time: options.time }); }
};
const scheduler = new MidiScheduler({ mpe: { enabled: false } });
scheduler._nowMs = () => hostMs;
const ports = createProcgenMidiPorts({ scheduler, now: () => hostMs, maxRecordedEvents: capacity });
ports.setNoteOutput(output); ports.configure({ recording: true });
globalThis.gc?.();
const startHeap = process.memoryUsage().heapUsed, started = performance.now();
for (let index = 0; index < notes; index++) {
  hostMs += 10;
  assert.equal(ports.sendNote({ note: 60, velocity: 90, durationTicks: 0 }), true);
}
ports.flush();
const elapsedMs = performance.now() - started, state = ports.getState();
assert.equal(acceptedSubmissions, notes * 2);
assert.equal(state.recordedEvents, Math.min(capacity, acceptedSubmissions));
assert.equal(state.recordingComplete, acceptedSubmissions <= capacity);
assert.equal(scheduler._ratePlanned.length, 0);
assert.equal(scheduler._activeNotes.size, 0);
assert.ok(ports.getRecording().every(event => event.encodingEvidence === 'adapter-byte-boundary'));
globalThis.gc?.();
const heapDeltaBytes = process.memoryUsage().heapUsed - startHeap;
ports.dispose(); scheduler.dispose();
console.log(JSON.stringify({ name, notes, acceptedSubmissions, retainedEvents: state.recordedEvents, capacity,
  droppedRecords: state.droppedRecords, complete: state.recordingComplete, elapsedMs,
  submissionsPerSecond: acceptedSubmissions * 1000 / elapsedMs, heapDeltaBytes,
  evidence: 'fake-adapter-api-submissions', physicalDeviceMeasured: false }));
