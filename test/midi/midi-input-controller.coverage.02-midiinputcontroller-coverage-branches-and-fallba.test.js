import { expect } from 'chai';
import { MidiInputController } from '../../js/midi/input/MidiInputController.js';
import { withPatchedGlobals } from '../support/globals.js';

const makeConfig = (channel = 'omni') => ({ input: { channel } });

describe('MidiInputController coverage: branches and fallbacks 2', function() {
  it('covers transport, actions, and control change defaults', function() {
    const calls = { pause: 0, resume: 0, restart: 0, setSpeed: [] };
    const patches = [];
    const view = {
      suspend() { calls.pause += 1; },
      continue() { calls.resume += 1; },
      moveToLevel() { calls.restart += 1; },
      setMidiEnabled(value) { this.midiEnabled = value; },
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
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
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
    const controller = new MidiInputController(view, {
      getConfig: () => config,
      onConfigChange: patch => patches.push(patch)
    });
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
