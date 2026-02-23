import { expect } from 'chai';
import { MidiInputController } from '../../js/midi/input/MidiInputController.js';
import { withPatchedGlobals } from '../support/globals.js';

const makeConfig = (channel = 'omni') => ({ input: { channel } });

describe('MidiInputController coverage: branches and fallbacks', function() {
  it('uses view getMidiConfig when no getConfig is provided', function() {
    let calls = 0;
    const config = makeConfig('omni');
    const view = {
      getMidiConfig() {
        calls += 1;
        return config;
      }
    };
    const controller = new MidiInputController(view);
    controller._handleNoteOn = () => {};
    controller._onMessage({ data: [0x90, 60, 100] });
    expect(calls).to.equal(1);
  });

  it('applyConfigPatch is a no-op without handlers', function() {
    const controller = new MidiInputController({});
    expect(() => controller._applyConfigPatch({ timing: { bpmBase: 120 } })).to.not.throw();
  });

  it('changeSpeed falls back to view speed when no timer exists', function() {
    const view = { gameSpeedFactor: 1 };
    const controller = new MidiInputController(view);
    controller._changeSpeed(1);
    expect(view.gameSpeedFactor).to.equal(2);
  });

  it('ignores unmapped notes with empty skill and action tables', function() {
    let queued = false;
    const view = { game: { queueCommand() { queued = true; } } };
    const controller = new MidiInputController(view);
    const config = { input: { notes: { skillBase: 60, skillOrder: [], actions: {} } } };
    controller._handleNoteOn(72, 100, config, 1);
    expect(queued).to.equal(false);
  });

  it('ignores control changes with mismatched cc numbers', function() {
    const patches = [];
    const config = { input: { cc: { speed: { cc: 10, min: 0.1, max: 2 } } } };
    const controller = new MidiInputController({}, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
    controller._handleControlChange(11, 100, config);
    expect(patches).to.have.length(0);
  });

  it('ignores realtime messages that are not transport commands', function() {  
    const controller = new MidiInputController({}, { getConfig: () => makeConfig('omni') });
    let transportCalls = 0;
    controller._handleTransport = () => { transportCalls += 1; };
    controller._onMessage({ data: [0xF8] });
    expect(transportCalls).to.equal(0);
  });

  it('covers constructor fallbacks and speed defaults', function() {
    const patches = [];
    const view = {
      getMidiConfig() { return { input: { channel: null } }; },
      applyMidiOverrides(patch) { patches.push(patch); }
    };
    const controller = new MidiInputController(view, { getConfig: 123 });
    expect(controller.getConfig()).to.eql({ input: { channel: null } });
    const nullView = new MidiInputController(null);
    expect(nullView.getConfig()).to.equal(undefined);
    controller.setConfig({});
    expect(controller.channel).to.equal('omni');
    controller.setConfig({ input: { channel: 99 } });
    expect(controller.channel).to.equal(16);

    controller._applyConfigPatch({ timing: { bpmBase: 110 } });
    expect(patches.length).to.equal(1);

    const target = {};
    controller._setNested(target, 0, 'x');
    controller._setNested(target, 'a.b', 2);
    expect(target.a.b).to.equal(2);

    const selectorView = { selectSpeedFactor(value) { this.last = value; } };
    const controllerSelect = new MidiInputController(selectorView);
    controllerSelect._setSpeedFactor(2);
    expect(selectorView.last).to.equal(2);

    const fallbackView = {};
    const controllerFallback = new MidiInputController(fallbackView);
    let setValue = null;
    controllerFallback._setSpeedFactor = value => { setValue = value; };
    controllerFallback._changeSpeed(1);
    expect(setValue).to.equal(2);
  });

  it('covers action fallthroughs and control change targets', function() {
    const patches = [];
    const calls = { pause: 0, resume: 0, restart: 0, speeds: [] };
    const view = {
      suspend() { calls.pause += 1; },
      continue() { calls.resume += 1; },
      moveToLevel() { calls.restart += 1; },
      selectSpeedFactor(value) { calls.speeds.push(value); },
      gameSpeedFactor: 1,
      game: { queueCommand() {}, gameGui: null }
    };
    const config = {
      input: {
        channel: 'omni',
        transport: { start: 'restart', stop: 'pause', continue: 'resume' },
        notes: {
          skillBase: 60,
          skillOrder: ['NOT_A_SKILL'],
          actions: {
            pause: 10,
            resume: 11,
            restart: 12,
            speedDown: 13,
            speedUp: 14,
            speedReset: 15,
            toggleMidi: 16,
            toggleViewPan: 17
          }
        },
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 },
          bpmBase: { cc: 2, min: 80, max: 120 },
          intensity: { cc: 3, min: 10, max: 20 },
          accent: { cc: 4, min: 0, max: 1 },
          list: { cc: 5, target: 'scale.name', values: ['major', 'minor'], toggle: true },
          floatValue: { cc: 6, target: 'timing.bpmBase', min: 0, max: 10 },
          rounded: { cc: 7, target: 'timing.bpmBase', min: 0, max: 10, round: true },
          emptyValues: { cc: 8, target: 'timing.bpmBase', values: [] }
        }
      },
      position: { viewPan: true }
    };
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });

    controller._handleTransport(0xFA, config);
    controller._handleTransport(0xFC, config);
    controller._handleTransport(0xFB, config);

    controller._handleNoteOn(60, 100, config, 1);
    controller._handleNoteOn(10, 100, config, 1);
    controller._handleNoteOn(11, 100, config, 1);
    controller._handleNoteOn(12, 100, config, 1);
    controller._handleNoteOn(13, 100, config, 1);
    controller._handleNoteOn(14, 100, config, 1);
    controller._handleNoteOn(15, 100, config, 1);
    controller._handleNoteOn(16, 100, config, 1);
    controller.getConfig = null;
    controller._handleNoteOn(17, 100, config, 1);

    controller._handleControlChange(1, 64, config);
    controller._handleControlChange(2, 0, config);
    controller._handleControlChange(3, 127, config);
    controller._handleControlChange(4, 127, config);
    controller._handleControlChange(5, 127, config);
    controller._handleControlChange(6, 64, config);
    controller._handleControlChange(7, 64, config);
    controller._handleControlChange(8, 64, config);
    controller._handleControlChange(9, 64, config);

    expect(calls.pause).to.equal(2);
    expect(calls.resume).to.equal(2);
    expect(calls.restart).to.equal(2);
    expect(calls.speeds.length).to.be.greaterThan(0);
    expect(patches.length).to.be.greaterThan(0);
  });

  it('covers remaining branch paths', function() {
    const patches = [];
    const view = {
      getMidiConfig() { return { input: { channel: null } }; },
      applyMidiOverrides(patch) { patches.push(patch); },
      selectSpeedFactor(value) { this.speed = value; },
      gameSpeedFactor: 1,
      moveToLevel() { this.restarted = true; },
      suspend() { this.paused = true; },
      continue() { this.resumed = true; },
      setMidiEnabled(value) { this.midiEnabled = value; },
      midiEnabled: false,
      game: { queueCommand() { this.queued = true; }, gameGui: {} }
    };
    const config = {
      input: {
        channel: '',
        transport: { start: 'restart', stop: 'pause', continue: 'resume' },
        notes: {
          skillBase: 60,
          skillOrder: ['CLIMBER'],
          actions: {
            pause: 1,
            resume: 2,
            restart: 3,
            speedDown: 4,
            speedUp: 5,
            speedReset: 6,
            toggleMidi: 7,
            toggleViewPan: 8
          }
        },
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 },
          bpmBase: { cc: 2 },
          list: { cc: 3, target: 'scale.name', values: ['major', 'minor'] },
          toggle: { cc: 4, target: 'position.viewPan', toggle: true },
          round: { cc: 5, target: 'timing.bpmBase', min: 0, max: 10, round: true },
          floatValue: { cc: 6, target: 'timing.bpmBase', min: 0, max: 10 },
          emptyValues: { cc: 7, target: 'timing.bpmBase', values: [] }
        }
      },
      position: { viewPan: true }
    };
    const controller = new MidiInputController(view, { getConfig: null });
    controller._onMessage({ data: [0xF8] });
    controller.setConfig(config);
    controller._applyConfigPatch({ timing: { bpmBase: 120 } });

    controller._changeSpeed(1);
    controller.getConfig = () => config;
    controller._onMessage({ data: [0xFA] });
    controller._onMessage({ data: [0xFC] });
    controller._onMessage({ data: [0xFB] });

    controller._handleNoteOn(60, 100, config, 1);
    controller._handleNoteOn(1, 100, config, 1);
    controller._handleNoteOn(2, 100, config, 1);
    controller._handleNoteOn(3, 100, config, 1);
    controller._handleNoteOn(4, 100, config, 1);
    controller._handleNoteOn(5, 100, config, 1);
    controller._handleNoteOn(6, 100, config, 1);
    controller._handleNoteOn(7, 100, config, 1);
    controller._handleNoteOn(8, 100, config, 1);
    controller.getConfig = null;
    controller._handleNoteOn(8, 100, config, 1);

    const missConfig = { input: { channel: 'omni', notes: { skillBase: 60, skillOrder: ['NOPE'] } } };
    const missController = new MidiInputController({ game: { queueCommand() {}, gameGui: null } }, { getConfig: () => missConfig });
    missController._handleNoteOn(60, 100, missConfig, 1);

    controller._handleControlChange(1, 64, config);
    controller._handleControlChange(2, 64, config);
    controller._handleControlChange(3, 127, config);
    controller._handleControlChange(4, 127, config);
    controller._handleControlChange(5, 64, config);
    controller._handleControlChange(6, 64, config);
    controller._handleControlChange(7, 64, config);
    controller._handleControlChange(8, 64, { input: { cc: {} } });
    controller._handleControlChange(99, 64, { input: {} });

    controller.setConfig({ input: { channel: 2 } });
    controller._onMessage({ data: [0x90, 60, 100] });

    expect(view.paused).to.equal(true);
    expect(view.resumed).to.equal(true);
    expect(view.restarted).to.equal(true);
    expect(patches.length).to.be.greaterThan(0);
  });

  it('covers config defaults and channel filtering', function() {
    const view = {
      getMidiConfig() {
        return {
          input: {
            channel: undefined,
            transport: { start: 'restart', stop: 'pause', continue: 'resume' },
            notes: {
              skillBase: 60,
              skillOrder: ['CLIMBER'],
              actions: { resume: 61, toggleMidi: 62, toggleViewPan: 63 }
            }
          },
          position: { viewPan: false }
        };
      },
      applyMidiOverrides() {},
      moveToLevel() { this.restarted = true; },
      suspend() { this.paused = true; },
      continue() { this.resumed = true; },
      setMidiEnabled(value) { this.midiEnabled = value; },
      midiEnabled: true,
      game: { queueCommand() {}, gameGui: {} }
    };
    const controller = new MidiInputController(view);
    controller.setConfig({ input: { channel: '' } });
    controller._setNested({}, null, 1);

    controller._onMessage({ data: [0xFA] });
    controller._onMessage({ data: [0xFC] });
    controller._onMessage({ data: [0xFB] });

    controller.setConfig({ input: { channel: 2 } });
    controller._onMessage({ data: [0x90, 60, 127] });

    const config = view.getMidiConfig();
    controller._handleNoteOn(60, 100, config, 1);
    controller._handleNoteOn(61, 100, config, 1);
    controller._handleNoteOn(62, 100, config, 1);
    controller._handleNoteOn(63, 100, config, 1);

    expect(view.restarted).to.equal(true);
    expect(view.paused).to.equal(true);
    expect(view.resumed).to.equal(true);
    expect(view.midiEnabled).to.equal(false);
  });

  it('covers speed fallbacks and skill selection without queueing', function() {
    const view = { gameSpeedFactor: 1 };
    const controller = new MidiInputController(view);
    controller._changeSpeed(1);
    expect(view.gameSpeedFactor).to.equal(2);

    const bareController = new MidiInputController({});
    bareController._changeSpeed(1);

    const noQueueView = { game: {} };
    const config = { input: { notes: { skillBase: 60, skillOrder: ['CLIMBER'] } } };
    const noQueue = new MidiInputController(noQueueView, { getConfig: () => config });
    noQueue._handleNoteOn(60, 100, config, 1);
  });

  it('forces remaining input controller branches', function() {
    const patches = [];
    const view = {
      getMidiConfig() {
        return {
          input: {
            channel: undefined,
            transport: { start: 'restart', stop: 'pause', continue: 'resume' },
            notes: {
              skillBase: 60,
              skillOrder: ['CLIMBER'],
              actions: { resume: 61, toggleMidi: 62, toggleViewPan: 63 }
            },
            cc: {
              speed: { cc: 1, min: 0.5, max: 2 },
              bpmBase: { cc: 2, min: 60, max: 200 },
              list: { cc: 4, target: 'scale.name', values: ['major', 'minor'] },
              toggle: { cc: 5, target: 'position.viewPan', toggle: true }
            }
          },
          position: { viewPan: false }
        };
      },
      applyMidiOverrides(patch) { patches.push(patch); },
      selectSpeedFactor(value) { this.speed = value; },
      gameSpeedFactor: 1,
      moveToLevel() { this.restarted = true; },
      suspend() { this.paused = true; },
      continue() { this.resumed = true; },
      setMidiEnabled(value) { this.midiEnabled = value; },
      midiEnabled: true,
      game: { queueCommand() { this.queued = true; }, gameGui: {} }
    };
    const controller = new MidiInputController(view);
    controller.getConfig();
    controller.setConfig();
    const nullViewController = new MidiInputController(null);
    nullViewController.getConfig();
    controller.setConfig({ input: { channel: '' } });
    controller._applyConfigPatch({ timing: { bpmBase: 110 } });

    const handlerController = new MidiInputController(view, {
      onConfigChange: patch => patches.push(patch)
    });
    handlerController._applyConfigPatch({ timing: { bpmBase: 120 } });

    controller._setNested({}, null, 1);
    controller._setSpeedFactor(2);
    const fallbackView = { gameSpeedFactor: 1 };
    const fallbackController = new MidiInputController(fallbackView);
    fallbackController._setSpeedFactor(2);

    const speedView = {
      selectSpeedFactor(value) { this.speed = value; },
      game: { getGameTimer() { return { speedFactor: 2 }; } }
    };
    const speedController = new MidiInputController(speedView);
    speedController._changeSpeed(1);

    const config = view.getMidiConfig();
    controller._handleTransport(0xFC, config);
    controller._handleTransport(0xFB, config);

    controller._handleNoteOn(60, 100, config, 1);
    controller._handleNoteOn(61, 100, config, 1);
    controller._handleNoteOn(62, 100, config, 1);
    controller._handleNoteOn(63, 100, config, 1);

    controller._handleControlChange(1, 64, config);
    controller._handleControlChange(2, 64, config);
    controller._handleControlChange(4, 127, config);
    controller._handleControlChange(5, 127, config);
    controller._handleControlChange(3, 64, { input: { cc: { custom: { cc: 3, target: 'timing.bpmBase', min: 0, max: 1 } } } });
    controller._handleControlChange(1, 64, { input: {} });

    controller._onMessage({ data: [0xFA] });
    controller.setConfig({ input: { channel: 2 } });
    controller._onMessage({ data: [0x90, 60, 100] });

    expect(view.paused).to.equal(true);
    expect(view.resumed).to.equal(true);
  });

  it('uses provided getConfig handler and parses channels', function() {
    let viewCalls = 0;
    const view = { getMidiConfig() { viewCalls += 1; return makeConfig('omni'); } };
    let getCalls = 0;
    const controller = new MidiInputController(view, {
      getConfig: () => { getCalls += 1; return { input: { channel: 2 } }; }
    });
    controller.setConfig({ input: { channel: 0 } });
    expect(controller.channel).to.equal(1);
    controller.setConfig({ input: { channel: 'Custom' } });
    expect(controller.channel).to.equal('custom');
    controller._onMessage({ data: [0x90, 60, 100] });
    expect(getCalls).to.equal(1);
    expect(viewCalls).to.equal(0);
  });

  it('covers transport, actions, and control change defaults', function() {
    const calls = { pause: 0, resume: 0, restart: 0, setSpeed: [] };
    const patches = [];
    const view = {
      suspend() { calls.pause += 1; },
      continue() { calls.resume += 1; },
      moveToLevel() { calls.restart += 1; },
      setMidiEnabled(value) { this.midiEnabled = value; },
      applyMidiOverrides(patch) { patches.push(patch); },
      midiEnabled: true,
      gameSpeedFactor: 2,
      game: { queueCommand() { calls.queued = true; }, gameGui: {} }
    };
    const config = {
      input: {
        channel: 'omni',
        transport: { start: 'pause', stop: 'resume', continue: 'restart' },
        notes: {
          skillBase: 60,
          skillOrder: ['CLIMBER'],
          actions: {
            pause: 70,
            resume: 71,
            restart: 72,
            speedDown: 73,
            speedUp: 74,
            speedReset: 75,
            toggleMidi: 76,
            toggleViewPan: 77
          }
        },
        cc: {
          target: { cc: 10, target: 'timing.bpmBase' }
        }
      },
      position: { viewPan: false }
    };
    const controller = new MidiInputController(view, { getConfig: () => config });
    controller._setSpeedFactor = value => calls.setSpeed.push(value);
    controller._handleTransport(0xFA, config);
    controller._handleTransport(0xFC, config);
    controller._handleTransport(0xFB, config);

    controller._handleNoteOn(60, 100, config, 1);
    expect(view.game.gameGui.skillSelectionChanged).to.equal(true);

    controller._handleNoteOn(70, 100, config, 1);
    controller._handleNoteOn(71, 100, config, 1);
    controller._handleNoteOn(72, 100, config, 1);
    controller._handleNoteOn(73, 100, config, 1);
    controller._handleNoteOn(74, 100, config, 1);
    controller._handleNoteOn(75, 100, config, 1);
    controller._handleNoteOn(76, 100, config, 1);
    controller._handleNoteOn(77, 100, config, 1);
    controller._handleNoteOn(77, 0, config, 1);

    controller._handleControlChange(10, 127, config);
    expect(patches.length).to.equal(2);
  });

  it('uses default ranges for speed and intensity controls', function() {
    const patches = [];
    const view = {
      applyMidiOverrides(patch) { patches.push(patch); },
      game: { queueCommand() {}, gameGui: {} },
      gameSpeedFactor: 1
    };
    const config = {
      input: {
        channel: 'omni',
        cc: {
          speed: { cc: 1 },
          intensity: { cc: 7 }
        }
      }
    };
    const controller = new MidiInputController(view, { getConfig: () => config });
    let speed = null;
    controller._setSpeedFactor = value => { speed = value; };

    controller._handleControlChange(1, 64, config);
    controller._handleControlChange(7, 64, config);

    expect(speed).to.be.greaterThan(0.1);
    expect(speed).to.be.lessThan(8.1);
    expect(patches[0].velocityRange.default).to.be.at.least(10);
    expect(patches[0].velocityRange.default).to.be.at.most(127);
  });

  it('covers attach and fallback branches', function() {
    const events = [];
    const input = {
      addListener(name) { events.push(['add', name]); },
      removeListener(name) { events.push(['remove', name]); }
    };
    const view = { game: { queueCommand() {}, gameGui: {} } };
    const controller = new MidiInputController(view);
    controller.attach(input);
    controller.attach(null);
    expect(controller.input).to.equal(null);

    const target = { timing: { bpmBase: 90 } };
    controller._setNested(target, 'timing.bpmBase', 120);
    expect(target.timing.bpmBase).to.equal(120);

    controller._handleTransport(0xFA, { input: {} });
    controller._handleControlChange(1, 64, { input: { cc: { speed: {} } } });
  });
});

describe('MidiInputController coverage: config and mapping', function() {
  it('setConfig handles numeric and string channels', function() {
    const controller = new MidiInputController({});
    controller.setConfig(makeConfig(3));
    expect(controller.channel).to.equal(3);
    controller.setConfig(makeConfig('3'));
    expect(controller.channel).to.equal(3);
    controller.setConfig(makeConfig('OmNi'));
    expect(controller.channel).to.equal('omni');
  });

  it('applyConfigPatch uses handler before view overrides', function() {
    const patches = [];
    const view = { applyMidiOverrides() { patches.push('view'); } };
    const controller = new MidiInputController(view, {
      onConfigChange: patch => patches.push(patch)
    });
    controller._applyConfigPatch({ timing: { bpmBase: 140 } });
    expect(patches.length).to.equal(1);
    expect(patches[0].timing.bpmBase).to.equal(140);
  });

  it('setNested ignores empty paths and creates nested objects', function() {
    const controller = new MidiInputController({});
    const target = {};
    controller._setNested(target, '', 1);
    expect(Object.keys(target)).to.have.length(0);
    controller._setNested(target, 'a.b.c', 2);
    expect(target.a.b.c).to.equal(2);
  });

  it('setSpeedFactor routes to view selector or fallback field', function() {
    const speeds = [];
    const view = { selectSpeedFactor(value) { speeds.push(value); } };
    const controller = new MidiInputController(view);
    controller._setSpeedFactor(2);
    expect(speeds[0]).to.equal(2);

    const viewFallback = { gameSpeedFactor: 1 };
    const controllerFallback = new MidiInputController(viewFallback);
    controllerFallback._setSpeedFactor(3);
    expect(viewFallback.gameSpeedFactor).to.equal(3);
  });

  it('changeSpeed reads from game timer when present', function() {
    const speeds = [];
    const view = {
      selectSpeedFactor(value) { speeds.push(value); },
      game: { getGameTimer() { return { speedFactor: 2 }; } }
    };
    const controller = new MidiInputController(view);
    controller._changeSpeed(0.5);
    expect(speeds[speeds.length - 1]).to.equal(2.5);
  });

  it('handles skill misses and action shortcuts', function() {
    const view = {
      gameSpeedFactor: 2,
      game: { queueCommand() {} }
    };
    const config = {
      input: {
        channel: 'omni',
        notes: {
          skillBase: 60,
          skillOrder: [],
          actions: { speedReset: 60 }
        }
      }
    };
    const controller = new MidiInputController(view, { getConfig: () => config });
    controller._handleNoteOn(60, 100, config, 1);
    expect(view.gameSpeedFactor).to.equal(1);
  });

  it('maps control change entries with value lists and toggles', function() {
    const patches = [];
    const config = {
      input: {
        channel: 'omni',
        cc: {
          scaleName: { cc: 10, target: 'scale.name', values: ['major', 'minor'] },
          viewPan: { cc: 11, target: 'position.viewPan', toggle: true },
          floatValue: { cc: 12, target: 'timing.bpmBase', min: 0, max: 2 }
        }
      }
    };
    const controller = new MidiInputController({}, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });

    controller._handleControlChange(10, 127, config);
    controller._handleControlChange(11, 127, config);
    controller._handleControlChange(12, 64, config);

    expect(patches.some(patch => patch.scale?.name === 'minor')).to.equal(true);
    expect(patches.some(patch => patch.position?.viewPan === true)).to.equal(true);
    expect(patches.some(patch => typeof patch.timing?.bpmBase === 'number')).to.equal(true);
  });

  it('ignores messages on mismatched channels', function() {
    const controller = new MidiInputController({}, { getConfig: () => makeConfig(2) });
    let handled = false;
    controller._handleNoteOn = () => { handled = true; };
    controller._onMessage({ data: [0x90, 60, 100] });
    expect(handled).to.equal(false);
  });

  it('applies view overrides and handles transport actions', function() {
    const patches = [];
    const view = {
      applyMidiOverrides(patch) { patches.push(patch); },
      moveToLevel() { this.moved = true; },
      suspend() { this.paused = true; },
      continue() { this.resumed = true; }
    };
    const config = {
      input: {
        channel: 'omni',
        transport: { start: 'restart', stop: 'pause', continue: 'resume' }
      }
    };
    const controller = new MidiInputController(view, { getConfig: () => config });
    controller._applyConfigPatch({ timing: { bpmBase: 111 } });
    expect(patches[0].timing.bpmBase).to.equal(111);

    controller._onMessage({ data: [0xFA] });
    controller._onMessage({ data: [0xFC] });
    controller._onMessage({ data: [0xFB] });
    expect(view.moved).to.equal(true);
    expect(view.paused).to.equal(true);
    expect(view.resumed).to.equal(true);
  });

  it('handles note capture, skill selection, and action shortcuts', function() {
    let midiEnabled = true;
    const patches = [];
    const view = {
      midiEnabled,
      setMidiEnabled(value) { midiEnabled = value; this.midiEnabled = value; },
      selectSpeedFactor(value) { this.lastSpeed = value; },
      game: { queueCommand() {}, gameGui: {} }
    };
    const config = {
      input: {
        channel: 'omni',
        notes: {
          skillBase: 60,
          skillOrder: ['CLIMBER'],
          actions: {
            pause: 36,
            resume: 37,
            restart: 38,
            speedDown: 39,
            speedUp: 40,
            speedReset: 41,
            toggleMidi: 42,
            toggleViewPan: 43
          }
        }
      },
      position: { viewPan: false }
    };
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
    const captured = [];
    controller.setNoteCapture((note) => {
      captured.push(note);
      return true;
    });
    controller._handleNoteOn(60, 100, config, 1);
    expect(captured).to.eql([60]);

    controller.setNoteCapture(null);
    controller._handleNoteOn(60, 100, config, 1);
    controller._handleNoteOn(36, 100, config, 1);
    controller._handleNoteOn(37, 100, config, 1);
    controller._handleNoteOn(38, 100, config, 1);
    controller._handleNoteOn(39, 100, config, 1);
    controller._handleNoteOn(40, 100, config, 1);
    controller._handleNoteOn(41, 100, config, 1);
    controller._handleNoteOn(42, 100, config, 1);
    controller._handleNoteOn(43, 100, config, 1);
    expect(view.midiEnabled).to.equal(false);
    expect(patches.some(patch => patch.position?.viewPan === true)).to.equal(true);

    const before = view.lastSpeed;
    controller._handleNoteOn(60, 0, config, 1);
    expect(view.lastSpeed).to.equal(before);
  });

  it('maps control change branches and ignores note-off messages', function() {
    const patches = [];
    const view = { selectSpeedFactor(value) { this.speed = value; } };
    const config = {
      input: {
        channel: 1,
        cc: {
          speed: { cc: 1, min: 0.1, max: 2 },
          bpmBase: { cc: 2, min: 60, max: 200 },
          intensity: { cc: 3, min: 10, max: 120 },
          accent: { cc: 4, min: 0, max: 1 },
          rounded: { cc: 5, target: 'noteDefaults.octave', min: 1, max: 8, round: true }
        }
      }
    };
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
    controller._handleControlChange(1, 64, config);
    controller._handleControlChange(2, 127, config);
    controller._handleControlChange(3, 100, config);
    controller._handleControlChange(4, 127, config);
    controller._handleControlChange(5, 127, config);

    expect(view.speed).to.be.greaterThan(0);
    expect(patches.some(patch => patch.timing?.bpmBase)).to.equal(true);
    expect(patches.some(patch => patch.velocityRange?.default)).to.equal(true);
    expect(patches.some(patch => patch.density?.velocityBoost != null)).to.equal(true);

    controller._onMessage({ data: [0x80, 60, 100] });
  });

  it('records last MIDI message when window is defined', function() {
    const controller = new MidiInputController({}, { getConfig: () => makeConfig('omni') });
    withPatchedGlobals({ window: {} }, () => {
      controller._onMessage({ data: [0xB0, 10, 20] });
      expect(globalThis.window.lastMidiInputMessage).to.eql([0xB0, 10, 20]);
    });
  });
});

