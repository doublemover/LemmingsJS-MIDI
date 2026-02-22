import { expect } from 'chai';
import {
  migrateMidiOverrides,
  midiStorageKeys,
  readStoredMidiOverrides,
  readStoredSectionStates,
  readStoredMidiId,
  storeMidiId,
  readStoredJson,
  storeJson
} from '../../js/app/midi-ui/midiUiStorage.js';

const createStorage = () => {
  const calls = { get: [], set: [], remove: [] };
  return {
    calls,
    getItem: (key) => {
      calls.get.push(key);
      return null;
    },
    setItem: (key, value) => {
      calls.set.push([key, value]);
    },
    removeItem: (key) => {
      calls.remove.push(key);
    }
  };
};

describe('midiUiStorage', function() {
  it('exports storage keys for MIDI settings', function() {
    expect(midiStorageKeys.storageVersion).to.equal('lemmings.midi.storageVersion');
    expect(midiStorageKeys.inputId).to.equal('lemmings.midi.inputId');
    expect(midiStorageKeys.outputId).to.equal('lemmings.midi.outputId');
    expect(midiStorageKeys.sectionStates).to.equal('lemmings.midi.sectionStates');
  });

  it('reads stored MIDI ids and handles failures', function() {
    const storage = createStorage();
    storage.getItem = () => 'device-1';
    expect(readStoredMidiId(storage, 'key')).to.equal('device-1');

    expect(readStoredMidiId(null, 'key')).to.equal(null);

    const badStorage = { getItem: () => { throw new Error('nope'); } };
    expect(readStoredMidiId(badStorage, 'key')).to.equal(null);
  });

  it('stores MIDI ids and clears when empty', function() {
    const storage = createStorage();
    storeMidiId(storage, 'input', 'midi-1');
    storeMidiId(storage, 'input', '');

    expect(storage.calls.set).to.deep.equal([['input', 'midi-1']]);
    expect(storage.calls.remove).to.deep.equal(['input']);
  });

  it('swallows storage errors when writing MIDI ids', function() {
    const storage = {
      setItem: () => { throw new Error('fail'); },
      removeItem: () => { throw new Error('fail'); }
    };

    expect(() => storeMidiId(storage, 'input', 'midi-2')).to.not.throw();
    expect(() => storeMidiId(storage, 'input', null)).to.not.throw();
  });

  it('reads stored JSON and handles missing or invalid values', function() {
    const storage = createStorage();
    storage.getItem = () => '{"a":1}';
    expect(readStoredJson(storage, 'key')).to.deep.equal({ a: 1 });

    storage.getItem = () => null;
    expect(readStoredJson(storage, 'key')).to.equal(null);

    storage.getItem = () => '{bad';
    expect(readStoredJson(storage, 'key')).to.equal(null);

    const badStorage = { getItem: () => { throw new Error('nope'); } };
    expect(readStoredJson(badStorage, 'key')).to.equal(null);
  });

  it('supports guarded JSON reads for migration hooks', function() {
    const storage = createStorage();
    storage.getItem = () => '{"a":1}';
    const value = readStoredJson(storage, 'key', {
      guard: (payload) => ({ migrated: payload?.a === 1 })
    });
    expect(value).to.deep.equal({ migrated: true });
  });

  it('stores JSON and removes entries when nullish', function() {
    const storage = createStorage();
    storeJson(storage, 'overrides', { a: 1 });
    storeJson(storage, 'overrides', null);

    expect(storage.calls.set).to.deep.equal([['overrides', '{"a":1}']]);
    expect(storage.calls.remove).to.deep.equal(['overrides']);
  });

  it('swallows storage errors when writing JSON', function() {
    const storage = {
      setItem: () => { throw new Error('fail'); },
      removeItem: () => { throw new Error('fail'); }
    };

    expect(() => storeJson(storage, 'overrides', { a: 2 })).to.not.throw();
    expect(() => storeJson(storage, 'overrides', null)).to.not.throw();
  });

  it('migrates stored MIDI overrides into a safe normalized object', function() {
    const migrated = migrateMidiOverrides({
      repeat: { spacingTicks: 4 },
      input: { channel: ' 17 ' },
      position: { mappings: [{ axis: 'x' }, null, 'bad'] }
    });
    expect(migrated.repeat.windowBeats).to.equal(4);
    expect(migrated.input.channel).to.equal(16);
    expect(migrated.position.mappings).to.deep.equal([{ axis: 'x' }]);
  });

  it('reads stored MIDI overrides and section states with guards', function() {
    const storage = createStorage();
    storage.getItem = (key) => {
      if (key === midiStorageKeys.overrides) {
        return '{"input":{"channel":"omni"},"repeat":{"spacingTicks":2}}';
      }
      if (key === midiStorageKeys.sectionStates) {
        return '{"main":true,"bad":"x"}';
      }
      return null;
    };
    const overrides = readStoredMidiOverrides(storage);
    const sections = readStoredSectionStates(storage);
    expect(overrides.input.channel).to.equal('omni');
    expect(overrides.repeat.windowBeats).to.equal(2);
    expect(sections).to.deep.equal({ main: true });
  });

  it('migrates legacy MIDI storage payloads to a versioned schema', function() {
    const backing = new Map();
    backing.set(midiStorageKeys.overrides, '{"repeat":{"spacingTicks":3},"input":{"channel":"18"}}');
    backing.set(midiStorageKeys.sectionStates, '{"io":true,"invalid":"x"}');
    const writes = [];
    const storage = {
      getItem(key) {
        return backing.has(key) ? backing.get(key) : null;
      },
      setItem(key, value) {
        writes.push([key, value]);
        backing.set(key, value);
      },
      removeItem(key) {
        backing.delete(key);
      }
    };

    const overrides = readStoredMidiOverrides(storage);
    const sections = readStoredSectionStates(storage);
    expect(overrides.repeat.windowBeats).to.equal(3);
    expect(overrides.input.channel).to.equal(16);
    expect(sections).to.deep.equal({ io: true });

    const storedVersion = backing.get(midiStorageKeys.storageVersion);
    expect(storedVersion).to.equal('2');
    const versionWrites = writes.filter(([key]) => key === midiStorageKeys.storageVersion);
    expect(versionWrites).to.have.lengthOf(1);
  });
});
