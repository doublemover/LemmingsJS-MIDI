import { expect } from 'chai';
import { EditorHistory } from '../../js/editor/EditorHistory.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';

describe('EditorHistory', () => {
  it('stores snapshots and replays undo/redo', () => {
    const history = new EditorHistory();
    const levelA = new EditorLevel();
    levelA.setHeader('TITLE', 'First');
    const levelB = new EditorLevel();
    levelB.setHeader('TITLE', 'Second');

    expect(history.pushSnapshot(levelA, 'A')).to.equal(true);
    expect(history.pushSnapshot(levelB, 'B')).to.equal(true);
    expect(history.canUndo()).to.equal(true);
    expect(history.canRedo()).to.equal(false);

    const undoLevel = history.undo();
    expect(undoLevel.getHeader('TITLE')).to.equal('First');
    expect(history.canRedo()).to.equal(true);

    const redoLevel = history.redo();
    expect(redoLevel.getHeader('TITLE')).to.equal('Second');
  });

  it('skips duplicate snapshots and trims history', () => {
    const history = new EditorHistory({ maxEntries: 2 });
    const levelA = new EditorLevel();
    levelA.setHeader('TITLE', 'Alpha');
    const levelB = new EditorLevel();
    levelB.setHeader('TITLE', 'Beta');
    const levelC = new EditorLevel();
    levelC.setHeader('TITLE', 'Gamma');
    const levelD = new EditorLevel();
    levelD.setHeader('TITLE', 'Delta');

    expect(history.pushSnapshot(levelA, 'A')).to.equal(true);
    expect(history.pushSnapshot(levelA, 'A2')).to.equal(false);
    expect(history.pushSnapshot(levelB, 'B')).to.equal(true);
    expect(history.undo().getHeader('TITLE')).to.equal('Alpha');
    expect(history.pushSnapshot(levelC, 'C')).to.equal(true);
    expect(history.pushSnapshot(levelD, 'D')).to.equal(true);
    expect(history.entries.length).to.equal(2);
    expect(history.cursor).to.equal(1);
    expect(history.entries[0].label).to.equal('C');

    const undoLevel = history.undo();
    expect(undoLevel.getHeader('TITLE')).to.equal('Gamma');
    expect(history.canUndo()).to.equal(false);
    expect(history.redo().getHeader('TITLE')).to.equal('Delta');
    expect(history.redo()).to.equal(null);

    history.clear();
    expect(history.entries).to.deep.equal([]);
    expect(history.cursor).to.equal(-1);
  });

  it('handles empty snapshots and invalid indices', () => {
    const history = new EditorHistory();
    expect(history.pushSnapshot(null, 'Empty')).to.equal(true);
    expect(history._applySnapshot(-1)).to.equal(null);
    history.clear();
    expect(history.undo()).to.equal(null);
  });

  it('groups transaction snapshots into a single undo step', () => {
    const history = new EditorHistory();
    const base = new EditorLevel();
    base.setHeader('TITLE', 'Base');
    const mid = new EditorLevel();
    mid.setHeader('TITLE', 'Mid');
    const fin = new EditorLevel();
    fin.setHeader('TITLE', 'Final');

    expect(history.pushSnapshot(base, 'Base')).to.equal(true);
    history.beginTransaction('Batch');
    expect(history.pushSnapshot(mid, 'Mid')).to.equal(true);
    expect(history.pushSnapshot(fin, 'Final')).to.equal(true);
    expect(history.entries).to.have.length(1);
    expect(history.endTransaction('Batch Done')).to.equal(true);

    expect(history.entries).to.have.length(2);
    expect(history.entries[1].label).to.equal('Batch Done');
    expect(history.undo().getHeader('TITLE')).to.equal('Base');
  });

  it('supports nested transaction boundaries and cancellation', () => {
    const history = new EditorHistory();
    const base = new EditorLevel();
    base.setHeader('TITLE', 'Base');
    const branch = new EditorLevel();
    branch.setHeader('TITLE', 'Branch');

    expect(history.pushSnapshot(base, 'Base')).to.equal(true);
    history.beginTransaction('Outer');
    history.beginTransaction('Inner');
    expect(history.pushSnapshot(branch, 'Inner Change')).to.equal(true);
    expect(history.endTransaction('Inner Done')).to.equal(false);
    expect(history.entries).to.have.length(1);
    expect(history.endTransaction('Outer Done')).to.equal(true);
    expect(history.entries).to.have.length(2);
    expect(history.entries[1].label).to.equal('Outer Done');

    history.beginTransaction('Cancel');
    expect(history.pushSnapshot(base, 'Revert')).to.equal(true);
    expect(history.cancelTransaction()).to.equal(true);
    expect(history.entries).to.have.length(2);
  });

  it('reports byte stats and enforces memory-aware retention', () => {
    const history = new EditorHistory({
      maxEntries: 10,
      maxBytes: 8,
      writer: { write: level => level.text },
      parser: { parse: text => ({ text }) }
    });

    expect(history.pushSnapshot({ text: 'aa' }, 'A')).to.equal(true);
    expect(history.pushSnapshot({ text: 'bb' }, 'B')).to.equal(true);
    expect(history.pushSnapshot({ text: 'cc' }, 'C')).to.equal(true);

    expect(history.entries.map(entry => entry.text)).to.deep.equal(['bb', 'cc']);
    expect(history.cursor).to.equal(1);
    expect(history.getStats()).to.include({
      entries: 2,
      cursor: 1,
      bytes: 8,
      maxBytes: 8
    });
  });

  it('keeps large sessions bounded by bytes during stress-style snapshot growth', () => {
    const history = new EditorHistory({
      maxEntries: 1000,
      maxBytes: 4096,
      writer: { write: level => level.text },
      parser: { parse: text => ({ text }) }
    });

    for (let i = 0; i < 80; i += 1) {
      const text = `${String(i).padStart(3, '0')}:${'x'.repeat(256)}`;
      expect(history.pushSnapshot({ text }, 'Stress')).to.equal(true);
      expect(history.getStats().bytes).to.be.at.most(4096);
      expect(history.getStats().entries).to.be.lessThan(1000);
    }

    expect(history.entries.at(-1).text.startsWith('079:')).to.equal(true);
    expect(history.getStats().bytes).to.be.at.most(4096);
  });

  it('coalesces nearby snapshots with the same label when configured', () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      const history = new EditorHistory({
        coalesceWindowMs: 250,
        writer: { write: level => level.text },
        parser: { parse: text => ({ text }) }
      });

      expect(history.pushSnapshot({ text: 'a' }, 'Drag')).to.equal(true);
      now += 100;
      expect(history.pushSnapshot({ text: 'b' }, 'Drag')).to.equal(true);
      expect(history.entries.map(entry => entry.text)).to.deep.equal(['b']);

      now += 500;
      expect(history.pushSnapshot({ text: 'c' }, 'Drag')).to.equal(true);
      expect(history.entries.map(entry => entry.text)).to.deep.equal(['b', 'c']);
    } finally {
      Date.now = originalNow;
    }
  });
});
