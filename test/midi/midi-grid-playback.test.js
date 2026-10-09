import { expect } from 'chai';
import { createMidiInstrumentWorkbench } from '../../js/app/midi-ui/midiInstrumentWorkbench.js';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { TestDocument } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { makeOutput } from '../support/midi-output.js';

const projectWithSharedClip = () => {
  let project = createMidiProjectFromMidiConfig({ enabled: true, mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 },
    scale: { name: 'chromatic', root: 0 }, sfx: { 20: { note: 60, channel: 1 }, 21: { note: 64, channel: 1 } } });
  project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'shared', lengthSteps: 8, playback: { advance: 'game-tick', spacingTicks: 2 },
    steps: [{ voices: [{ note: 60, durationTicks: 5 }, { note: 64, durationTicks: 2 }], transformLayers: [{ type: 'repeat', count: 2, spacingTicks: 2, transpose: 7 }] }] } });
  for (const source of project.sources) project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: source.id, clipId: 'shared' });
  return project;
};

describe('actual local grid voice projection', function() {
  it('retargets the same bounded observer by source and clip, preserves focus on rerender, and refuses old release resurrection', function() {
    const project = projectWithSharedClip(), document = new TestDocument(), create = document.createElement.bind(document);
    document.body = create('body'); const animations = [];
    document.createElement = tag => { const node = create(tag); Object.defineProperty(node, 'isConnected', { get: () => document.body.contains(node) });
      node.remove = () => node.parent?.removeChild(node); node.animate = (frames, options) => { const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; }; return node; };
    const row = registerElement(document, 'button', 'event'); row.dataset.gameEventId = '20'; document.body.appendChild(row);
    const grid = registerElement(document, 'div', 'midiEventClipGrid'); document.body.appendChild(grid);
    const cells = () => { while (grid.firstChild) grid.removeChild(grid.firstChild); for (let index = 0; index < 8; index++) { const cell = document.createElement('button'); cell.dataset.cellIndex = String(index); grid.appendChild(cell); } };
    cells(); let source = project.sources[0], reads = 0; row.getBoundingClientRect = () => { reads++; return { width: 200 }; };
    const workbench = createMidiInstrumentWorkbench({ document, window: { performance: { now: () => 1000 } }, getRows: () => [row], getEventRows: () => [row],
      getLemmings: () => null, getProject: () => project, getSource: () => source, history: createMidiEditHistory(), setStatus() {} });
    workbench.setVisible(true);
    const note = { id: 1, owner: 'game', sfxId: 20, sourceId: source.id, sourceKind: source.kind, sourceKey: source.sourceKey, clipId: 'shared',
      phase: 'start', note: 67, velocity: 127, startMs: 1000, releaseMs: 1300, endMs: 1340, durationMs: 300, attackMs: 8, sustain: 1, stepIndex: 0, stepCount: 8 };
    grid.children[0].title = 'Entered C4'; workbench.onPlayback(note); expect(grid.children[0].title).to.equal('Entered C4 | Admitted local voices: G4'); expect(grid.children[0].children.map(node => node.textContent)).to.deep.equal(['G4']);
    source = project.sources[1]; workbench.render(); expect(grid.children[0].title).to.equal('Entered C4'); expect(grid.children.every(cell => !cell.children.length)).to.equal(true); expect(row.children).to.have.length(1);
    source = project.sources[0]; workbench.render(); expect(grid.children[0].children).to.have.length(1);
    cells(); grid.children[0].focus(); const before = reads; workbench.render();
    expect(document.activeElement).to.equal(grid.children[0]); expect(grid.children[0].children[0].textContent).to.equal('G4'); expect(reads).to.equal(before);
    source = { ...source, clipId: 'another' }; workbench.render(); expect(grid.children.every(cell => !cell.children.length)).to.equal(true);
    source = project.sources[0]; workbench.render(); workbench.clearPlayback();
    workbench.onPlayback({ ...note, phase: 'release', releaseMs: 1200, endMs: 1240 }); expect(row.children).to.have.length(0); expect(grid.children[0].children).to.have.length(0);
    for (let index = 0; index < 70; index++) workbench.onPlayback({ ...note, id: index + 2, stepIndex: index % 8 });
    expect(row.children).to.have.length(64); expect(grid.children.reduce((sum, cell) => sum + cell.children.length, 0)).to.equal(64);
    expect(animations.every(animation => animation.options.duration > 0)).to.equal(true); workbench.dispose(); expect(row.children).to.have.length(0);
    expect(grid.children.every(cell => !cell.children.length)).to.equal(true);
  });

  it('keeps project origin metadata runtime-only and sends identical external MIDI calls', function() {
    withFakeClockAndPerformance(clock => {
      const project = projectWithSharedClip(), config = projectToMidiConfig(project), legacy = structuredClone(config), calls = [[], []];
      expect(config.sfx[20]).to.include({ sourceId: 'sfx-20', sourceKind: 'sfx', sourceKey: '20' });
      expect(project.sources.some(source => Object.hasOwn(source.mapping || {}, 'sourceId'))).to.equal(false);
      for (const mapping of Object.values(legacy.sfx)) { delete mapping.sourceId; delete mapping.sourceKind; delete mapping.sourceKey; }
      const routers = [new MidiEventRouter(config), new MidiEventRouter(legacy)], timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; } };
      try {
        routers.forEach((router, index) => { router.setOutput(makeOutput([1], calls[index])); router.attach({ onEvent: new EventHandler(), gameTimer: timer }); router._onEvent({ sfxId: 20, tick: 0, frameMs: 60 }); });
        for (let index = 0; index < 8; index++) { clock.tick(60); timer.tick++; timer.onGameTick.trigger(); }
        expect(calls[0].filter(call => call.type === 'noteOn')).to.have.length(4); expect(calls[0]).to.deep.equal(calls[1]);
        expect(calls[0].filter(call => call.type === 'noteOn').every(call => !Object.hasOwn(call.opts, 'playback'))).to.equal(true);
      } finally { routers.forEach(router => router.dispose()); }
    });
  });
});
