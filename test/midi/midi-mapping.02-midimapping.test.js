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

describe('MidiMapping 2', function() {
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
});
