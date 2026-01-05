import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { EditorController } from '../../js/editor/EditorController.js';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { EditorTools } from '../../js/editor/EditorTools.js';
import { createTerrainEntry, createGadgetEntry } from '../../js/editor/EditorEntryFactory.js';

class FakeHistory {
  constructor() {
    this.clearCount = 0;
    this.snapshots = [];
    this.undoValue = null;
    this.redoValue = null;
  }

  clear() {
    this.clearCount += 1;
  }

  pushSnapshot(level, label) {
    this.snapshots.push({ level, label });
    return true;
  }

  undo() {
    return this.undoValue;
  }

  redo() {
    return this.redoValue;
  }
}

const buildSession = () => {
  const session = new EditorSession();
  const level = new EditorLevel();
  level.setHeader('STYLE', 'dirt');
  level.terrains = [];
  level.gadgets = [];
  session.level = level;
  return session;
};

const buildAssets = () => {
  const terrainMeta = { id: 2, name: 'terrain_2', width: 8, height: 8 };
  const gadgetMeta = { id: 1, name: 'object_1', width: 8, height: 8, triggerEffectId: 0 };
  const triggerMeta = { id: 3, name: 'object_3', width: 8, height: 8, triggerEffectId: 5 };
  const exitMeta = { id: 4, name: 'object_4', width: 8, height: 8, triggerEffectId: 0 };
  return {
    terrain: [terrainMeta],
    gadgets: [gadgetMeta],
    triggers: [triggerMeta],
    entranceId: 1,
    exitId: 4,
    terrainById: new Map([[terrainMeta.id, terrainMeta]]),
    gadgetById: new Map([
      [gadgetMeta.id, gadgetMeta],
      [triggerMeta.id, triggerMeta],
      [exitMeta.id, exitMeta]
    ])
  };
};

describe('EditorController', () => {
  it('initializes selections and debounces preview updates', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, previewDelay: 5 });
    controller.setAssets(buildAssets());

    expect(controller.selectedTerrainId).to.equal(2);
    expect(controller.selectedGadgetId).to.equal(1);
    expect(controller.selectedTriggerId).to.equal(3);

    const levelEvents = [];
    const previewEvents = [];
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    controller.setCallbacks({
      onLevelChange: level => levelEvents.push(level),
      onPreviewRequest: label => previewEvents.push(label)
    });

    controller.updateHeader('TITLE', 'First');
    controller.updateHeader('TITLE', 'Second');
    expect(levelEvents).to.have.length(2);
    expect(previewEvents).to.deep.equal([]);

    clock.tick(5);
    expect(previewEvents).to.deep.equal(['Header']);
    clock.uninstall();

    controller.resetHistory('Init');
    expect(history.clearCount).to.equal(1);
    expect(history.snapshots[0].label).to.equal('Init');
  });

  it('selects, drags, and clears selections', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history });
    controller.setAssets(buildAssets());

    const terrainEntry = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 10, y: 10 });
    session.level.terrains.push(terrainEntry);

    const selections = [];
    controller.setCallbacks({ onSelectionChange: selection => selections.push(selection) });

    controller.handlePointerDown({ x: 12, y: 12 }, 0);
    expect(controller.getSelectedEntries()).to.have.length(1);
    expect(controller.getSelectedEntries()[0].type).to.equal('terrain');

    controller.handlePointerMove({ x: 20, y: 20 });
    expect(terrainEntry.props.X).to.equal(18);
    expect(terrainEntry.props.Y).to.equal(18);

    controller.handlePointerUp();
    expect(history.snapshots[0].label).to.equal('Move');
    expect(selections.length).to.be.greaterThan(0);

    const gadgetEntry = createGadgetEntry({ styleName: 'dirt', piece: 1, x: 30, y: 30 });
    session.level.gadgets.push(gadgetEntry);
    controller.handlePointerDown({ x: 31, y: 31 }, 0);
    controller.handlePointerMove({ x: 40, y: 40 });
    controller.handlePointerUp();

    controller.handlePointerDown({ x: 0, y: 0 }, 2);
    expect(controller.getSelectedEntries()).to.have.length(0);

    controller.handlePointerDown({ x: 100, y: 100 }, 0);
    expect(controller.getSelectedEntries()).to.have.length(0);

    controller._selectHit(null);
    expect(controller.getSelectedEntries()).to.have.length(0);
  });

  it('places terrain, gadgets, triggers, entrances, and exits', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    controller.setAssets(buildAssets());
    controller.setSnapEnabled(false);

    controller.setSelectedTerrain(2);
    controller.setSelectedTerrain('bad');
    controller.setTool(EditorTools.TERRAIN);
    controller.handlePointerDown({ x: 5.2, y: 6.2 }, 0);
    expect(session.level.terrains).to.have.length(1);
    expect(session.level.terrains[0].props.X).to.equal(1);
    expect(history.snapshots[0].label).to.equal('Terrain');

    controller.setSelectedGadget(1);
    controller.setSelectedGadget(undefined);
    controller.setTool(EditorTools.GADGET);
    controller.handlePointerDown({ x: 10, y: 12 }, 0);
    expect(session.level.gadgets).to.have.length(1);
    expect(history.snapshots[1].label).to.equal('Gadget');

    controller.setSelectedTrigger(3);
    controller.setTool(EditorTools.TRIGGER);
    controller.handlePointerDown({ x: 14, y: 16 }, 0);
    expect(session.level.gadgets[1].props.PIECE).to.equal(3);

    controller.setSelectedTrigger('bad');
    controller.selectedTriggerId = null;
    controller.setTool(EditorTools.TRIGGER);
    controller.handlePointerDown({ x: 18, y: 20 }, 0);
    expect(session.level.gadgets[2].props.PIECE).to.equal(1);

    for (let i = 0; i < 4; i++) {
      session.level.gadgets.push(createGadgetEntry({ styleName: 'dirt', piece: 1, x: 1, y: 1 }));
    }
    controller.setTool(EditorTools.ENTRANCE);
    controller.handlePointerDown({ x: 30, y: 40 }, 0);
    const entranceCount = session.level.gadgets.filter(entry => entry.props.PIECE === 1).length;
    expect(entranceCount).to.equal(4);

    for (let i = 0; i < 4; i++) {
      session.level.gadgets.push(createGadgetEntry({ styleName: 'dirt', piece: 4, x: 2, y: 2 }));
    }
    controller.setTool(EditorTools.EXIT);
    controller.handlePointerDown({ x: 32, y: 44 }, 0);
    const exitCount = session.level.gadgets.filter(entry => entry.props.PIECE === 4).length;
    expect(exitCount).to.equal(4);

    controller.setTool('unknown');
    controller.handlePointerDown({ x: 0, y: 0 }, 0);
  });

  it('handles brush and eraser strokes', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, eraseGadgets: true });
    controller.setAssets(buildAssets());

    controller.setBrushSize(0);
    expect(controller.brushSize).to.equal(1);
    controller.setBrushSize(Number.NaN);
    expect(controller.brushSize).to.equal(1);

    controller.setTool(EditorTools.BRUSH);
    controller.setBrushSize(2);
    controller.handlePointerDown({ x: 5, y: 6 }, 0);
    const countAfterDown = session.level.terrains.length;
    controller.handlePointerMove({ x: 5, y: 6 }, { isDown: true });
    controller.handlePointerMove({ x: 5, y: 6 }, { isDown: false });
    expect(session.level.terrains).to.have.length(countAfterDown);
    controller.handlePointerUp();
    expect(history.snapshots[0].label).to.equal('Brush');

    controller.setTool(EditorTools.ERASER);
    controller.setEraseGadgets(true);
    session.level.gadgets.push(createGadgetEntry({ styleName: 'dirt', piece: 1, x: 4, y: 4 }));
    const terrainCount = session.level.terrains.length;
    controller.handlePointerDown({ x: 4, y: 4 }, 0);
    expect(session.level.terrains.length).to.be.lessThan(terrainCount);
    expect(session.level.gadgets).to.have.length(0);
    controller.handlePointerMove({ x: 4, y: 4 }, { isDown: true });
    controller.handlePointerUp();
    expect(history.snapshots.some(entry => entry.label === 'Erase')).to.equal(true);
  });

  it('stamps brush lines', () => {
    const session = buildSession();
    const controller = new EditorController({ session, gridSize: 4, snapEnabled: true });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.BRUSH);
    controller.setBrushSize(1);
    controller.handlePointerDown({ x: 0, y: 0 }, 0);
    controller.handlePointerMove({ x: 8, y: 0 }, { isDown: true });
    controller.handlePointerUp();
    expect(session.level.terrains).to.have.length(3);
  });

  it('stamps brush and eraser moves without a prior stroke', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());

    controller.setTool(EditorTools.BRUSH);
    const beforeBrush = session.level.terrains.length;
    controller.handlePointerMove({ x: 6, y: 6 }, { isDown: true });
    expect(session.level.terrains).to.have.length(beforeBrush + 1);
    controller.handlePointerUp();

    controller.setTool(EditorTools.ERASER);
    const beforeErase = session.level.terrains.length;
    controller.handlePointerMove({ x: 6, y: 6 }, { isDown: true });
    expect(session.level.terrains.length).to.be.lessThan(beforeErase);
  });

  it('supports multi-select and marquee selection', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);
    const selectionEvents = [];
    controller.setCallbacks({ onSelectionChange: selection => selectionEvents.push(selection) });

    const entryA = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 10, y: 10 });
    const entryB = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 30, y: 30 });
    session.level.terrains.push(entryA, entryB);

    controller.handlePointerDown({ x: 10, y: 10 }, 0);
    controller.handlePointerUp();
    controller.handlePointerDown({ x: 30, y: 30 }, 0, { shiftKey: true });
    expect(controller.getSelectedEntries()).to.have.length(2);

    controller.handlePointerDown({ x: 10, y: 10 }, 0);
    controller.handlePointerMove({ x: 20, y: 20 });
    controller.handlePointerUp();
    expect(entryA.props.X).to.equal(20);
    expect(entryB.props.X).to.equal(40);

    controller.handlePointerDown({ x: 0, y: 0 }, 0);
    controller.handlePointerMove({ x: 50, y: 50 }, { isDown: true });
    controller.handlePointerUp();
    expect(controller.getSelectedEntries()).to.have.length(2);
    controller.handlePointerDown({ x: 20, y: 20 }, 0, { shiftKey: true });
    expect(controller.getSelectedEntries()).to.have.length(1);
    expect(selectionEvents.length).to.be.greaterThan(0);
  });

  it('supports steel placement and selection', () => {
    const session = buildSession();
    const history = new FakeHistory();
    session.level.steel = null;
    const controller = new EditorController({ session, history, snapEnabled: false, gridSize: 1 });
    controller.setAssets(buildAssets());
    const selectionEvents = [];
    controller.setCallbacks({ onSelectionChange: entries => selectionEvents.push(entries) });
    controller.setTool(EditorTools.STEEL);
    controller.handlePointerDown({ x: 5, y: 6 }, 0);
    controller.handlePointerMove({ x: 9, y: 10 });
    controller.handlePointerUp();
    expect(session.level.steel).to.have.length(1);
    expect(selectionEvents.length).to.be.greaterThan(0);
    expect(history.snapshots.some(entry => entry.label === 'Steel')).to.equal(true);

    const steelHit = controller._findSelectionAt(6, 7);
    expect(steelHit?.type).to.equal('steel');

    controller.setTool(EditorTools.SELECT);
    controller.handlePointerDown({ x: 6, y: 7 }, 0);
    expect(controller.getSelectedEntries()[0].type).to.equal('steel');
    expect(controller.deleteSelected()).to.equal(true);
    expect(session.level.steel).to.have.length(0);
  });

  it('uses a 1px steel size when the grid is invalid', () => {
    const session = buildSession();
    session.level.steel = null;
    const controller = new EditorController({ session, snapEnabled: false, gridSize: 0 });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.STEEL);
    controller.handlePointerDown({ x: 1, y: 2 }, 0);
    controller.handlePointerUp();
    expect(session.level.steel[0].props.WIDTH).to.equal(1);
    expect(session.level.steel[0].props.HEIGHT).to.equal(1);
  });

  it('computes selection bounds for gadgets', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    session.level.gadgets.push(createGadgetEntry({ styleName: 'dirt', piece: 1, x: 12, y: 14 }));
    controller.selection = [{ type: 'gadget', index: 0 }];
    const bounds = controller.getSelectionBounds();
    expect(bounds.x).to.equal(12);
    expect(bounds.y).to.equal(14);
    expect(bounds.width).to.equal(8);
  });

  it('copies, pastes, duplicates, and nudges selections', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, gridSize: 4, snapEnabled: true });
    controller.setAssets(buildAssets());

    const terrainEntry = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 8, y: 8 });
    session.level.terrains.push(terrainEntry);
    controller.selection = [{ type: 'terrain', index: 0 }];

    expect(controller.copySelection()).to.equal(true);
    expect(controller.pasteSelection()).to.equal(true);
    expect(session.level.terrains).to.have.length(2);
    expect(session.level.terrains[1].props.X).to.equal(12);

    controller.selection = [{ type: 'terrain', index: 1 }];
    expect(controller.duplicateSelection()).to.equal(true);
    expect(session.level.terrains).to.have.length(3);
    expect(session.level.terrains[2].props.X).to.equal(16);

    controller.selection = [{ type: 'terrain', index: 2 }];
    expect(controller.nudgeSelection(1, 0, 1)).to.equal(true);
    expect(session.level.terrains[2].props.X).to.equal(17);

    expect(controller.snapSelectionToGrid()).to.equal(true);
    expect(session.level.terrains[2].props.X).to.equal(16);
  });

  it('coerces non-finite positions when copying', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());

    const terrainEntry = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 4, y: 4 });
    terrainEntry.props.X = 'bad';
    terrainEntry.props.Y = Number.NaN;
    session.level.terrains.push(terrainEntry);
    controller.selection = [{ type: 'terrain', index: 0 }];

    expect(controller.copySelection()).to.equal(true);
    expect(controller.pasteSelection()).to.equal(true);
    expect(session.level.terrains[1].props.X).to.equal(1);
    expect(session.level.terrains[1].props.Y).to.equal(1);
  });

  it('copies entries without props using defaults', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    session.level.terrains.push({ props: null });
    controller.selection = [{ type: 'terrain', index: 0 }];

    expect(controller.copySelection()).to.equal(true);
    expect(controller.pasteSelection()).to.equal(true);
    expect(session.level.terrains[1].props.X).to.equal(1);
  });

  it('returns false when snapping without a selection', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    controller.setAssets(buildAssets());
    expect(controller.snapSelectionToGrid()).to.equal(false);
  });

  it('snaps using a 1px grid when the grid size is invalid', () => {
    const session = buildSession();
    const controller = new EditorController({ session, gridSize: 0, snapEnabled: true });
    controller.setAssets(buildAssets());
    session.level.terrains.push(createTerrainEntry({ styleName: 'dirt', piece: 2, x: 4, y: 4 }));
    session.level.terrains[0].props.X = 3.6;
    session.level.terrains[0].props.Y = 4.4;
    controller.selection = [{ type: 'terrain', index: 0 }];
    expect(controller.snapSelectionToGrid()).to.equal(true);
    expect(session.level.terrains[0].props.X).to.equal(4);
    expect(session.level.terrains[0].props.Y).to.equal(4);
  });

  it('returns false when nudging without a selection', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    expect(controller.nudgeSelection(1, 0, 1)).to.equal(false);
  });

  it('skips missing props when nudging and snapping', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: true });
    controller.setAssets(buildAssets());
    const selectionEvents = [];
    controller.setCallbacks({ onSelectionChange: entries => selectionEvents.push(entries) });
    session.level.terrains.push({ props: null });
    controller.selection = [{ type: 'terrain', index: 0 }];
    expect(controller.nudgeSelection(1, 0, 1)).to.equal(true);
    expect(controller.snapSelectionToGrid()).to.equal(true);
    expect(selectionEvents.length).to.be.greaterThan(0);
  });

  it('uses 1px paste steps when snapping is disabled', () => {
    const session = buildSession();
    const controller = new EditorController({ session, gridSize: 4, snapEnabled: false });
    controller.setAssets(buildAssets());

    session.level.terrains.push(createTerrainEntry({ styleName: 'dirt', piece: 2, x: 8, y: 8 }));
    controller.selection = [{ type: 'terrain', index: 0 }];
    expect(controller.copySelection()).to.equal(true);
    expect(controller.pasteSelection()).to.equal(true);
    expect(session.level.terrains[1].props.X).to.equal(9);
  });

  it('returns false when clone/paste/duplicate have nothing to act on', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    session.level.gadgets = null;

    const cloneResult = controller._cloneSelection([
      { type: 'gadget', index: 0, entry: { props: { X: 0, Y: 0 } } }
    ], 0, 0);
    expect(cloneResult).to.equal(null);

    controller._clipboard = {
      items: [{ type: 'gadget', entry: { props: { X: 0, Y: 0 } }, offsetX: 0, offsetY: 0 }],
      minX: 0,
      minY: 0
    };
    expect(controller.pasteSelection()).to.equal(false);
    expect(controller.duplicateSelection()).to.equal(false);
  });

  it('duplicates selection with alt-drag', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({
      session,
      history,
      snapEnabled: false,
      gridSize: 1,
      handleSize: 2
    });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);

    const terrainEntry = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 10, y: 10 });
    session.level.terrains.push(terrainEntry);

    controller.handlePointerDown({ x: 14, y: 14 }, 0);
    controller.handlePointerUp();

    controller.handlePointerDown({ x: 14, y: 14 }, 0, { altKey: true });
    controller.handlePointerMove({ x: 16, y: 16 });
    controller.handlePointerUp();

    expect(session.level.terrains).to.have.length(2);
    expect(history.snapshots.some(entry => entry.label === 'Duplicate')).to.equal(true);
  });

  it('handles additive marquee selection without duplicates', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);

    const entryA = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 10, y: 10 });
    session.level.terrains.push(entryA);

    controller.handlePointerDown({ x: 10, y: 10 }, 0);
    controller.handlePointerUp();

    session.level.gadgets = null;
    controller.handlePointerDown({ x: 0, y: 0 }, 0, { shiftKey: true });
    controller.handlePointerMove({ x: 20, y: 20 }, { isDown: true });
    controller.handlePointerUp();

    expect(controller.getSelectedEntries()).to.have.length(1);
  });

  it('covers marquee intersection branches', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    session.level.terrains.push(createTerrainEntry({ styleName: 'dirt', piece: 2, x: 10, y: 10 }));

    const scenarios = [
      { x: 20, y: 10, width: 2, height: 2 },
      { x: 0, y: 10, width: 5, height: 2 },
      { x: 10, y: 25, width: 8, height: 2 },
      { x: 10, y: 0, width: 8, height: 5 },
      { x: 12, y: 12, width: 2, height: 2 }
    ];
    const originalGetMarqueeBounds = controller.getMarqueeBounds.bind(controller);
    for (const bounds of scenarios) {
      controller._marquee = { startX: 0, startY: 0, x: 1, y: 1, additive: false };
      controller.getMarqueeBounds = () => bounds;
      controller._applyMarqueeSelection();
    }
    controller.getMarqueeBounds = originalGetMarqueeBounds;
    controller._marquee = null;
  });

  it('notifies marquee callbacks', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    const marqueeEvents = [];
    controller.setCallbacks({ onMarqueeChange: bounds => marqueeEvents.push(bounds) });

    controller._beginMarquee(0, 0, true);
    controller._updateMarquee(5, 6);
    controller._clearMarquee();

    expect(marqueeEvents).to.have.length(3);
    expect(marqueeEvents[0]).to.have.property('width');
    expect(marqueeEvents[2]).to.equal(null);
  });

  it('uses a custom handle size', () => {
    const session = buildSession();
    const controller = new EditorController({ session, handleSize: 12 });
    expect(controller.getHandleSize()).to.equal(12);
  });

  it('supports additive selection helpers', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);
    const selectionEvents = [];
    controller.setCallbacks({ onSelectionChange: selection => selectionEvents.push(selection) });

    const entryA = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 10, y: 10 });
    const entryB = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 30, y: 30 });
    session.level.terrains.push(entryA, entryB);

    const firstHit = controller._findSelectionAt(10, 10);
    const secondHit = controller._findSelectionAt(30, 30);
    controller._selectHit(firstHit);
    controller._selectHit(secondHit, { additive: true });
    expect(controller.getSelectedEntries()).to.have.length(2);
    expect(controller._isSelected('gadget', 0)).to.equal(false);
    expect(selectionEvents.length).to.be.greaterThan(0);

    const gadgetEntry = createGadgetEntry({ styleName: 'dirt', piece: 1, x: 5, y: 6 });
    session.level.gadgets.push(gadgetEntry);
    controller.selection = [{ type: 'gadget', index: 0 }];
    const bounds = controller.getSelectionBounds();
    expect(bounds.width).to.equal(8);
    expect(bounds.height).to.equal(8);
  });

  it('supports on-canvas resize handles', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false, gridSize: 1 });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);
    expect(controller.getHandleSize()).to.equal(2);

    const entry = createTerrainEntry({
      styleName: 'dirt',
      piece: 2,
      x: 10,
      y: 10,
      width: 8,
      height: 8
    });
    session.level.terrains.push(entry);

    controller.handlePointerDown({ x: 10, y: 10 }, 0);
    controller.handlePointerUp();

    const handleX = entry.props.X + entry.props.WIDTH;
    const handleY = entry.props.Y + entry.props.HEIGHT;
    controller.handlePointerDown({ x: handleX, y: handleY }, 0);
    controller.handlePointerMove({ x: handleX + 4, y: handleY + 6 });
    controller.handlePointerUp();

    expect(entry.props.WIDTH).to.equal(12);
    expect(entry.props.HEIGHT).to.equal(14);
    expect(history.snapshots.some(entry => entry.label === 'Resize')).to.equal(true);
  });

  it('snaps resize handles when snapping is enabled', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, gridSize: 4 });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);

    let selectionChanges = 0;
    controller.setCallbacks({ onSelectionChange: () => selectionChanges++ });

    const entry = createTerrainEntry({
      styleName: 'dirt',
      piece: 2,
      x: 8,
      y: 8,
      width: 8,
      height: 8
    });
    session.level.terrains.push(entry);

    controller.handlePointerDown({ x: 8, y: 8 }, 0);
    controller.handlePointerUp();

    const handleX = entry.props.X + entry.props.WIDTH;
    const handleY = entry.props.Y + entry.props.HEIGHT;
    controller.handlePointerDown({ x: handleX, y: handleY }, 0);
    controller.handlePointerMove({ x: handleX + 3, y: handleY + 3 });
    controller.handlePointerUp();

    expect(entry.props.WIDTH).to.equal(12);
    expect(entry.props.HEIGHT).to.equal(12);
    expect(selectionChanges).to.be.greaterThan(0);
  });

  it('clamps inverted resize handles', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false, gridSize: 1 });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);

    const entry = createTerrainEntry({
      styleName: 'dirt',
      piece: 2,
      x: 10,
      y: 10,
      width: 8,
      height: 8
    });
    session.level.terrains.push(entry);

    controller.handlePointerDown({ x: 10, y: 10 }, 0);
    controller.handlePointerUp();

    const right = entry.props.X + entry.props.WIDTH;
    const bottom = entry.props.Y + entry.props.HEIGHT;
    controller.handlePointerDown({ x: right, y: bottom }, 0);
    controller.handlePointerMove({ x: entry.props.X - 5, y: entry.props.Y - 5 });
    controller.handlePointerUp();
    expect(entry.props.WIDTH).to.be.at.least(1);
    expect(entry.props.HEIGHT).to.be.at.least(1);

    controller.handlePointerDown({ x: entry.props.X, y: entry.props.Y }, 0);
    controller.handlePointerMove({ x: entry.props.X + entry.props.WIDTH + 10, y: entry.props.Y + entry.props.HEIGHT + 10 });
    controller.handlePointerUp();
    expect(entry.props.WIDTH).to.be.at.least(1);
    expect(entry.props.HEIGHT).to.be.at.least(1);
  });

  it('updates selected props, deletes entries, and supports undo/redo', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history });
    controller.setAssets(buildAssets());
    const levelChanges = [];
    const selectionUpdates = [];
    controller.setCallbacks({
      onLevelChange: level => levelChanges.push(level),
      onSelectionChange: selection => selectionUpdates.push(selection)
    });

    const terrainEntry = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    session.level.terrains.push(terrainEntry);
    controller.handlePointerDown({ x: 1, y: 1 }, 0);

    const updated = controller.updateSelectedProps({ flip_horizontal: true, erase: false });
    expect(updated).to.equal(true);
    expect(terrainEntry.props.FLIP_HORIZONTAL).to.equal(true);
    expect(terrainEntry.props).to.not.have.property('ERASE');

    expect(controller.deleteSelected()).to.equal(true);
    expect(session.level.terrains).to.have.length(0);
    expect(controller.deleteSelected()).to.equal(false);
    const gadgetEntry = createGadgetEntry({ styleName: 'dirt', piece: 1, x: 10, y: 10 });
    session.level.gadgets.push(gadgetEntry);
    controller.selection = [{ type: 'gadget', index: 0 }];
    expect(controller.deleteSelected()).to.equal(true);
    expect(session.level.gadgets).to.have.length(0);

    const undoLevel = new EditorLevel();
    undoLevel.setHeader('TITLE', 'Undo');
    const redoLevel = new EditorLevel();
    redoLevel.setHeader('TITLE', 'Redo');
    history.undoValue = undoLevel;
    history.redoValue = redoLevel;

    expect(controller.undo()).to.equal(undoLevel);
    expect(session.level).to.equal(undoLevel);
    expect(controller.redo()).to.equal(redoLevel);
    expect(levelChanges).to.deep.equal([undoLevel, redoLevel]);

    history.undoValue = null;
    history.redoValue = null;
    expect(controller.undo()).to.equal(null);
    expect(controller.redo()).to.equal(null);

    controller.selection = [{ type: 'gadget', index: 5 }];
    expect(controller.getSelectedEntry()).to.equal(null);
    controller.selection = [];
    expect(controller.updateSelectedProps({ X: 1 })).to.equal(false);
    expect(selectionUpdates.length).to.be.greaterThan(0);

    controller.selection = [{ type: 'gadget', index: 0 }];
    controller.session.level.gadgets = null;
    expect(controller.getSelectedEntry()).to.equal(null);
  });

  it('handles missing sessions safely', () => {
    const history = new FakeHistory();
    const controller = new EditorController({ session: null, history });
    expect(controller.deleteSelected()).to.equal(false);
    controller.handlePointerDown({ x: 1, y: 1 }, 0);
    controller.handlePointerMove({ x: 1, y: 1 });
    controller.handlePointerUp();
    expect(controller._placeTerrainAt(1, 1)).to.equal(null);
    expect(controller._placeGadgetAt(1, 1, 1)).to.equal(null);
    controller._eraseAt(1, 1);
    controller._removeGadgetsById(1);
    expect(controller._findSelectionAt(0, 0)).to.equal(null);
    controller.updateHeader('TITLE', 'Missing');
  });

  it('returns null lists without a session', () => {
    const controller = new EditorController({ session: null });
    expect(controller._getListForType('terrain')).to.equal(null);
  });

  it('uses fallback entrance and exit ids without assets', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    controller.setAssets(null);
    controller.setSelectedGadget(5);

    controller.setTool(EditorTools.ENTRANCE);
    controller.handlePointerDown({ x: 1, y: 1 }, 0);
    expect(session.level.gadgets[0].props.PIECE).to.equal(1);

    controller.setTool(EditorTools.EXIT);
    controller.handlePointerDown({ x: 2, y: 2 }, 0);
    expect(session.level.gadgets[1].props.PIECE).to.equal(5);
  });

  it('preserves existing selections when assets change', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history });
    controller.selectedTerrainId = 9;
    controller.selectedGadgetId = 8;
    controller.selectedTriggerId = 7;
    controller.setAssets(buildAssets());
    expect(controller.selectedTerrainId).to.equal(2);
    expect(controller.selectedGadgetId).to.equal(1);
    expect(controller.selectedTriggerId).to.equal(3);
    controller.setAssets(null);
    expect(controller.assets).to.equal(null);
  });

  it('rounds positions when the grid size is disabled', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({
      session,
      history,
      gridSize: 0,
      snapEnabled: true,
      brushSize: 3
    });
    expect(controller.brushSize).to.equal(3);
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.TERRAIN);
    controller.handlePointerDown({ x: 5.6, y: 5.2 }, 0);
    expect(session.level.terrains[0].props.X).to.equal(2);
    expect(session.level.terrains[0].props.Y).to.equal(1);
  });

  it('covers internal fallbacks', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, previewDelay: 5 });
    const previewEvents = [];
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    controller.setCallbacks({ onPreviewRequest: label => previewEvents.push(label) });
    session.level.terrains.push(createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 }));
    controller.setSnapEnabled(false);
    controller.setSnapEnabled(true);
    controller.resetHistory();
    controller.setTool(null);
    controller._requestPreview();
    clock.tick(5);
    clock.uninstall();
    expect(previewEvents).to.deep.equal(['Update']);

    controller._removeGadgetsById(null);
    controller.session.level.gadgets = null;
    controller._removeGadgetsById(1);
    controller._trimGadgetsById(null, 1);
    controller._trimGadgetsById(1, 1);
    controller._updateMarquee(1, 1);
    controller._applyMarqueeSelection();
    controller._setSelection(null);
    controller._toggleSelection(null);
    controller.selection = null;
    controller.getSelectedEntries();
    controller.getMarqueeBounds();
    controller.copySelection();
    controller.pasteSelection();
    controller._eraseLine(null, null);
    controller._brushLine(null, null);

    const originalSession = controller.session;
    controller.session = null;
    controller._placeSteelAt(0, 0, 1, 1);
    controller._beginSteelDraft(0, 0);
    controller.session = originalSession;

    controller._steelDraft = null;
    controller._updateSteelDraft(1, 1);
    controller._steelDraft = { index: 0, startX: 0, startY: 0 };
    controller.session.level.steel = null;
    controller._updateSteelDraft(1, 1);
    controller.session.level.steel = [];
    controller._updateSteelDraft(1, 1);

    controller._steelDraft = null;

    const originalGetMarqueeBounds = controller.getMarqueeBounds.bind(controller);
    controller.getMarqueeBounds = () => null;
    controller._marquee = { startX: 0, startY: 0, x: 5, y: 5, additive: false };
    controller._applyMarqueeSelection();
    controller.getMarqueeBounds = originalGetMarqueeBounds;
    controller._marquee = null;

    controller.selection = [];
    controller._resize = { handle: 'se', type: 'terrain', index: 0, bounds: { x: 0, y: 0, width: 4, height: 4 } };
    controller.handlePointerMove({ x: 2, y: 2 });
    controller._resize = null;

    controller._drag = { entries: null };
    controller.tool = EditorTools.SELECT;
    controller.handlePointerMove({ x: 1, y: 1 }, { isDown: true });

    controller._drag = { label: '', entries: [] };
    controller._strokeChanged = true;
    controller.handlePointerUp();
  });

  it('removes gadgets by id', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    session.level.gadgets.push(createGadgetEntry({ styleName: 'dirt', piece: 1, x: 4, y: 4 }));
    controller._removeGadgetsById(1);
    expect(session.level.gadgets).to.have.length(0);
  });

  it('creates a default history when none is provided', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    expect(controller.history).to.exist;
  });
});
