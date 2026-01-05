import { expect } from 'chai';
import { __test__ } from '../../js/midi/MidiMapping.js';

describe('MidiMapping helpers', function() {
  it('identifies plain objects and merges configs', function() {
    expect(__test__.isPlainObject({})).to.equal(true);
    expect(__test__.isPlainObject([])).to.equal(false);
    expect(Boolean(__test__.isPlainObject(null))).to.equal(false);
    expect(__test__.isPlainObject('nope')).to.equal(false);

    const base = { noteRange: { min: 40, max: 60 }, scale: { root: 1 } };
    const merged = __test__.mergeConfig(base, null);
    expect(merged.noteRange.min).to.equal(40);

    const mergedDefault = __test__.mergeConfig(base);
    expect(mergedDefault.noteRange.max).to.equal(60);

    const nested = __test__.mergeConfig(base, { noteRange: { max: 72 } });
    expect(nested.noteRange.max).to.equal(72);

    const arrayOverride = __test__.mergeConfig(base, { noteRange: [1, 2, 3] });
    expect(arrayOverride.noteRange).to.eql([1, 2, 3]);
  });

  it('builds position mappings and axis values', function() {
    const mappings = __test__.resolvePositionMappings({ mappings: [{ axis: 'x' }] }, { min: 1, max: 2 });
    expect(mappings).to.have.length(1);

    const toggles = __test__.resolvePositionMappings(
      {
        xToNote: true,
        yToVelocity: true,
        yToTimbre: true,
        xNoteRange: { min: -5, max: 5 },
        timbreRange: { min: 10, max: 20 }
      },
      { min: 10, max: 20 }
    );
    expect(toggles).to.have.length(3);

    const empty = __test__.resolvePositionMappings({}, { min: 1, max: 2 });
    expect(empty).to.have.length(0);

    const axis = __test__.resolveAxisValues({ x: 50, y: 20 }, { levelWidth: 100, levelHeight: 40 });
    expect(axis.x).to.equal(0.5);
    expect(axis.y).to.equal(0.5);
    expect(axis.xy).to.equal(0.5);

    const missing = __test__.resolveAxisValues({ x: 10 }, { levelWidth: 0, levelHeight: null });
    expect(missing.x).to.equal(null);
    expect(missing.y).to.equal(null);
  });

  it('resolves axis combinations and operations', function() {
    const axisValues = { x: 0.25, y: 0.5, xy: 0.375 };
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true, axisOp: 'sub' }, axisValues))
      .to.equal(0.375);
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true, axisOp: 'mul' }, axisValues))
      .to.equal(0.125);
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true, axisOp: 'add' }, axisValues))
      .to.equal(0.375);
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true }, axisValues))
      .to.equal(0.375);

    const divValues = { x: 0.5, y: 0, xy: 0.5 };
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true, axisOp: 'div' }, divValues))
      .to.equal(1);
    const divNonZero = { x: 0.4, y: 0.8, xy: 0.6 };
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true, axisOp: 'div' }, divNonZero))
      .to.equal(0.5);

    expect(__test__.resolveAxisValue({ axisX: true, axisY: false }, axisValues))
      .to.equal(0.25);
    expect(__test__.resolveAxisValue({ axisX: false, axisY: true }, axisValues))
      .to.equal(0.5);
    expect(__test__.resolveAxisValue({ axisX: false, axisY: false }, axisValues))
      .to.equal(null);

    const missingAxis = { x: 0.4, y: null, xy: 0.4 };
    expect(__test__.resolveAxisValue({ axis: 'xy' }, missingAxis)).to.equal(0.4);
    expect(__test__.resolveAxisValue({ axis: 'xy', axisOp: 'mul' }, axisValues))
      .to.equal(0.125);
    expect(__test__.resolveAxisValue({ axis: 'xy', axisOp: 'sub' }, axisValues))
      .to.equal(0.375);
    expect(__test__.resolveAxisValue({ axis: 'xy', axisOp: 'div' }, divValues))
      .to.equal(1);
    const divAxisValues = { x: 0.3, y: 0.6, xy: 0.45 };
    expect(__test__.resolveAxisValue({ axis: 'xy', axisOp: 'div' }, divAxisValues))
      .to.equal(0.5);
    expect(__test__.resolveAxisValue({ axis: 'x' }, axisValues)).to.equal(0.25);

    expect(__test__.resolveAxisValue(null, axisValues)).to.equal(0.25);
    const missingPair = { x: 0.4, y: null, xy: null };
    expect(__test__.resolveAxisValue({ axisX: true, axisY: true }, missingPair))
      .to.equal(null);
  });

  it('resolves scales and quantizes notes', function() {
    const scale = __test__.resolveScale({ name: 'major', root: 2 });
    expect(scale.degrees).to.have.length(7);

    const custom = __test__.resolveScale({ name: 'custom', root: 3, degrees: [0, 3, 7] });
    expect(custom.degrees).to.eql([0, 3, 7]);

    const fallback = __test__.resolveScale({ name: 'unknown', degrees: [] });
    expect(fallback.name).to.equal('chromatic-minor');

    const defaultQuantized = __test__.quantizeToScale(60.4, null);
    expect(defaultQuantized).to.equal(60);
    const rootFallback = __test__.quantizeToScale(61, { degrees: [0], root: null });
    expect(rootFallback).to.equal(60);

    expect(__test__.quantizeToScale(60.4, { degrees: [], root: 0 })).to.equal(60);
    expect(__test__.quantizeToScale(60, { degrees: [0], root: 0 })).to.equal(60);
    expect(__test__.quantizeToScale(61, { degrees: [0], root: 0 })).to.equal(60);
    expect(__test__.quantizeToScale(58, { degrees: [0], root: 0 })).to.equal(60);
  });

  it('clamps notes and builds scales/chords', function() {
    expect(__test__.clampNoteToRange(50, null)).to.equal(50);
    expect(__test__.clampNoteToRange(50, { min: 60, max: 72 })).to.equal(62);
    expect(__test__.clampNoteToRange(100, { min: 60, max: 72 })).to.equal(64);
    expect(__test__.clampNoteToRange(65, { min: 60, max: 72 })).to.equal(65);

    const baseScale = { degrees: [0, 2, 4, 5, 7, 9, 11], root: 0 };
    expect(__test__.buildScaleNote(-1, baseScale, 4)).to.equal(48);
    expect(__test__.buildScaleNote(8, baseScale, 3)).to.equal(50);

    const triad = __test__.buildChordNotes(0, baseScale, 4, 'unknown', 0);
    expect(triad).to.have.length(3);

    const fallbackChord = __test__.buildChordNotes(0, { root: 0 }, 4, 'triad', 0);
    expect(fallbackChord).to.have.length(3);

    const inverted = __test__.buildChordNotes(0, baseScale, 4, 'triad', 1);
    expect(inverted[0]).to.be.greaterThan(triad[0]);
  });

  it('converts between notes and frequencies', function() {
    const freq = __test__.noteToFrequency(69);
    expect(freq).to.be.closeTo(440, 0.001);
    expect(__test__.noteFromFrequency(freq)).to.be.closeTo(69, 0.001);
  });

  it('covers default ranges, scale fallbacks, and quantize directions', function() {
    const fallbackScale = __test__.resolveScale(null);
    expect(fallbackScale.name).to.equal('chromatic-minor');

    const mappings = __test__.resolvePositionMappings({ yToVelocity: true, yToTimbre: true }, null);
    expect(mappings[0].min).to.equal(127);
    expect(mappings[0].max).to.equal(1);
    expect(mappings[1].min).to.equal(127);
    expect(mappings[1].max).to.equal(0);

    const axis = __test__.resolveAxisValues({ x: 10 }, { levelWidth: 100, levelHeight: 0 });
    expect(axis.x).to.equal(0.1);
    expect(axis.y).to.equal(null);
    expect(axis.xy).to.equal(null);

    const up = __test__.quantizeToScale(1, { degrees: [2], root: 0 });
    const down = __test__.quantizeToScale(3, { degrees: [2], root: 0 });
    expect(up).to.equal(2);
    expect(down).to.equal(2);

    expect(__test__.clampNoteToRange(130, { min: 60 })).to.equal(118);

    const baseScale = { degrees: [0, 2, 4], root: 0 };
    const chord = __test__.buildChordNotes(0, baseScale, 4, 'triad', 0);        
    expect(chord).to.have.length(3);
  });

  it('covers additional helper fallbacks', function() {
    expect(__test__.isPlainObject(0)).to.not.be.ok;

    const mappings = __test__.resolvePositionMappings({ xToNote: true }, null);
    expect(mappings[0].min).to.equal(0);

    const nullMappings = __test__.resolvePositionMappings(null, null);
    expect(nullMappings).to.have.length(0);

    const axis = __test__.resolveAxisValues({ y: 5 }, { levelWidth: 10, levelHeight: 20 });
    expect(axis.x).to.equal(null);
    expect(axis.y).to.equal(0.25);
    expect(axis.xy).to.equal(null);

    const axisMixed = __test__.resolveAxisValues({ x: 5 }, { levelWidth: 10, levelHeight: null });
    expect(axisMixed.x).to.equal(0.5);

    const scale = __test__.resolveScale({ name: 'major', degrees: [] });
    expect(scale.degrees.length).to.equal(7);

    expect(__test__.quantizeToScale(60, { degrees: [0, 4, 7], root: 0 })).to.equal(60);
    expect(__test__.quantizeToScale(62, { degrees: [2], root: 0 })).to.equal(62);

    const clamped = __test__.clampNoteToRange(5, { min: 60, max: 72 });
    expect(clamped).to.be.at.least(60);

    const defaultScaleNote = __test__.buildScaleNote(0, { root: 0 }, 4);
    expect(defaultScaleNote).to.be.a('number');

    const chord = __test__.buildChordNotes(0, { degrees: [0, 2, 4], root: 0 }, 4, 'sixth', 1);
    expect(chord).to.have.length(4);
  });

  it('covers position defaults and scale fallbacks', function() {
    const customMappings = __test__.resolvePositionMappings({
      mappings: [{ axis: 'x', target: 'note', min: -1, max: 1 }]
    }, { min: 1, max: 2 });
    expect(customMappings).to.have.length(1);

    const mappings = __test__.resolvePositionMappings({
      xToNote: true,
      xNoteRange: { min: -5, max: 5 },
      yToVelocity: true,
      yToTimbre: true,
      timbreRange: { min: 10, max: 20 }
    }, { min: 2, max: 4 });
    expect(mappings).to.have.length(3);

    const axis = __test__.resolveAxisValues({ x: 5, y: 5 }, { levelWidth: 0, levelHeight: 10 });
    expect(axis.x).to.equal(null);
    expect(axis.y).to.equal(0.5);
    expect(axis.xy).to.equal(null);

    const scale = __test__.resolveScale({ name: 'unknown', root: 3 });
    expect(scale.name).to.equal('chromatic-minor');
    expect(scale.root).to.equal(0);

    expect(__test__.quantizeToScale(60, { degrees: [0, 4, 7], root: 0 })).to.equal(60);

    const noRange = __test__.clampNoteToRange(5, null);
    expect(noRange).to.equal(5);

    const defaultScale = __test__.buildScaleNote(0, {}, 4);
    expect(defaultScale).to.be.a('number');

    const inverted = __test__.buildChordNotes(0, { degrees: [0, 2, 4], root: 0 }, 4, 'unknown', 2);
    expect(inverted[inverted.length - 1]).to.be.greaterThan(inverted[0]);
  });
});
