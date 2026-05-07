import { expect } from 'chai';
import { MidiInputController } from '../../js/midi/input/MidiInputController.js';
import { withPatchedGlobals } from '../support/globals.js';

const makeConfig = (channel = 'omni') => ({ input: { channel } });

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

  it('applyConfigPatch uses the project config handler', function() {
    const patches = [];
    const view = {};
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

  it('applies config handler patches and handles transport actions', function() {
    const patches = [];
    const view = {
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
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
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
