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

describe('MidiMapping 3', function() {
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
