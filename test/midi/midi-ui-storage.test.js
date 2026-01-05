import { expect } from 'chai';
import {
  midiStorageKeys,
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
});
