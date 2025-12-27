import { expect } from 'chai';
import { MidiMapping } from '../../js/midi/MidiMapping.js';

describe('MidiMapping', function() {
  it('maps frequency to note and pitch bend', function() {
    const freq = 440 * Math.pow(2, 0.5 / 12);
    const mapping = new MidiMapping({
      position: {
        xToNote: false,
        yToVelocity: false,
        yToTimbre: false,
        viewPan: false
      },
      mpe: {
        pitchBendRange: { semitones: 2, cents: 0 }
      },
      sfx: {
        '1': { frequencyHz: freq }
      }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, { levelWidth: 100, levelHeight: 100 }, 0);
    const floatNote = 69 + 12 * Math.log2(freq / 440);
    const baseNote = Math.round(floatNote);
    const expectedBend = (floatNote - baseNote) / 2;

    expect(spec.note).to.equal(baseNote);
    expect(spec.pitchBend).to.be.closeTo(expectedBend, 0.01);
    expect(spec.frequencyHz).to.equal(freq);
  });

  it('applies position and density adjustments', function() {
    const mapping = new MidiMapping({
      scale: { degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], root: 0 },
      noteRange: { min: 60, max: 72 },
      velocityRange: { min: 20, max: 100, default: 80 },
      durationTicks: { default: 10, min: 2, max: 20 },
      density: { windowTicks: 24, velocityBoost: 0.4, durationScale: 0.5 },
      position: {
        xToNote: true,
        xNoteRange: { min: -12, max: 12 },
        yToVelocity: true,
        yToTimbre: true,
        timbreRange: { min: 20, max: 100 },
        viewPan: false
      }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100, y: 50 },
      { levelWidth: 100, levelHeight: 100 },
      0.5
    );

    expect(spec.note).to.equal(66);
    expect(spec.velocity).to.equal(72);
    expect(spec.durationTicks).to.equal(8);
    expect(spec.timbre).to.equal(60);
  });

  it('calculates pan from the view window', function() {
    const mapping = new MidiMapping({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0.1,
        panOnscreenWeight: 1,
        panOffscreenWeight: 0,
        panOffscreenRange: 1
      }
    });

    const center = mapping.mapEvent(
      { sfxId: 1, x: 50 },
      { viewRect: { x: 0, w: 100 } },
      0
    );
    const right = mapping.mapEvent(
      { sfxId: 1, x: 100 },
      { viewRect: { x: 0, w: 100 } },
      0
    );

    expect(center.pan).to.equal(0);
    expect(right.pan).to.be.greaterThan(0);
    expect(right.pan).to.be.at.most(127);
  });

  it('parses JSON input and handles invalid JSON', function() {
    const valid = MidiMapping.fromJson('{"noteRange":{"min":50,"max":51}}');
    expect(valid.config.noteRange.min).to.equal(50);
    const invalid = MidiMapping.fromJson('{bad');
    expect(invalid.config).to.be.ok;
  });

  it('returns sfx config and skips disabled events', function() {
    const mapping = new MidiMapping({
      enabled: true,
      sfx: { '2': { note: 61, disabled: true } }
    });
    expect(mapping.getSfxConfig(2).note).to.equal(61);
    expect(mapping.getSfxConfig(3)).to.equal(null);
    const spec = mapping.mapEvent({ sfxId: 2 }, {}, 0);
    expect(spec).to.equal(null);

    const disabled = new MidiMapping({ enabled: false });
    expect(disabled.mapEvent({ sfxId: 1 }, {}, 0)).to.equal(null);
  });

  it('quantizes and clamps notes with custom scale', function() {
    const mapping = new MidiMapping({
      scale: { degrees: [], root: 0 },
      noteRange: { min: 60, max: 61 },
      position: { xToNote: false, yToVelocity: false, yToTimbre: false, viewPan: false }
    });
    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.equal(61);
  });

  it('computes pan for offscreen events and keeps defaults', function() {
    const mapping = new MidiMapping({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0.1,
        panOnscreenWeight: 0.5,
        panOffscreenWeight: 0.5,
        panOffscreenRange: 1,
        xToNote: false,
        yToVelocity: false,
        yToTimbre: false
      }
    });
    const spec = mapping.mapEvent({ sfxId: 1, x: 300 }, { viewRect: { x: 0, w: 100 } }, 0);
    expect(spec.pan).to.be.greaterThan(0);
  });

  it('builds chords and applies envelope settings', function() {
    const mapping = new MidiMapping({
      scale: { name: 'major', root: 0 },
      noteDefaults: { octave: 4, degree: 0, chord: 'triad' },
      envelope: { attack: 1.2, decay: 0.1, sustain: 1, release: 0.8 },
      sfx: { '1': { degree: 0, chord: { type: 'triad' } } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.notes).to.have.length(3);
    expect(spec.velocity).to.be.greaterThan(0);
    expect(spec.releaseVelocity).to.be.greaterThan(0);
  });

  it('applies intensity scaling and per-event envelope overrides', function() {
    const mapping = new MidiMapping({
      velocityRange: { min: 10, max: 127, default: 50 },
      envelope: { attack: 1, decay: 0, sustain: 1, release: 1 },
      position: { xToNote: false, yToVelocity: false, yToTimbre: false, viewPan: false },
      sfx: { '1': { envelope: { attack: 1.5, release: 0.5 } } }
    });

    const spec = mapping.mapEvent({ sfxId: 1, intensity: 1.2 }, {}, 0);
    expect(spec.velocity).to.equal(90);
    expect(spec.releaseVelocity).to.equal(45);
  });

  it('merges configs with overrides', function() {
    const merged = MidiMapping.mergeConfigs(
      { noteRange: { min: 40, max: 60 }, scale: { root: 1 } },
      { noteRange: { max: 72 }, scale: { name: 'minor' } }
    );
    expect(merged.noteRange.min).to.equal(40);
    expect(merged.noteRange.max).to.equal(72);
    expect(merged.scale.root).to.equal(1);
    expect(merged.scale.name).to.equal('minor');
  });
});
