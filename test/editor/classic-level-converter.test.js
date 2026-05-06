import { expect } from 'chai';
import { createEditorLevelFromClassic } from '../../js/editor/ClassicLevelConverter.js';
import { resetStyleRegistry, registerStyle, getDefaultStyle } from '../../js/editor/StyleRegistry.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';

const buildLevelReader = (overrides = {}) => {
  const skills = new Array(Object.keys(SkillTypes).length).fill(0);
  skills[SkillTypes.CLIMBER] = 2;
  skills[SkillTypes.FLOATER] = 1;
  return {
    levelWidth: 1600,
    levelHeight: 160,
    screenPositionX: 12,
    graphicSet1: 4,
    levelProperties: {
      levelName: 'Classic',
      releaseCount: 20,
      needCount: 10,
      timeLimit: 0,
      releaseRate: 50,
      skills
    },
    terrains: [
      {
        id: 3,
        x: 100,
        y: 80,
        drawProperties: { isUpsideDown: true, noOverwrite: true, isErase: true }
      }
    ],
    objects: [
      {
        id: 1,
        x: 200,
        y: 64,
        drawProperties: { isUpsideDown: false, noOverwrite: false, isErase: false }
      }
    ],
    ...overrides
  };
};

describe('ClassicLevelConverter', () => {
  beforeEach(() => {
    resetStyleRegistry();
    registerStyle('alpha', { groundSet: 4 });
    registerStyle('beta', { groundSet: 2 });
  });

  it('returns null for empty inputs', () => {
    const level = createEditorLevelFromClassic(null);
    expect(level).to.equal(null);
  });

  it('maps classic values into editor headers and skills', () => {
    const reader = buildLevelReader();
    const level = createEditorLevelFromClassic(reader);
    expect(level.getHeader('TITLE')).to.equal('Classic');
    expect(level.getHeader('STYLE')).to.equal('alpha');
    expect(level.getHeader('LEMMINGS')).to.equal(20);
    expect(level.getHeader('SAVE_REQUIREMENT')).to.equal(10);
    expect(level.getHeader('TIME_LIMIT')).to.equal('INFINITE');
    expect(level.getHeader('MAX_SPAWN_INTERVAL')).to.equal(50);
    expect(level.getHeader('WIDTH')).to.equal(1600);
    expect(level.getHeader('HEIGHT')).to.equal(160);
    expect(level.getHeader('START_X')).to.equal(12);
    expect(level.getHeader('START_Y')).to.equal(0);
    expect(level.getSkill('CLIMBER')).to.equal(2);
    expect(level.getSkill('FLOATER')).to.equal(1);
  });

  it('respects explicit style overrides and finite time limits', () => {
    const reader = buildLevelReader({
      graphicSet1: 9,
      levelProperties: {
        levelName: 'Timed',
        releaseCount: 5,
        needCount: 3,
        timeLimit: 120,
        releaseRate: 30,
        skills: []
      }
    });
    const level = createEditorLevelFromClassic(reader, { styleName: 'custom' });
    expect(level.getHeader('STYLE')).to.equal('custom');
    expect(level.getHeader('TIME_LIMIT')).to.equal(120);
  });

  it('uses the default style when the ground set is unmapped', () => {
    const reader = buildLevelReader({ graphicSet1: 99 });
    const level = createEditorLevelFromClassic(reader);
    expect(level.getHeader('STYLE')).to.equal(getDefaultStyle()?.name || 'dirt');
  });

  it('falls back to defaults when fields are missing', () => {
    resetStyleRegistry();
    const defaultName = getDefaultStyle()?.name || 'dirt';
    const reader = buildLevelReader({
      levelWidth: NaN,
      levelHeight: null,
      screenPositionX: null,
      levelProperties: {}
    });
    const level = createEditorLevelFromClassic(reader);
    expect(level.getHeader('STYLE')).to.equal(defaultName);
    expect(level.getHeader('WIDTH')).to.equal(1600);
    expect(level.getHeader('HEIGHT')).to.equal(160);
    expect(level.getHeader('START_X')).to.equal(0);
    expect(level.getHeader('LEMMINGS')).to.equal(0);
  });

  it('handles missing level properties and missing arrays', () => {
    const reader = buildLevelReader({
      levelProperties: null,
      terrains: null,
      objects: undefined
    });
    const level = createEditorLevelFromClassic(reader);
    expect(level.getHeader('TITLE')).to.equal('Untitled');
    expect(level.terrains).to.deep.equal([]);
    expect(level.gadgets).to.deep.equal([]);
  });

  it('maps terrain and gadget draw properties', () => {
    const reader = buildLevelReader();
    const level = createEditorLevelFromClassic(reader);
    const terrain = level.terrains[0];
    expect(terrain.props.FLIP_VERTICAL).to.equal(true);
    expect(terrain.props.NO_OVERWRITE).to.equal(true);
    expect(terrain.props.ERASE).to.equal(true);
    expect(terrain.props).to.not.have.property('ONE_WAY');
    const gadget = level.gadgets[0];
    expect(gadget.props.FLIP_VERTICAL).to.equal(undefined);
  });

  it('maps steel areas into editor entries', () => {
    const reader = buildLevelReader({
      steel: [{ x: 5, y: 6, width: 7, height: 8 }]
    });
    const level = createEditorLevelFromClassic(reader);
    expect(level.steel).to.have.length(1);
    expect(level.steel[0].props.X).to.equal(5);
    expect(level.steel[0].props.WIDTH).to.equal(7);
  });

  it('skips draw properties when not provided', () => {
    const reader = buildLevelReader({
      terrains: [{ id: 4, x: 10, y: 20 }],
      objects: [{ id: 2, x: 5, y: 7 }]
    });
    const level = createEditorLevelFromClassic(reader);
    expect(level.terrains[0].props.FLIP_VERTICAL).to.equal(undefined);
    expect(level.terrains[0].props.NO_OVERWRITE).to.equal(undefined);
    expect(level.terrains[0].props.ERASE).to.equal(undefined);
  });
});
