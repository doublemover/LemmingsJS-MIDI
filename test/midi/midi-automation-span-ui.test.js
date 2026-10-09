import { expect } from 'chai';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { TestDocument } from '../helpers/test-dom.js';
import { createMidiAutomationSpanEditor, createMidiSpan } from '../../js/app/midi-ui/midiAutomationSpanEditor.js';
import { createProcgenMidiSpanControls } from '../../js/app/procgen/ProcgenMidiSpanControls.js';
import { createMidiProjectFromMidiConfig, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { getMidiSpanRectangles, createProcgenMidiSpanOverlay } from '../../js/app/procgen/ProcgenMidiSpanOverlay.js';
const find = (element, test) => test(element) ? element : element.children.map(child => find(child, test)).find(Boolean);
const editorFixture = () => {
  const document = new TestDocument(), updates = []; let state = null;
  const lane = { id: 'one', name: 'Velocity', target: 'velocity', min: 48, max: 110, span: createMidiSpan() };
  const editor = createMidiAutomationSpanEditor({ document, lane, onUpdate: patch => updates.push(patch), getState: () => state });
  const timeline = find(editor, el => el.className === 'midi-span-timeline'), bar = find(editor, el => el.className.startsWith('midi-span-rectangle'));
  timeline.getBoundingClientRect = () => ({ left: 0, width: 160 });
  const pointer = (type, x, target = bar) => timeline.dispatchEvent({ type, clientX: x, target, pointerId: 1, preventDefault() {} });
  return { editor, updates, pointer, bar, timeline, setState: value => { state = value; } };
};
describe('musical span editing and lane rectangles', () => {
  it('explains actual sound and physical trigger conditions while preserving unknown saved IDs', () => {
    const f = editorFixture(), sound = find(f.editor, el => el.dataset.spanField === 'sfxId'), trigger = find(f.editor, el => el.dataset.spanField === 'triggerType');
    expect(sound.tagName).to.equal('SELECT'); expect(trigger.tagName).to.equal('SELECT');
    expect(sound.children.find(option => option.value === String(SoundEffectIds.LAND)).textContent).to.equal('Safe landing');
    expect(trigger.children.find(option => option.value === String(TriggerTypes.EXIT_LEVEL)).textContent).to.equal('Exit trigger');
    sound.value = String(SoundEffectIds.LAND); sound.dispatchEvent({ type: 'change', target: sound });
    expect(f.updates.at(-1).span.condition.sfxId).to.equal(SoundEffectIds.LAND);
    const saved = createMidiAutomationSpanEditor({ document: new TestDocument(), lane: { id: 'legacy', min: 20, max: 40, span: { ...createMidiSpan(), condition: { sfxId: 1234, triggerType: null, unit: 'event', every: 1, phase: 0 } } }, onUpdate() {} });
    const selected = find(saved, el => el.dataset.spanField === 'sfxId');
    expect(selected.value).to.equal('1234'); expect(selected.children.at(-1).textContent).to.include('Unrecognized saved sound event (1234)');
  });
  it('adds a named procgen combination with one saved intent and removes its click handler on disposal', () => {
    const document = new TestDocument();
    for (const [id, tag] of [['procgenSpanList', 'div'], ['procgenSpanDomain', 'select'], ['procgenSpanPreset', 'select'], ['procgenSpanPresetApply', 'button'], ['procgenSpanPresetStatus', 'p']]) document.registerElement(id, document.createElement(tag));
    let project = createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} }); const intents = [];
    const controls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => 8, getRouter: () => null, onIntent: intent => { intents.push(intent); project = reduceMidiProject(project, intent); } });
    const picker = document.getElementById('procgenSpanPreset'), button = document.getElementById('procgenSpanPresetApply');
    button.removeEventListener = (type, handler) => button.listeners.set(type, button.listeners.get(type).filter(listener => listener !== handler));
    expect(picker.children).to.have.length(3); picker.value = 'span-open-air'; document.getElementById('procgenSpanDomain').value = 'distance';
    button.dispatchEvent({ type: 'click', target: button });
    expect(intents).to.have.length(1); expect(intents[0].type).to.equal('automation.bundle.add');
    expect(controls.getSelectedIds()).to.have.length(3);
    expect(controls.getSelectedIds()).to.deep.equal(project.automation.filter(entry => entry.span).map(entry => entry.id));
    expect(project.automation.filter(entry => entry.span).map(entry => entry.target)).to.deep.equal(['note', 'duration', 'release']);
    expect(project.automation.filter(entry => entry.span).every(entry => entry.span.domain === 'distance')).to.equal(true);
    expect(project.enabled).to.equal(false); expect(document.getElementById('procgenSpanPresetStatus').textContent).to.include('scale-safe');
    controls.dispose(); button.dispatchEvent({ type: 'click', target: button }); expect(intents).to.have.length(1);
  });
  it('keeps multiple span editors open, applies one common transaction and retains field focus and names', () => {
    const document = new TestDocument(); document.registerElement('procgenSpanList', document.createElement('div'));
    let project = createMidiProjectFromMidiConfig({ sfx: {}, triggers: {} }); const intents = [];
    let controls;
    controls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => 8, getRouter: () => null,
      onIntent: intent => { intents.push(intent); project = reduceMidiProject(project, intent); controls?.render(); } });
    const first = controls.addSpan(), second = controls.addSpan(); controls.select(first); controls.select(second, { additive: true });
    const list = document.getElementById('procgenSpanList');
    expect(controls.getSelectedIds()).to.deep.equal([first, second]);
    expect(list.children.filter(row => row.className === 'midi-span-row').every(row => find(row, element => element.className === 'midi-span-editor')?.open)).to.equal(true);
    const name = find(list, element => element.dataset.spanId === first), nameInput = find(name, element => element.dataset.spanProperty === 'name');
    nameInput.focus(); nameInput.value = 'First melody'; nameInput.dispatchEvent({ type: 'change', target: nameInput });
    expect(project.automation.find(entry => entry.id === first).name).to.equal('First melody');
    expect(document.activeElement.dataset.spanProperty).to.equal('name');
    const bulk = find(list, element => element.dataset.bulkSpanField === 'duration'); bulk.focus(); bulk.value = '8';
    const before = intents.length; bulk.dispatchEvent({ type: 'change', target: bulk });
    expect(intents.length).to.equal(before + 1); expect(intents.at(-1).type).to.equal('automation.batch.update');
    expect(project.automation.filter(entry => entry.span).map(entry => entry.span.duration)).to.deep.equal([8, 8]);
    expect(document.activeElement.dataset.bulkSpanField).to.equal('duration');
    controls.updateSelected({ enabled: false }); expect(project.automation.filter(entry => entry.span).every(entry => !entry.enabled)).to.equal(true);
    const prior = project;
    expect(reduceMidiProject(project, { type: 'automation.batch.update', updates: [{ automationId: first, patch: { name: 'Partial' } }, { automationId: 'missing', patch: {} }] })).to.deep.equal(prior);
    expect(reduceMidiProject(project, { type: 'automation.batch.update', updates: [null] })).to.deep.equal(prior);
  });
  it('keeps procgen spans editable and durable instead of offering an unsupported spatial conversion', () => {
    const document = new TestDocument(); document.registerElement('procgenSpanList', document.createElement('div'));
    let project = createMidiProjectFromMidiConfig({ sfx: {}, triggers: {} }); const intents = [];
    const controls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => 8, getRouter: () => null,
      onIntent: intent => { intents.push(intent); project = reduceMidiProject(project, intent); controls?.render(); } });
    try {
      const id = controls.addSpan(createMidiSpan(), 'pan'), original = project.automation.find(entry => entry.id === id);
      expect(find(document.getElementById('procgenSpanList'), element => element.textContent === 'Return to spatial curve')).to.equal(undefined);
      const name = find(document.getElementById('procgenSpanList'), element => element.dataset.spanProperty === 'name'); name.value = 'Visible pan'; name.dispatchEvent({ type: 'change', target: name });
      expect(project.automation.find(entry => entry.id === id)).to.deep.equal({ ...original, name: 'Visible pan' });
      expect(intents.some(intent => intent.patch?.span === null)).to.equal(false);
      const main = createMidiAutomationSpanEditor({ document, lane: original, onUpdate() {} });
      expect(find(main, element => element.textContent === 'Return to spatial curve')).not.to.equal(undefined);
    } finally { controls.dispose(); }
  });

  it('freezes a beat draft across rollover without pausing or jumping its interval', () => {
    const document = new TestDocument(), canvas = document.createElement('canvas'); document.registerElement('gameCanvas', canvas);
    canvas.width = 160; canvas.height = 192; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const context = { save() {}, restore() {}, scale() {}, fillRect() {}, strokeRect() {}, setLineDash() {}, fillText() {} };
    const renderer = { canvas, window: { devicePixelRatio: 1 }, world: { laneCount: 2, laneHeight: 96, tickIndex: 132, generation: 1 }, originX: 0, originY: 0, viewWidth: 160, viewHeight: 192,
      render() { this.midiSpanOverlay?.draw(context, this, 1); } };
    const added = [], project = { transport: { bpmBase: 120 }, automation: [] };
    const overlay = createProcgenMidiSpanOverlay({ document, getRuntime: () => ({ lanes: { renderer } }), getProject: () => project, getDomain: () => 'beats', getTarget: () => 'pan', onUpdate() {}, onSelect() {}, onAdd: span => added.push(span) });
    const pointer = (type, x) => canvas.dispatchEvent({ type, clientX: x, clientY: 40, pointerId: 7, preventDefault() {}, stopImmediatePropagation() {} });
    try {
      overlay.sync(); overlay.setEditing(true); pointer('pointerdown', 40);
      renderer.world.tickIndex = 134; pointer('pointermove', 60);
      // Dense looping previews cover the remaining frozen beat window.
      expect(overlay.snapshot().rectangles[0]).to.include({ x: 40, width: 120 });
      pointer('pointerup', 60); expect(added).to.have.length(1); expect(added[0]).to.include({ start: 4, duration: 2, laneStart: 0 });
      expect(renderer.world.tickIndex).to.equal(134);
    } finally { overlay.dispose(); }
  });

  it('keeps original world and lane coordinates through camera follow, zoom and canvas relocation, canceling on generation reset', () => {
    const document = new TestDocument(), canvas = document.createElement('canvas'); document.registerElement('gameCanvas', canvas);
    canvas.width = 160; canvas.height = 192; let box = { left: 10, top: 20 }, captured = null; canvas.getBoundingClientRect = () => box;
    canvas.setPointerCapture = id => { captured = id; }; canvas.hasPointerCapture = id => captured === id; canvas.releasePointerCapture = () => { captured = null; };
    const context = { save() {}, restore() {}, scale() {}, fillRect() {}, strokeRect() {}, setLineDash() {}, fillText() {} };
    const renderer = { canvas, window: { devicePixelRatio: 1 }, world: { laneCount: 4, laneHeight: 96, tickIndex: 0, generation: 1 }, originX: 100, originY: 96, viewWidth: 160, viewHeight: 192,
      render() { this.midiSpanOverlay?.draw(context, this, 1); } };
    const added = [], project = { transport: { bpmBase: 120 }, automation: [] };
    const overlay = createProcgenMidiSpanOverlay({ document, getRuntime: () => ({ lanes: { renderer } }), getProject: () => project, getDomain: () => 'distance', getTarget: () => 'velocity', onUpdate() {}, onSelect() {}, onAdd: span => added.push(span) });
    const pointer = (type, x, y) => canvas.dispatchEvent({ type, clientX: x, clientY: y, pointerId: 7, preventDefault() {}, stopImmediatePropagation() {} });
    try {
      overlay.sync(); overlay.setEditing(true); pointer('pointerdown', 30, 50);
      renderer.originX = 700; renderer.originY = 192; renderer.viewWidth = 80; renderer.viewHeight = 96; renderer.window.devicePixelRatio = 2; canvas.width = 320; canvas.height = 384; box = { left: 100, top: 100 };
      pointer('pointermove', 70, 150); expect(overlay.snapshot().rectangles[0]).to.include({ x: 20, width: 40, y: 0, height: 192 });
      pointer('pointerup', 70, 150); expect(added).to.have.length(1); expect(added[0]).to.include({ start: 120, duration: 40, laneScope: 'group', laneStart: 1, laneEnd: 2 }); expect(captured).to.equal(null);
      pointer('pointerdown', 120, 120); pointer('pointermove', 140, 140); expect(captured).to.equal(7);
      renderer.world.generation++; overlay.sync(); pointer('pointerup', 140, 140); expect(captured).to.equal(null); expect(added).to.have.length(1);
    } finally { overlay.dispose(); }
  });

  it('aligns distance span geometry and drawing with actual144pixel lanes', () => {
    const document = new TestDocument(), canvas = document.createElement('canvas'); document.registerElement('gameCanvas', canvas);
    canvas.width = 720; canvas.height = 432; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const renderer = { canvas, window: { devicePixelRatio: 1 }, world: { laneHeight: 144, laneCount: 4, tickIndex: 0 }, originX: 0, originY: 144, viewWidth: 720, viewHeight: 432, render() {} };
    const span = { ...createMidiSpan('distance'), loop: false, laneScope: 'lane', laneStart: 2, laneEnd: 2 };
    const project = { transport: { bpmBase: 120 }, automation: [{ id: 'height', span, target: 'velocity' }] };
    expect(getMidiSpanRectangles(renderer, project)[0]).to.include({ y: 144, h: 144 });
    const added = [], overlay = createProcgenMidiSpanOverlay({ document, getRuntime: () => ({ lanes: { renderer } }), getProject: () => project, getDomain: () => 'distance', getTarget: () => 'velocity', onUpdate() {}, onSelect() {}, onAdd: value => added.push(value) });
    overlay.sync(); overlay.setEditing(true);
    for (const [type, clientX] of [['pointerdown', 20], ['pointermove', 40], ['pointerup', 40]]) canvas.dispatchEvent({ type, clientX, clientY: 150, preventDefault() {}, stopImmediatePropagation() {} });
    expect(added[0]).to.include({ laneScope: 'lane', laneStart: 2, laneEnd: 2 }); overlay.dispose();
  });

  it('commits one moved interval after a drag and discards canceled resize edits', () => {
    const f = editorFixture(); f.pointer('pointerdown', 20); f.pointer('pointermove', 40); expect(f.updates).to.have.length(0);
    f.pointer('pointerup', 40); expect(f.updates).to.have.length(1); expect(f.updates[0].span).to.include({ start: 2, duration: 4 });
    const handle = find(f.editor, el => el.className === 'midi-span-resize'); f.pointer('pointerdown', 40, handle); f.pointer('pointermove', 70, handle); f.pointer('pointercancel', 70); expect(f.updates).to.have.length(1);
  });
  it('draws a new interval in the strip and accepts blank optional event conditions', () => {
    const f = editorFixture(); f.pointer('pointerdown', 80, f.timeline); f.pointer('pointermove', 120, f.timeline); f.pointer('pointerup', 120, f.timeline);
    expect(f.updates[0].span).to.include({ start: 8, duration: 4 });
    const input = find(f.editor, el => el.dataset.spanField === 'sfxId'); input.value = ''; input.dispatchEvent({ type: 'change', target: input });
    expect(f.updates).to.have.length(2); expect(f.updates[1].span.condition.sfxId).to.equal(null);
  });
  it('updates sampled phase/status without recreating or overwriting an edited input', () => {
    const f = editorFixture(), input = find(f.editor, el => el.dataset.spanField === 'duration'); input.value = '7';
    f.setState({ active: true, phase: 0.5, eventCount: 4, bar: 2, spanPass: 3 }); f.editor.syncStatus();
    expect(input.value).to.equal('7'); expect(find(f.editor, el => el.className === 'midi-span-playhead').style.left).to.equal('50%');
    expect(find(f.editor, el => el.className === 'midi-span-status').textContent).to.include('event 4 · bar 2 · span pass 3');
  });
  it('distinguishes beat-screen and distance-world coordinates while clipping lane groups at DPR two', () => {
    const renderer = { canvas: { width: 2880, height: 1800 }, window: { devicePixelRatio: 2 }, world: { laneCount: 8, tickIndex: 10, generationStartTick: 0 }, originX: 128, originY: 96, viewWidth: 480, viewHeight: 300, scale: 3 };
    const beat = { id: 'beat', target: 'velocity', span: { ...createMidiSpan(), loop: false, laneScope: 'group', laneStart: 2, laneEnd: 4 } }, distance = { id: 'world', target: 'note', span: { ...createMidiSpan('distance'), start: 128, loop: false } };
    const project = { transport: { bpmBase: 120 }, automation: [beat, distance] }, rectangles = getMidiSpanRectangles(renderer, project);
    expect(rectangles).to.have.length(2); expect(rectangles[0]).to.include({ x: 0, y: 288, w: 360, h: 612 }); expect(rectangles[1]).to.include({ x: 0, y: 0, w: 384, h: 900 });
    expect(beat.span.laneEnd).to.equal(4);
  });
  it('commits canvas moves and resizes once, cancels drafts, and releases old-runtime capture', () => {
    const document = new TestDocument(), canvas = document.createElement('canvas'); document.registerElement('gameCanvas', canvas);
    canvas.width = 240; canvas.height = 192; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    let captured = null, releases = 0;
    canvas.setPointerCapture = id => { captured = id; };
    canvas.hasPointerCapture = id => captured === id;
    canvas.releasePointerCapture = () => { captured = null; releases++; };
    const context = { save() {}, restore() {}, scale() {}, fillRect() {}, strokeRect() {}, setLineDash() {}, fillText() {} };
    let project = createMidiProjectFromMidiConfig({ sfx: {}, triggers: {} });
    project = reduceMidiProject(project, { type: 'automation.add', automation: { id: 'canvas-span', name: 'Phrase', target: 'velocity', min: 48, max: 110,
      span: { ...createMidiSpan('distance'), start: 96, duration: 48, loop: false, laneScope: 'lane', laneStart: 0, laneEnd: 0 } } });
    let renderer, overlay; const updates = [];
    const makeRenderer = () => ({ canvas, window: { devicePixelRatio: 1 }, world: { laneCount: 2, tickIndex: 0 }, originX: 64, originY: 0, viewWidth: 240, viewHeight: 192,
      render() { overlay.draw(context, this, 1); } });
    renderer = makeRenderer();
    overlay = createProcgenMidiSpanOverlay({ document, getRuntime: () => ({ lanes: { renderer } }), getProject: () => project, getDomain: () => 'distance', getTarget: () => 'velocity',
      onUpdate: (automationId, patch) => { updates.push(patch); project = reduceMidiProject(project, { type: 'automation.update', automationId, patch }); },
      onSelect: id => overlay.select(id), onAdd() { throw new Error('An existing interval must be edited'); } });
    const pointer = (type, x) => canvas.dispatchEvent({ type, clientX: x, clientY: 40, pointerId: 7, preventDefault() {}, stopImmediatePropagation() {} });
    try {
      overlay.sync(); overlay.setEditing(true);
      expect(overlay.snapshot().rectangles[0]).to.include({ x: 32, width: 48 });
      pointer('pointerdown', 40); pointer('pointermove', 60); expect(updates).to.have.length(0); pointer('pointerup', 60);
      expect(updates[0].span).to.include({ start: 116, duration: 48 }); expect(captured).to.equal(null);
      pointer('pointerdown', 97); pointer('pointermove', 109); pointer('pointerup', 109);
      expect(updates[1].span).to.include({ start: 116, duration: 60 });
      pointer('pointerdown', 109); pointer('pointermove', 129); pointer('pointercancel', 129);
      expect(updates).to.have.length(2); expect(overlay.snapshot().rectangles[0].width).to.equal(60);
      pointer('pointerdown', 60); pointer('pointermove', 80);
      const previous = renderer; renderer = makeRenderer(); overlay.sync(); pointer('pointerup', 80);
      expect(previous.midiSpanOverlay).to.equal(null); expect(renderer.midiSpanOverlay).to.equal(overlay);
      expect(updates).to.have.length(2); expect(captured).to.equal(null); expect(releases).to.equal(4);
      renderer.render(); pointer('pointerdown', 60); pointer('pointermove', 80); overlay.setVisible(false); pointer('pointerup', 80);
      expect(updates).to.have.length(2); expect(captured).to.equal(null);
    } finally { overlay.dispose(); }
  });
  it('represents the whole dense repeat area with one bounded rectangle', () => {
    const renderer = { canvas: { width: 1440, height: 900 }, window: { devicePixelRatio: 1 }, world: { laneCount: 8, tickIndex: 0 }, originX: 0, originY: 0, viewWidth: 480, viewHeight: 300 };
    const entry = { id: 'dense', target: 'velocity', span: { ...createMidiSpan(), duration: 0.25 } };
    const rectangles = getMidiSpanRectangles(renderer, { transport: { bpmBase: 120 }, automation: [entry] });
    expect(rectangles).to.have.length(1); expect(rectangles[0]).to.include({ x: 0, w: 1440, start: 0, end: 16, repeating: true });
  });
  it('creates usable envelope ramps through the actual project sanitation path', () => {
    const document = new TestDocument(); let project = createMidiProjectFromMidiConfig({ sfx: {}, triggers: {} });
    const controls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => 8, getRouter: () => null, onIntent: intent => { project = reduceMidiProject(project, intent); } });
    for (const target of ['attack', 'decay', 'sustain', 'release']) controls.addSpan(createMidiSpan(), target);
    expect(project.automation.filter(entry => entry.span).map(entry => [entry.target, entry.min, entry.max])).to.deep.equal([['attack', 0.5, 1.5], ['decay', 0.5, 1.5], ['sustain', 0.5, 1.5], ['release', 0.5, 1.5]]); controls.dispose();
  });
  it('survives a native change event during removal of a focused editor row', () => {
    const document = new TestDocument(), list = document.createElement('div'); document.registerElement('procgenSpanList', list);
    let project = createMidiProjectFromMidiConfig({ sfx: {}, triggers: {} });
    const controls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => 8, getRouter: () => null, onIntent: intent => { project = reduceMidiProject(project, intent); } });
    controls.addSpan(createMidiSpan(), 'note'); let changed = false; const remove = list.removeChild.bind(list);
    list.removeChild = child => { if (!changed) { changed = true; controls.render(); } if (!list.children.includes(child)) throw new Error('Focused row removed twice'); return remove(child); };
    expect(() => controls.render()).not.to.throw(); expect(list.children.filter(row => project.automation.find(entry => entry.id === row.dataset.spanId)?.span)).to.have.length(1);
    expect(list.children).to.have.length(project.automation.length); controls.dispose();
  });
  it('keeps pointer input available to game/camera controls until drawing is explicitly enabled', () => {
    const document = new TestDocument(), canvas = document.createElement('canvas'); canvas.id = 'gameCanvas'; document.registerElement('gameCanvas', canvas);
    canvas.width = 1440; canvas.height = 900; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const renderer = { canvas, window: { devicePixelRatio: 1 }, world: { laneCount: 8, tickIndex: 0 }, originX: 0, originY: 0, viewWidth: 480, viewHeight: 300, scale: 3, render() {} };
    const added = [], project = { transport: { bpmBase: 120 }, automation: [] };
    const overlay = createProcgenMidiSpanOverlay({ document, getRuntime: () => ({ lanes: { renderer } }), getProject: () => project, getDomain: () => 'distance', getTarget: () => 'velocity', onUpdate() {}, onSelect() {}, onAdd: span => added.push(span) }); overlay.sync();
    let claimed = 0; const pointer = (type, x, y) => canvas.dispatchEvent({ type, clientX: x, clientY: y, preventDefault: () => claimed++, stopImmediatePropagation() {} });
    pointer('pointerdown', 100, 200); pointer('pointermove', 500, 450); pointer('pointerup', 500, 450); expect(claimed).to.equal(0);
    overlay.setEditing(true); pointer('pointerdown', 100, 200); pointer('pointermove', 500, 450); pointer('pointerup', 500, 450);
    expect(added).to.have.length(1); expect(added[0]).to.include({ domain: 'distance', laneScope: 'group', laneStart: 0, laneEnd: 1, start: 33, duration: 133 });
    overlay.setVisible(false); const previousClaims = claimed; pointer('pointerdown', 100, 200); pointer('pointermove', 500, 450); pointer('pointerup', 500, 450);
    expect(claimed).to.equal(previousClaims); expect(overlay.snapshot()).to.include({ editing: false, visible: false }); overlay.dispose();
  });
});
