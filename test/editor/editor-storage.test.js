import { expect } from 'chai';
import {
  STORAGE_KEYS,
  createLevelId,
  listSavedLevels,
  loadSavedLevel,
  saveLevel,
  deleteLevel,
  __test__
} from '../../js/editor/EditorStorage.js';

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

describe('EditorStorage', () => {
  it('creates deterministic ids and increments', () => {
    const now = () => 1000;
    const first = createLevelId(now);
    const second = createLevelId(now);
    expect(first).to.not.equal(second);
    expect(first).to.match(/^level-1000-\d+$/);
  });

  it('uses Date.now when no generator is provided', () => {
    const originalNow = Date.now;
    Date.now = () => 5000;
    try {
      const id = createLevelId();
      expect(id).to.match(/^level-5000-\d+$/);
    } finally {
      Date.now = originalNow;
    }
  });

  it('lists saved levels sorted by name then updatedAt', () => {
    const storage = new MemoryStorage();
    const entries = [
      { id: 'b', name: 'Beta', updatedAt: 5 },
      { id: 'a1', name: 'Alpha', updatedAt: 10 },
      { id: 'a2', name: 'Alpha', updatedAt: 3 },
      { id: 'c', name: '', updatedAt: 'nope' },
      { name: 'Skip', updatedAt: 1 }
    ];
    storage.setItem(STORAGE_KEYS.index, JSON.stringify(entries));
    const list = listSavedLevels(storage);
    expect(list).to.have.length(4);
    expect(list[0].id).to.equal('a1');
    expect(list[1].id).to.equal('a2');
    expect(list[2].id).to.equal('b');
    expect(list[3].name).to.equal('Untitled');
    expect(list[3].updatedAt).to.equal(0);
  });

  it('orders names in both directions', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.index, JSON.stringify([
      { id: 'b', name: 'Beta', updatedAt: 1 },
      { id: 'a', name: 'Alpha', updatedAt: 2 }
    ]));
    const list = listSavedLevels(storage);
    expect(list[0].id).to.equal('a');
    expect(list[1].id).to.equal('b');
  });

  it('orders equal names by updatedAt', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.index, JSON.stringify([
      { id: 'a1', name: 'Same', updatedAt: 1 },
      { id: 'a2', name: 'Same', updatedAt: 5 }
    ]));
    const list = listSavedLevels(storage);
    expect(list[0].id).to.equal('a2');
    expect(list[1].id).to.equal('a1');
  });

  it('compares names and updatedAt explicitly', () => {
    const { compareSavedLevels } = __test__;
    expect(compareSavedLevels({ name: 'Alpha' }, { name: 'Beta' })).to.equal(-1);
    expect(compareSavedLevels({ name: 'Gamma' }, { name: 'Beta' })).to.equal(1);
    expect(compareSavedLevels({ name: 'Same', updatedAt: 1 }, { name: 'Same', updatedAt: 4 }))
      .to.equal(3);
    expect(compareSavedLevels({}, { updatedAt: 2 })).to.equal(2);
    expect(compareSavedLevels({}, {})).to.equal(0);
  });

  it('handles invalid storage data without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.index, '{bad json');
    const list = listSavedLevels(storage);
    expect(list).to.deep.equal([]);
  });

  it('ignores non-array index payloads', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.index, JSON.stringify({ id: 'x' }));
    const list = listSavedLevels(storage);
    expect(list).to.deep.equal([]);
  });

  it('handles storage errors gracefully', () => {
    const storage = {
      getItem() { throw new Error('fail'); }
    };
    const list = listSavedLevels(storage);
    expect(list).to.deep.equal([]);
  });

  it('covers default storage access', () => {
    const list = listSavedLevels();
    expect(list).to.deep.equal([]);
    const loaded = loadSavedLevel(undefined, 'missing');
    expect(loaded).to.equal(null);
  });

  it('handles storage write failures', () => {
    const storage = {
      getItem() { return null; },
      setItem() { throw new Error('fail'); },
      removeItem() { throw new Error('fail'); }
    };
    const id = saveLevel(storage, { id: 'bad', name: 'Bad', text: 'x', updatedAt: 1 });
    expect(id).to.equal('bad');
    const removed = deleteLevel(storage, 'bad');
    expect(removed).to.equal(true);
  });

  it('saves and loads levels', () => {
    const storage = new MemoryStorage();
    const id = saveLevel(storage, {
      name: 'First',
      text: 'LEVEL DATA',
      updatedAt: 123
    });
    expect(id).to.match(/^level-123-\d+$/);
    const loaded = loadSavedLevel(storage, id);
    expect(loaded).to.equal('LEVEL DATA');
    const list = listSavedLevels(storage);
    expect(list).to.have.length(1);
    expect(list[0].name).to.equal('First');
  });

  it('uses Date.now when updatedAt is not finite', () => {
    const storage = new MemoryStorage();
    const originalNow = Date.now;
    Date.now = () => 77;
    try {
      const id = saveLevel(storage, { name: 'Timed', text: 't', updatedAt: NaN });
      expect(id).to.match(/^level-77-\d+$/);
      const list = listSavedLevels(storage);
      expect(list[0].updatedAt).to.equal(77);
    } finally {
      Date.now = originalNow;
    }
  });

  it('updates existing entries and normalizes text', () => {
    const storage = new MemoryStorage();
    const id = saveLevel(storage, {
      id: 'fixed',
      name: 'Start',
      text: 'a',
      updatedAt: 1
    });
    expect(id).to.equal('fixed');
    const updated = saveLevel(storage, {
      id: 'fixed',
      name: 'Next',
      text: null,
      updatedAt: 2
    });
    expect(updated).to.equal('fixed');
    const list = listSavedLevels(storage);
    expect(list).to.have.length(1);
    expect(list[0].updatedAt).to.equal(2);
    const loaded = loadSavedLevel(storage, 'fixed');
    expect(loaded).to.equal('');
  });

  it('deletes entries and handles missing inputs', () => {
    const storage = new MemoryStorage();
    expect(deleteLevel(storage, null)).to.equal(false);
    expect(deleteLevel(null, 'x')).to.equal(false);
    saveLevel(storage, { id: 'keep', name: 'Keep', text: 'x', updatedAt: 1 });
    saveLevel(storage, { id: 'drop', name: 'Drop', text: 'y', updatedAt: 2 });
    const removed = deleteLevel(storage, 'drop');
    expect(removed).to.equal(true);
    const list = listSavedLevels(storage);
    expect(list).to.have.length(1);
    expect(list[0].id).to.equal('keep');
    expect(loadSavedLevel(storage, 'drop')).to.equal(null);
    expect(loadSavedLevel(storage, null)).to.equal(null);
  });

  it('returns null when storage is unavailable', () => {
    const id = saveLevel(null, { name: 'Nope', text: 'x' });
    expect(id).to.equal(null);
  });
});
