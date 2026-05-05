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
  it('covers reorder edge cases and selection bounds', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    controller.setAssets(buildAssets());
    const t0 = createTerrainEntry({ styleName: 'dirt', piece: 1, x: 0, y: 0 });
    const t1 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    session.level.terrains = [t0, t1];

    controller.selection = [];
    expect(controller.getSelectionBounds()).to.equal(null);
    expect(controller._getResizeHandleAt(0, 0)).to.equal(null);
    expect(controller._reorderSelection('front')).to.equal(false);

    controller.selection = [{ type: 'terrain', index: 0 }];
    expect(controller._reorderSelection('unknown')).to.equal(false);
    controller.selection = [{ type: 'terrain', index: 5 }];
    expect(controller._reorderSelection('front')).to.equal(false);

    controller.selection = [{ type: 'terrain', index: 1 }];
    controller.moveSelectionForward();
    controller.selection = [{ type: 'terrain', index: 0 }];
    expect(controller.getSelectionBounds().width).to.equal(8);

    controller.selection = [
      { type: 'terrain', index: 0 },
      { type: 'terrain', index: 1 }
    ];
    controller.moveSelectionForward();
    controller.moveSelectionBackward();

    const steel = createSteelEntry({ x: 10, y: 10, width: 4, height: 4 });
    session.level.steel = [steel];
    controller.selection = [{ type: 'steel', index: 0 }];
    expect(controller.getSelectionBounds().width).to.equal(4);
    expect(controller._getResizeHandleAt(0, 0)).to.equal(null);
  });

  it('returns null when resize bounds are missing for steel selections', () => {
    const controller = new EditorController({ session: null });
    controller.selection = [{ type: 'steel', index: 0 }];
    expect(controller._getResizeHandleAt(0, 0)).to.equal(null);
  });

  it('adds default entrances and exits when missing', () => {
    const session = buildSession();
    session.level.setHeader('WIDTH', 320);
    session.level.setHeader('HEIGHT', 160);
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, previewDelay: 5 });
    controller.setAssets(buildAssets());
    const previews = [];
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    controller.setCallbacks({ onPreviewRequest: label => previews.push(label) });

    const result = controller.ensureDefaultEntrancesExits({ viewRect: { x: 0, y: 0, w: 320, h: 160 } });
    expect(result).to.equal(true);
    expect(session.level.gadgets.some(entry => entry.props.PIECE === 1)).to.equal(true);
    expect(session.level.gadgets.some(entry => entry.props.PIECE === 4)).to.equal(true);

    clock.tick(5);
    expect(previews).to.eql(['Defaults']);
    clock.uninstall();
  });

  it('handles default entrances with custom ids and missing headers', () => {
    const session = buildSession();
    session.level.setHeader('WIDTH', 'bad');
    session.level.setHeader('HEIGHT', 0);
    const history = new FakeHistory();
    const controller = new EditorController({ session, history });
    controller.setAssets(buildAssets());
    const result = controller.ensureDefaultEntrancesExits({ entranceId: 99, exitId: 100 });
    expect(result).to.equal(true);
    const pieces = session.level.gadgets.map(entry => entry.props.PIECE);
    expect(pieces).to.include(99);
    expect(pieces).to.include(100);
  });

  it('falls back to asset arrays and handles missing gadget lists', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    controller.setAssets({
      terrain: [{ id: 5, width: 4, height: 5 }],
      gadgets: [{ id: 6, width: 7, height: 8 }]
    });
    expect(controller._getTerrainMeta(5).width).to.equal(4);
    expect(controller._getGadgetMeta(6).width).to.equal(7);
    expect(controller._getTerrainMeta(99)).to.equal(null);

    session.level.gadgets = null;
    expect(controller._hasGadgetId(1)).to.equal(false);
    expect(controller._hasGadgetId(Number.NaN)).to.equal(false);
  });

  it('returns false when ensuring defaults without a session', () => {
    const controller = new EditorController({ session: null });
    expect(controller.ensureDefaultEntrancesExits()).to.equal(false);
  });

  it('skips defaults when entrances and exits already exist', () => {
    const session = buildSession();
    session.level.setHeader('WIDTH', 320);
    session.level.setHeader('HEIGHT', 160);
    const history = new FakeHistory();
    const controller = new EditorController({ session, history });
    controller.setAssets(buildAssets());
    session.level.gadgets.push(
      createGadgetEntry({ styleName: 'dirt', piece: 1, x: 0, y: 0 }),
      createGadgetEntry({ styleName: 'dirt', piece: 4, x: 10, y: 0 })
    );
    const result = controller.ensureDefaultEntrancesExits();
    expect(result).to.equal(false);
  });

  it('clones entries while preserving uids', () => {
    const entry = createTerrainEntry({ styleName: 'dirt', piece: 1, x: 0, y: 0 });
    entry.uid = 't_keep';
    const clone = __test__.cloneEntry(entry, { preserveUid: true });
    expect(clone.uid).to.equal('t_keep');
    expect(clone.props).to.deep.equal(entry.props);
  });

  it('assigns default entry uids when none are provided', () => {
    const entry = createTerrainEntry({ styleName: 'dirt', piece: 1, x: 2, y: 3 });
    delete entry.uid;
    const clone = __test__.cloneEntry(entry);
    expect(clone.uid.startsWith('e_')).to.equal(true);
  });

  it('assigns uids and clones gadget/steel entries', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    controller.setAssets(buildAssets());
    const gadget = createGadgetEntry({ styleName: 'dirt', piece: 1, x: 0, y: 0 });
    const steel = createSteelEntry({ x: 1, y: 1, width: 2, height: 2 });
    session.level.gadgets.push(gadget);
    session.level.steel = [steel];
    const cloned = controller._cloneSelection([
      { type: 'gadget', index: 0, entry: gadget },
      { type: 'steel', index: 0, entry: steel }
    ], 1, 1);
    expect(cloned).to.have.length(2);
    expect(session.level.gadgets[1].uid.startsWith('g_')).to.equal(true);
    expect(session.level.steel[1].uid.startsWith('s_')).to.equal(true);
  });

  it('resolves selected entries by uid after index shifts', () => {
    const session = buildSession();
    const controller = new EditorController({ session });
    const first = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    const second = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 8, y: 0 });
    session.level.terrains.push(first, second);
    controller.selection = [{ type: 'terrain', index: 0, uid: first.uid }];

    session.level.terrains = [second, first];
    const selected = controller.getSelectedEntries();

    expect(selected).to.have.length(1);
    expect(selected[0].entry).to.equal(first);
    expect(selected[0].index).to.equal(1);
    expect(controller._isSelected('terrain', 1)).to.equal(true);
  });
});
