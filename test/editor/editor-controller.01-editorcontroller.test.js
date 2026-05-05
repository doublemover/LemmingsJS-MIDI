import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { EditorController, __test__ } from '../../js/editor/EditorController.js';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { EditorTools } from '../../js/editor/EditorTools.js';
import { createTerrainEntry, createGadgetEntry, createSteelEntry } from '../../js/editor/EditorEntryFactory.js';

class FakeHistory {
  constructor() {
    this.clearCount = 0;
    this.snapshots = [];
    this.undoValue = null;
    this.redoValue = null;
    this.beginLabels = [];
    this.endLabels = [];
    this.cancelCount = 0;
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

  beginTransaction(label) {
    this.beginLabels.push(label);
  }

  endTransaction(label) {
    this.endLabels.push(label);
    return true;
  }

  cancelTransaction() {
    this.cancelCount += 1;
    return true;
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

  it('dispatches pending preview requests to the latest callback', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, previewDelay: 5 });
    controller.setAssets(buildAssets());

    const firstPreviewEvents = [];
    const secondPreviewEvents = [];
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    controller.setCallbacks({
      onPreviewRequest: label => firstPreviewEvents.push(label)
    });
    controller.updateHeader('TITLE', 'Queued');
    controller.setCallbacks({
      onPreviewRequest: label => secondPreviewEvents.push(label)
    });

    clock.tick(5);
    expect(firstPreviewEvents).to.deep.equal([]);
    expect(secondPreviewEvents).to.deep.equal(['Header']);
    clock.uninstall();
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

    controller.setSelectedTrigger(3);
    controller.setTool(EditorTools.MIDI_FLAG);
    controller.handlePointerDown({ x: 22, y: 24 }, 0);
    const midiFlagEntry = session.level.gadgets[3];
    expect(midiFlagEntry.props.PIECE).to.equal(3);
    expect(midiFlagEntry.props.MIDI_FLAG).to.equal(true);
    expect(Number.isFinite(midiFlagEntry.props.MIDI_FLAG_ID)).to.equal(true);

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

  it('coalesces long brush drags into one committed history snapshot', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false, gridSize: 1 });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.BRUSH);

    controller.handlePointerDown({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 64; i += 1) {
      controller.handlePointerMove({ x: i, y: i % 8 }, { isDown: true });
    }
    controller.handlePointerUp();

    expect(history.snapshots.filter(entry => entry.label === 'Brush')).to.have.length(1);
    expect(session.level.terrains.length).to.be.greaterThan(10);
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
});
