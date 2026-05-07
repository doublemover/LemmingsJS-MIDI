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
  it('applies batch selection actions for align, distribute, replace, and randomize', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    const assets = buildAssets();
    assets.terrain.push({ id: 7, name: 'terrain_7', width: 16, height: 16 });
    assets.terrainById.set(7, assets.terrain[1]);
    controller.setAssets(assets);

    const t0 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    const t1 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 20, y: 10 });
    const t2 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 40, y: 30 });
    session.level.terrains.push(t0, t1, t2);
    controller._setSelection([
      { type: 'terrain', index: 0 },
      { type: 'terrain', index: 1 },
      { type: 'terrain', index: 2 }
    ]);

    expect(controller.alignSelection('y', 'min')).to.equal(true);
    expect(t0.props.Y).to.equal(0);
    expect(t1.props.Y).to.equal(0);
    expect(t2.props.Y).to.equal(0);

    t1.props.X = 36;
    expect(controller.distributeSelection('x')).to.equal(true);
    expect(t1.props.X).to.equal(20);

    expect(controller.replaceSelectionPiece(7, 'terrain')).to.equal(true);
    expect(t0.props.PIECE).to.equal(7);
    expect(t1.props.PIECE).to.equal(7);
    expect(t2.props.PIECE).to.equal(7);

    expect(controller.randomizeSelectionPieces([2, 7], {
      type: 'terrain',
      requireSameSize: true,
      seed: 123
    })).to.equal(false);
    expect(t0.props.PIECE).to.equal(7);

    expect(controller.randomizeSelectionPieces([2], {
      type: 'terrain',
      requireSameSize: false,
      seed: 123
    })).to.equal(true);
    expect(t0.props.PIECE).to.equal(2);
    expect(t1.props.PIECE).to.equal(2);
    expect(t2.props.PIECE).to.equal(2);
    expect(history.snapshots.some(entry => entry.label === 'Align')).to.equal(true);
    expect(history.snapshots.some(entry => entry.label === 'Distribute')).to.equal(true);
    expect(history.snapshots.some(entry => entry.label === 'Replace')).to.equal(true);
    expect(history.snapshots.some(entry => entry.label === 'Randomize')).to.equal(true);
  });

  it('wraps batch selection edits in explicit history transactions', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    controller.setAssets(buildAssets());
    const t0 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 0, y: 0 });
    const t1 = createTerrainEntry({ styleName: 'dirt', piece: 2, x: 20, y: 10 });
    session.level.terrains.push(t0, t1);
    controller._setSelection([
      { type: 'terrain', index: 0 },
      { type: 'terrain', index: 1 }
    ]);

    expect(controller.alignSelection('x', 'min')).to.equal(true);
    expect(history.beginLabels).to.include('Align');
    expect(history.endLabels).to.include('Align');
  });

  it('cancels explicit history transactions when a batch callback throws', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history });

    expect(() => {
      controller.runHistoryTransaction('Boom', () => {
        throw new Error('explode');
      });
    }).to.throw('explode');
    expect(history.cancelCount).to.equal(1);
  });

  it('scales grouped selections with transformSelectionGroup', () => {
    const session = buildSession();
    const history = new FakeHistory();
    const controller = new EditorController({ session, history, snapEnabled: false });
    controller.setAssets(buildAssets());

    const steel = createSteelEntry({ x: 10, y: 12, width: 4, height: 8 });
    session.level.steel = [steel];
    controller._setSelection([{ type: 'steel', index: 0 }]);

    expect(controller.transformSelectionGroup({ scaleX: 1.5, scaleY: 0.5 })).to.equal(true);
    expect(steel.props.WIDTH).to.equal(6);
    expect(steel.props.HEIGHT).to.equal(4);
    expect(steel.props.X).to.equal(9);
    expect(steel.props.Y).to.equal(14);
    expect(history.snapshots.some(entry => entry.label === 'Transform')).to.equal(true);
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

  it('pastes steel selections with a steel uid prefix', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    session.level.steel = [createSteelEntry({ x: 4, y: 6, width: 2, height: 2 })];
    controller.selection = [{ type: 'steel', index: 0 }];

    expect(controller.copySelection()).to.equal(true);
    expect(controller.pasteSelection()).to.equal(true);
    expect(session.level.steel).to.have.length(2);
    expect(session.level.steel[1].uid.startsWith('s_')).to.equal(true);
  });

  it('pastes gadget selections with a gadget uid prefix', () => {
    const session = buildSession();
    const controller = new EditorController({ session, snapEnabled: false });
    controller.setAssets(buildAssets());
    session.level.gadgets.push(createGadgetEntry({ styleName: 'dirt', piece: 1, x: 2, y: 2 }));
    controller.selection = [{ type: 'gadget', index: 0 }];

    expect(controller.copySelection()).to.equal(true);
    expect(controller.pasteSelection()).to.equal(true);
    expect(session.level.gadgets).to.have.length(2);
    expect(session.level.gadgets[1].uid.startsWith('g_')).to.equal(true);
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
});
