import { expect } from 'chai';
import { MidiMapping } from '../../js/midi/MidiMapping.js';

const basePosition = {
  mappings: [],
  viewPan: false
};

const normalizeConfig = (config = {}) => {
  const hasPosition = Object.prototype.hasOwnProperty.call(config, 'position');
  const position = hasPosition
    ? (config.position === null ? null : { ...basePosition, ...config.position })
    : basePosition;
  return { ...config, position };
};

const makeMapping = (config) => new MidiMapping(normalizeConfig(config));
const mapEvent = (config, event = { sfxId: 1 }, context = {}, density = 0, overrides) => {
  const mapping = makeMapping(config);
  return mapping.mapEvent(event, context, density, overrides);
};

const expectSpec = (spec, expected) => {
  for (const [key, value] of Object.entries(expected)) {
    expect(spec[key]).to.eql(value);
  }
};

describe('MidiMapping 1', function() {
  const mappingCases = [
    {
      name: 'applies position and density adjustments',
      config: {
        scale: { degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], root: 0 },
        noteRange: { min: 60, max: 72 },
        velocityRange: { min: 20, max: 100, default: 80 },
        durationTicks: { default: 10, min: 2, max: 20 },
        density: { windowTicks: 24, velocityBoost: 0.4, durationScale: 0.5 },
        position: {
          mappings: [
            { axis: 'x', target: 'note', min: -12, max: 12, enabled: true },
            { axis: 'y', target: 'velocity', min: 100, max: 20, enabled: true },
            { axis: 'y', target: 'timbre', min: 100, max: 20, enabled: true }
          ],
          timbreRange: { min: 20, max: 100 }
        }
      },
      event: { sfxId: 1, x: 100, y: 50 },
      context: { levelWidth: 100, levelHeight: 100 },
      density: 0.5,
      expect: { note: 66, velocity: 72, durationTicks: 8, timbre: 60 }
    },
    {
      name: 'applies note offsets to explicit notes',
      config: {
        noteRange: { min: 60, max: 72 },
        position: {
          mappings: [{ axis: 'x', target: 'note', min: 0, max: 12, enabled: true }]
        },
        sfx: { '1': { note: 60 } }
      },
      event: { sfxId: 1, x: 100 },
      context: { levelWidth: 100, levelHeight: 100 },
      expect: { note: 72 }
    },
    {
      name: 'applies duration overrides from position mappings',
      config: {
        durationTicks: { default: 4, min: 1, max: 10 },
        position: {
          mappings: [{ axis: 'x', target: 'duration', min: 2, max: 6, enabled: true }]
        }
      },
      event: { sfxId: 1, x: 50 },
      context: { levelWidth: 100, levelHeight: 100 },
      expect: { durationTicks: 4 }
    },
    {
      name: 'applies pan overrides from position mappings',
      config: {
        position: {
          mappings: [{ axis: 'x', target: 'pan', min: -127, max: 127, enabled: true }],
          panRange: { min: -127, max: 127 }
        }
      },
      event: { sfxId: 1, x: 100 },
      context: { levelWidth: 100, levelHeight: 100 },
      expect: { pan: 127 }
    }
  ];

  for (const testCase of mappingCases) {
    it(testCase.name, function() {
      const spec = mapEvent(
        testCase.config,
        testCase.event,
        testCase.context,
        testCase.density,
        testCase.overrides
      );
      expectSpec(spec, testCase.expect);
    });
  }

  it('maps frequency to note and pitch bend', function() {
    const freq = 440 * Math.pow(2, 0.5 / 12);
    const mapping = makeMapping({
      mpe: { pitchBendRange: { semitones: 2, cents: 0 } },
      sfx: { '1': { frequencyHz: freq } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, { levelWidth: 100, levelHeight: 100 }, 0);
    const floatNote = 69 + 12 * Math.log2(freq / 440);
    const baseNote = Math.round(floatNote);
    const expectedBend = (floatNote - baseNote) / 2;

    expect(spec.note).to.equal(baseNote);
    expect(spec.pitchBend).to.be.closeTo(expectedBend, 0.01);
    expect(spec.frequencyHz).to.equal(freq);
  });

  it('falls back to a safe pitch-bend range when semitones are invalid', function() {
    const mapping = makeMapping({
      mpe: { pitchBendRange: { semitones: 0, cents: 0 } },
      sfx: { '1': { frequencyHz: 440 } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);

    expect(Number.isFinite(spec.pitchBend)).to.equal(true);
    expect(spec.pitchBend).to.equal(0);
  });

  it('applies axisX/axisY mappings across targets', function() {
    const spec = mapEvent({
      velocityRange: { min: 1, max: 101, default: 1 },
      durationTicks: { default: 5, min: 1, max: 10 },
      position: {
        mappings: [
          { axisX: true, axisY: true, axisOp: 'sub', target: 'velocity', min: 1, max: 101, enabled: true },
          { axisX: true, axisY: false, target: 'timbre', min: 0, max: 100, enabled: true },
          { axisX: false, axisY: true, target: 'pan', min: -127, max: 127, enabled: true },
          { axisX: false, axisY: false, target: 'duration', min: 1, max: 9, enabled: true }
        ],
        timbreRange: { min: 0, max: 100 },
        panRange: { min: -127, max: 127 }
      }
    }, { sfxId: 1, x: 25, y: 75 }, { levelWidth: 100, levelHeight: 100 }, 0);

    expectSpec(spec, {
      velocity: 26,
      timbre: 25,
      pan: 64,
      durationTicks: 5
    });
  });

  it('skips axisX/axisY mappings when values are missing', function() {
    const spec = mapEvent({
      velocityRange: { min: 1, max: 127, default: 10 },
      position: {
        mappings: [{ axisX: true, axisY: true, axisOp: 'mul', target: 'velocity', min: 1, max: 127, enabled: true }]
      }
    }, { sfxId: 1, x: 50 }, { levelWidth: 100, levelHeight: null }, 0);

    expect(spec.velocity).to.equal(10);
  });

  it('applies xy axis operations for mappings', function() {
    const config = {
      velocityRange: { min: 1, max: 101, default: 1 },
      position: {
        mappings: [
          { axis: 'xy', axisOp: 'sub', target: 'velocity', min: 1, max: 101, enabled: true },
          { axis: 'xy', axisOp: 'mul', target: 'timbre', min: 0, max: 100, enabled: true },
          { axis: 'xy', axisOp: 'div', target: 'pan', min: -127, max: 127, enabled: true }
        ],
        timbreRange: { min: 0, max: 100 },
        panRange: { min: -127, max: 127 }
      }
    };
    const spec = mapEvent(config, { sfxId: 1, x: 25, y: 75 }, { levelWidth: 100, levelHeight: 100 }, 0);

    expectSpec(spec, { velocity: 26, timbre: 19 });
    expect(spec.pan).to.be.below(0);

    const zeroSpec = mapEvent(config, { sfxId: 1, x: 25, y: 0 }, { levelWidth: 100, levelHeight: 100 }, 0);

    expect(zeroSpec.pan).to.equal(127);
  });

  it('skips xy mappings when axis values are missing', function() {
    const spec = mapEvent({
      velocityRange: { min: 1, max: 127, default: 10 },
      position: {
        mappings: [{ axis: 'xy', target: 'velocity', min: 1, max: 127, enabled: true }]
      }
    }, { sfxId: 1, x: 50 }, { levelWidth: 100, levelHeight: null }, 0);

    expect(spec.velocity).to.equal(10);
  });

  it('calculates pan from the view window', function() {
    const mapping = makeMapping({
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

  it('uses pan defaults when optional settings are missing', function() {
    const spec = mapEvent(
      { position: { viewPan: true } },
      { sfxId: 1, x: 80 },
      { viewRect: { x: 0, w: 100 }, levelWidth: 100 },
      0
    );

    expect(spec.pan).to.be.at.least(-127);
    expect(spec.pan).to.be.at.most(127);
  });

  it('falls back to view pan defaults when config values are null', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: null,
        panDeadZonePct: null,
        panOnscreenWeight: null,
        panOffscreenWeight: null,
        panOffscreenRange: null,
      }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 80 },
      { viewRect: { x: 0, w: 100 } },
      0
    );

    expect(spec.pan).to.be.within(-127, 127);
    expect(spec.pan).to.not.equal(0);
  });

  it('keeps view pan at zero when weights are zero', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0,
        panOnscreenWeight: 0,
        panOffscreenWeight: 0,
        panOffscreenRange: 1,
      }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100 },
      { viewRect: { x: 0, w: 50 } },
      0
    );

    expect(spec.pan).to.equal(0);
  });

  it('uses default ranges when config values are null', function() {
    const mapping = makeMapping({
      noteRange: null,
      velocityRange: null,
      durationTicks: null,
      density: null,
      position: null,
      noteDefaults: null,
      envelope: null
    });
    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.be.a('number');
    expect(spec.velocity).to.be.within(1, 127);
  });

  it('defaults axis and target when mappings omit them', function() {
    const spec = mapEvent({
      velocityRange: { min: 10, max: 20, default: 10 },
      position: { mappings: [{ min: 10, max: 20, enabled: true }] }
    }, { sfxId: 1, x: 100 }, { levelWidth: 100 }, 0);
    expect(spec.velocity).to.equal(20);
  });

  it('uses default pitch bend range when mpe config is missing', function() {
    const spec = mapEvent({
      mpe: null,
      sfx: { '1': { frequencyHz: 450 } }
    }, { sfxId: 1 }, {}, 0);
    expect(spec.pitchBend).to.be.a('number');
  });

  it('returns null for getSfxConfig when sfxId is null', function() {
    const mapping = makeMapping();
    expect(mapping.getSfxConfig(null)).to.equal(null);
  });

  it('keeps explicit velocity when position mappings are present', function() {
    const spec = mapEvent({
      velocityRange: { min: 10, max: 127, default: 80 },
      position: { mappings: [{ axis: 'x', target: 'velocity', min: 10, max: 20, enabled: true }] }
    }, { sfxId: 1, x: 100 }, { levelWidth: 100 }, 0, { velocity: 90 });

    expect(spec.velocity).to.equal(90);
  });

  it('parses JSON input and handles invalid JSON', function() {
    const valid = MidiMapping.fromJson('{"noteRange":{"min":50,"max":51}}');
    expect(valid.config.noteRange.min).to.equal(50);
    const direct = MidiMapping.fromJson({ noteRange: { min: 48, max: 49 } });
    expect(direct.config.noteRange.max).to.equal(49);
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
    const mapping = makeMapping({
      scale: { degrees: [], root: 0 },
      noteRange: { min: 60, max: 61 }
    });
    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.equal(61);
  });

  it('covers position mapping targets and overrides', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 60, max: 72 },
      velocityRange: { min: 10, max: 120, default: 80 },
      durationTicks: { min: 1, max: 10, default: 4 },
      density: { velocityBoost: 0.5, durationScale: 0.5 },
      position: {
        mappings: [
          { axis: 'x', target: 'note', max: 12, enabled: true },
          { axis: 'x', target: 'velocity', enabled: true },
          { axis: 'x', target: 'timbre', min: 0, max: 127, enabled: true },
          { axis: 'x', target: 'pan', min: -50, max: 50, enabled: true },
          { axis: 'x', target: 'duration', min: 2, max: 6, enabled: true },
          { axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true },
          { axis: 'x', target: 'attack', min: 0, max: 2, enabled: true },
          { axis: 'x', target: 'decay', min: 0, max: 2, enabled: true },
          { axis: 'x', target: 'sustain', min: 0.5, max: 1.5, enabled: true },
          { axis: 'x', target: 'release', min: 0, max: 2, enabled: true },
          { axis: 'xy', target: 'velocity', min: 20, max: 100, enabled: true }
        ],
        timbreRange: { min: 0, max: 127 },
        panRange: { min: -127, max: 127 },
        viewPan: false
      },
      scale: { degrees: [0, 2, 4, 5, 7, 9, 11], root: 0 }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 50, y: 25, intensity: 1.2 },
      { levelWidth: 100, levelHeight: 50 },
      0.5,
      { notes: [60, 64], envelope: { attack: 1.2 } }
    );

    expect(spec.notes).to.have.length(2);
    expect(spec.pitchBend).to.be.a('number');
    expect(spec.timbre).to.be.a('number');
    expect(spec.pan).to.be.a('number');
  });

  it('skips mappings when axis values are missing', function() {
    const spec = mapEvent({
      position: {
        mappings: [{ axis: 'y', target: 'velocity', min: 0, max: 127, enabled: true }]
      }
    }, { sfxId: 1, x: 10 }, { levelWidth: 100, levelHeight: null }, 0);
    expect(spec.velocity).to.be.a('number');
  });

  it('handles null inputs for fromJson and mapEvent', function() {
    const mapping = MidiMapping.fromJson(null);
    expect(mapping.config).to.be.ok;
    expect(mapping.mapEvent(null)).to.equal(null);
  });

  it('computes pan for offscreen events and keeps defaults', function() {
    const spec = mapEvent({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0.1,
        panOnscreenWeight: 0.5,
        panOffscreenWeight: 0.5,
        panOffscreenRange: 1
      }
    }, { sfxId: 1, x: 300 }, { viewRect: { x: 0, w: 100 } }, 0);
    expect(spec.pan).to.be.greaterThan(0);
  });

  it('builds chords and applies envelope settings', function() {
    const mapping = makeMapping({
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

  it('builds scale notes from degree without chords', function() {
    const mapping = makeMapping({
      scale: { degrees: [0, 2, 4, 5, 7, 9, 11], root: 0 },
      noteRange: { min: 60, max: 72 },
      sfx: { '1': { degree: 2, octave: 4 } }
    });
    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.be.within(60, 72);
  });
});
