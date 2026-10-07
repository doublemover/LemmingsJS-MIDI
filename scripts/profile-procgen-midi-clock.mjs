import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import FakeTimers from '@sinonjs/fake-timers';
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const root = path.resolve(args.repo || '.'), out = path.resolve(args.output || '../lemmings_optimization_artifacts/midi-clock-results.json');
const source = file => import(pathToFileURL(path.join(root, file)));
const [{ loadProcgenMasks, loadProcgenTerrain }, { ProcgenLaneWorld }, { MidiEventRouter }, project, presets] = await Promise.all([
  source('scripts/bench-procgen-lanes.js'), source('js/app/procgen/ProcgenLaneWorld.js'), source('js/midi/MidiEventRouter.js'), source('js/midi/project/MidiProject.js'), source('js/midi/project/GameEventMidiPresets.js')
]);
const masks = await loadProcgenMasks(), results = [];
for (const laneCount of [1, 100]) {
  const terrain = await loadProcgenTerrain(), clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout'] });
  const world = new ProcgenLaneWorld({ masks, terrain, laneCount, seed: 42, cohorts: true, spawnSpreadTicks: 12, speed: 3 });
  const config = project.projectToMidiConfig(presets.applyGameEventMidiPreset(project.createMidiProjectFromMidiConfig({ enabled: true, sfx: {}, triggers: {} }), 'game-major')); config.enabled = true;
  const router = new MidiEventRouter(config), counts = { events: 0, mappedEvents: 0, acceptedPlanRequests: 0, plannedNotes: 0, canceledPendingNotes: 0, dispatchedOn: 0, dispatchedOff: 0, maxLeadMs: 0 };
  router._nowMs = () => clock.now; router.scheduler._nowMs = () => clock.now;
  const output = { channels: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, {
    sendNoteOn() { counts.dispatchedOn++; }, sendNoteOff() { counts.dispatchedOff++; }, sendControlChange() {}, sendPitchBend() {}, sendPitchBendRange() {}, sendAllNotesOff() {}, sendProgramChange() {}
  }])) };
  router.setOutput(output); router.attach(world.soundEvents, { game: world });
  world.soundEvents.onEvent.on(() => counts.events++);
  const mapEvent = router.mapping.mapEvent.bind(router.mapping); router.mapping.mapEvent = (...values) => { const spec = mapEvent(...values); if (spec) counts.mappedEvents++; return spec; };
  const shouldSend = router._shouldSend.bind(router); router._shouldSend = (...values) => { const accepted = shouldSend(...values); if (accepted) counts.acceptedPlanRequests++; return accepted; };
  const send = router.scheduler.sendNote.bind(router.scheduler); router.scheduler.sendNote = (spec, meta) => {
    const accepted = send(spec, meta); if (accepted) counts.plannedNotes++;
    counts.maxLeadMs = Math.max(counts.maxLeadMs, (spec.timeMs || 0) - clock.now); return accepted;
  };
  const stop = router.scheduler._stopActiveNoteToken.bind(router.scheduler); router.scheduler._stopActiveNoteToken = (...values) => { if (router.scheduler._pendingNoteOns.has(values[0])) counts.canceledPendingNotes++; return stop(...values); };
  const panic = router.scheduler.allNotesOff.bind(router.scheduler); router.scheduler.allNotesOff = (...values) => { counts.canceledPendingNotes += router.scheduler._pendingNoteOns.size; return panic(...values); };
  const samples = [];
  try {
    for (let tick = 0; tick < 1000; tick++) {
      clock.tick(20); world.step(args.baseline ? undefined : clock.now);
      if ((tick + 1) % 100 === 0) samples.push({ tick: tick + 1, wallMs: clock.now, eventTimeMs: world.eventTimeMs ?? world.tickIndex * world.timer.frameTime,
        ...counts, pending: router.scheduler._pendingNoteOns.size, active: router.scheduler._activeNotes.size });
    }
    results.push({ laneCount, samples });
  } finally { router.dispose(); world.dispose(); clock.uninstall(); }
}
await fs.writeFile(out, JSON.stringify({ root, scope: 'Real world, sound bus, preset and scheduler with fake JS timers and stub MIDI output. Not native AudioContext or hardware MIDI.', results }, null, 2));
console.log(JSON.stringify(results.map(result => ({ laneCount: result.laneCount, ...result.samples.at(-1) })), null, 2));
