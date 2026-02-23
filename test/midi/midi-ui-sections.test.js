import { expect } from 'chai';
import { createMidiUiSectionsController } from '../../js/app/midi-ui/midiUiSections.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';

const makeSectionsController = (deps = {}) => {
  const document = deps.document || new TestDocument();
  const window = deps.window || createTestWindow();
  const setMidiOverrides = deps.setMidiOverrides || (() => {});
  const mappingCalls = [];
  const mappingEditors = [];
  return {
    document,
    window,
    mappingCalls,
    mappingEditors,
    sections: createMidiUiSectionsController({
      document,
      window,
      setMidiOverrides,
      getConfig: deps.getConfig || (() => ({})),
      createRow: () => document.createElement('div'),
      buildMappingEditor: ({ id, name, targetKey, allowIndependentArp }) => {
        mappingCalls.push({ id, name, targetKey, allowIndependentArp });
        const host = document.createElement('div');
        mappingEditors.push(host);
        return host;
      },
      refreshMidiUiFromConfig: deps.refreshMidiUiFromConfig || (() => {})
    })
  };
};

describe('midiUiSectionsController', function() {
  it('builds scale and key option lists', function() {
    const { document, sections } = makeSectionsController();
    const scaleSelect = document.createElement('select');
    sections.buildScaleOptions(scaleSelect, 'diatonic');
    expect(scaleSelect.children.length).to.be.greaterThan(1);

    const keySelect = document.createElement('select');
    sections.buildKeyOptions(keySelect, 4);
    expect(keySelect.children.length).to.equal(12);
    expect(keySelect.value).to.equal('4');
  });

  it('builds note options with omni and numbered channels', function() {
    const { document, sections } = makeSectionsController();
    const channelSelect = document.createElement('select');
    sections.buildChannelOptions(channelSelect, null);
    const first = channelSelect.children[0];
    const last = channelSelect.children[16];
    expect(first.value).to.equal('omni');
    expect(last.value).to.equal('16');
    expect(channelSelect.value).to.equal('omni');

    const channelSelectWithValue = document.createElement('select');
    sections.buildChannelOptions(channelSelectWithValue, 12);
    expect(channelSelectWithValue.value).to.equal('12');
  });

  it('builds mapping, event, and trigger editors from config', function() {
    const getConfig = () => ({
      position: {
        mappings: [{ axis: 'x', axisX: true, axisY: false, target: 'note', min: 1, max: 7 }]
      },
      sfx: {
        1: { name: 'tick' },
        2: { name: 'toff' }
      },
      triggers: {
        [TriggerTypes.TRAP]: { name: 'trap-mapped', enabled: true }
      }
    });
    const { document, sections, mappingCalls, mappingEditors } = makeSectionsController({ getConfig });
    const positionContainer = document.createElement('div');
    sections.buildPositionMappingList(positionContainer, getConfig().position.mappings, getConfig());
    expect(positionContainer.children.length).to.equal(1);

    const eventContainer = document.createElement('div');
    eventContainer.id = 'midiEventList';
    document.registerElement('midiEventList', eventContainer);
    sections.buildEventList(getConfig(), new Set([1]));
    expect(eventContainer.children.length).to.equal(1);
    expect(mappingCalls.some((call) => call.targetKey === 'sfx')).to.equal(true);

    const triggerContainer = document.createElement('div');
    triggerContainer.id = 'midiTriggerList';
    document.registerElement('midiTriggerList', triggerContainer);
    sections.buildTriggerList(getConfig(), new Set([TriggerTypes.TRAP]));
    expect(triggerContainer.children.length).to.equal(1);
    expect(mappingCalls.some((call) => call.targetKey === 'triggers')).to.equal(true);

    const positionEditors = mappingEditors.filter((entry) => entry);
    expect(positionEditors.length).to.be.greaterThan(0);
  });

  it('resolves envelope targets and merges per-scope config', function() {
    const { sections } = makeSectionsController();
    expect(sections.resolveEnvelopeTarget('global').scope).to.equal('global');
    expect(sections.resolveEnvelopeTarget('sfx:3').id).to.equal('3');
    expect(sections.resolveEnvelopeTarget('trigger:5').scope).to.equal('trigger');

    const config = {
      envelope: { attack: 1, decay: 2 },
      sfx: { 3: { envelope: { sustain: 5 } } },
      triggers: { 9: { envelope: { release: 7 } } }
    };
    expect(sections.resolveEnvelopeConfig(config, 'global').attack).to.equal(1);
    expect(sections.resolveEnvelopeConfig(config, 'sfx:3').sustain).to.equal(5);
    expect(sections.resolveEnvelopeConfig(config, 'trigger:9').release).to.equal(7);
  });
});
