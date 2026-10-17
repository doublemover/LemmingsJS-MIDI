import { expect } from 'chai';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createMidiProject, sanitizeMidiProject, projectToMidiConfig, stringifyMidiProjectExport, importMidiProjectPayload } from '../../js/midi/project/MidiProject.js';
import { applyProcgenGameEventMidiPreset } from '../../js/midi/project/ProcgenMidiDefaults.js';
import { PROCGEN_DRUM_SCHEMES } from '../../js/midi/project/ProcgenDrumSchemes.js';
import { sanitizeMidiLaneMusic, midiLaneMusicRange } from '../../js/midi/project/MidiLaneMusic.js';
import { editProcgenMusicProject, procgenMusicDefaults } from '../../js/app/procgen/ProcgenMusicProject.js';
import { loadProcgenAutomation, saveProcgenAutomation } from '../../js/app/procgen/ProcgenAutomationStorage.js';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const settings = { preset: 'game-major', mode: 'steps', laneCount: 8 };
const baseProject = () => applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true, global: { mpe: { enabled: false } } }), settings.preset);
const event = (laneIndex = 0, sfxId = SoundEffectIds.BUILDER_STEP, tick = 0) => ({ laneIndex, laneCount: 8, sfxId, tick, lemmingId: 3 });
const range = (id, startLane, endLane, schemeId, enabled = true) => ({ id, startLane, endLane, schemeId, enabled });

describe('saved lane music and GM percussion', () => {
  it('keeps legacy event pitches intact until global pitch is deliberately edited', () => {
    const base = baseProject(), config = projectToMidiConfig(base), legacy = new MidiMapping(config);
    const migrated = new MidiMapping(projectToMidiConfig(sanitizeMidiProject({ ...base, global: { ...base.global, laneMusic: procgenMusicDefaults(base, settings) } })));
    for (const id of Object.values(SoundEffectIds)) expect(migrated.mapEvent(event(3, id))).to.deep.equal(legacy.mapEvent(event(3, id)));
    expect(config).not.to.have.property('laneMusic');
  });

  it('transposes absolute notes once, preserves degree-based scale notes and spreads lane registers', () => {
    const config = { enabled: true, noteRange: { min: 0, max: 127 }, scale: { name: 'major', root: 2, degrees: [0, 2, 4, 5, 7, 9, 11] },
      laneMusic: { referenceRoot: 0, spread: 24 }, sfx: { 20: { note: 60 }, 21: { degree: 0, octave: 4 }, 22: { notes: [60, 64, 67] } } };
    const mapping = new MidiMapping(config);
    expect(mapping.mapEvent({ ...event(), laneCount: 1 }).note).to.equal(62);
    expect(mapping.mapEvent({ ...event(0, 21), laneCount: 1 }).note).to.equal(50);
    expect(mapping.mapEvent({ ...event(0, 22), laneCount: 1 }).notes).to.deep.equal([62, 66, 69]);
    expect(mapping.mapEvent(event(0)).note).to.equal(50); expect(mapping.mapEvent(event(7)).note).to.equal(74);
    expect(config.sfx[22].notes).to.deep.equal([60, 64, 67]);
  });

  it('resolves last enabled inclusive ranges, preserves out-of-run rows and leaves unmatched lanes alone', () => {
    const project = baseProject(), config = projectToMidiConfig(project);
    config.laneMusic = { pitchEnabled: false, ranges: [range('a', 1, 4, 'procgen-drum-pocket'), range('b', 3, 6, 'procgen-drum-metal'),
      range('disabled', 1, 8, 'procgen-drum-toms', false), range('later', 500, 600, 'procgen-drum-soft')] };
    const mapping = new MidiMapping(config), baseline = new MidiMapping(projectToMidiConfig(project));
    expect(mapping.mapEvent(event(0))).to.include({ note: 42, channel: 10, percussion: true });
    expect(mapping.mapEvent(event(2)).note).to.equal(80);
    expect(mapping.mapEvent(event(7))).to.deep.equal(baseline.mapEvent(event(7)));
    for (let i = 0; i < 100; i++) mapping.mapEvent(event(i % 8));
    expect(mapping.laneSchemes.size).to.equal(2);
    expect(mapping.config.laneMusic.ranges).to.have.length(4);
    expect(midiLaneMusicRange(mapping.config.laneMusic, 499).id).to.equal('later');
  });

  it('keeps all six kits on their GM voices despite key, scale, pitch position, spread and countdown changes', () => {
    const signatures = new Set();
    for (const scheme of PROCGEN_DRUM_SCHEMES) {
      const project = applyProcgenGameEventMidiPreset(baseProject(), scheme.id), config = projectToMidiConfig(project);
      config.scale = { name: 'major', root: 11, degrees: [0, 2, 4, 5, 7, 9, 11] }; config.noteRange = { min: 80, max: 84 };
      config.laneMusic = { referenceRoot: 0, spread: 48, variation: 'animated' }; config.position = { mappings: [{ axis: 'x', target: 'note', min: 24, max: 24 }] };
      const mapping = new MidiMapping(config), voices = [];
      for (const sfxId of [20, 21, 22, 23, 25, 28, 29, 12]) {
        const spec = mapping.mapEvent({ ...event(7, sfxId, 15), type: 'bomber-countdown', countdownNumber: 5, x: 100 }, { levelWidth: 200 });
        expect(spec, scheme.id).to.include({ percussion: true, channel: 10, program: null, pitchBend: null, timbre: null });
        for (const note of spec.notes || [spec.note]) expect(scheme.kit).to.include(note);
        voices.push(spec.note);
      }
      signatures.add(JSON.stringify(voices));
      expect(importMidiProjectPayload(stringifyMidiProjectExport(project))).to.deep.equal(project);
    }
    expect(signatures.size).to.equal(6);
  });

  it('preserves explicit clips, mutes and destination routing when a lane changes scheme', () => {
    const config = projectToMidiConfig(baseProject()); config.laneMusic = { ranges: [range('a', 1, 8, 'procgen-drum-pocket')] };
    config.sfx[20] = { note: 64, clipSequence: { id: 'edited', steps: [{ note: 64 }] }, outputId: 'own-device' };
    config.sfx[21] = { note: 60, disabled: true }; config.sfx[22].outputId = 'own-device';
    const mapping = new MidiMapping(config);
    expect(mapping.getSfxConfig(20, event()).clipSequence).to.deep.equal(config.sfx[20].clipSequence);
    expect(mapping.mapEvent(event(0, 20))).not.to.have.property('percussion');
    expect(mapping.mapEvent(event(0, 21))).to.equal(null);
    expect(mapping.mapEvent(event(0, 22)).outputId).to.equal('own-device');
  });

  it('uses deterministic event accents and bypasses MPE allocation for drums without hanging gates', () => withFakeClockAndPerformance(clock => {
    const project = applyProcgenGameEventMidiPreset(baseProject(), 'procgen-drum-pocket'), config = projectToMidiConfig(project);
    config.mpe.enabled = true; config.mpe.memberChannels = [2, 10]; config.laneMusic = { variation: 'animated' };
    const mapping = new MidiMapping(config), scheduler = new MidiScheduler(mapping.config), calls = [];
    scheduler.setOutput(makeOutput([1, 2, 10], calls)); scheduler.setTickMs(10);
    try {
      const first = mapping.mapEvent(event(0, 20, 0)), later = mapping.mapEvent(event(0, 20, 5));
      expect(first.velocity).not.to.equal(later.velocity); expect(new MidiMapping(config).mapEvent(event(0, 20, 0))).to.deep.equal(first);
      expect(scheduler._ensembleChannels().has(10)).to.equal(true);
      expect(scheduler.sendNote(first)).to.equal(true); clock.tick(100);
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.id)).to.deep.equal([10]);
      expect(calls.some(call => call.type === 'noteOff' && call.id === 10)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.sendNote(later); scheduler.allNotesOff(); expect(scheduler._activeNotes.size).to.equal(0);
    } finally { scheduler.dispose(); }
  }));

  it('clears pending old arrangement phrases on a key or lane scheme change', () => {
    const config = projectToMidiConfig(baseProject()), router = new MidiEventRouter(config);
    router._arpStateBySfx.set('old', { index: 3 });
    router.setMapping({ ...config, laneMusic: { ranges: [range('a', 1, 3, 'procgen-drum-hand')] } });
    expect(router._arpStateBySfx.size).to.equal(0); router.dispose();
  });
  it('keeps a lane percussion completion cue out of the default melodic ensemble', () => {
    const project = applyProcgenGameEventMidiPreset(baseProject(), 'game-iron-ensemble'), config = projectToMidiConfig(project);
    config.laneMusic = { ranges: [range('drums', 1, 4, 'procgen-drum-pocket')] };
    const router = new MidiEventRouter(config);
    try {
      const cells = router._musicDirectionCells({ event: event(2, SoundEffectIds.PROCGEN_ROUTE_COMPLETE) }, 'lead', { ticksPerQuarter: 8, quartersPerBar: 4, bar: 1 });
      expect(cells).to.have.length(1); expect(cells[0].voices).to.have.length(1);
      expect(cells[0].voices[0]).to.include({ note: 49, channel: 10, percussion: true, program: null });
      expect(router._musicDirectionCells({ event: event(2, SoundEffectIds.PROCGEN_ROUTE_COMPLETE) }, 'reply', { ticksPerQuarter: 8, quartersPerBar: 4 })).to.deep.equal([]);
    } finally { router.dispose(); }
  });

  it('saves the complete musical project and restores Undo while retaining device and enabled state', () => {
    const data = new Map(), storage = { setItem: (key, value) => data.set(key, value), getItem: key => data.get(key) };
    let before = baseProject(); before.global.laneMusic = procgenMusicDefaults(before, settings);
    let after = editProcgenMusicProject(before, settings, { type: 'global', patch: { root: 5, spread: 24, stereoWidth: 32 } });
    after = editProcgenMusicProject(after, settings, { type: 'addRange' });
    const history = createMidiEditHistory(); history.record(before, after);
    expect(saveProcgenAutomation(storage, after)).to.equal(true);
    const target = createMidiProject({ enabled: false }); target.tracks[0].outputId = 'current-device';
    const restored = loadProcgenAutomation(storage, target);
    expect(restored.global).to.deep.equal(after.global); expect(restored.sources).to.deep.equal(after.sources);
    expect(restored.enabled).to.equal(false); expect(restored.tracks[0].outputId).to.equal('current-device');
    history.undo(after, next => { after = next; }); expect(after.global).to.deep.equal(before.global);
    history.redo(after, next => { after = next; }); expect(after.global.laneMusic.ranges).to.have.length(1);
    expect(importMidiProjectPayload(stringifyMidiProjectExport(after))).to.deep.equal(sanitizeMidiProject(after));
  });

  it('caps and sanitizes persisted ranges without duplicate truncated IDs', () => {
    const ranges = Array.from({ length: 40 }, (_, i) => range(String(i), -4, 9000, 'procgen-drum-hand'));
    const music = sanitizeMidiLaneMusic({ ranges, spread: 999, variation: 'bad' });
    expect(music.ranges).to.have.length(32); expect(music).to.include({ spread: 48, variation: 'balanced' });
    expect(music.ranges[0]).to.include({ startLane: 1, endLane: 1024 });
    expect(sanitizeMidiLaneMusic({ ranges: [range('x'.repeat(81), 1, 2, 'a'), range('x'.repeat(82), 2, 3, 'b')] }).ranges).to.have.length(1);
  });
});
