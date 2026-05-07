import { expect } from 'chai';
import {
  LEGACY_MIDI_STORAGE_KEYS,
  PROJECT_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  clearMidiProjectStorage,
  loadMidiProject,
  readStoredMidiProjectTemplates,
  resetMidiProjectStorage,
  saveMidiProject,
  saveMidiProjectTemplate
} from '../../js/midi/project/MidiProjectStorage.js';

const createStorage = () => {
  const backing = new Map();
  const calls = { get: [], set: [], remove: [] };
  return {
    backing,
    calls,
    getItem(key) {
      calls.get.push(key);
      return backing.has(key) ? backing.get(key) : null;
    },
    setItem(key, value) {
      calls.set.push([key, value]);
      backing.set(key, value);
    },
    removeItem(key) {
      calls.remove.push(key);
      backing.delete(key);
    }
  };
};

describe('MidiProjectStorage', function() {
  it('exports the canonical project key and legacy cleanup list', function() {
    expect(PROJECT_STORAGE_KEY).to.equal('lemmings.midi.project.v1');
    expect(TEMPLATE_STORAGE_KEY).to.equal('lemmings.midi.templates.v1');
    expect(LEGACY_MIDI_STORAGE_KEYS).to.include.members([
      'lemmings.midi.intent',
      'lemmings.midi.overrides',
      'lemmings.midi.inputId',
      'lemmings.midi.outputId',
      'lemmings.midi.enabled',
      'lemmings.midi.inputChannel',
      'lemmings.midi.viewPan',
      'lemmings.midi.adsrTarget',
      'lemmings.midi.tabLeft',
      'lemmings.midi.tabRight',
      'lemmings.midi.sectionStates',
      'lemmings.midi.schemaHash',
      'lemmings.midi.storageVersion',
      'lemmings.midi.panelCollapsed',
      'lemmings.midi.ui.audition'
    ]);
  });

  it('loads stored projects after deleting legacy keys without migrating overrides', function() {
    const storage = createStorage();
    storage.backing.set('lemmings.midi.overrides', JSON.stringify({ sfx: { '1': { note: 99 } } }));
    storage.backing.set('lemmings.midi.inputChannel', '12');

    const project = loadMidiProject(storage, {
      enabled: false,
      input: { channel: 3 },
      sfx: { '1': { note: 60, durationTicks: 4 } }
    });

    expect(project.enabled).to.equal(false);
    expect(project.devices.inputChannel).to.equal(3);
    expect(project.sources[0].mapping.note).to.equal(60);
    expect(storage.backing.has('lemmings.midi.overrides')).to.equal(false);
    expect(storage.backing.has('lemmings.midi.inputChannel')).to.equal(false);
  });

  it('saves sanitized projects and reloads the project storage key', function() {
    const storage = createStorage();
    const saved = saveMidiProject(storage, {
      tracks: [{ id: 'track-a', channel: 99 }],
      sources: [{ id: 'sfx-1', kind: 'sfx', sourceKey: '1', mapping: { note: 999 } }],
      clips: [{ id: 'clip-a', name: 'Clip A', lengthSteps: 2, steps: [{ note: 64 }, { note: 67, velocity: 90 }] }],
      automation: [{ id: 'lane-a', target: 'pan', axis: 'x', min: -50, max: 50 }],
      ui: { selectedTrackId: 'track-a', selectedSourceId: 'sfx-1' }
    });

    expect(saved.tracks[0].channel).to.equal(16);
    expect(saved.sources[0].mapping.note).to.equal(127);
    expect(saved.clips[0].steps.map(step => step.note)).to.deep.equal([64, 67]);
    expect(saved.automation[0]).to.include({ id: 'lane-a', target: 'pan', axis: 'x', min: -50, max: 50 });

    const loaded = loadMidiProject(storage);
    expect(loaded.tracks[0].channel).to.equal(16);
    expect(loaded.sources[0].mapping.note).to.equal(127);
    expect(loaded.clips[0].steps[1]).to.include({ note: 67, velocity: 90 });
    expect(loaded.automation[0]).to.include({ id: 'lane-a', target: 'pan' });
    expect(storage.calls.get).to.include(PROJECT_STORAGE_KEY);
  });

  it('resets to a fresh factory project and cleans all legacy keys', function() {
    const storage = createStorage();
    for (const key of LEGACY_MIDI_STORAGE_KEYS) {
      storage.backing.set(key, 'legacy');
    }
    storage.backing.set(PROJECT_STORAGE_KEY, JSON.stringify({
      sources: [{ id: 'sfx-old', kind: 'sfx', sourceKey: 'old', mapping: { note: 1 } }]
    }));

    const project = resetMidiProjectStorage(storage, {
      enabled: true,
      input: { channel: 'omni' },
      sfx: { '7': { note: 70, disabled: true } }
    });

    expect(project.sources.map(source => source.sourceKey)).to.deep.equal(['7']);
    expect(project.sources[0].enabled).to.equal(false);
    expect(JSON.parse(storage.backing.get(PROJECT_STORAGE_KEY)).sources[0].sourceKey).to.equal('7');
    for (const key of LEGACY_MIDI_STORAGE_KEYS) {
      expect(storage.backing.has(key)).to.equal(false);
    }
  });

  it('saves user templates and can reset a project from a selected template', function() {
    const storage = createStorage();
    const project = saveMidiProject(storage, {
      enabled: true,
      devices: { inputId: 'in-1', outputId: 'out-1', inputChannel: 7 },
      tracks: [{ id: 'lead', name: 'Lead', channel: 3 }],
      sources: [{ id: 'sfx-1', kind: 'sfx', sourceKey: '1', label: 'Skill', trackId: 'lead', mapping: { note: 72 } }],
      ui: { selectedTrackId: 'lead', selectedSourceId: 'sfx-1' }
    });

    const template = saveMidiProjectTemplate(storage, project, {
      id: 'lead-template',
      name: 'Lead Template',
      now: 99
    });
    expect(template).to.include({ id: 'lead-template', name: 'Lead Template' });
    expect(template.project).to.include({ enabled: false, templateId: 'lead-template' });
    expect(template.project.devices).to.deep.equal({ inputId: null, outputId: null, inputChannel: 7 });
    expect(readStoredMidiProjectTemplates(storage).map(entry => entry.id)).to.deep.equal(['lead-template']);

    const reset = resetMidiProjectStorage(storage, {
      sfx: { '2': { note: 60 } },
      triggers: {}
    }, 'lead-template');
    expect(reset).to.include({ enabled: false, templateId: 'lead-template', name: 'Lead Template' });
    expect(reset.tracks[0]).to.include({ id: 'lead', name: 'Lead', channel: 3 });
    expect(reset.sources[0]).to.include({ id: 'sfx-1', sourceKey: '1', trackId: 'lead' });
    expect(reset.sources[0].mapping.note).to.equal(72);
    expect(JSON.parse(storage.backing.get(TEMPLATE_STORAGE_KEY)).templates[0].id).to.equal('lead-template');
  });

  it('clears project and legacy storage keys and swallows storage failures', function() {
    const storage = createStorage();
    storage.backing.set(PROJECT_STORAGE_KEY, '{}');
    clearMidiProjectStorage(storage);
    expect(storage.backing.has(PROJECT_STORAGE_KEY)).to.equal(false);

    const badStorage = {
      getItem: () => { throw new Error('get'); },
      setItem: () => { throw new Error('set'); },
      removeItem: () => { throw new Error('remove'); }
    };
    expect(() => loadMidiProject(badStorage)).to.not.throw();
    expect(() => saveMidiProject(badStorage, {})).to.not.throw();
    expect(() => clearMidiProjectStorage(badStorage)).to.not.throw();
  });
});
