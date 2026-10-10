import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createNodeSurveyTrial, loadProcgenMasks } from '../scripts/procgen-survey/SurveyNodeWorld.js';
import { smokeScenarios } from '../scripts/run-procgen-survey.js';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { MidiOutputCapture } from '../js/midi/capture/MidiOutputCapture.js';
import { analyzeMidiOutputCapture } from '../js/midi/capture/MidiCaptureAnalysis.js';
import { createMidiProject, projectToMidiConfig } from '../js/midi/project/MidiProject.js';
import { applyProcgenGameEventMidiPreset } from '../js/midi/project/ProcgenMidiDefaults.js';
import { SoundEffectIds } from '../js/game/SoundEvents.js';
import { makeOutput } from './support/midi-output.js';
import { withFakeClockAndPerformance } from './support/timers.js';

describe('selected real survey musical capture', function() {
  this.timeout(10000);
  it('keeps physics and logical events identical with existing routing, then Panic closes every captured gate', async () => {
    const masks = await loadProcgenMasks(), receipts = [];
    for (const scenario of smokeScenarios().filter(scene => scene.mode !== 'generated')) {
      const job = { scenario, candidate: { id: 'baseline', kind: 'baseline', configuration: {} } };
      const control = await createNodeSurveyTrial(job, masks), routed = await createNodeSurveyTrial(job, masks);
      try {
        const receipt = withFakeClockAndPerformance(clock => {
          const project = applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true, global: { mpe: { enabled: false } } }), 'game-iron-ensemble');
          const router = new MidiEventRouter(projectToMidiConfig(project)), calls = [], output = makeOutput([1, 2, 3, 4, 10], calls, 'survey-capture');
          output.supportsPerNotePan = true; output.supportsPerNoteInstrument = true; output.supportsIndependentNoteGates = true;
          const capture = new MidiOutputCapture({ capacity: 32768, nowMs: () => clock.now }); capture.start({ scenarioId: scenario.id, scale: projectToMidiConfig(project).scale, scope: 'muted controlled-clock sink; no acoustic or physical MIDI receipt' });
          router.setCapture(capture); router.setOutput(output); router.attach(routed.world.soundEvents, { game: routed.world });
          try {
            for (let tick = 0; tick < scenario.horizonTicks; tick++) { clock.tick(routed.world.timer.frameTime); routed.step(); control.step(); }
            const beforePanic = capture.snapshot(), notes = calls.filter(call => call.type === 'noteOn'); expect(notes.length).to.be.greaterThan(0);
            expect(notes.every(note => Number.isInteger(note.note) && note.note >= 0 && note.note <= 127 && note.opts.rawAttack >= 0 && note.opts.rawAttack <= 127)).to.equal(true);
            router.scheduler.allNotesOff(); const stopped = calls.filter(call => call.type === 'noteOn').length; clock.tick(60000);
            expect(calls.filter(call => call.type === 'noteOn')).to.have.length(stopped); expect(router.scheduler._activeNotes.size).to.equal(0);
            capture.stop('survey-panic'); const summary = analyzeMidiOutputCapture(capture.snapshot()); expect(summary.openGateCount).to.equal(0); expect(summary.orphanReleaseCount).to.equal(0);
            const original = control.result(), replay = routed.result(); expect(replay.finalStateHash).to.equal(original.finalStateHash); expect(replay.eventHash).to.equal(original.eventHash);
            return { scenarioId: scenario.id, accounting: replay.accounting, physicsHash: replay.finalStateHash, eventHash: replay.eventHash,
              qualifiedPassageEvents: replay.events.filter(event => event.sfxId === SoundEffectIds.PROCGEN_ROUTE_COMPLETE).length,
              cueRequests: beforePanic.records.filter(record => record.stage === 'request' && record.sfxId === SoundEffectIds.PROCGEN_ROUTE_COMPLETE).length,
              summary, scope: 'Real selected-world events through existing router/ensemble/director; controlled-clock capture sink. No listening or physical MIDI claim.' };
          } finally { router.dispose(); }
        }); receipts.push(receipt);
      } finally { control.dispose(); routed.dispose(); }
    }
    await fs.mkdir('temp/procgen-surveys', { recursive: true }); await fs.writeFile('temp/procgen-surveys/musical-qualification.json', JSON.stringify({ schemaVersion: 1, receipts }, null, 2));
  });
});
