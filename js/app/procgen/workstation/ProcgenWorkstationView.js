import { PROCGEN_SOUND_COLLECTIONS, PROCGEN_ROLES, resolveProcgenSound } from './ProcgenSoundCollections.js';
import { createProcgenLaneProjection } from './ProcgenLaneProjection.js';
import { procgenStepNotes } from './ProcgenPatternEngine.js';

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SCALES = { Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Lydian: [0, 2, 4, 6, 7, 9, 11], Pentatonic: [0, 2, 4, 7, 9], Chromatic: Array.from({ length: 12 }, (_, i) => i) };
const COLORS = ['#289fd1', '#6daa43', '#9362c9', '#ac855a', '#ef7440', '#dc639e', '#58aec6', '#99ac37'];
const rendererLeases = new WeakMap();

function createProcgenWorkstationView({ document, window, getProject, getRuntime, dispatch, handlers = {}, state = {} }) {
  for (const [key, value] of Object.entries({ slot: 0, step: 0, tab: 'Lane', tool: 'select', layout: 'strip', firstLane: 0, minimumRow: 64, inspectorWidth: 304, hazardSpacing: 160 })) if (state[key] == null) state[key] = value;
  const listeners = [];
  const on = (element, event, handler, options) => { element.addEventListener(event, handler, options); listeners.push(() => element.removeEventListener(event, handler, options)); };
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, action, title = text) => { const el = node('button', text); el.type = 'button'; el.title = title; el.addEventListener('click', action); return el; };
  const select = (choices, value, changed, label) => {
    const el = node('select'); el.setAttribute('aria-label', label);
    for (const choice of choices) { const [id, text] = Array.isArray(choice) ? choice : [choice, choice]; const option = node('option', text); option.value = id; el.append(option); }
    el.value = String(value); el.addEventListener('change', () => changed(el.value)); return el;
  };
  const input = (value, changed, options = {}) => {
    const el = node('input'); el.type = options.type || 'number';
    for (const key of ['min', 'max', 'step', 'placeholder']) if (options[key] != null) el[key] = String(options[key]);
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value ?? '';
    let committed = el.type === 'checkbox' ? el.checked : el.value;
    el.addEventListener('change', () => {
      const raw = el.type === 'checkbox' ? el.checked : el.value;
      if (raw === committed) return;
      committed = raw;
      changed(el.type === 'checkbox' ? el.checked : el.type === 'text' ? el.value : options.nullable && el.value === '' ? null : Number(el.value));
    }); return el;
  };
  const labeled = (label, control, parent) => { const wrap = node('label', null, 'studio-field'); wrap.append(node('span', label), control); parent.append(wrap); return control; };
  const byId = id => document.getElementById(id);
  const shell = node('main', null, 'procgen-studio'); shell.id = 'procgenStudio';
  const heading = node('div', null, 'studio-brand'); heading.append(node('strong', 'PROCGEN'), node('span', 'Living worlds. Musical stories.'));
  byId('procgenTopbar').prepend(heading);
  const transport = node('div', null, 'studio-transport'); transport.setAttribute('aria-label', 'Musical transport'); byId('procgenTopbar').append(transport);
  const lanes = node('div', null, 'studio-lane-headers'); lanes.setAttribute('aria-label', 'Musical lanes'); lanes.tabIndex = 0;
  const stage = node('div', null, 'studio-stage'); stage.id = 'procgenStudioStage';
  const canvas = byId('gameCanvas'), canvasParent = canvas.parentNode, canvasSibling = canvas.nextSibling; stage.append(canvas);
  const grid = node('div', null, 'studio-sequences'); grid.setAttribute('aria-label', 'Lane sequencers'); stage.append(grid);
  const inspector = node('aside', null, 'studio-inspector'); inspector.setAttribute('aria-label', 'Selected lane inspector');
  const resize = node('div', null, 'studio-resize'); resize.setAttribute('role', 'separator'); resize.setAttribute('aria-label', 'Resize inspector'); resize.tabIndex = 0;
  const tabs = node('div', null, 'studio-inspector-tabs');
  const fields = node('div', null, 'studio-inspector-fields'); fields.id = 'procgenInspectorFields';
  resize.setAttribute('aria-controls', fields.id); resize.setAttribute('aria-valuemin', '250'); resize.setAttribute('aria-valuemax', '480');
  resize.setAttribute('aria-valuenow', String(state.inspectorWidth));
  inspector.append(resize, tabs, fields);
  shell.append(lanes, stage, inspector); byId('procgenTopbar').after(shell);
  const footer = node('footer', null, 'studio-footer'); footer.id = 'procgenStudioFooter'; shell.after(footer);
  const status = node('output', 'Ready', 'studio-status'); status.setAttribute('aria-live', 'polite');
  const storageStatus = node('output', 'Unsaved', 'studio-storage-status'); storageStatus.setAttribute('aria-label', 'Project save status');
  const recoveryStatus = node('output', 'Recovery unsaved', 'studio-recovery-status'); recoveryStatus.setAttribute('aria-label', 'Crash recovery status');
  const legacyNotice = node('div', null, 'studio-legacy-conversion'); legacyNotice.hidden = true;
  footer.append(legacyNotice);
  let projection, dragging = null, lastFrame = 0, lastMidiFrame = 0, stroke = null, suppressClickUntil = 0;
  let attachedRenderer = null, disposed = false, superseded = false, composing = false, pendingInspectorRender = false;
  const owner = {};
  on(fields, 'compositionstart', () => { composing = true; });
  on(fields, 'compositionend', () => {
    composing = false;
    if (pendingInspectorRender) { pendingInspectorRender = false; window.setTimeout?.(() => { if (!disposed) render(); }, 0); }
  });
  const detachRenderer = () => {
    const renderer = attachedRenderer; attachedRenderer = null;
    if (!renderer) return;
    const lease = rendererLeases.get(renderer);
    if (lease?.owner !== owner) return;
    rendererLeases.delete(renderer);
    if (renderer.onWorkstationFrame === frame) renderer.onWorkstationFrame = lease.baseFrame;
    if (renderer.workstationLayout === projection) renderer.workstationLayout = lease.baseLayout;
    renderer.resize();
  };
  on(resize, 'pointerdown', event => { dragging = event.pointerId; resize.setPointerCapture(event.pointerId); });
  const setInspectorWidth = width => { state.inspectorWidth = Math.max(250, Math.min(480, width)); resize.setAttribute('aria-valuenow', String(state.inspectorWidth)); shell.style.setProperty('--inspector-width', state.inspectorWidth + 'px'); layout(); };
  on(resize, 'pointermove', event => { if (dragging != null) setInspectorWidth(window.innerWidth - event.clientX); });
  on(resize, 'pointerup', () => { dragging = null; handlers.preferences?.(); });
  on(resize, 'pointercancel', () => { dragging = null; });
  on(resize, 'keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); setInspectorWidth(state.inspectorWidth + (event.key === 'ArrowLeft' ? 16 : -16)); });
  const layoutMode = select([['strip', 'Strip'], ['overlay', 'Overlay']], state.layout, value => { state.layout = value; render(); handlers.preferences?.(); }, 'Sequencer layout');
  const bpm = input(120, value => handlers.transport?.({ bpm: value, baseBpm: value }), { min: 20, max: 400, step: 1 }); bpm.setAttribute('aria-label', 'BPM');
  const speedMode = select([['bpm', 'BPM'], ['game', 'Game speed']], 'bpm', value => handlers.transport?.({ speedMode: value }), 'Speed mode');
  const linked = input(true, value => handlers.transport?.({ linked: value }), { type: 'checkbox' });
  const root = select(NOTES.map((note, index) => [index, note]), getProject().global.scale.root, value => dispatch({ type: 'procgen/global', patch: { scale: { ...getProject().global.scale, root: Number(value) } } }), 'Global key');
  const scale = select(Object.keys(SCALES), 'Major', value => dispatch({ type: 'procgen/global', patch: { scale: { ...getProject().global.scale, name: value, degrees: SCALES[value] } } }), 'Global scale');
  const clock = select([['internal', 'Internal'], ['external', 'MIDI in']], 'internal', value => handlers.transport?.({ clockSource: value }), 'Clock source');
  const clockStatus = node('output', 'Internal', 'studio-clock-status');
  const displayStatus = node('output', 'Display ready', 'studio-display-status'); displayStatus.setAttribute('aria-live', 'polite');
  const retryDisplay = button('Retry display', () => handlers.retryDisplay?.(), 'Retry canvas display after context loss'); retryDisplay.hidden = true;
  labeled('View', layoutMode, transport); labeled('Speed', speedMode, transport); labeled('BPM', bpm, transport); labeled('Link world', linked, transport);
  labeled('Key', root, transport); labeled('Scale', scale, transport); labeled('Clock', clock, transport); transport.append(clockStatus, displayStatus, retryDisplay);
  const tool = select(['select', 'draw', 'erase'], state.tool, value => { state.tool = value; }, 'Step editing tool');
  const laneRange = node('output', '', 'studio-lane-range'); laneRange.setAttribute('aria-label', 'Visible lane range');
  const moveLanes = delta => { state.firstLane += delta; layout(); renderRows(); handlers.preferences?.(); };
  const previousLanes = button('↑', () => moveLanes(-projection.count), 'Show previous lanes');
  const nextLanes = button('↓', () => moveLanes(projection.count), 'Show next lanes');
  const laneNavigation = node('span', null, 'studio-lane-navigation'); laneNavigation.append(previousLanes, laneRange, nextLanes); footer.append(laneNavigation);
  footer.append(button('+ Lane', () => handlers.addLane?.()), button('− Lane', () => handlers.removeLane?.()), button('Duplicate', () => handlers.duplicate?.()), button('Clear', () => handlers.clear?.()), tool,
    button('Copy', () => handlers.copy?.()), button('Paste', () => handlers.paste?.()), button('Undo', () => handlers.undo?.()), button('Redo', () => handlers.redo?.()));
  const records = button('● Record', () => handlers.record?.(!state.recording), 'Record MIDI input into the selected phrase'); records.id = 'studioRecord';
  const exportDesk = node('details', null, 'studio-export-desk'); exportDesk.setAttribute('aria-label', 'Prepared export');
  const exportSummary = node('summary', 'No prepared file');
  const exportDetails = node('output', 'Choose Export or MIDI to prepare a file.', 'studio-export-details');
  const retryExport = button('Retry file', () => handlers.retryExport?.(), 'Request the same prepared file again'); retryExport.disabled = true;
  const savePrepared = button('Save file', () => handlers.savePreparedExport?.(), 'Stream the prepared file to a selected destination'); savePrepared.disabled = true;
  const cancelDelivery = button('Cancel delivery', () => handlers.cancelExportDelivery?.(), 'Stop the current file write but keep the prepared file'); cancelDelivery.disabled = true;
  const discardPrepared = button('Discard file', () => handlers.discardExport?.(), 'Release the prepared file without changing the project'); discardPrepared.disabled = true;
  exportDesk.append(exportSummary, exportDetails, retryExport, savePrepared, cancelDelivery, discardPrepared);
  footer.append(records, status, storageStatus, recoveryStatus, button('Save', () => handlers.save?.()), button('Save As', () => handlers.saveAs?.()),
    button('Rename', () => handlers.rename?.()), button('Load', () => handlers.load?.()), button('New', () => handlers.new?.()),
    button('Export', () => handlers.export?.()), button('MIDI', () => handlers.exportMidi?.()), exportDesk);
  const importInput = input('', () => {}, { type: 'file' }); importInput.accept = '.json,.procgen'; importInput.hidden = true; footer.append(importInput);
  on(importInput, 'change', () => { if (importInput.files?.[0]) handlers.import?.(importInput.files[0]); importInput.value = ''; });
  footer.append(button('Import', () => importInput.click()));
  const projectList = node('dialog', null, 'studio-dialog'); projectList.setAttribute('aria-label', 'Saved projects'); document.body.append(projectList);
  const showProjectPage = (page, load, fetchPage = null) => {
    const items = node('div', null, 'studio-project-items'), feedback = node('p', '', 'studio-project-feedback');
    const search = node('input'); search.type = 'search'; search.placeholder = 'Search project names'; search.setAttribute('aria-label', 'Search project names');
    const more = button('More projects', async () => {
      if (!page.nextCursor || !fetchPage) return;
      more.disabled = true; feedback.textContent = 'Loading more projects…';
      try { const next = await fetchPage(page.nextCursor, search.value); if (!next) return; page = next; append(next.items); feedback.textContent = next.items.length ? '' :
        next.nextCursor ? 'No matches in this page. Continue the search with More projects.' : 'No matching projects.'; }
      catch (error) { feedback.textContent = error?.message || 'Could not load more projects. Retry.'; }
      finally { more.disabled = !page.nextCursor; more.hidden = !page.nextCursor; }
    });
    const append = entries => {
      for (const entry of entries) items.append(button(`${entry.name} · ${new Date(entry.savedAt).toLocaleString()} · ${String(entry.id).slice(-6)}`, async () => {
        feedback.textContent = 'Opening project…';
        try {
          if (await load(entry.id)) projectList.close();
          else feedback.textContent = 'Project could not be opened. It may have changed or been removed; choose another or retry.';
        } catch (error) { feedback.textContent = error?.message || 'Project could not be opened.'; }
      }));
      if (!items.childElementCount) feedback.textContent = page.nextCursor ? 'No matches in this page. Continue the search with More projects.' :
        'No matching projects. Save here or import a project file.';
    };
    search.addEventListener('change', async () => {
      if (!fetchPage) return;
      feedback.textContent = 'Searching projects…';
      try { const next = await fetchPage(null, search.value); if (!next) return; page = next; items.replaceChildren(); append(next.items); }
      catch (error) { feedback.textContent = error?.message || 'Project search failed. Retry.'; }
      more.disabled = !page.nextCursor; more.hidden = !page.nextCursor;
    });
    projectList.replaceChildren(node('h2', 'Saved projects'), button('Close', () => { handlers.cancelProjectPicker?.(); projectList.close(); }), search, items, feedback, more);
    append(page.items); more.hidden = !page.nextCursor;
    if (handlers.reclaimRecovery) projectList.append(button('Remove recovery checkpoint', () => handlers.reclaimRecovery()));
    projectList.showModal();
  };
  const showProjects = (entries, load) => showProjectPage({ items: entries, nextCursor: null }, load);
  const selected = () => { const project = getProject(), lane = project.procgen.lanes.find(item => item.id === state.laneId) || project.procgen.lanes[0]; state.laneId = lane.id; return lane; };
  const changeLane = patch => dispatch({ type: 'procgen/lane', laneId: selected().id, patch });
  const changePattern = patch => { if (selected().mode === 'pattern') dispatch({ type: 'procgen/pattern', laneId: selected().id, slot: state.slot, patch }); };
  const changeStep = patch => { if (selected().mode === 'pattern') dispatch({ type: 'procgen/step', laneId: selected().id, slot: state.slot, index: state.step, patch }); };
  const changePhysicalInstrument = (id, patch) => {
    const graph = getProject().procgen.physicalGraph;
    try {
      dispatch({ type: 'procgen/physicalGraph', graph: { ...graph, revision: graph.revision + 1,
        instruments: graph.instruments.map(instrument => instrument.id === id ? { ...instrument, ...patch } : instrument) } });
    } catch (error) { handlers.status?.(error.message); renderInspector(); }
  };
  function renderInspector() {
    const lane = selected(); state.slot = Math.max(0, Math.min(3, state.slot));
    const pattern = lane.mode === 'pattern' ? lane.patterns[state.slot] : null;
    state.step = pattern ? Math.max(0, Math.min(state.step, pattern.length - 1)) : 0;
    const step = pattern?.steps[state.step];
    if (!pattern && ['Step', 'Chord'].includes(state.tab)) state.tab = 'Lane';
    tabs.replaceChildren();
    for (const tab of (pattern ? ['Lane', 'Step', 'Chord', 'MIDI', 'World', 'Automation'] : ['Lane', 'Physical', 'MIDI', 'World', 'Automation'])) { const el = button(tab, () => { state.tab = tab; render(); }); el.setAttribute('aria-pressed', String(state.tab === tab)); tabs.append(el); }
    fields.replaceChildren(node('div', `${lane.family.toUpperCase()} / ${lane.role}`, 'studio-eyebrow'), node('h2', state.tab === 'Step' || state.tab === 'Chord' ? `Step ${state.step + 1} · Phrase ${state.slot + 1}` : lane.name));
    if (state.tab === 'Lane') {
      labeled('Name', input(lane.name, name => changeLane({ name }), { type: 'text' }), fields);
      labeled('Collection / tileset', select(PROCGEN_SOUND_COLLECTIONS.map(c => [c.id, c.name]), lane.family, family => dispatch({ type: 'procgen/palette', laneId: lane.id, family }), 'Sound collection'), fields);
      labeled('Role', select(PROCGEN_ROLES, lane.role, role => dispatch({ type: 'procgen/palette', laneId: lane.id, role }), 'Instrument role'), fields);
      const collection = PROCGEN_SOUND_COLLECTIONS.find(c => c.id === lane.family).roles.find(r => r.id === lane.role);
      labeled('Patch', select(collection.patches.map(p => [p.id, p.name]), lane.patch, patch => dispatch({ type: 'procgen/palette', laneId: lane.id, patch }), 'Sound patch'), fields);
      labeled('Mode', select([['physical', 'Physical causes'], ['pattern', 'Complementary pattern']], lane.mode, mode =>
        changeLane(mode === 'pattern' ? { mode, patternPurpose: 'Clocked support for physical events' } :
          { mode, patternPurpose: null, patterns: [] }), 'Lane playback mode'), fields);
      if (pattern) {
        labeled('Physical purpose', input(lane.patternPurpose || '', patternPurpose => changeLane({ patternPurpose }), { type: 'text' }), fields);
        labeled('Pattern length', input(pattern.length, length => changePattern({ length }), { min: 1, max: 64 }), fields);
        labeled('Playback rate', select([0.125, 0.25, 0.5, 1, 2, 4, 8].map(v => [v, v + '×']), pattern.rate, value => changePattern({ rate: Number(value) }), 'Lane playback rate'), fields);
      } else fields.append(node('p', 'This lane follows committed world causes. The Physical tab edits the live instrument mapping.', 'studio-hint'));
      labeled('Level', input(lane.gain, gain => changeLane({ gain }), { type: 'range', min: 0, max: 2, step: 0.01 }), fields);
      labeled('Game accent', input(lane.eventAccent, eventAccent => changeLane({ eventAccent }), { type: 'range', min: 0, max: 2, step: 0.01 }), fields);
      labeled('Pan', input(lane.pan, pan => changeLane({ pan }), { type: 'range', min: -127, max: 127 }), fields);
      const events = node('fieldset', null, 'studio-event-mask'); events.append(node('legend', 'Game events'));
      for (const action of ['build', 'bash', 'mine', 'dig', 'fall', 'land', 'spawn']) labeled(action, input(lane.eventMask?.[action] !== false, enabled => changeLane({ eventMask: { ...lane.eventMask, [action]: enabled } }), { type: 'checkbox' }), events);
      fields.append(events);
      if (pattern) fields.append(button('Reset phrase to this sound', () => handlers.resetPattern?.()));
    } else if (state.tab === 'Physical') {
      fields.append(node('p', 'Physical instruments use committed world facts from all actors. Pitch and velocity belong to the physical engine; no preview note is started here.', 'studio-hint'));
      const take = handlers.causalTakeState?.();
      if (take) {
        const controls = node('fieldset', null, 'studio-physical-take');
        controls.append(node('legend', 'Causal take'));
        state.takeNameDraft ||= 'Untitled take'; state.takeMarkerDraft ||= 'Marker';
        labeled('Take name', input(state.takeNameDraft, takeName => {
          state.takeNameDraft = takeName.slice(0, 120); handlers.preferences?.();
        }, { type: 'text', max: 120 }), controls);
        const toggle = button(take.starting ? 'Cancel arming' : take.recording ? 'Stop causal take' : 'Record causal take', () =>
          take.starting ? handlers.cancelCausalTakeArm?.() : take.recording ? handlers.stopCausalTake?.() :
            handlers.startCausalTake?.({ takeName: state.takeNameDraft }));
        toggle.disabled = take.stopping;
        controls.append(toggle);
        if (take.recording) {
          labeled('Marker', input(state.takeMarkerDraft, label => { state.takeMarkerDraft = label.slice(0, 120); }, { type: 'text' }), controls);
          controls.append(button('Mark latest tick', () => handlers.markCausalTake?.(state.takeMarkerDraft),
            'Annotate the last committed physical tick without creating a musical onset'));
        }
        const receipt = take.active || take.last;
        const summary = receipt ? `${receipt.state} · ${receipt.durableSequence} durable records${receipt.pendingBytes ? ` · ${receipt.pendingBytes} bytes pending` : ''}${receipt.complete === false && receipt.state !== 'recording' ? ' · partial coverage' : ''}` :
          take.starting ? 'Preparing a source checkpoint…' : 'No causal take started.';
        controls.append(node('output', summary, 'studio-physical-take-status'));
        if ((take.selectedTakeId || take.last) && !take.recording) {
          controls.append(button('Inspect take', () => handlers.inspectLastCausalTake?.(), 'Verify the stored causal take and show its durable range'));
          controls.append(button('Prepare take archive', () => handlers.prepareCausalArchive?.(), 'Prepare a verified, replayable causal take file'));
        }
        controls.append(button('Browse saved takes', () => handlers.browseCausalTakes?.('first'), 'List saved causal takes from project storage'));
        if (take.takePage) {
          const page = node('div', null, 'studio-causal-take-page');
          page.append(node('p', `Saved takes · page ${take.takePageNumber}`, 'studio-hint'));
          for (const item of take.takePage.items) {
            const choose = button(`${item.takeName} · ${item.state} · ${item.durableSequence} records`, () => handlers.selectCausalTake?.(item.takeId));
            choose.setAttribute('aria-pressed', String(take.selectedTakeId === item.takeId));
            page.append(choose);
          }
          if (!take.takePage.items.length) page.append(node('p', 'No saved takes on this page.', 'studio-hint'));
          if (take.hasPreviousTakePage) page.append(button('Previous takes', () => handlers.browseCausalTakes?.('previous')));
          if (take.takePage.nextCursor) page.append(button('More takes', () => handlers.browseCausalTakes?.('next')));
          controls.append(page);
        }
        if (take.inspection) controls.append(node('p', `${take.inspection.takeName} · ${take.inspection.status} · ticks ${take.inspection.firstTick ?? 'unknown'}–${take.inspection.lastTick ?? 'unknown'} · ${take.inspection.gaps} coverage gaps · opens paused`, 'studio-hint'));
        fields.append(controls);
      }
      const graph = getProject().procgen.physicalGraph;
      const search = node('input'); search.type = 'search'; search.placeholder = 'Find a physical instrument';
      search.value = state.physicalSearch || ''; search.setAttribute('aria-label', 'Find physical instrument');
      const list = node('div', null, 'studio-physical-list');
      const sourceChoices = [
        ['TerrainWorkCommitted', 'Terrain · committed work'], ['ContactResolved', 'Contact · resolved impact'],
        ['ContactSpanBegan', 'Contact · span began'], ['MotionCommitted', 'Actor · gate crossing'],
        ['ActionEntered', 'Actor · action entered']
      ];
      const sourcePatch = (instrument, sourceKind) => ({ sourceKind, action: sourceKind === 'ActionEntered' ? instrument.action || 'build' : null,
        operationKind: sourceKind === 'TerrainWorkCommitted' ? instrument.operationKind : null,
        causeKind: ['ContactResolved', 'ContactSpanBegan'].includes(sourceKind) ? instrument.causeKind : null,
        gateX: sourceKind === 'MotionCommitted' ? instrument.gateX ?? 40 : null,
        articulation: sourceKind === 'MotionCommitted' ? instrument.articulation : null });
      const renderPhysicalList = () => {
        const needle = (state.physicalSearch || '').trim().toLowerCase();
        const matching = graph.instruments.filter(instrument => `${instrument.id} ${instrument.sourceKind} ${instrument.role}`.toLowerCase().includes(needle));
        const visible = matching.slice(0, 40);
        list.replaceChildren(node('p', `Showing ${visible.length} of ${matching.length} matching instruments${matching.length > visible.length ? ' · refine the search' : ''}.`, 'studio-hint'));
        for (const instrument of visible) {
          const group = node('fieldset', null, 'studio-physical-instrument');
          group.append(node('legend', instrument.id));
          labeled('Source · all actors', select(sourceChoices, instrument.sourceKind,
            sourceKind => changePhysicalInstrument(instrument.id, sourcePatch(instrument, sourceKind)), 'Physical source'), group);
          if (instrument.sourceKind === 'TerrainWorkCommitted') labeled('Work kind', input(instrument.operationKind || '',
            operationKind => changePhysicalInstrument(instrument.id, { operationKind: operationKind.trim() || null }),
            { type: 'text' }), group);
          if (['ContactResolved', 'ContactSpanBegan'].includes(instrument.sourceKind)) labeled('Contact cause', input(instrument.causeKind || '',
            causeKind => changePhysicalInstrument(instrument.id, { causeKind: causeKind.trim() || null }), { type: 'text' }), group);
          if (instrument.sourceKind === 'ActionEntered') labeled('Action kind', input(instrument.action || 'build',
            action => changePhysicalInstrument(instrument.id, { action: action.trim() || 'build' }), { type: 'text' }), group);
          if (instrument.sourceKind === 'MotionCommitted') {
            labeled('Crossing x / world px', input(instrument.gateX, gateX => changePhysicalInstrument(instrument.id, { gateX }),
              { min: -1000000000, max: 1000000000, step: 1 }), group);
            labeled('Crossing direction', select(['either', 'positive', 'negative'], instrument.crossingDirection,
              crossingDirection => changePhysicalInstrument(instrument.id, { crossingDirection }), 'Crossing direction'), group);
          }
          labeled('Enabled', input(!instrument.mute, enabled => changePhysicalInstrument(instrument.id, { mute: !enabled }), { type: 'checkbox' }), group);
          labeled('Solo', input(instrument.solo, solo => changePhysicalInstrument(instrument.id, { solo }), { type: 'checkbox' }), group);
          labeled('Chance / %', input(Math.round(instrument.probability01 * 100), chance => changePhysicalInstrument(instrument.id,
            { probability01: chance / 100 }), { min: 0, max: 100, step: 1 }), group);
          labeled('Pitch / cents', input(instrument.pitchCents, pitchCents => changePhysicalInstrument(instrument.id, { pitchCents }),
            { min: -24000, max: 24000, step: 0.01 }), group);
          labeled('Velocity / %', input(Math.round(instrument.velocity01 * 100), velocity => changePhysicalInstrument(instrument.id,
            { velocity01: velocity / 100 }), { min: 0, max: 100, step: 1 }), group);
          list.append(group);
        }
      };
      search.addEventListener('input', () => { state.physicalSearch = search.value; renderPhysicalList(); });
      fields.append(search, list); renderPhysicalList();
    } else if (state.tab === 'Step' || state.tab === 'Chord') {
      labeled('Trigger', input(step.enabled, enabled => changeStep({ enabled }), { type: 'checkbox' }), fields);
      labeled('Scale degree', input(step.degree, degree => changeStep({ degree }), { min: -56, max: 56 }), fields);
      labeled('Fixed MIDI note', input(step.note ?? '', note => changeStep({ note }), { min: 0, max: 127, nullable: true }), fields);
      labeled('Velocity', input(step.velocity, velocity => changeStep({ velocity }), { min: 1, max: 127 }), fields);
      labeled('Duration / beats', input(step.duration, duration => changeStep({ duration }), { min: 0.01, max: 32, step: 0.0625 }), fields);
      labeled('Probability %', input(Math.round(step.probability * 100), value => changeStep({ probability: value / 100 }), { min: 0, max: 100 }), fields);
      labeled('Chance counter', select(['event', 'pass', 'bar'], step.probabilityBasis, probabilityBasis => changeStep({ probabilityBasis }), 'Probability counter'), fields);
      labeled('Condition', select(['none', 'event', 'pass', 'bar', 'terrain', 'action'], step.condition?.kind || 'none', kind => changeStep({ condition: kind === 'none' ? null : { kind, value: kind === 'terrain' ? 'ground' : kind === 'action' ? 'walk' : '', every: 2, offset: 0 } }), 'Step condition'), fields);
      if (step.condition) {
        if (['terrain', 'action'].includes(step.condition.kind)) {
          const choices = step.condition.kind === 'terrain' ? ['ground', 'gap', 'wall', 'steel', 'hazard'] : ['walk', 'build', 'bash', 'mine', 'dig', 'fall', 'jump', 'climb', 'float', 'block', 'idle'];
          if (step.condition.value && !choices.includes(step.condition.value)) choices.push(step.condition.value);
          labeled('Match', select(choices, step.condition.value, value => changeStep({ condition: { ...step.condition, value } }), 'Observed condition match'), fields);
        }
        else { labeled('Every', input(step.condition.every, every => changeStep({ condition: { ...step.condition, every } }), { min: 1, max: 64 }), fields); labeled('Offset', input(step.condition.offset, offset => changeStep({ condition: { ...step.condition, offset } }), { min: 0, max: 63 }), fields); }
      }
      labeled('Repeats', input(step.repeats, repeats => changeStep({ repeats }), { min: 1, max: 8 }), fields);
      for (const key of ['tie', 'hold']) labeled(key, input(step[key], value => changeStep({ [key]: value }), { type: 'checkbox' }), fields);
      labeled('Chord', input(!!step.chord, value => changeStep({ chord: value ? { degrees: [0, 2, 4], inversion: 0, spread: 0 } : null }), { type: 'checkbox' }), fields);
      if (step.chord) {
        labeled('Chord degrees', input(step.chord.degrees.join(', '), value => changeStep({ chord: { ...step.chord, degrees: value.split(',').map(Number).filter(Number.isFinite) } }), { type: 'text' }), fields);
        labeled('Inversion', input(step.chord.inversion, inversion => changeStep({ chord: { ...step.chord, inversion } }), { min: -7, max: 7 }), fields);
        labeled('Spread / octaves', input(step.chord.spread, spread => changeStep({ chord: { ...step.chord, spread } }), { min: 0, max: 3 }), fields);
        const pitches = procgenStepNotes(step, resolveProcgenSound(lane.family, lane.role, lane.patch), getProject().global.scale).map(note => note % 12);
        const keys = node('div', null, 'studio-keyboard'); for (let i = 0; i < 12; i++) { const key = node('i', NOTES[i]); key.className = [1, 3, 6, 8, 10].includes(i) ? 'black' : ''; if (pitches.includes(i)) key.classList.add('lit'); keys.append(key); } fields.append(keys);
      }
    } else if (state.tab === 'MIDI') {
      const ports = handlers.devices?.() || { inputs: [], outputs: [] };
      labeled('Input', select([['', 'None'], ...ports.inputs.map(p => [p.id, p.name || p.id])], state.inputId || '', id => handlers.input?.(id), 'MIDI input'), fields);
      labeled('Lane output', select([['', 'Default output'], ...ports.outputs.map(p => [p.id, p.name || p.id])], lane.outputId || '', outputId => changeLane({ outputId: outputId || null }), 'Lane MIDI output'), fields);
      labeled('Channel', input(lane.channel, channel => changeLane({ channel }), { min: 1, max: 16 }), fields);
      labeled('Clock output', select([['', 'Off'], ...ports.outputs.map(p => [p.id, p.name || p.id])], state.clockOutputId || '', id => handlers.clockOutput?.(id), 'MIDI clock output'), fields);
      labeled('MIDI Thru', input(state.thru, value => handlers.thru?.(value), { type: 'checkbox' }), fields);
      for (const [key, title] of [['bankMSB', 'Bank MSB'], ['bankLSB', 'Bank LSB']]) labeled(title, input(lane[key] ?? '', value => changeLane({ [key]: value }), { min: 0, max: 127, nullable: true }), fields);
      fields.append(button('Connect MIDI', () => handlers.connect?.()),
        ...(pattern ? [button('Learn step note', () => handlers.learn?.())] : []),
        node('p', 'Clock and note routing are independent. Incoming clock is never echoed.', 'studio-hint'));
      for (const [type, title, low, high] of [['sustain', 'Sustain', 0, 127], ['bend', 'Pitch bend', -8192, 8191], ['pressure', 'Pressure', 0, 127]]) labeled(title, input(0, value => handlers.expression?.({ type, value, channel: lane.channel, outputId: lane.outputId }), { type: 'range', min: low, max: high }), fields);
      fields.append(node('output', state.lastMidi || 'No input received', 'studio-midi-monitor'));
      fields.append(node('p', pattern ? (state.inputId ? `Input ready · recording targets ${lane.name}, phrase ${state.slot + 1}.` :
        'Connect and select a MIDI input to record notes or learn a step.') :
        'Physical instruments use committed world facts. MIDI input remains available for transport and capture.', 'studio-hint'));
    } else if (state.tab === 'World') {
      fields.append(button('Reroll world', () => handlers.reroll?.()), button('Replay seed', () => handlers.replay?.()));
      labeled('Seed', input(getRuntime()?.world?.seed || 0, seed => handlers.seed?.(seed), { min: 0, max: 4294967295 }), fields);
      labeled('Trap spacing / pixels', input(state.hazardSpacing, value => { state.hazardSpacing = value; handlers.rebuild?.(); }, { min: 80, max: 1024, step: 16 }), fields);
      labeled('Minimum display row', input(state.minimumRow, value => { state.minimumRow = value; layout(); renderRows(); }, { min: 56, max: 220, step: 4 }), fields);
      const observe = patch => { Object.assign(state, { observerMode: patch.mode ?? state.observerMode, observerLane: patch.laneId ?? state.observerLane, observerHold: patch.holdSeconds ?? state.observerHold }); handlers.observe?.(patch); handlers.preferences?.(); };
      labeled('Observer', select([['overview', 'Overview'], ['follow', 'Follow lane'], ['director', 'Automatic director']], state.observerMode || 'overview', mode => observe({ mode }), 'Observer mode'), fields);
      labeled('Follow lane', select(getProject().procgen.lanes.map(item => [item.id, item.name]), state.observerLane || lane.id, laneId => observe({ laneId }), 'Observer lane'), fields);
      labeled('Director hold / seconds', input(state.observerHold || 8, holdSeconds => observe({ holdSeconds }), { min: 2, max: 60 }), fields);
      fields.append(node('p', 'Scenery grows ahead through a dithered reveal. The world is shared; each lane keeps its own visual and musical character.', 'studio-hint'), button('Advanced world controls', () => byId('procgenTab')?.click()));
    } else {
      fields.append(node('p', 'Controller curves repeat with musical beats or the observed lane frontier. Points are position:value pairs.', 'studio-hint'));
      const curves = lane.ccAutomation || [];
      const update = (id, patch) => changeLane({ ccAutomation: curves.map(curve => curve.id === id ? { ...curve, ...patch } : curve) });
      for (const curve of curves) {
        const group = node('fieldset', null, 'studio-automation-curve'); group.append(node('legend', `CC ${curve.controller}`));
        labeled('Enabled', input(curve.enabled, enabled => update(curve.id, { enabled }), { type: 'checkbox' }), group);
        labeled('Controller', input(curve.controller, controller => update(curve.id, { controller }), { min: 0, max: 127 }), group);
        labeled('Position', select([['beat', 'Beats'], ['distance', 'World pixels']], curve.axis, axis => update(curve.id, { axis }), 'Automation position'), group);
        labeled('Loop length', input(curve.length, length => update(curve.id, { length }), { min: 0.25, max: 65536, step: 0.25 }), group);
        labeled('Curve', select(['linear', 'step'], curve.mode, mode => update(curve.id, { mode }), 'Automation curve'), group);
        labeled('Points', input(curve.points.map(point => `${point.beat}:${point.value}`).join(', '), value => {
          const points = value.split(',').map(pair => pair.trim().split(':').map(Number));
          if (points.some(pair => pair.length !== 2 || pair.some(number => !Number.isFinite(number)))) { status.textContent = 'Use points such as 0:32, 2:110, 4:32.'; return; }
          update(curve.id, { points: points.map(([beat, value]) => ({ beat, value })) });
        }, { type: 'text', placeholder: '0:32, 2:110, 4:32' }), group);
        group.append(button('Remove curve', () => changeLane({ ccAutomation: curves.filter(item => item.id !== curve.id) }))); fields.append(group);
      }
      if (curves.length < 16) fields.append(button('Add CC curve', () => { let index = 1; while (curves.some(curve => curve.id === `cc-${index}`)) index++; changeLane({ ccAutomation: [...curves, { id: `cc-${index}`, controller: 74, length: 4, points: [{ beat: 0, value: 32 }, { beat: 2, value: 100 }, { beat: 4, value: 32 }] }] }); }));
      const automation = byId('procgenSpanControls') || byId('procgenSpanFields');
      if (automation) fields.append(button('Open automation editor', () => { byId('procgenTab')?.click(); automation.scrollIntoView?.({ block: 'center' }); }));
      fields.append(button('Record MIDI CC', () => { handlers.record?.(true); handlers.status?.('MIDI recording armed. CC events are captured with the performance.'); }));
    }
  }
  function layout() {
    if (disposed) return;
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    projection = createProcgenLaneProjection({ laneCount: getProject().procgen.lanes.length, height, firstLane: state.firstLane, mode: state.layout, physicalHeight: getRuntime()?.world?.laneHeight || 144, minimumRow: state.minimumRow });
    state.firstLane = projection.firstLane;
    shell.dataset.layout = state.layout; shell.style.setProperty('--row-height', projection.rowHeight + 'px'); shell.style.setProperty('--inspector-width', state.inspectorWidth + 'px');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) { canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); }
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    const renderer = getRuntime()?.lanes?.renderer;
    if (renderer !== attachedRenderer) detachRenderer();
    if (renderer && !superseded) {
      if (!attachedRenderer) {
        const previous = rendererLeases.get(renderer);
        previous?.relinquish();
        rendererLeases.set(renderer, { owner, baseLayout: previous ? previous.baseLayout : renderer.workstationLayout,
          baseFrame: previous ? previous.baseFrame : renderer.onWorkstationFrame, relinquish: () => { attachedRenderer = null; superseded = true; } });
        attachedRenderer = renderer;
      }
      renderer.workstationLayout = projection; renderer.onWorkstationFrame = frame; renderer.resize();
    }
  }
  function renderRows() {
    if (!projection) return;
    lanes.replaceChildren(); grid.replaceChildren(); const project = getProject();
    laneRange.textContent = `${projection.firstLane + 1}–${projection.firstLane + projection.count} of ${project.procgen.lanes.length}`;
    previousLanes.disabled = projection.firstLane === 0; nextLanes.disabled = projection.firstLane + projection.count >= project.procgen.lanes.length;
    for (let row = 0; row < projection.count; row++) {
      const laneIndex = projection.firstLane + row, lane = project.procgen.lanes[laneIndex], displaySlot = state.laneId === lane.id ? state.slot : lane.activeSlot, pattern = lane.mode === 'pattern' ? lane.patterns[displaySlot] : null;
      const header = node('section', null, 'studio-lane-header'); header.dataset.laneId = lane.id; header.style.setProperty('--lane-color', COLORS[laneIndex % 8]); header.classList.toggle('selected', state.laneId === lane.id);
      const label = button(`${laneIndex + 1}  ${lane.family.toUpperCase()}`, () => { state.laneId = lane.id; state.slot = lane.activeSlot; state.tab = 'Lane'; render(); }); label.className = 'studio-lane-title';
      const role = node('span', lane.role, 'studio-role');
      const controls = node('div', null, 'studio-lane-mini');
      for (const [key, text] of [['solo', 'S'], ['mute', 'M']]) { const el = button(text, () => dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { [key]: !lane[key] } }), `${key} ${lane.name}`); el.setAttribute('aria-pressed', String(lane[key])); controls.append(el); }
      const slots = node('div', null, 'studio-slots');
      if (pattern) for (let slot = 0; slot < 4; slot++) { const el = button(String(slot + 1), () => { state.laneId = lane.id; state.slot = slot; dispatch({ type: 'procgen/launch', laneId: lane.id, slot }); }, `Launch phrase ${slot + 1} on next bar`); el.setAttribute('aria-pressed', String(lane.activeSlot === slot)); el.classList.toggle('queued', lane.queuedSlot === slot); slots.append(el); }
      else slots.append(node('span', 'LIVE', 'studio-physical-badge'));
      header.append(label, role, controls, slots); lanes.append(header);
      const sequence = node('div', null, 'studio-sequence'); sequence.dataset.laneId = lane.id; sequence.dataset.slot = displaySlot; sequence.style.setProperty('--lane-color', COLORS[laneIndex % 8]); sequence.style.gridTemplateColumns = `repeat(${pattern?.length || 1}, minmax(0, 1fr))`;
      sequence.style.top = (row * projection.rowHeight + projection.rowHeight - (state.layout === 'strip' ? 25 : Math.min(44, projection.rowHeight * 0.48))) + 'px';
      sequence.style.height = (state.layout === 'strip' ? 25 : Math.min(44, projection.rowHeight * 0.48)) + 'px';
      if (!pattern) {
        sequence.classList.add('studio-physical-row');
        sequence.style.gridTemplateColumns = '1fr';
        sequence.append(node('span', 'Physical causes · live world', 'studio-physical-label'));
        grid.append(sequence);
        continue;
      }
      for (let index = 0; index < pattern.length; index++) {
        const step = pattern.steps[index], cell = button(step.tie ? '―' : step.enabled ? step.chord ? '◆' : '●' : '·', () => {
          if (window.performance.now() < suppressClickUntil) return;
          state.laneId = lane.id; state.step = index; state.slot = displaySlot; state.tab = step.chord ? 'Chord' : 'Step';
          if (state.tool !== 'select') dispatch({ type: 'procgen/step', laneId: lane.id, slot: state.slot, index, patch: { enabled: state.tool === 'draw' } }); else render();
        }, `${lane.role}, step ${index + 1}, ${step.enabled ? 'on' : 'off'}, probability ${Math.round(step.probability * 100)}%`);
        cell.className = 'studio-cell'; cell.dataset.index = index; cell.classList.toggle('enabled', step.enabled); cell.classList.toggle('conditional', !!step.condition || step.probability < 1); cell.classList.toggle('selected', state.laneId === lane.id && state.step === index); cell.setAttribute('aria-pressed', String(step.enabled));
        cell.addEventListener('dblclick', () => {
          if (state.tool !== 'select') return;
          const current = getProject().procgen.lanes.find(item => item.id === lane.id)?.patterns[displaySlot]?.steps[index];
          if (current) dispatch({ type: 'procgen/step', laneId: lane.id, slot: displaySlot, index, patch: { enabled: !current.enabled } });
        });
        sequence.append(cell);
      }
      grid.append(sequence);
    }
  }
  function frame(beat = state.beat || 0) {
    if (disposed || superseded) return;
    const now = window.performance.now(); if (now - lastFrame < 32) return; lastFrame = now;
    for (const row of grid.children) {
      const lane = getProject().procgen.lanes.find(l => l.id === row.dataset.laneId); if (!lane) continue;
      const playhead = handlers.playhead?.(lane.id), slot = playhead?.slot ?? lane.activeSlot;
      if (String(slot) !== row.dataset.slot) { row.querySelector('.playing')?.classList.remove('playing'); delete row.dataset.playing; continue; }
      const pattern = lane.patterns?.[slot]; if (!pattern) continue;
      const index = Math.floor(Math.max(0, beat - (playhead?.origin || 0)) * 4 * pattern.rate) % pattern.length;
      if (row.dataset.playing === String(index)) continue;
      row.querySelector('.playing')?.classList.remove('playing'); row.children[index]?.classList.add('playing'); row.dataset.playing = String(index);
    }
  }
  function render({ partial = false } = {}) {
    if (disposed) return;
    const active = document.activeElement;
    const pathFrom = scope => {
      const path = []; let node = active;
      while (node && node !== scope) { const parent = node.parentElement; if (!parent) return null; path.unshift([...parent.children].indexOf(node)); node = parent; }
      return node === scope ? path : null;
    };
    const fieldPath = fields.contains(active) ? pathFrom(fields) : null;
    const header = active?.closest?.('.studio-lane-header'), row = active?.closest?.('.studio-sequence');
    const focus = fieldPath ? { scope: fields, path: fieldPath, laneId: state.laneId, slot: state.slot, tab: state.tab } :
      header ? { scope: 'lane', laneId: header.dataset.laneId, path: pathFrom(header) } :
        row ? { scope: 'row', laneId: row.dataset.laneId, slot: row.dataset.slot, path: pathFrom(row) } :
          tabs.contains(active) ? { scope: tabs, path: pathFrom(tabs) } : null;
    if (focus && active?.tagName === 'INPUT' && ['text', 'number', 'search'].includes(active.type)) {
      focus.value = active.value;
      try { focus.selectionStart = active.selectionStart; focus.selectionEnd = active.selectionEnd; } catch { /* Number inputs have no caret. */ }
    }
    selected(); root.value = String(getProject().global.scale.root);
    const current = getProject().global.scale;
    const matched = Object.keys(SCALES).find(name => JSON.stringify(SCALES[name]) === JSON.stringify(current.degrees));
    if (!matched && ![...scale.options].some(option => option.value === current.name)) { const option = node('option', current.name); option.value = current.name; scale.append(option); }
    scale.value = matched || current.name;
    if (!partial) { layout(); renderRows(); }
    if (composing && fieldPath) pendingInspectorRender = true;
    else renderInspector();
    records.setAttribute('aria-pressed', String(!!state.recording));
    if (focus && !composing) {
      const fieldFocus = focus.scope === fields;
      if (fieldFocus && (focus.laneId !== state.laneId || focus.slot !== state.slot || focus.tab !== state.tab)) { focus.scope = tabs; focus.path = null; }
      let scope = focus.scope;
      if (scope === 'lane') scope = [...lanes.children].find(item => item.dataset.laneId === focus.laneId);
      if (scope === 'row') scope = [...grid.children].find(item => item.dataset.laneId === focus.laneId && item.dataset.slot === focus.slot);
      const target = focus.path?.reduce((node, index) => node?.children?.[index], scope);
      if (target?.tagName === active?.tagName && (focus.value == null || target.type === active.type)) {
        if (focus.value != null) target.value = focus.value;
        target.focus?.({ preventScroll: true });
        if (focus.selectionStart != null) try { target.setSelectionRange?.(focus.selectionStart, focus.selectionEnd); } catch { /* Number inputs have no caret. */ }
      } else if (fieldFocus) tabs.querySelector?.('button[aria-pressed="true"]')?.focus?.({ preventScroll: true });
    }
  }
  function patchStep(action) {
    if (disposed) return;
    const lane = getProject().procgen.lanes.find(item => item.id === action.laneId);
    const slot = action.slot ?? lane?.activeSlot;
    const row = [...grid.children].find(item => item.dataset.laneId === action.laneId && Number(item.dataset.slot) === slot);
    const step = lane?.patterns[slot]?.steps[action.index], cell = row?.children[action.index];
    if (step && cell) {
      cell.textContent = step.tie ? '―' : step.enabled ? step.chord ? '◆' : '●' : '·';
      cell.title = `${lane.role}, step ${action.index + 1}, ${step.enabled ? 'on' : 'off'}, probability ${Math.round(step.probability * 100)}%`;
      cell.classList.toggle('enabled', step.enabled);
      cell.classList.toggle('conditional', !!step.condition || step.probability < 1);
      cell.setAttribute('aria-pressed', String(step.enabled));
    }
    for (const selectedCell of grid.querySelectorAll('.studio-cell.selected')) selectedCell.classList.remove('selected');
    if (state.laneId === action.laneId && state.slot === slot) row?.children[state.step]?.classList.add('selected');
    render({ partial: true });
  }
  on(lanes, 'wheel', event => { if (getProject().procgen.lanes.length <= projection.count) return; event.preventDefault(); state.firstLane += Math.sign(event.deltaY); layout(); renderRows(); }, { passive: false });
  on(lanes, 'keydown', event => {
    const offsets = { PageUp: -projection.count, PageDown: projection.count, ArrowUp: -1, ArrowDown: 1 };
    if (!(event.key in offsets)) return;
    event.preventDefault(); event.stopPropagation(); moveLanes(offsets[event.key]);
  });
  const paint = cell => {
    const row = cell?.closest?.('.studio-sequence');
    if (!stroke || !row || row.dataset.laneId !== stroke.laneId || Number(row.dataset.slot) !== stroke.slot) return;
    const index = Number(cell.dataset.index), step = stroke.steps[index]; if (!step) return;
    if (step.enabled !== stroke.enabled) { stroke.steps[index] = { ...step, enabled: stroke.enabled }; stroke.changed = true; }
    state.step = index; cell.classList.toggle('enabled', stroke.enabled); cell.setAttribute('aria-pressed', String(stroke.enabled)); cell.textContent = step.tie ? '―' : stroke.enabled ? step.chord ? '◆' : '●' : '·';
  };
  on(grid, 'pointerdown', event => {
    if (state.tool === 'select' || event.button !== 0) return;
    const cell = event.target.closest?.('.studio-cell'), row = cell?.closest('.studio-sequence'); if (!row) return;
    event.preventDefault();
    const lane = getProject().procgen.lanes.find(item => item.id === row.dataset.laneId), slot = Number(row.dataset.slot);
    if (!lane?.patterns?.[slot]) return;
    stroke = { laneId: lane.id, slot, steps: lane.patterns[slot].steps.slice(), enabled: state.tool === 'draw', changed: false };
    state.laneId = lane.id; state.slot = slot; state.tab = 'Step'; paint(cell);
  });
  on(window, 'pointermove', event => { if (stroke) paint(document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.studio-cell')); });
  on(window, 'pointerup', () => {
    if (!stroke) return;
    const completed = stroke; stroke = null; suppressClickUntil = window.performance.now() + 100;
    if (completed.changed) dispatch({ type: 'procgen/pattern', laneId: completed.laneId, slot: completed.slot, patch: { steps: completed.steps } });
    else render();
  });
  on(window, 'pointercancel', () => { if (stroke) { stroke = null; renderRows(); } });
  on(window, 'resize', render);
  on(window, 'keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.key === 'Dead' || projectList.open || document.querySelector?.('dialog[open]') ||
        event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(event.target?.tagName) ||
        ['separator', 'slider', 'tab', 'menuitem'].includes(event.target?.getAttribute?.('role'))) return;
    const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    const action = modifier ? key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' ? 'redo' : null : null;
    if (action) { event.preventDefault(); handlers[action]?.(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); changeStep({ enabled: false }); }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && selected().mode === 'pattern') { event.preventDefault(); const length = selected().patterns[state.slot].length; state.step = (state.step + (event.key === 'ArrowLeft' ? length - 1 : 1)) % length; state.tab = 'Step'; render(); }
  });
  return { render, patchStep, layout, renderInspector: render, showProjects, showProjectPage, status: text => { status.textContent = text; },
    offerLegacyConversion(report, convert) {
      legacyNotice.replaceChildren(node('span', `Previous setup uses legacy phrases. Physical conversion will discard ${report.discardedEnabledSteps} enabled steps across ${report.laneCount} lanes.`),
        button('Convert previous setup', () => convert?.(), 'Replace the previous setup with a physical instrument graph'));
      legacyNotice.hidden = false;
    },
    clearLegacyConversion() { legacyNotice.hidden = true; legacyNotice.replaceChildren(); },
    displayState(receipt) {
      const current = receipt?.state || 'unavailable';
      displayStatus.textContent = `Display ${current}${receipt?.reason ? `: ${receipt.reason}` : ''}`;
      displayStatus.dataset.state = current;
      retryDisplay.hidden = !['lost', 'unavailable'].includes(current);
    },
    exportState(artifact, delivery) {
      const ready = !!artifact?.retained && Date.now() < artifact.expiresAt;
      const writing = delivery?.state === 'writing';
      retryExport.disabled = !ready || !artifact.deliveryModes?.includes('anchor');
      savePrepared.disabled = !ready || writing || typeof window.showSaveFilePicker !== 'function';
      cancelDelivery.disabled = !writing; discardPrepared.disabled = !artifact?.retained;
      const size = artifact?.byteLength == null ? artifact?.streamingEstimate == null ? 'size pending' :
        `about ${artifact.streamingEstimate.toLocaleString()} bytes` : `${artifact.byteLength.toLocaleString()} bytes`;
      exportSummary.textContent = artifact ? `${artifact.suggestedFilename} · ${size}${ready ? '' : ' · expired'}` : 'No prepared file';
      exportDetails.textContent = artifact ? `Source ${artifact.immutableSourceRef} · ${artifact.formatVersion} · SHA-256 ${artifact.sha256 || artifact.digestState}` +
        `${artifact.coverageLossReportRef ? ` · coverage ${artifact.coverageLossReportRef}` : ''} · Delivery ${delivery?.state || 'ready'}` :
        'Choose Export or MIDI to prepare a file.';
      if (artifact?.retained) exportDesk.open = true;
    },
    storage({ dirty, savedAt, error, recovery }) {
      storageStatus.textContent = error ? 'Save failed · Export' : dirty ? 'Unsaved' : 'Saved';
      storageStatus.dataset.state = error ? 'error' : dirty ? 'dirty' : 'saved';
      storageStatus.title = error?.message || (savedAt ? 'Last saved ' + new Date(savedAt).toLocaleString() : 'No saved project yet');
      const state = recovery?.state || 'unsaved';
      recoveryStatus.textContent = `Recovery ${state}`;
      recoveryStatus.dataset.state = state;
      recoveryStatus.title = recovery?.error?.message || (recovery?.durableRevision >= 0
        ? `Last durable edit revision ${recovery.durableRevision}, world tick ${recovery.durableTick ?? 'unknown'}` : 'No recovery checkpoint yet');
    },
    launched: () => renderRows(),
    transport(position) { state.beat = position.beat; if (document.activeElement !== bpm) bpm.value = String(Math.round(position.bpm * 100) / 100); bpm.disabled = position.clockSource === 'external'; clockStatus.textContent = position.clockSource === 'external' ? position.clockStatus : `${Math.floor(position.beat / 4) + 1} : ${Math.floor(position.beat % 4) + 1}`; linked.checked = position.linked; speedMode.value = position.speedMode; clock.value = position.clockSource; frame(position.beat); },
    recording(value, midiState = null) {
      state.recording = !!value;
      records.setAttribute('aria-pressed', String(value));
      const partial = midiState?.recordingComplete === false;
      records.textContent = partial ? '● Partial take' : '● Record';
      records.title = partial ? `Recording incomplete: ${midiState.incompleteReason}. Export labels the partial window.`
        : midiState?.recordingPressure >= 0.8 ? `Recording storage ${Math.round(midiState.recordingPressure * 100)}% full.`
          : 'Record MIDI input into the selected phrase';
      records.dataset.state = partial ? 'partial' : midiState?.recordingPressure >= 0.8 ? 'near-cap' : value ? 'recording' : 'idle';
    },
    midi(text) { state.lastMidi = text; const time = window.performance.now(); if (time - lastMidiFrame < 50) return; lastMidiFrame = time; const monitor = fields.querySelector('.studio-midi-monitor'); if (monitor && monitor.textContent !== text) monitor.textContent = text; },
    dispose() { if (disposed) return; disposed = true; detachRenderer(); for (const unlisten of listeners) unlisten(); if (canvasParent) canvasParent.insertBefore(canvas, canvasSibling?.parentNode === canvasParent ? canvasSibling : null); projectList.remove(); shell.remove(); footer.remove(); transport.remove(); heading.remove(); },
    getProjection: () => projection
  };
}
export { createProcgenWorkstationView };
