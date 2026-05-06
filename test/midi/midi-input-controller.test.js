import { expect } from 'chai';
import { MidiInputController } from '../../js/midi/input/MidiInputController.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { withPatchedGlobals } from '../support/globals.js';

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
          scaleName: { cc: 4, target: 'scale.name', values: ['major', 'minor'] },
          accent: { cc: 5, min: 0, max: 1 }
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

    controller._onMessage({ data: [0xB0, 5, 127] });
    expect(patches.some(patch => patch.density?.velocityBoost === 1)).to.equal(true);
  });

  it('captures note input when a capture handler is active', function() {
    const commands = [];
    const view = {
      game: {
        queueCommand(cmd) { commands.push(cmd); },
        gameGui: {}
      }
    };
    const config = {
      input: {
        channel: 'omni',
        notes: { skillBase: 60, skillOrder: ['CLIMBER'] }
      }
    };
    const controller = new MidiInputController(view, { getConfig: () => config });
    const captured = [];
    controller.setNoteCapture((note, velocity, channel) => {
      captured.push({ note, velocity, channel });
      return true;
    });

    controller._onMessage({ data: [0x90, 60, 100] });

    expect(captured).to.deep.equal([{ note: 60, velocity: 100, channel: 1 }]);
    expect(commands.length).to.equal(0);
  });

  it('capture handlers respect channel filtering, velocity-zero note-ons, and fallthrough', function() {
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
    const captured = [];
    controller.setNoteCapture((note, velocity, channel) => {
      captured.push({ note, velocity, channel });
      return false;
    });

    controller._onMessage({ data: [0x90, 60, 100] });
    controller._onMessage({ data: [0x91, 60, 0] });
    controller._onMessage({ data: [0x91, 60, 100] });

    expect(captured).to.deep.equal([{ note: 60, velocity: 100, channel: 2 }]);
    expect(commands.length).to.equal(1);
    expect(commands[0].skill).to.equal(SkillTypes.CLIMBER);
  });

  it('stores the last MIDI message on window', function() {
    const view = {};
    const controller = new MidiInputController(view, { getConfig: () => ({ input: { channel: 'omni' } }) });
    withPatchedGlobals({ window: {} }, () => {
      controller._onMessage({ data: [0x90, 60, 100] });
      expect(globalThis.window.lastMidiInputMessage).to.eql([0x90, 60, 100]);
    });
  });

  it('sets gameSpeedFactor when no speed selector is present', function() {
    const view = { gameSpeedFactor: 1 };
    const controller = new MidiInputController(view, { getConfig: () => ({ input: { channel: 'omni' } }) });
    controller._setSpeedFactor(2);
    expect(view.gameSpeedFactor).to.equal(2);
  });

  it('maps intensity CC to velocity defaults', function() {
    const patches = [];
    const view = {};
    const config = {
      input: {
        channel: 'omni',
        cc: { intensity: { cc: 9, min: 10, max: 127 } }
      }
    };
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
    controller._onMessage({ data: [0xB0, 9, 127] });
    expect(patches.some(patch => patch.velocityRange?.default === 127)).to.equal(true);
  });

  it('attaches and detaches MIDI listeners', function() {
    const calls = [];
    const input = {
      addListener(type, handler) { calls.push({ type, handler }); },
      removeListener(type, handler) { calls.push({ type, handler, removed: true }); }
    };
    const input2 = {
      addListener(type, handler) { calls.push({ type, handler, input: 2 }); },
      removeListener(type, handler) { calls.push({ type, handler, removed: true, input: 2 }); }
    };
    const controller = new MidiInputController({}, { getConfig: () => ({ input: { channel: 'omni' } }) });
    controller.attach(input);
    controller.attach(input2);
    controller.detach();
    expect(calls.some(call => call.type === 'midimessage' && !call.removed)).to.equal(true);
    expect(calls.some(call => call.type === 'midimessage' && call.removed)).to.equal(true);
  });

  it('applies config patches through the view when no handler is provided', function() {
    const patches = [];
    const view = { applyMidiOverrides(patch) { patches.push(patch); } };
    const controller = new MidiInputController(view, { getConfig: () => ({ input: { channel: 'omni' } }) });
    controller._applyConfigPatch({ timing: { bpmBase: 140 } });
    expect(patches).to.eql([{ timing: { bpmBase: 140 } }]);
  });

  it('uses the view config getter and adjusts speed with game timer', function() {
    const speeds = [];
    const view = {
      getMidiConfig() { return { input: { channel: 3 } }; },
      selectSpeedFactor(value) { speeds.push(value); },
      game: { getGameTimer() { return { speedFactor: 2 }; } }
    };
    const controller = new MidiInputController(view);
    controller._onMessage({ data: [0x92, 60, 100] });
    controller._changeSpeed(1);
    expect(speeds[speeds.length - 1]).to.equal(3);
  });

  it('handles velocity-zero notes, note capture fallthrough, and note offs', function() {
    const commands = [];
    const view = {
      game: {
        queueCommand(cmd) { commands.push(cmd); },
        gameGui: {}
      }
    };
    const config = { input: { channel: 'omni', notes: { skillBase: 60, skillOrder: ['CLIMBER'] } } };
    const controller = new MidiInputController(view, { getConfig: () => config });
    controller.setNoteCapture(() => false);

    controller._onMessage({ data: [0x90, 60, 0] });
    controller._onMessage({ data: [0x90, 60, 100] });
    controller._onMessage({ data: [0x80, 60, 0] });

    expect(commands.length).to.equal(1);
  });

  it('maps generic CC targets without rounding', function() {
    const patches = [];
    const config = {
      input: {
        channel: 'omni',
        cc: { custom: { cc: 99, min: 0, max: 10, target: 'timing.bpmBase' } }
      }
    };
    const controller = new MidiInputController({}, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
    controller._onMessage({ data: [0xB0, 99, 64] });
    expect(patches[0].timing.bpmBase).to.be.a('number');
  });

  it('ignores realtime clock messages', function() {
    const controller = new MidiInputController({}, { getConfig: () => ({ input: { channel: 'omni' } }) });
    controller._onMessage({ data: [0xF8] });
    expect(controller.channel).to.equal('omni');
  });

  it('refreshes config before ignoring empty messages', function() {
    const view = {};
    const controller = new MidiInputController(view, { getConfig: () => ({ input: { channel: 'omni' } }) });
    let setCalled = false;
    controller.setConfig = () => { setCalled = true; };
    controller._onMessage({ data: [] });
    expect(setCalled).to.equal(true);
  });

  it('avoids redundant config normalization for unchanged config references', function() {
    const config = { input: { channel: 'omni' } };
    const controller = new MidiInputController({}, { getConfig: () => config });
    let setCalls = 0;
    const originalSetConfig = controller.setConfig.bind(controller);
    controller.setConfig = (...args) => {
      setCalls += 1;
      return originalSetConfig(...args);
    };
    controller._onMessage({ data: [0xF8] });
    controller._onMessage({ data: [0xF8] });
    expect(setCalls).to.equal(1);
  });

  it('avoids redundant config normalization for equivalent wrapper objects', function() {
    const sharedCc = { speed: { cc: 1, min: 0.1, max: 2 } };
    const controller = new MidiInputController({}, {
      getConfig: () => ({ input: { channel: 'omni', cc: sharedCc } })
    });
    let setCalls = 0;
    const originalSetConfig = controller.setConfig.bind(controller);
    controller.setConfig = (...args) => {
      setCalls += 1;
      return originalSetConfig(...args);
    };

    controller._onMessage({ data: [0xF8] });
    controller._onMessage({ data: [0xF8] });

    expect(setCalls).to.equal(1);
  });

  it('rebuilds CC mapping index when config CC bindings change', function() {
    const speeds = [];
    const patches = [];
    const config = {
      input: {
        channel: 'omni',
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 }
        }
      }
    };
    const controller = new MidiInputController({
      selectSpeedFactor(value) { speeds.push(value); }
    }, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });

    controller._onMessage({ data: [0xB0, 1, 127] });
    expect(speeds.length).to.equal(1);

    config.input.cc = {
      bpmBase: { cc: 2, min: 100, max: 200 }
    };
    controller._onMessage({ data: [0xB0, 2, 0] });
    expect(patches.some(patch => patch.timing?.bpmBase === 100)).to.equal(true);

    controller._onMessage({ data: [0xB0, 1, 127] });
    expect(speeds.length).to.equal(1);
  });

  it('indexes note actions and rebuilds when note bindings change', function() {
    const calls = { pause: 0, restart: 0 };
    const config = {
      input: {
        channel: 'omni',
        notes: {
          actions: { pause: 40 }
        }
      }
    };
    const controller = new MidiInputController({
      suspend() { calls.pause += 1; },
      moveToLevel() { calls.restart += 1; }
    }, {
      getConfig: () => config
    });

    controller._onMessage({ data: [0x90, 40, 100] });
    expect(calls.pause).to.equal(1);
    expect(controller._noteActions.get(40)).to.equal('pause');

    config.input.notes = {
      actions: { restart: 41 }
    };
    controller._onMessage({ data: [0x90, 41, 100] });
    controller._onMessage({ data: [0x90, 40, 100] });

    expect(calls.restart).to.equal(1);
    expect(calls.pause).to.equal(1);
    expect(controller._noteActions.get(41)).to.equal('restart');
  });

  it('refreshes stale CC cache entries when mappings mutate in place', function() {
    const speeds = [];
    const config = {
      input: {
        channel: 'omni',
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 }
        }
      }
    };
    const controller = new MidiInputController({
      selectSpeedFactor(value) { speeds.push(value); }
    }, {
      getConfig: () => config
    });

    controller._onMessage({ data: [0xB0, 1, 127] });
    expect(speeds.length).to.equal(1);

    config.input.cc.speed.cc = 2;
    controller._onMessage({ data: [0xB0, 1, 127] });
    expect(speeds.length).to.equal(1);

    controller._onMessage({ data: [0xB0, 2, 127] });
    expect(speeds.length).to.equal(2);
  });

  it('resolveCcEntries rebuilds stale cache entries and rescans mappings', function() {
    const config = {
      input: {
        channel: 'omni',
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 },
          accent: { cc: 2, min: 0, max: 1 }
        }
      }
    };
    const controller = new MidiInputController({}, { getConfig: () => config });
    controller.setConfig(config);

    const initial = controller._resolveCcEntries(1, config.input.cc);
    expect(initial).to.have.length(1);
    expect(initial[0].key).to.equal('speed');

    config.input.cc.speed = { cc: 3, min: 0.1, max: 2 };
    const stale = controller._resolveCcEntries(1, config.input.cc);
    expect(stale).to.have.length(0);

    const remapped = controller._resolveCcEntries(3, config.input.cc);
    expect(remapped).to.have.length(1);
    expect(remapped[0].key).to.equal('speed');
  });

  it('defaults missing velocity and CC values to zero', function() {
    const controller = new MidiInputController({}, { getConfig: () => ({ input: { channel: 'omni' } }) });
    const noteCalls = [];
    const ccCalls = [];
    controller._handleNoteOn = (note, velocity) => noteCalls.push({ note, velocity });
    controller._handleControlChange = (cc, value) => ccCalls.push({ cc, value });

    controller._onMessage({ data: [0x90, 60] });
    controller._onMessage({ data: [0xB0, 7] });

    expect(noteCalls[0].velocity).to.equal(0);
    expect(ccCalls[0].value).to.equal(0);
  });

  it('applies accent defaults and rounds mapped values', function() {
    const patches = [];
    const config = {
      input: {
        channel: 'omni',
        cc: {
          accent: { cc: 10 },
          rounded: { cc: 11, target: 'timing.bpmBase', min: 0, max: 10, round: true }
        }
      }
    };
    const controller = new MidiInputController({}, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });

    controller._onMessage({ data: [0xB0, 10, 127] });
    controller._onMessage({ data: [0xB0, 11, 64] });

    expect(patches.some(patch => patch.density?.velocityBoost === 1)).to.equal(true);
    expect(patches.some(patch => Number.isInteger(patch.timing?.bpmBase))).to.equal(true);
  });

  it('handles missing config providers gracefully', function() {
    const controller = new MidiInputController({});
    controller.getConfig = null;
    controller._onMessage({ data: [] });
    expect(controller.channel).to.equal('omni');
  });
});
