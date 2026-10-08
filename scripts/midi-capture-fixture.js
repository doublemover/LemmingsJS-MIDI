import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMidiOutputCapture, serializeMidiCaptureCSV } from '../js/midi/capture/MidiOutputCapture.js';
import { analyzeMidiOutputCapture, formatMidiCaptureSummary, renderMidiCaptureReport } from '../js/midi/capture/MidiCaptureAnalysis.js';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { withFakeClockAndPerformance } from '../test/support/timers.js';
import { makeOutput } from '../test/support/midi-output.js';

const fixtureConfig = { enabled: true, mpe: { enabled: false }, position: { mappings: [], viewPan: false },
  scale: { name: 'major', root: 0 }, density: { velocityBoost: 0, durationScale: 0 }, timing: { scheduleAheadMs: 0 },
  limits: { maxEventsPerSecond: 64, hardMaxEventsPerSecond: 64, maxBytesPerSecond: 100000, maxEventsPerTick: 32 },
  sfx: { '1': { notes: [60, 64, 67, 72], program: 38, durationTicks: 1 } } };

const buildMidiCaptureFixture = () => withFakeClockAndPerformance(clock => {
  const capture = createMidiOutputCapture({ capacity: 8192, nowMs: () => clock.now });
  capture.start({ seed: 42, backend: 'deterministic-fake-channel-api', tempoBpm: 120, speed: 1, frameMs: 60,
    scale: fixtureConfig.scale, limits: fixtureConfig.limits,
    settingsReference: createHash('sha256').update(JSON.stringify(fixtureConfig)).digest('hex'),
    fixture: '64 busy lanes, atomic chords, speed transitions, held note, ownership release and Panic; no physical sends' });
  const router = new MidiEventRouter(fixtureConfig), output = makeOutput([1], [], 'deterministic-fake-output');
  output.channels[1].sendProgramChange = () => {};
  router.setCapture(capture); router.setOutput(output);
  for (let second = 0; second < 32; second += 1) {
    const speedFactor = second < 8 || second >= 24 ? 1 : 8;
    for (let laneIndex = 0; laneIndex < 64; laneIndex += 1) router._onEvent({ sfxId: 1, type: 'fixture-chord', tick: second,
      laneIndex, laneCount: 64, lemmingId: laneIndex, frameMs: 60 / speedFactor, speedFactor, timeMs: clock.now });
    clock.tick(1001);
  }
  router.scheduler.sendNote({ note: 60, channel: 1, program: 38, durationTicks: 0 }, { laneIndex: 0, eventType: 'fixture-held' });
  clock.tick(100);
  router.scheduler.sendNote({ note: 64, channel: 1, program: 29, durationTicks: 1 }, { laneIndex: 0, eventType: 'fixture-edit' });
  clock.tick(100);
  router.dispose(); capture.stop('fixture-complete');
  return capture.snapshot();
});

const writeMidiCaptureArtifacts = async (snapshot, directory) => {
  const { records, ...header } = snapshot;
  const jsonl = [JSON.stringify({ kind: 'midi-capture', ...header }), ...records.map(record => JSON.stringify(record))].join('\n') + '\n';
  const csv = serializeMidiCaptureCSV(snapshot);
  await fs.mkdir(directory, { recursive: true });
  for (const [name, content] of [['capture.jsonl', jsonl], ['capture.csv', csv], ['summary.txt', formatMidiCaptureSummary(snapshot)],
    ['inspection.html', renderMidiCaptureReport(snapshot)], ['analysis.json', JSON.stringify(analyzeMidiOutputCapture(snapshot), null, 2) + '\n']]) {
    await fs.writeFile(path.join(directory, name), content);
  }
  return analyzeMidiOutputCapture(snapshot);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), directory = args.find(arg => arg.startsWith('--out-dir='))?.slice(10) || 'temp/midi-capture-fixture';
  const input = args.find(arg => arg.startsWith('--input='))?.slice(8);
  let snapshot;
  if (input) {
    const stat = await fs.stat(input);
    if (stat.size > 32 * 1024 * 1024) throw new RangeError('Capture input exceeds the 32MiB inspection limit');
    const lines = (await fs.readFile(input, 'utf8')).trim().split('\n');
    if (lines.length > 32769) throw new RangeError('Capture input exceeds 32768 retained records');
    const [header, ...records] = lines.map(line => JSON.parse(line));
    snapshot = { ...header, records };
  } else snapshot = buildMidiCaptureFixture();
  const report = await writeMidiCaptureArtifacts(snapshot, directory);
  console.log(JSON.stringify({ directory, records: report.records, noteOns: report.noteOns, fairness: report.fairness,
    openNotes: report.openNotes.length, activeChannelChanges: report.activeChannelChanges.length, truncated: report.truncated }));
}
export { buildMidiCaptureFixture, writeMidiCaptureArtifacts };
