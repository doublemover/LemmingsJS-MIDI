import { expect } from 'chai';
import {
  NOTE_NAMES,
  CHORD_OPTIONS,
  POSITION_AXIS_OPERATORS,
  POSITION_TARGETS,
  REPEAT_TARGETS,
  REPEAT_WINDOW_OPTIONS,
  EXCLUDED_TRIGGER_NAMES,
  TRIGGER_NAME_BY_VALUE,
  TRAP_SFX_IDS,
  EXCLUDED_SFX_IDS,
  SFX_NAME_BY_ID,
  listTriggerEntries,
  collectTriggerTypes,
  resolveAvailableSfxIds,
  resolvePositionMappings
} from '../../js/app/midi-ui/midiUiDomain.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { toMidiFlagTriggerType } from '../../js/midi/MidiFlagTriggers.js';

describe('midiUiDomain', function() {
  it('exports static option lists and maps', function() {
    expect(NOTE_NAMES).to.have.length(12);
    expect(CHORD_OPTIONS).to.include('triad');
    expect(POSITION_AXIS_OPERATORS.map(op => op.value)).to.include('add');
    expect(POSITION_TARGETS.map(target => target.value)).to.include('note');
    expect(REPEAT_TARGETS.map(target => target.value)).to.include('velocity');
    expect(REPEAT_WINDOW_OPTIONS.map(option => option.value)).to.include(1);
    expect(EXCLUDED_TRIGGER_NAMES.has('UNKNOWN_2')).to.equal(true);
    expect(TRIGGER_NAME_BY_VALUE.get(TriggerTypes.TRAP)).to.equal('TRAP');
    expect(TRAP_SFX_IDS.has(SoundEffectIds.TRAP_ZAP)).to.equal(true);
    expect(EXCLUDED_SFX_IDS.has(SoundEffectIds.UNKNOWN_0B)).to.equal(true);
    expect(SFX_NAME_BY_ID.get(SoundEffectIds.BUILDER_STEP)).to.equal('builder-step');
  });

  it('collectTriggerTypes returns empty for missing level', function() {
    const types = collectTriggerTypes(null);
    expect(types.size).to.equal(0);
  });

  it('collectTriggerTypes includes triggers, disabled, arrows, and steel ranges', function() {
    const level = {
      triggers: [
        { type: TriggerTypes.EXIT_LEVEL },
        { type: TriggerTypes.TRAP, disableTicksCount: 2 },
        { type: 'not-a-number' }
      ],
      arrowRanges: [{}],
      steelRanges: [{}],
      midiFlags: [
        { id: 2 }
      ]
    };
    const types = collectTriggerTypes(level);

    expect(types.has(TriggerTypes.EXIT_LEVEL)).to.equal(true);
    expect(types.has(TriggerTypes.TRAP)).to.equal(true);
    expect(types.has(TriggerTypes.DISABLED)).to.equal(true);
    expect(types.has(TriggerTypes.ONEWAY_LEFT)).to.equal(true);
    expect(types.has(TriggerTypes.ONEWAY_RIGHT)).to.equal(true);
    expect(types.has(TriggerTypes.STEEL)).to.equal(true);
    expect(types.has(toMidiFlagTriggerType(2))).to.equal(true);
  });

  it('lists trigger entries including dynamic midi flag trigger ids', function() {
    const flagTrigger = toMidiFlagTriggerType(7);
    const entries = listTriggerEntries(
      { triggers: { [flagTrigger]: { note: 72 } } },
      new Set([TriggerTypes.TRAP, flagTrigger]),
      { midiFlags: [{ id: 7, triggerType: flagTrigger }] }
    );
    const trap = entries.find(entry => entry.value === TriggerTypes.TRAP);
    const flag = entries.find(entry => entry.value === flagTrigger);
    expect(trap?.name).to.equal('TRAP');
    expect(flag?.name).to.equal('MIDI_FLAG_7');
  });

  it('resolveAvailableSfxIds returns all ids when level and skills missing', function() {
    const config = {
      sfx: {
        '0': { name: 'none' },
        '1': { name: 'one' },
        '2': { name: 'two' },
        'nope': { name: 'invalid' }
      }
    };

    const available = resolveAvailableSfxIds(config, null, null);

    expect(available.has(0)).to.equal(true);
    expect(available.has(1)).to.equal(true);
    expect(available.has(2)).to.equal(true);
    expect(available.size).to.equal(3);
  });

  it('resolveAvailableSfxIds uses skill getter and any-skill gating', function() {
    const config = {
      sfx: {
        [SoundEffectIds.BUILDER_STEP]: { name: 'builder' },
        [SoundEffectIds.DIG]: { name: 'dig' },
        [SoundEffectIds.SKILL_SELECT]: { name: 'select' },
        [SoundEffectIds.EXIT]: { name: 'exit' }
      }
    };
    const skills = {
      cheatMode: false,
      getSkill: (skill) => (skill === SkillTypes.BUILDER ? 1 : 0)
    };

    const available = resolveAvailableSfxIds(config, null, skills);

    expect(available.has(SoundEffectIds.BUILDER_STEP)).to.equal(true);
    expect(available.has(SoundEffectIds.DIG)).to.equal(false);
    expect(available.has(SoundEffectIds.SKILL_SELECT)).to.equal(true);
    expect(available.has(SoundEffectIds.EXIT)).to.equal(true);
  });

  it('resolveAvailableSfxIds excludes gated ids when no matches exist', function() {
    const config = {
      sfx: {
        [SoundEffectIds.BUILDER_WARNING]: { name: 'builder-warning' },
        [SoundEffectIds.SKILL_ASSIGN]: { name: 'assign' },
        [SoundEffectIds.STEEL_HIT]: { name: 'steel' },
        [SoundEffectIds.DROWN]: { name: 'drown' },
        [SoundEffectIds.TRAP_ZAP]: { name: 'zap' },
        [SoundEffectIds.EXIT]: { name: 'exit' }
      }
    };
    const level = {
      skills: []
    };

    const available = resolveAvailableSfxIds(config, level, null);

    expect(available.has(SoundEffectIds.BUILDER_WARNING)).to.equal(false);
    expect(available.has(SoundEffectIds.SKILL_ASSIGN)).to.equal(false);
    expect(available.has(SoundEffectIds.STEEL_HIT)).to.equal(false);
    expect(available.has(SoundEffectIds.DROWN)).to.equal(false);
    expect(available.has(SoundEffectIds.TRAP_ZAP)).to.equal(false);
    expect(available.has(SoundEffectIds.EXIT)).to.equal(true);
    expect(available.size).to.equal(1);
  });

  it('resolveAvailableSfxIds handles missing skill sources', function() {
    const config = {
      sfx: {
        [SoundEffectIds.BUILDER_WARNING]: { name: 'builder-warning' },
        [SoundEffectIds.EXIT]: { name: 'exit' }
      }
    };
    const level = { triggers: [] };
    const skills = {};

    const available = resolveAvailableSfxIds(config, level, skills);

    expect(available.has(SoundEffectIds.BUILDER_WARNING)).to.equal(false);
    expect(available.has(SoundEffectIds.EXIT)).to.equal(true);
  });

  it('resolveAvailableSfxIds includes gated ids when level and cheat allow', function() {
    const config = {
      sfx: {
        [SoundEffectIds.BUILDER_WARNING]: { name: 'builder-warning' },
        [SoundEffectIds.SKILL_ASSIGN]: { name: 'assign' },
        [SoundEffectIds.STEEL_HIT]: { name: 'steel' },
        [SoundEffectIds.DROWN]: { name: 'drown' },
        [SoundEffectIds.TRAP_ZAP]: { name: 'zap' },
        [SoundEffectIds.TRAP_FIRE]: { name: 'fire' },
        [SoundEffectIds.EXIT]: { name: 'exit' }
      }
    };
    const level = {
      triggers: [
        { type: TriggerTypes.TRAP, soundIndex: SoundEffectIds.TRAP_ZAP },
        { type: TriggerTypes.TRAP, soundIndex: 0 },
        { type: TriggerTypes.KILL },
        { type: TriggerTypes.FRYING },
        { type: TriggerTypes.DROWN }
      ],
      steelMask: { mask: [0, 1] }
    };
    const skills = { cheatMode: true };

    const available = resolveAvailableSfxIds(config, level, skills);

    expect(available.has(SoundEffectIds.BUILDER_WARNING)).to.equal(true);
    expect(available.has(SoundEffectIds.SKILL_ASSIGN)).to.equal(true);
    expect(available.has(SoundEffectIds.STEEL_HIT)).to.equal(true);
    expect(available.has(SoundEffectIds.DROWN)).to.equal(true);
    expect(available.has(SoundEffectIds.TRAP_ZAP)).to.equal(true);
    expect(available.has(SoundEffectIds.TRAP_FIRE)).to.equal(true);
    expect(available.has(SoundEffectIds.EXIT)).to.equal(true);
  });

  it('resolvePositionMappings normalizes axisX and axisY entries', function() {
    const config = {
      position: {
        mappings: [
          { axisX: true, target: 'note', min: 0, max: 12, enabled: true },
          { axisY: true, axisOp: 'mul', target: 'pan', min: -1, max: 1, enabled: true }
        ]
      }
    };

    const mappings = resolvePositionMappings(config);

    expect(mappings).to.have.length(2);
    expect(mappings[0].axisX).to.equal(true);
    expect(mappings[0].axisY).to.equal(false);
    expect(mappings[0].axisOp).to.equal('add');
    expect(mappings[1].axisX).to.equal(false);
    expect(mappings[1].axisY).to.equal(true);
    expect(mappings[1].axisOp).to.equal('mul');
  });

  it('resolvePositionMappings normalizes axis strings', function() {
    const config = {
      position: {
        mappings: [
          { axis: 'xy', target: 'note', min: 0, max: 1, enabled: true },
          { axis: 'y', target: 'velocity', min: 0, max: 1, enabled: true },
          { axis: 'x', target: 'timbre', min: 0, max: 1, enabled: true }
        ]
      }
    };

    const mappings = resolvePositionMappings(config);

    expect(mappings[0].axisX).to.equal(true);
    expect(mappings[0].axisY).to.equal(true);
    expect(mappings[1].axisX).to.equal(false);
    expect(mappings[1].axisY).to.equal(true);
    expect(mappings[2].axisX).to.equal(true);
    expect(mappings[2].axisY).to.equal(false);
  });

  it('resolvePositionMappings defaults axis to x when missing', function() {
    const config = {
      position: {
        mappings: [
          { target: 'note', min: 0, max: 1, enabled: true }
        ]
      }
    };

    const mappings = resolvePositionMappings(config);

    expect(mappings).to.have.length(1);
    expect(mappings[0].axisX).to.equal(true);
    expect(mappings[0].axisY).to.equal(false);
    expect(mappings[0].axisOp).to.equal('add');
  });

  it('resolvePositionMappings preserves explicit mapping ranges', function() {
    const config = {
      position: {
        mappings: [
          { axis: 'x', target: 'note', min: -5, max: 5, enabled: true },
          { axis: 'y', target: 'velocity', min: 120, max: 5, enabled: true },
          { axis: 'y', target: 'timbre', min: 20, max: 10, enabled: true }
        ]
      }
    };

    const mappings = resolvePositionMappings(config);

    expect(mappings).to.have.length(3);
    expect(mappings[0].target).to.equal('note');
    expect(mappings[0].min).to.equal(-5);
    expect(mappings[0].max).to.equal(5);
    expect(mappings[1].target).to.equal('velocity');
    expect(mappings[1].min).to.equal(120);
    expect(mappings[1].max).to.equal(5);
    expect(mappings[2].target).to.equal('timbre');
    expect(mappings[2].min).to.equal(20);
    expect(mappings[2].max).to.equal(10);
  });

  it('resolvePositionMappings returns empty when mappings are omitted', function() {
    const config = {
      position: {
        xToNote: true,
        yToVelocity: true
      }
    };

    const mappings = resolvePositionMappings(config);

    expect(mappings).to.have.length(0);
  });

  it('resolvePositionMappings handles missing config', function() {
    const mappings = resolvePositionMappings(null);

    expect(mappings).to.have.length(0);
  });
});
