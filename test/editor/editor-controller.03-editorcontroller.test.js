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
  it('supports on-canvas resize handles', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false, gridSize: 1 });
    controller.setAssets(buildAssets());
    controller.setTool(EditorTools.SELECT);
    expect(controller.getHandleSize()).to.equal(2);

    const entry = createSteelEntry({
      x: 10,
      y: 10,
      width: 8,
      height: 8
    });
    session.level.steel.push(entry);

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

    const entry = createSteelEntry({
      x: 8,
      y: 8,
      width: 8,
      height: 8
    });
    session.level.steel.push(entry);

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

    const entry = createSteelEntry({
      x: 10,
      y: 10,
      width: 8,
      height: 8
    });
    session.level.steel.push(entry);

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

  it('dispose cancels pending preview callbacks', () => {
    const session = buildSession();
    const controller = new EditorController({ session, history: new FakeHistory(), previewDelay: 5 });
    const previewEvents = [];
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    controller.setCallbacks({ onPreviewRequest: label => previewEvents.push(label) });

    controller._requestPreview('Dispose');
    controller.dispose();
    clock.tick(5);
    clock.uninstall();

    expect(previewEvents).to.deep.equal([]);
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

  it('reorders selected entries across lists', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    const t0 = createTerrainEntry({ styleName: 'dirt', piece: 1, x: 0, y: 0 });
    const t1 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    const g0 = createGadgetEntry({ styleName: 'dirt', piece: 1, x: 0, y: 0 });
    const g1 = createGadgetEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    const s0 = createSteelEntry({ x: 0, y: 0, width: 1, height: 1 });
    const s1 = createSteelEntry({ x: 2, y: 2, width: 1, height: 1 });
    session.level.terrains = [t0, t1];
    session.level.gadgets = [g0, g1];
    session.level.steel = [s0, s1];

    controller._setSelection([
      { type: 'terrain', index: 0 },
      { type: 'gadget', index: 0 },
      { type: 'steel', index: 0 }
    ]);

    expect(controller.bringSelectionToFront()).to.equal(true);
    expect(session.level.terrains[1]).to.equal(t0);
    expect(session.level.gadgets[1]).to.equal(g0);
    expect(session.level.steel[1]).to.equal(s0);

    expect(controller.sendSelectionToBack()).to.equal(true);
    expect(session.level.terrains[0]).to.equal(t0);
    expect(session.level.gadgets[0]).to.equal(g0);
    expect(session.level.steel[0]).to.equal(s0);

    controller._setSelection([{ type: 'terrain', index: 0 }]);
    expect(controller.moveSelectionForward()).to.equal(true);
    expect(session.level.terrains[1]).to.equal(t0);

    expect(controller.moveSelectionBackward()).to.equal(true);
    expect(session.level.terrains[0]).to.equal(t0);
  });
});
