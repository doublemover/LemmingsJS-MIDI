import { expect } from 'chai';
import {
  createEntry,
  createTerrainEntry,
  createGadgetEntry,
  createSteelEntry,
  setEntryProp,
  removeEntryAt
} from '../../js/editor/EditorEntryFactory.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';

describe('EditorEntryFactory', () => {
  it('creates entries with normalized keys and default order', () => {
    const entry = createEntry({ x: 1, y: 2, empty: '', nil: null, zero: 0 });
    expect(entry.props).to.deep.equal({ X: 1, Y: 2, ZERO: 0 });
    expect(entry.order).to.deep.equal(['X', 'Y', 'ZERO']);
    expect(entry.unknownLines).to.deep.equal([]);
  });

  it('respects an explicit order list', () => {
    const order = ['A', 'B'];
    const entry = createEntry({ a: 1 }, order);
    order.push('C');
    expect(entry.order).to.deep.equal(['A', 'B']);
  });

  it('creates terrain and gadget entries with flags', () => {
    const terrain = createTerrainEntry({
      styleName: 'dirt',
      piece: 2,
      x: 4,
      y: 6,
      flipH: true,
      flipV: true,
      noOverwrite: true,
      erase: true,
      oneWay: true,
      width: 16,
      height: 24
    });
    expect(terrain.props).to.include({
      STYLE: 'dirt',
      PIECE: 2,
      X: 4,
      Y: 6,
      FLIP_HORIZONTAL: true,
      FLIP_VERTICAL: true,
      NO_OVERWRITE: true,
      ERASE: true,
      ONE_WAY: true,
      WIDTH: 16,
      HEIGHT: 24
    });

    const gadget = createGadgetEntry({
      styleName: 'dirt',
      piece: 5,
      x: 7,
      y: 8,
      flipH: true,
      flipV: true,
      rotate: 3,
      width: 10,
      height: 12,
      skill: 'BUILDER',
      lemmings: 4,
      pairing: 2
    });
    expect(gadget.props).to.include({
      STYLE: 'dirt',
      PIECE: 5,
      X: 7,
      Y: 8,
      FLIP_HORIZONTAL: true,
      FLIP_VERTICAL: true,
      ROTATE: 3,
      WIDTH: 10,
      HEIGHT: 12,
      SKILL: 'BUILDER',
      LEMMINGS: 4,
      PAIRING: 2
    });

    const steel = createSteelEntry({ x: 2, y: 3, width: 12, height: 8 });
    expect(steel.props).to.include({
      X: 2,
      Y: 3,
      WIDTH: 12,
      HEIGHT: 8
    });
  });

  it('sets and removes entry properties', () => {
    const entry = createEntry({ X: 1 });
    setEntryProp(entry, 'y', 2);
    expect(entry.props.Y).to.equal(2);
    expect(entry.order).to.include('Y');

    setEntryProp(entry, 'y', '');
    expect(entry.props).to.not.have.property('Y');
    expect(entry.order).to.not.include('Y');

    setEntryProp(entry, 'flag', false, { removeIfFalse: true });
    expect(entry.props).to.not.have.property('FLAG');

    setEntryProp(entry, 'flag', true, { removeIfFalse: true });
    expect(entry.props.FLAG).to.equal(true);

    setEntryProp(null, 'X', 1);
    setEntryProp(entry, null, 1);

    setEntryProp(entry, '', 5);
    expect(entry.props).to.not.have.property('');
  });

  it('removes entries by type and index', () => {
    const level = new EditorLevel();
    const terrainEntry = createTerrainEntry({ piece: 1, x: 0, y: 0 });
    const gadgetEntry = createGadgetEntry({ piece: 2, x: 1, y: 1 });
    const steelEntry = createSteelEntry({ x: 2, y: 2, width: 4, height: 4 });
    level.terrains = [terrainEntry];
    level.gadgets = [gadgetEntry];
    level.steel = [steelEntry];

    expect(removeEntryAt(level, 'terrain', 0)).to.equal(terrainEntry);
    expect(level.terrains).to.have.length(0);
    expect(removeEntryAt(level, 'gadget', 0)).to.equal(gadgetEntry);
    expect(level.gadgets).to.have.length(0);
    expect(removeEntryAt(level, 'steel', 0)).to.equal(steelEntry);
    expect(level.steel).to.have.length(0);

    level.terrains = [undefined];
    expect(removeEntryAt(level, 'terrain', 0)).to.equal(null);

    expect(removeEntryAt(level, 'terrain', 5)).to.equal(null);
    expect(removeEntryAt(level, 'gadget', -1)).to.equal(null);
    expect(removeEntryAt(null, 'terrain', 0)).to.equal(null);
  });
});
