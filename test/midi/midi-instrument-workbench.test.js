import { expect } from 'chai';
import fs from 'node:fs';
import { positionCurveValue } from '../../js/midi/midi-mapping/PositionCurve.js';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { createSoundAuditionPlan } from '../../js/app/midi-ui/midiSoundAudition.js';
import { createMidiInstrumentWorkbench, gameClock } from '../../js/app/midi-ui/midiInstrumentWorkbench.js';
import { createMidiProjectFromMidiConfig } from '../../js/midi/project/MidiProject.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';

const makeProject = () => createMidiProjectFromMidiConfig({ enabled: false,
  mpe: { enabled: false }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
  durationTicks: { min: 1, max: 960, default: 4 },
  sfx: { 20: { note: 60, notes: [60, 64, 67], velocity: 80, durationTicks: 4, arp: { enabled: true, mode: 'up' } } }
});

describe('live instrument workbench', function() {
  it('retains one original canvas in markup with distinct transport and sound controls', function() {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect((html.match(/<canvas\b/g) || []).length).to.equal(1);
    expect((html.match(/id="gameCanvas"/g) || []).length).to.equal(1);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).to.equal(ids.length);
    for (const name of ['midiGamePlay', 'midiGameStop', 'midiGameClock', 'midiSoundRoute', 'midiSoundDurationNumber', 'midiLayoutFocus', 'midiLayoutSplit', 'midiLayoutOverlay']) expect(ids).to.include(name);
  });

  it('uses the game tick clock, not stored BPM or the release rate', function() {
    const slow = gameClock({ speedFactor: 0.5, frameTime: 120, tickIndex: 71, isRunning: () => false });
    const fast = gameClock({ speedFactor: 2, frameTime: 30, tickIndex: 71, isRunning: () => true });
    expect(slow.ticksPerSecond).to.be.closeTo(8.3333, 0.001);
    expect(fast.ticksPerSecond).to.be.closeTo(33.3333, 0.001);
    expect(fast.tick).to.equal(slow.tick);
    expect(fast.running).to.equal(true);
  });

  it('coalesces a slider gesture into one undo without undoing device state', function() {
    let p = makeProject();
    const history = createMidiEditHistory();
    const commit = next => { history.record(p, next); p = next; };
    history.beginGesture();
    for (const name of ['First', 'Second', 'Third']) commit({ ...p, name });
    history.endGesture();
    commit({ ...p, enabled: true, devices: { ...p.devices, outputId: 'kept' }, ui: { ...p.ui, activeRegion: 'clips' } });
    expect(history.undo(p, commit)).to.equal(true);
    expect(p.name).to.equal('Factory MIDI Project');
    expect(p.enabled).to.equal(true);
    expect(p.devices.outputId).to.equal('kept');
    expect(p.ui.activeRegion).to.equal('clips');
    expect(history.undo(p, commit)).to.equal(false);
    expect(history.redo(p, commit)).to.equal(true);
    expect(p.name).to.equal('Third');
  });

  it('bounds history, invalidates redo on edits and ignores selection-only changes', function() {
    let p = makeProject(); const history = createMidiEditHistory(2);
    const commit = next => { history.record(p, next); p = next; };
    commit({ ...p, ui: { ...p.ui, activeRegion: 'tracks' } });
    expect(history.state().canUndo).to.equal(false);
    for (const name of ['One', 'Two', 'Three']) commit({ ...p, name });
    history.undo(p, commit); history.undo(p, commit);
    expect(p.name).to.equal('One'); expect(history.undo(p, commit)).to.equal(false);
    commit({ ...p, name: 'New' }); expect(history.state().canRedo).to.equal(false);
  });

  it('keeps source selection and the same canvas through every layout and event pulse', function() {
    const doc = new TestDocument(); doc.body = doc.createElement('body');
    const win = createTestWindow();
    const canvas = registerElement(doc, 'canvas', 'gameCanvas');
    for (const id of ['midiInstrumentHead', 'midiGameClock', 'midiLastEvent', 'midiGameEventList', 'midiSoundContour']) registerElement(doc, 'div', id);
    for (const name of ['Focus', 'Split', 'Overlay']) registerElement(doc, 'button', `midiLayout${name}`);
    const p = makeProject(), source = p.sources[0];
    const bus = { onEvent: new EventHandler() };
    let mutations = 0;
    const timer = { tickIndex: 44, speedFactor: 1, frameTime: 60, isRunning: () => false };
    const workbench = createMidiInstrumentWorkbench({ document: doc, window: win,
      getLemmings: () => ({ game: { soundEvents: bus, getGameTimer: () => timer } }),
      getProject: () => p, getSource: () => source, updateMapping() { mutations += 1; }, updateSource() { mutations += 1; },
      commitProject() { mutations += 1; }, chooseView() {}, bind() {}, panic() {}, history: createMidiEditHistory(), setStatus() {}
    });
    workbench.initialize(); workbench.setVisible(true);
    for (const mode of ['focus', 'split', 'overlay', 'focus']) {
      workbench.setLayout(mode);
      expect(doc.getElementById('gameCanvas')).to.equal(canvas);
      expect(doc.body.dataset.midiLayout).to.equal(mode);
      expect(p.ui.selectedSourceId).to.equal(source.id);
    }
    bus.onEvent.trigger({ sfxId: 24, tick: 44 }); workbench.refreshClock();
    expect(workbench.getState().lastEvent).to.deep.equal({ sfxId: 24, tick: 44 });
    expect(mutations).to.equal(0);
    timer.tickIndex = 10; workbench.refreshClock(); expect(workbench.getState().lastEvent).to.equal(null);
    workbench.dispose(); expect(bus.onEvent.handlers.size).to.equal(0);
    expect(doc.getElementById('midiInstrumentHead').hidden).to.equal(true);
  });

  it('keeps the titlebar scoped to the active workspace without extra label copy', function() {
    const doc = new TestDocument(); doc.body = doc.createElement('body'); const win = createTestWindow();
    for (const id of ['midiEditScope', 'midiViewDevices', 'midiViewProject', 'midiViewExpert']) registerElement(doc, 'button', id);
    const p = makeProject(), source = p.sources[0]; source.label = 'Spawn · falling';
    const workbench = createMidiInstrumentWorkbench({ document: doc, window: win, getLemmings: () => null,
      getProject: () => p, getSource: () => source, updateMapping() {}, updateSource() {}, commitProject() {}, chooseView() {}, bind() {}, panic() {}, history: createMidiEditHistory(), setStatus() {} });
    workbench.setVisible(true); expect(doc.getElementById('midiEditScope').textContent).to.equal('Spawn · falling');
    for (const [id, title] of [['midiViewDevices', 'Devices'], ['midiViewProject', 'Project'], ['midiViewExpert', 'Tracks & clips']]) {
      doc.getElementById(id).setAttribute('aria-pressed', 'true'); workbench.refreshClock();
      expect(doc.getElementById('midiEditScope').textContent).to.equal(title);
      expect(doc.getElementById('midiEditScope').getAttribute('title')).to.equal(title);
      doc.getElementById(id).setAttribute('aria-pressed', 'false');
    }
    workbench.dispose();
  });

  it('preserves arp progress across unrelated mapping edits and wraps its next marker', function() {
    const config = { enabled: true, sfx: { 20: { note: 60, notes: [60, 64, 67], arp: { enabled: true, mode: 'up' } } } };
    const router = new MidiEventRouter(config);
    router._arpStateBySfx.set('sfx:20', { index: 3, dir: 1, length: 3 });
    router.setMapping({ ...config, sfx: { ...config.sfx, 24: { note: 72 } } });
    expect(router._arpStateBySfx.get('sfx:20').index).to.equal(3);
    expect(router.getEventPlaybackState({ sfxId: 20 })).to.deep.equal({ nextIndex: 0, direction: 1 });
    router.dispose();
  });
});

describe('independent local event audition', function() {
  it('steps once per event test and preserves ascending, descending and up/down order', function() {
    const p = makeProject(), source = p.sources[0];
    const sequence = () => Array.from({ length: 5 }, (_, i) => createSoundAuditionPlan(source, p, 30, i).notes[0].note);
    expect(sequence()).to.deep.equal([60, 64, 67, 60, 64]);
    source.mapping.arp.mode = 'down'; expect(sequence()).to.deep.equal([67, 64, 60, 67, 64]);
    source.mapping.arp.mode = 'updown'; expect(sequence()).to.deep.equal([60, 64, 67, 64, 60]);
  });

  it('gives phrases game-speed-linked gaps while chords are simultaneous', function() {
    const p = makeProject(), source = p.sources[0];
    source.mapping.arp = null; source.mapping.phrase = { enabled: true, mode: 'down', spacingTicks: 3 };
    const before = JSON.stringify(p);
    const plan = createSoundAuditionPlan(source, p, 30);
    expect(plan.notes.map(n => n.offsetMs)).to.deep.equal([0, 90, 180]);
    expect(plan.notes.map(n => n.durationMs)).to.deep.equal([120, 120, 120]);
    expect(plan.notes.map(n => n.note)).to.deep.equal([67, 64, 60]);
    expect(JSON.stringify(p)).to.equal(before);
    source.mapping.phrase = null;
    expect(createSoundAuditionPlan(source, p, 30).notes.map(n => n.offsetMs)).to.deep.equal([0, 0, 0]);
  });

  it('explains disabled, muted and solo-excluded test events', function() {
    const p = makeProject(), source = p.sources[0];
    source.enabled = false; expect(createSoundAuditionPlan(source, p).reason).to.contain('off');
    source.enabled = true; p.tracks[0].mute = true; expect(createSoundAuditionPlan(source, p).reason).to.contain('muted');
    p.tracks[0].mute = false; p.tracks.push({ id: 'other', solo: true, mute: false });
    expect(createSoundAuditionPlan(source, p).reason).to.contain('excluded by solo');
  });
});

describe('spatial transfer curves', function() {
  it('interpolates normalized positions and honors end-point overrides', function() {
    expect(positionCurveValue({}, 0.5, 10, 20)).to.equal(15);
    const curve = { points: [{ beat: 0.5, value: 80 }] };
    expect(positionCurveValue(curve, 0.5, 0, 100)).to.equal(80);
    expect(positionCurveValue(curve, 0.25, 0, 100)).to.equal(40);
    expect(positionCurveValue(curve, 0.75, 0, 100)).to.equal(90);
    expect(positionCurveValue({ points: [{ position: 0, value: 20 }, { position: 1, value: 30 }] }, 0.5, 0, 100)).to.equal(25);
  });
  it('ignores malformed and legacy out-of-range points without nonfinite output', function() {
    expect(positionCurveValue({ points: [{ beat: 9, value: 200 }, { beat: 0.2, value: NaN }] }, 0.5, 0, 100)).to.equal(50);
  });
});
