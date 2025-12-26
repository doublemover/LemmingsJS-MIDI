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

    expect(spec.note).to.equal(78);
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
});
