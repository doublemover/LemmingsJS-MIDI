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

describe('MidiMapping', function() {
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

  it('uses octave defaults when mapping degrees', function() {
    const mapping = makeMapping({
      noteDefaults: { degree: null, octave: null },
      sfx: { '1': { degree: 2 }, '2': { degree: 2, octave: 5 } }
    });

    const fallback = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(fallback.note).to.equal(50);

    const explicit = mapping.mapEvent({ sfxId: 2 }, {}, 0);
    expect(explicit.note).to.equal(62);
  });

  it('computes view pan using level width when viewRect is missing', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0.1,
        panOnscreenWeight: 0.8,
        panOffscreenWeight: 0.2,
        panOffscreenRange: 1
      }
    });
    const spec = mapping.mapEvent({ sfxId: 1, x: 75 }, { levelWidth: 100 }, 0);
    expect(spec.pan).to.be.a('number');
  });

  it('keeps view pan null when view width is unavailable', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: null,
        panDeadZonePct: null,
        panOnscreenWeight: null,
        panOffscreenWeight: null,
        panOffscreenRange: null
      }
    });

    const spec = mapping.mapEvent({ sfxId: 1, x: 10 }, {}, 0);
    expect(spec.pan).to.equal(null);
  });

  it('falls back to the default scale when the name is unknown', function() {
    const mapping = makeMapping({
      scale: { name: 'mystery-scale', degrees: [] },
      noteRange: { min: 60, max: 60 }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.equal(60);
  });

  it('quantizes notes upward and downward to the scale', function() {
    const mapping = makeMapping({
      scale: { degrees: [0], root: 0 },
      noteRange: { min: 0, max: 127 }
    });

    const up = mapping.mapEvent({ sfxId: 1 }, {}, 0, { note: 59 });
    const down = mapping.mapEvent({ sfxId: 1 }, {}, 0, { note: 61 });
    expect(up.note).to.equal(60);
    expect(down.note).to.equal(60);
  });

  it('keeps notes unchanged when no scale degree is within range', function() {
    const mapping = makeMapping({
      scale: { degrees: [99], root: 0 },
      noteRange: { min: 0, max: 127 }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0, { note: 60 });
    expect(spec.note).to.equal(60);
  });

  it('handles chord inversions', function() {
    const mapping = new MidiMapping({
      scale: { name: 'major', root: 0, degrees: [0, 2, 4, 5, 7, 9, 11] },
      noteDefaults: { octave: 4, degree: 0, chord: 'triad' },
      sfx: { '1': { degree: 0, chord: { type: 'triad', inversion: 1 } } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.notes).to.eql([52, 55, 60]);
  });

  it('maps degrees to scale notes when chord is not specified', function() {
    const mapping = new MidiMapping({
      scale: { name: 'major', root: 0, degrees: [0, 2, 4, 5, 7, 9, 11] },
      noteDefaults: { octave: 4, degree: 0 },
      sfx: { '1': { degree: 2, octave: 4 } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.equal(52);
  });

  it('applies note offsets to note arrays', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 0, max: 127 },
      position: {
        mappings: [{ axis: 'x', target: 'note', min: 0, max: 12, enabled: true }],
        viewPan: false
      },
      sfx: { '1': { notes: [60, 64, 67] } }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100 },
      { levelWidth: 100, levelHeight: 100 },
      0
    );

    expect(spec.notes).to.eql([72, 76, 79]);
    expect(spec.note).to.equal(72);
  });

  it('applies pitch bend and sustain overrides from position mappings', function() {
    const spec = mapEvent({
      position: {
        mappings: [
          { axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true },
          { axis: 'x', target: 'attack', min: 0, max: 2, enabled: true },
          { axis: 'x', target: 'sustain', min: 0.5, max: 1.5, enabled: true },
          { axis: 'x', target: 'unknown', min: 0, max: 1, enabled: true }
        ]
      }
    }, { sfxId: 1, x: 100 }, { levelWidth: 100, levelHeight: 100 }, 0);

    expect(spec.pitchBend).to.equal(1);
    expect(spec.durationTicks).to.be.greaterThan(0);
  });

  it('applies intensity scaling and per-event envelope overrides', function() {
    const spec = mapEvent({
      velocityRange: { min: 10, max: 127, default: 50 },
      envelope: { attack: 1, decay: 0, sustain: 1, release: 1 },
      sfx: { '1': { envelope: { attack: 1.5, release: 0.5 } } }
    }, { sfxId: 1, intensity: 1.2 }, {}, 0);
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

  it('handles null JSON input and array overrides', function() {
    const fresh = MidiMapping.fromJson(null);
    expect(fresh.config).to.be.ok;
    const merged = MidiMapping.mergeConfigs(
      { noteRange: { min: 40, max: 60 } },
      { noteRange: [1, 2, 3] }
    );
    expect(merged.noteRange).to.eql([1, 2, 3]);
  });

  it('applies explicit position mappings', function() {
    const mapping = makeMapping({
      position: {
        mappings: [
          { axis: 'x', target: 'note', min: -12, max: 12, enabled: true },
          { axis: 'y', target: 'velocity', min: 110, max: 10, enabled: true },
          { axis: 'y', target: 'timbre', min: 127, max: 0, enabled: true }
        ]
      },
      velocityRange: { min: 10, max: 110, default: 80 }
    });
    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100, y: 50 },
      { levelWidth: 100, levelHeight: 100 },
      0
    );
    expect(spec.timbre).to.be.within(0, 127);
  });

  it('applies mapping targets and skips missing axis values', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 60, max: 72 },
      velocityRange: { min: 1, max: 127, default: 60 },
      durationTicks: { default: 4, min: 1, max: 10 },
      position: {
        mappings: [
          { axis: 'x', target: 'note', min: -12, max: 12, enabled: true },
          { axis: 'x', target: 'velocity', min: 10, max: 100, enabled: true },
          { axis: 'y', target: 'timbre', min: 20, max: 80, enabled: true },
          { axis: 'x', target: 'pan', min: -100, max: 100, enabled: true },
          { axis: 'y', target: 'duration', min: 2, max: 6, enabled: true },
          { axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true },
          { axis: 'x', target: 'attack', min: 0, max: 2, enabled: true },
          { axis: 'x', target: 'decay', min: 0, max: 2, enabled: true },
          { axis: 'y', target: 'sustain', min: 0.5, max: 1.5, enabled: true },
          { axis: 'y', target: 'release', min: 0, max: 2, enabled: true },
          { axis: 'x', enabled: true }
        ],
        viewPan: false
      }
    });
    const spec = mapping.mapEvent(
      { sfxId: 1, x: 50, y: 50 },
      { levelWidth: 100, levelHeight: 100 },
      0
    );
    expect(spec.pan).to.not.equal(null);
    expect(spec.pitchBend).to.be.a('number');

    const missingAxis = mapping.mapEvent(
      { sfxId: 1, x: 50 },
      { levelWidth: 100 },
      0
    );
    expect(missingAxis.velocity).to.be.a('number');
  });

  it('quantizes notes already in scale and clamps out-of-range notes', function() {
    const mapping = makeMapping({
      scale: { degrees: [0, 4, 7], root: 0 },
      noteRange: { min: 60, max: 72 },
      sfx: { '1': { note: 64 } }
    });
    const inScale = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(inScale.note).to.equal(64);

    const clamped = mapping.mapEvent({ sfxId: 1 }, {}, 0, { note: 30 });
    expect(clamped.note).to.equal(67);
  });

  it('builds sixth chords and falls back to triads', function() {
    const mapping = new MidiMapping({
      scale: { name: 'major', root: 0, degrees: [0, 2, 4, 5, 7, 9, 11] },       
      noteDefaults: { octave: 4, degree: 0, chord: 'triad' }
    });
    const sixth = mapping.mapEvent({ sfxId: 1 }, {}, 0, { degree: 0, chord: { type: 'sixth' } });
    expect(sixth.notes).to.have.length(4);
    const fallback = mapping.mapEvent({ sfxId: 1 }, {}, 0, { degree: 0, chord: { type: 'unknown' } });
    expect(fallback.notes).to.have.length(3);
  });

  it('respects explicit values while applying pitch bend overrides', function() {
    const mapping = new MidiMapping({
      position: {
        mappings: [
          { axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true },
          { axis: 'x', target: 'velocity', min: 10, max: 100, enabled: true },
          { axis: 'x', target: 'duration', min: 2, max: 6, enabled: true }
        ],
        viewPan: false
      },
      velocityRange: { min: 1, max: 127, default: 50 },
      durationTicks: { default: 4, min: 1, max: 10 }
    });

    const specFreq = mapping.mapEvent(
      { sfxId: 1, x: 50 },
      { levelWidth: 100, levelHeight: 100 },
      0,
      { frequencyHz: 440, velocity: 90, durationTicks: 8 }
    );
    expect(specFreq.pitchBend).to.equal(0);
    expect(specFreq.velocity).to.equal(90);
    expect(specFreq.durationTicks).to.equal(8);

    const specOverride = mapping.mapEvent(
      { sfxId: 1, x: 100 },
      { levelWidth: 100, levelHeight: 100 },
      0
    );
    expect(specOverride.pitchBend).to.equal(1);
  });

  it('skips chord mapping when a note is already provided', function() {
    const mapping = makeMapping({
      scale: { name: 'major', root: 0, degrees: [0, 2, 4, 5, 7, 9, 11] },
      noteRange: { min: 60, max: 72 }
    });
    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0, { chord: { type: 'triad' }, note: 65 });
    expect(spec.notes).to.equal(null);
    expect(spec.note).to.equal(65);
  });

  it('handles view pan dead zones and empty widths', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0.5,
        panOnscreenWeight: 1,
        panOffscreenWeight: 0,
        panOffscreenRange: 1
      }
    });
    const center = mapping.mapEvent({ sfxId: 1, x: 50 }, { viewRect: { x: 0, w: 100 } }, 0);
    expect(center.pan).to.equal(0);

    const zero = mapping.mapEvent({ sfxId: 1, x: 10 }, { viewRect: { x: 0, w: 0 } }, 0);
    expect(zero.pan).to.equal(null);
  });

  it('returns null for missing events and ignores non-plain envelopes', function() {
    const mapping = makeMapping();
    expect(mapping.mapEvent(null, {}, 0)).to.equal(null);

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0, { envelope: [] });
    expect(spec.velocity).to.be.a('number');
  });

  it('mapEvent uses defaults and override sfx', function() {
    const mapping = makeMapping();
    const spec = mapping.mapEvent({ sfxId: 1 });
    expect(spec.note).to.be.a('number');

    const overrideSpec = mapping.mapEvent({ sfxId: 1 }, undefined, undefined, { note: 70 });
    expect(overrideSpec.note).to.equal(70);
  });

  it('mapEvent applies mapping targets and disabled entries', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 60, max: 72 },
      velocityRange: { min: 1, max: 127, default: 64 },
      durationTicks: { default: 4, min: 1, max: 10 },
      density: { windowTicks: 10, velocityBoost: 0.1, durationScale: 0.1 },
      position: {
        mappings: [
          { axis: 'x', target: 'note', min: -12, max: 12, enabled: true },
          { axis: 'x', target: 'velocity', min: 10, max: 100, enabled: true },
          { axis: 'y', target: 'timbre', min: 20, max: 80, enabled: true },
          { axis: 'x', target: 'pan', min: -50, max: 50, enabled: true },
          { axis: 'x', target: 'duration', min: 2, max: 6, enabled: true },
          { axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true },
          { axis: 'x', target: 'attack', min: 0, max: 2, enabled: true },
          { axis: 'y', target: 'sustain', min: 0.5, max: 1.5, enabled: true },
          { axis: 'x', target: 'unknown', enabled: true },
          { axis: 'y', target: 'velocity', enabled: false }
        ],
        viewPan: false,
        timbreRange: { min: 0, max: 127 },
        panRange: { min: -50, max: 50 }
      }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100, y: 50, intensity: 1.5 },
      { levelWidth: 100, levelHeight: 100 },
      0.5
    );
    expect(spec.timbre).to.be.within(0, 127);
    expect(spec.pan).to.be.within(-50, 50);
    expect(spec.durationTicks).to.be.at.least(1);

    const missingAxis = mapping.mapEvent(
      { sfxId: 1, x: 50 },
      { levelWidth: 100 },
      0
    );
    expect(missingAxis.timbre).to.equal(null);
  });

  it('mapEvent offsets note arrays and pitch bend overrides', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 60, max: 72 },
      velocityRange: { min: 1, max: 127, default: 60 },
      position: {
        mappings: [
          { axis: 'x', target: 'note', min: 0, max: 12, enabled: true },
          { axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true }
        ],
        viewPan: false
      },
      sfx: { '1': { notes: [60, 64] } }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100 },
      { levelWidth: 100, levelHeight: 100 },
      0
    );
    expect(spec.notes[0]).to.equal(72);
    expect(spec.pitchBend).to.equal(1);
  });

  it('mapEvent applies envelope defaults and view pan fallbacks', function() {  
    const mapping = new MidiMapping({
      envelope: { attack: NaN, decay: NaN, sustain: NaN, release: NaN },
      position: {
        mappings: [],
        viewPan: true,
        panDeadZonePct: 1,
        panOnscreenWeight: 1,
        panOffscreenWeight: 0,
        panOffscreenRange: 1
      }
    });
    const spec = mapping.mapEvent(
      { sfxId: 1, x: 50 },
      { viewRect: { x: 0, w: 100 } },
      0,
      { envelope: { attack: NaN } }
    );
    expect(spec.pan).to.equal(0);
    expect(spec.releaseVelocity).to.be.a('number');
  });

  it('mapEvent returns null for missing events and uses defaults', function() {
    const mapping = new MidiMapping();
    expect(mapping.mapEvent(null, {}, 0)).to.equal(null);
    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.be.a('number');
  });

  it('mapEvent handles overrides and unknown mapping targets', function() {
    const mapping = new MidiMapping({
      position: {
        mappings: [
          { axis: 'y', target: 'unknown', enabled: true },
          { axis: 'y', target: 'velocity', enabled: false }
        ],
        viewPan: false
      }
    });
    const spec = mapping.mapEvent(
      { sfxId: 1, y: 50 },
      { levelWidth: 100, levelHeight: 100 },
      0,
      { note: 60, velocity: 90 }
    );
    expect(spec.velocity).to.equal(90);
  });

  it('mapEvent uses pitch bend overrides without frequency data', function() {
    const mapping = new MidiMapping({
      position: {
        mappings: [{ axis: 'x', target: 'pitchBend', min: -1, max: 1, enabled: true }],
        viewPan: false
      }
    });
    const spec = mapping.mapEvent(
      { sfxId: 1, x: 100 },
      { levelWidth: 100, levelHeight: 100 },
      0,
      { note: 60 }
    );
    expect(spec.pitchBend).to.equal(1);
  });

  it('uses note defaults for chord mapping when degree is missing', function() {
    const mapping = new MidiMapping({
      scale: { name: 'major', root: 0 },
      noteDefaults: { degree: 1, octave: 5, chord: 'seventh' },
      sfx: { '1': { chord: {} } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.notes).to.have.length(4);
    expect(spec.note).to.equal(spec.notes[0]);
  });

  it('computes view pan from level width when no view rect is present', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: { min: -127, max: 127 },
        panDeadZonePct: 0,
        panOnscreenWeight: 1,
        panOffscreenWeight: 0,
        panOffscreenRange: 1
      }
    });

    const spec = mapping.mapEvent({ sfxId: 1, x: 0 }, { levelWidth: 100 }, 0);
    expect(spec.pan).to.be.lessThan(0);
  });

  it('builds chord defaults when note defaults are null', function() {
    const mapping = makeMapping({
      scale: { name: 'custom', root: 1, degrees: [0, 3, 7] },
      noteDefaults: { degree: null, octave: null, chord: null },
      noteRange: { min: 0, max: 127 },
      sfx: { '1': { chord: {}, note: null } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.notes).to.have.length(3);
    expect(spec.note).to.equal(49);
  });

  it('applies position mappings with null range defaults', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 60, max: 72 },
      velocityRange: { min: null, max: null, default: 80 },
      durationTicks: { min: null, max: null, default: 4 },
      position: {
        mappings: [
          { axis: 'x', target: 'note', enabled: true },
          { axis: 'x', target: 'velocity', enabled: true },
          { axis: 'y', target: 'timbre', enabled: true },
          { axis: 'x', target: 'pan', enabled: true },
          { axis: 'y', target: 'duration', enabled: true }
        ],
        xNoteRange: null,
        timbreRange: null,
        panRange: null,
        viewPan: false
      },
      sfx: { '1': { note: 60 } }
    });

    const spec = mapping.mapEvent(
      { sfxId: 1, x: 50, y: 50 },
      { levelWidth: 100, levelHeight: 100 },
      0
    );

    expect(spec.velocity).to.be.within(1, 127);
    expect(spec.timbre).to.be.within(0, 127);
    expect(spec.pan).to.be.within(-127, 127);
    expect(spec.durationTicks).to.be.within(1, 999);
  });

  it('computes view pan fallbacks with view rect weights', function() {
    const mapping = makeMapping({
      position: {
        viewPan: true,
        panRange: { min: 0, max: 0 },
        panDeadZonePct: 1,
        panOnscreenWeight: 0,
        panOffscreenWeight: 0,
        panOffscreenRange: null
      },
      sfx: { '1': { note: 60 } }
    });

    const context = { viewRect: { x: 20, w: 100 }, levelWidth: 200 };
    const centered = mapping.mapEvent({ sfxId: 1, x: 70 }, context, 0);
    const offscreen = mapping.mapEvent({ sfxId: 1, x: 170 }, context, 0);
    expect(centered.pan).to.equal(0);
    expect(offscreen.pan).to.equal(0);
  });

  it('merges configs with default fallbacks', function() {
    const merged = MidiMapping.mergeConfigs(null, null);
    expect(merged.scale.name).to.be.a('string');
  });

  it('mergeConfigs preserves base when override is null', function() {
    const merged = MidiMapping.mergeConfigs({ timing: { bpmBase: 90 } }, null);
    expect(merged.timing.bpmBase).to.equal(90);
  });

  it('clamps notes when the note range min is null', function() {
    const mapping = makeMapping({
      noteRange: { min: null, max: 60 },
      sfx: { '1': { note: 80 } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.equal(56);
  });

  it('skips chord mapping when a note is already set', function() {
    const mapping = makeMapping({
      scale: { name: 'major', root: 0 },
      noteRange: { min: 0, max: 127 },
      sfx: { '1': { note: 62, chord: { type: 'seventh' } } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.notes).to.equal(null);
    expect(spec.note).to.equal(62);
  });

  it('uses fallback velocity and duration defaults when config values are null', function() {
    const mapping = makeMapping({
      velocityRange: { min: null, max: null, default: null },
      durationTicks: { min: null, max: null, default: null }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.velocity).to.equal(127);
    expect(spec.durationTicks).to.equal(6);
  });

  it('uses scale degrees with a null root', function() {
    const mapping = makeMapping({
      scale: { name: 'custom', degrees: [0, 2, 4], root: null },
      noteDefaults: { degree: 0, octave: 4 },
      sfx: { '1': { degree: 1 } }
    });

    const spec = mapping.mapEvent({ sfxId: 1 }, {}, 0);
    expect(spec.note).to.equal(50);
  });

  it('defaults axisOp to add when not provided', function() {
    const spec = mapEvent({
      velocityRange: { min: 0, max: 100, default: 0 },
      position: {
        mappings: [{ axis: 'xy', target: 'velocity', min: 0, max: 100, enabled: true }]
      }
    }, { sfxId: 1, x: 50, y: 50 }, { levelWidth: 100, levelHeight: 100 }, 0);
    expect(spec.velocity).to.equal(50);
  });
});
