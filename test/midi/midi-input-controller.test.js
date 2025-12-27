import { expect } from 'chai';
import { MidiInputController } from '../../js/midi/input/MidiInputController.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';

describe('MidiInputController', function() {
  it('filters channels and selects skills', function() {
    const commands = [];
    const view = {
      game: {
        queueCommand(cmd) { commands.push(cmd); },
        gameGui: {}
      }
    };
    const config = {
      input: {
        channel: 2,
        notes: { skillBase: 60, skillOrder: ['CLIMBER'] }
      }
    };
    const controller = new MidiInputController(view, { getConfig: () => config });

    controller._onMessage({ data: [0x90, 60, 100] });
    controller._onMessage({ data: [0x91, 60, 100] });

    expect(commands.length).to.equal(1);
    expect(commands[0].skill).to.equal(SkillTypes.CLIMBER);
    expect(view.game.gameGui.skillSelectionChanged).to.equal(true);
  });

  it('handles transport, note actions, and CC mappings', function() {
    const calls = { pause: 0, resume: 0, restart: 0, speed: [] };
    const patches = [];
    const view = {
      suspend() { calls.pause += 1; },
      continue() { calls.resume += 1; },
      moveToLevel() { calls.restart += 1; },
      selectSpeedFactor(value) { calls.speed.push(value); },
      gameSpeedFactor: 1,
      setMidiEnabled(enabled) { this.midiEnabled = enabled; },
      midiEnabled: true
    };
    const config = {
      input: {
        channel: 'omni',
        transport: {
          start: 'restart',
          stop: 'pause',
          continue: 'resume'
        },
        notes: {
          actions: { pause: 36, speedUp: 37, toggleMidi: 38, toggleViewPan: 39 }
        },
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 },
          bpmBase: { cc: 2, min: 100, max: 200 },
          custom: { cc: 3, target: 'position.viewPan', toggle: true },
          scaleName: { cc: 4, target: 'scale.name', values: ['major', 'minor'] }
        }
      },
      position: { viewPan: false }
    };
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });

    controller._onMessage({ data: [0xFA] });
    controller._onMessage({ data: [0xFC] });
    controller._onMessage({ data: [0xFB] });

    expect(calls.restart).to.equal(1);
    expect(calls.pause).to.equal(1);
    expect(calls.resume).to.equal(1);

    controller._onMessage({ data: [0x90, 36, 100] });
    controller._onMessage({ data: [0x90, 37, 100] });
    controller._onMessage({ data: [0x90, 38, 100] });
    controller._onMessage({ data: [0x90, 39, 100] });

    expect(calls.pause).to.equal(2);
    expect(calls.speed[0]).to.equal(2);
    expect(view.midiEnabled).to.equal(false);
    expect(patches.some(patch => patch.position?.viewPan === true)).to.equal(true);

    controller._onMessage({ data: [0xB0, 1, 127] });
    expect(calls.speed[calls.speed.length - 1]).to.be.closeTo(2, 0.001);

    controller._onMessage({ data: [0xB0, 2, 0] });
    expect(patches.some(patch => patch.timing?.bpmBase === 100)).to.equal(true);

    controller._onMessage({ data: [0xB0, 3, 127] });
    expect(patches.some(patch => patch.position?.viewPan === true)).to.equal(true);

    controller._onMessage({ data: [0xB0, 4, 127] });
    expect(patches.some(patch => patch.scale?.name === 'minor')).to.equal(true);
  });
});
