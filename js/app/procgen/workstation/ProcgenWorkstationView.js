import { createProcgenOperationalView } from './ProcgenOperationalView.js';
import { createLaneDisplaySnapshot, LANE_DISPLAY_PAGES } from './LaneDisplaySnapshot.js';
import { createLaneDisplayView } from './LaneDisplayView.js';
import { createCausalVisualView } from './CausalVisualView.js';
import { createModalOutputSafety } from '../../controls/ModalOutputSafety.js';
import { createKeyedControlTree } from '../../controls/KeyedControlTree.js';
import { createAutomationCurveEditor } from '../../controls/AutomationCurveEditor.js';
import { createWorkstationDock } from './WorkstationDock.js';
import { createWorkstationChrome } from './WorkstationChrome.js';
import { getProcgenCommandDispatcher } from '../../controls/ProcgenCommandDispatcher.js';
import { createProcgenCommandPalette } from '../../controls/ProcgenCommandPalette.js';
import { formatLaneGain, parseLaneGain } from './LaneMixState.js';
import { procgenLane, procgenLaneIndex } from './ProcgenProjectIndex.js';
import { createProjectNameDialog } from '../../controls/ProjectNameDialog.js';
import { createParameterKnob } from '../../controls/ParameterKnob.js';
import { getPointerGestureArbiter } from '../../controls/PointerGestureArbiter.js';
import { PROCGEN_SOUND_COLLECTIONS, PROCGEN_ROLES, resolveProcgenSound } from './ProcgenSoundCollections.js';
import { createProcgenLaneProjection } from './ProcgenLaneProjection.js';
import { procgenStepNotes } from './ProcgenPatternEngine.js';
import { createProcgenFullscreenSession } from './ProcgenFullscreenSession.js';
import { quarterMeterPosition } from '../../../midi/project/MidiMusicalPosition.js';
import { createInstrumentDisplayScheduler } from '../../resources/InstrumentDisplayScheduler.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { createPerformanceSceneControlView } from './PerformanceSceneControlView.js';
import { readSceneMacroControl } from './SceneMacroAction.js';
import { createMidiRouteDiagnostics } from './MidiRouteDiagnostics.js';

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SCALES = { Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Lydian: [0, 2, 4, 6, 7, 9, 11], Pentatonic: [0, 2, 4, 7, 9], Chromatic: Array.from({ length: 12 }, (_, i) => i) };
const COLORS = ['#289fd1', '#6daa43', '#9362c9', '#ac855a', '#ef7440', '#dc639e', '#58aec6', '#99ac37'];
const rendererLeases = new WeakMap(), mountedViews = new WeakMap();

function createProcgenWorkstationView({ document, window, resourceBudget = null, getProject, getRuntime, getDocumentIdentity = () => null, dispatch, handlers = {}, canCommand = name => typeof handlers[name] === 'function', state = {} }) {
  mountedViews.get(document.getElementById('gameCanvas'))?.dispose();
  for (const [key, value] of Object.entries({ slot: 0, step: 0, tab: 'Lane', tool: 'select', layout: 'strip', firstLane: 0, minimumRow: 96, inspectorWidth: 304, hazardSpacing: 160 })) if (state[key] == null) state[key] = value;
  const listeners = [], parameterControls = [], laneMixControls = new Map(), lanePanControls = new Map(), parameterCache = new Map(), curveEditors = new Map();
  const laneDisplays = new Map(), laneDisplayPages = new Map();
  let parameterScope = null, parameterSeen = null, viewRevision = 0, curveDocumentIdentity = getDocumentIdentity();
  let midiRouteView = null, midiRouteState = null, mixDocumentIdentity = null;
  const pointerArbiter = getPointerGestureArbiter(document), nameDialog = createProjectNameDialog({ document, window });
  const retirement = createProcgenRetirementScope(), displayScheduler = createInstrumentDisplayScheduler({ document, window, resourceBudget });
  const on = (element, event, handler, options) => { element.addEventListener(event, handler, options); listeners.push(() => element.removeEventListener(event, handler, options)); };
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, action, title = text) => { const el = node('button', text); el.type = 'button'; el.title = title; el.dataset.controlKey = 'button:' + text; return controlTree.bind(el, { click: action }); };
  const inMenu = (name, element) => { element.dataset.commandGroup = name; return element; };
  const select = (choices, value, changed, label) => {
    const el = node('select'); el.setAttribute('aria-label', label);
    for (const choice of choices) { const [id, text] = Array.isArray(choice) ? choice : [choice, choice]; const option = node('option', text); option.value = id; el.append(option); }
    el.value = String(value); return controlTree.bind(el, { getIdentity: getDocumentIdentity, change: event => changed(event.currentTarget.value) });
  };
  const input = (value, changed, options = {}) => {
    const el = node('input'); el.type = options.type || 'number';
    for (const key of ['min', 'max', 'step', 'placeholder']) if (options[key] != null) el[key] = String(options[key]);
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value ?? '';
    return controlTree.bind(el, { getIdentity: options.getIdentity || getDocumentIdentity, change: event => {
      const current = event.currentTarget;
      if (current.type === 'checkbox') return changed(current.checked);
      if (current.type === 'text') return changed(current.value);
      const empty = !current.value.trim(), value = empty && options.nullable ? null : Number(current.value);
      if (value !== null && (empty || !Number.isFinite(value) || options.min != null && value < options.min || options.max != null && value > options.max)) {
        current.setAttribute('aria-invalid', 'true'); status.textContent = empty ? 'Enter a value; an empty field is not zero.' :
          `Enter a finite value${options.min == null ? '' : ' from ' + options.min}${options.max == null ? '' : ' through ' + options.max}.`; return false;
      }
      current.removeAttribute('aria-invalid'); return changed(value);
    } });
  };

  const macroControls = new Map(), macroModes = new Map();
  const parameter = (value, changed, descriptor, options = {}) => {
    const scope = parameterScope, identity = JSON.stringify([scope, descriptor, !!options.momentary]), cacheKey = descriptor.id;
    let entry = parameterCache.get(cacheKey);
    if (entry && entry.identity !== identity) { entry.control.dispose(); parameterControls.splice(parameterControls.indexOf(entry.control), 1); parameterCache.delete(cacheKey); entry = null; }
    if (!entry) {
      entry = { identity, changed, options, token: {}, control: null };
      const invoke = name => (...args) => entry.options[name]?.(...args);
      entry.control = createParameterKnob({ document, window, value, descriptor, ...options,
        getIdentity: () => !disposed && !superseded && parameterScope === scope ? entry.token : null,
        commit: (...args) => entry.changed(...args), preview: invoke('preview'), onFinish: invoke('onFinish'), onCancel: reason => {
          if (reason === 'external-edit' || reason === 'unavailable') status.textContent = 'The parameter changed or became unavailable. The gesture was canceled; its draft was not committed.';
          entry.options.onCancel?.(reason);
        } });
      entry.control.element.__ownedControl = true; parameterCache.set(cacheKey, entry); parameterControls.push(entry.control);
    } else { entry.control.setState({ value, isReadOnly: !!options.readOnly, isPending: !!options.pending }); if (entry.control.inspect().gestureId == null) { entry.changed = changed; entry.options = options; } }
    parameterSeen?.add(cacheKey); if (options.macroKey) macroControls.set(options.macroKey, entry.control);
    return entry.control.element.isConnected ? controlTree.retain(entry.control.element) : entry.control.element;
  };
  const labeled = (label, control, parent) => {
    const fieldKey = state.tab + ':' + (parent.dataset.controlKey ? parent.dataset.controlKey + ':' : '') + (control.__retainedControl?.dataset.parameterId || control.dataset.parameterId || label);
    control.id = 'studio-field-' + encodeURIComponent(parameterScope + ':' + fieldKey);
    const parameterField = !!(control.__retainedControl?.dataset.parameterId || control.dataset.parameterId);
    control.dataset.fieldKey = fieldKey; const wrap = node(parameterField ? 'div' : 'label', null, parameterField ? 'studio-field studio-parameter-field' : 'studio-field'); wrap.dataset.fieldKey = fieldKey;
    if (parameterField) { wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label); wrap.append(control); }
    else wrap.append(node('span', label), control);
    parent.append(wrap); return control;
  };
  const automationEditor = (lane, curve) => {
    const key = JSON.stringify([lane.id, curve.id]), documentIdentity = getDocumentIdentity(); let entry = curveEditors.get(key);
    if (!entry) {
      if (curveEditors.size >= 32) {
        const retired = [...curveEditors].find(([, value]) => !value.control.inspect().dirty && value.laneId !== state.laneId);
        if (retired) { retired[1].control.dispose(); curveEditors.delete(retired[0]); }
      }
      if (curveEditors.size >= 32) return node('p', 'Curve draft storage is full. Apply or discard an existing lane curve draft before opening another editor.', 'studio-hint');
      entry = { laneId: lane.id, curveId: curve.id, token: {}, control: null };
      const current = () => !disposed && !superseded && getDocumentIdentity() === documentIdentity && state.laneId === lane.id && state.tab === 'Automation' && dock.visible() && procgenLane(getProject().procgen.lanes, lane.id)?.ccAutomation.some(value => value.id === curve.id);
      try { entry.control = createAutomationCurveEditor({ document, window, curve, resourceBudget, getIdentity: () => current() ? entry.token : null, onStatus: text => { status.textContent = text; },
        commit: points => { if (!current()) return false; const target = procgenLane(getProject().procgen.lanes, lane.id); dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { ccAutomation: target.ccAutomation.map(value => value.id === curve.id ? { ...value, points } : value) } }); return true; } }); }
      catch (failure) { return node('p', 'Curve editor unavailable: ' + failure.message, 'studio-hint'); }
      curveEditors.set(key, entry);
    }
    entry.control.update(curve); return entry.control.element.isConnected ? controlTree.retain(entry.control.element) : entry.control.element;
  };
  const byId = id => document.getElementById(id);
  const topbar = byId('procgenTopbar'), topbarParent = topbar.parentNode, topbarSibling = topbar.nextSibling;
  const presentationRoot = node('div', null, 'procgen-presentation-root'); presentationRoot.id = 'procgenPresentationRoot';
  topbarParent.insertBefore(presentationRoot, topbar); presentationRoot.append(topbar);
  const shell = node('main', null, 'procgen-studio'); shell.id = 'procgenStudio';
  const heading = node('div', null, 'studio-brand'); heading.append(node('strong', 'PROCGEN'), node('span', 'Living worlds. Musical stories.'));
  topbar.prepend(heading);
  const transport = node('div', null, 'studio-transport'); transport.setAttribute('aria-label', 'Musical transport'); topbar.append(transport);
  const lanes = node('div', null, 'studio-lane-headers'); lanes.setAttribute('aria-label', 'Musical lanes'); lanes.tabIndex = 0;
  const stage = node('div', null, 'studio-stage'); stage.id = 'procgenStudioStage';
  const canvas = byId('gameCanvas'), canvasParent = canvas.parentNode, canvasSibling = canvas.nextSibling; stage.append(canvas);
  const grid = node('div', null, 'studio-sequences'); grid.setAttribute('aria-label', 'Lane sequencers'); stage.append(grid);
  const inspector = node('aside', null, 'studio-inspector'); inspector.setAttribute('aria-label', 'Selected lane inspector');
  const resize = node('div', null, 'studio-resize'); resize.setAttribute('role', 'separator'); resize.tabIndex = 0;
  const tabs = node('div', null, 'studio-inspector-tabs');
  const fields = node('div', null, 'studio-inspector-fields'); fields.id = 'procgenInspectorFields';
  const conflictHost = node('div', null, 'studio-field-conflict'); conflictHost.hidden = true; conflictHost.setAttribute('role', 'status');
  inspector.append(resize, tabs, conflictHost, fields);
  shell.append(lanes, stage, inspector); topbar.after(shell);
  const footer = node('footer', null, 'studio-footer'); footer.id = 'procgenStudioFooter'; shell.after(footer);
  const panel = byId('procgenPanel'), panelParent = panel?.parentNode, panelSibling = panel?.nextSibling;
  if (panel) presentationRoot.append(panel);
  const status = node('output', 'Ready', 'studio-status'); status.setAttribute('aria-live', 'polite');
  const modalSafety = createModalOutputSafety({ document, stop: () => handlers.stopOutput?.(), panic: () => {
    const panic = document.getElementById('procgenPanic'); if (panic) panic.click(); else handlers.panicOutput?.();
  }, onStatus: message => { status.textContent = message; } });
  const storageStatus = node('output', 'Unsaved', 'studio-storage-status'); storageStatus.setAttribute('aria-label', 'Project save status');
  const recoveryStatus = node('output', 'Recovery unsaved', 'studio-recovery-status'); recoveryStatus.setAttribute('aria-label', 'Crash recovery status');
  const legacyNotice = node('div', null, 'studio-legacy-conversion'); legacyNotice.hidden = true;
  footer.append(legacyNotice);
  const controlTree = createKeyedControlTree({ document, conflictHost, onStatus: text => { status.textContent = text; }, focusFallback: () => tabs.querySelector('[role="tab"][aria-selected="true"]') || dock.toggle });
  const cueStrip = node('div', null, 'studio-scene-cue'); cueStrip.setAttribute('aria-label', 'Prepared physical scene transition'); cueStrip.hidden = true;
  const currentCue = node('span', 'CURRENT · Physical world'), nextCue = node('span', 'NEXT · No candidate'), cueState = node('output'); cueState.setAttribute('aria-live', 'polite');
  const cueGo = button('GO · stop and load', () => handlers.stageGo?.()); cueGo.disabled = true;
  cueStrip.append(currentCue, nextCue, cueState, button('Choose NEXT', () => handlers.scenes?.()), cueGo, button('Play', () => handlers.stagePlay?.()), button('Pause', () => handlers.stagePause?.()), button('Stop', () => handlers.stopOutput?.()), button('Panic', () => handlers.panicOutput?.()), button('Exit stage', () => handlers.stageExit?.())); shell.before(cueStrip);
  let projection, stroke = null, layoutKey = null, queuedBeat = null;
  const currentLaneIndex = () => ({ get: id => procgenLane(getProject().procgen.lanes, id) });
  let attachedRenderer = null, disposed = false, superseded = false, stageActive = false;
  const operationalView = createProcgenOperationalView({ document, readSnapshot: () => handlers.operationalState?.() || null,
    performAction: (...args) => handlers.recoverOperational?.(...args), onStatus: text => { status.textContent = text; } });
  topbar.append(operationalView.element);
  const operationalSurface = displayScheduler.register({ id: 'workstation-operational', element: operationalView.element, intervalMs: 100,
    write: () => operationalView.render(handlers.operationalState?.() || null) }); operationalSurface.invalidate();
  let geometryPending = false, geometryRelease = null, geometryUnsubscribe = null;
  const owner = {};
  const detachRenderer = () => {
    const renderer = attachedRenderer; attachedRenderer = null;
    causalView.bind(null);
    if (!renderer) return;
    const lease = rendererLeases.get(renderer);
    if (lease?.owner !== owner) return;
    rendererLeases.delete(renderer);
    if (renderer.onWorkstationFrame === frame) renderer.onWorkstationFrame = lease.baseFrame;
    if (renderer.workstationLayout === projection) renderer.workstationLayout = lease.baseLayout;
    renderer.resize();
  };
  const finishGeometry = () => {
    if (!geometryPending || disposed) return;
    const renderer = getRuntime()?.lanes?.renderer || null;
    if (renderer?.presentation?.demanded && !renderer.presentation.getSnapshot()) return;
    geometryPending = false; state.presentationTransition = false; grid.inert = false;
    delete stage.dataset.presentation;
    geometryUnsubscribe?.(); geometryUnsubscribe = null;
  };
  const beginGeometry = () => {
    if (disposed) return;
    cancelPresentationGestures('geometry-transition'); stroke = null; geometryPending = true; state.presentationTransition = true;
    grid.inert = true; stage.dataset.presentation = 'preparing';
    geometryRelease?.(); geometryRelease = null;
    geometryUnsubscribe?.(); geometryUnsubscribe = null;
    const host = getRuntime()?.lanes?.renderer?.presentation;
    geometryRelease = host?.suspend?.(owner, 'The world display is preparing its fullscreen geometry.') || null;
    geometryUnsubscribe = host?.subscribe?.(() => finishGeometry()) || null;
  };
  const reflowGeometry = () => {
    if (disposed) return;
    layout(); renderRows();
    geometryRelease?.(); geometryRelease = null;
    getRuntime()?.lanes?.renderer?.render?.(false);
    finishGeometry();
  };
  const dock = createWorkstationDock({ document, window, shell, inspector, resize, tabs, fields, state, getIdentity: getDocumentIdentity,
    getContext: () => {
      const lane = selected(), renderer = getRuntime()?.lanes?.renderer, snapshot = renderer?.presentation?.getSnapshot?.(), selectedIndex = procgenLaneIndex(getProject().procgen.lanes).get(lane.id);
      const entity = renderer?.selectedWorldEntityId && snapshot?.entities?.find(value => value.id === renderer.selectedWorldEntityId && (state.tab === 'Selection' || value.lane === selectedIndex));
      const mappingId = document.activeElement?.closest?.('.studio-physical-instrument')?.dataset.mappingId;
      const mappingTarget = state.tab === 'Physical' && getProject().procgen.physicalGraph?.instruments.some(value => value.id === mappingId) ? mappingId : null;
      return { laneId: lane.id, laneName: lane.name, editorKind: state.tab, targetScope: state.tab === 'Physical' ? 'physical-graph' : ['World', 'Selection'].includes(state.tab) ? 'world' : 'lane', targetId: document.activeElement?.closest?.('.studio-curve-editor')?.dataset.curveId || (state.tab === 'Physical' ? mappingTarget || 'procgen.physicalGraph' : state.tab === 'Selection' ? entity?.id || snapshot?.worldId || null : state.tab === 'World' ? snapshot?.worldId || null : null),
        selectedEntity: entity ? { id: entity.id, kind: entity.kind, worldId: snapshot.worldId, generation: snapshot.generation } : null,
        dirtyBuffer: [...curveEditors.values()].filter(value => value.laneId === lane.id).map(value => ({ curveId: value.curveId, ...value.control.inspect() })) };
    }, isSuspended: () => stageActive,
    onOpen: () => render(), onClose: () => cancelPresentationGestures('dock-closed'), onModeChange: () => cancelPresentationGestures('workspace-mode'),
    onLayout: reflowGeometry, onPreferences: () => handlers.preferences?.(), onStatus: text => { status.textContent = text; } });
  on(inspector, 'focusin', () => dock.update());
  on(inspector, 'input', () => dock.update());
  on(inspector, 'click', () => dock.update());
  on(stage, 'pointerup', () => dock.update()); on(stage, 'keydown', event => { if (event.key === 'Escape') dock.update(); });
  function cancelPresentationGestures(reason) { stroke?.lease.cancel(reason); dock.cancel(reason); for (const control of parameterControls) control.cancel(reason); for (const control of laneMixControls.values()) control.cancel(reason); for (const control of lanePanControls.values()) control.cancel(reason); for (const entry of curveEditors.values()) entry.control.cancel(reason); }
  const layoutMode = select([['strip', 'Strip'], ['overlay', 'Overlay']], state.layout, value => { state.layout = value; render(); handlers.preferences?.(); }, 'Sequencer layout');
  const bpm = input(120, value => handlers.transport?.({ bpm: value, baseBpm: value }), { min: 20, max: 400, step: 0.01 }); bpm.setAttribute('aria-label', 'BPM');
  bpm.title = 'Base musical tempo. Linked game-speed mode multiplies it by the world speed; Status details show effective tempo.';
  const speedMode = select([['bpm', 'BPM'], ['game', 'Game speed']], 'bpm', value => handlers.transport?.({ speedMode: value }), 'Speed mode');
  const linked = input(true, value => handlers.transport?.({ linked: value }), { type: 'checkbox' });
  const root = select(NOTES.map((note, index) => [index, note]), getProject().global.scale.root, value => dispatch({ type: 'procgen/global', patch: { scale: { ...getProject().global.scale, root: Number(value) } } }), 'Global key');
  const scale = select(Object.keys(SCALES), 'Major', value => dispatch({ type: 'procgen/global', patch: { scale: { ...getProject().global.scale, name: value, degrees: SCALES[value] } } }), 'Global scale');
  const clock = select([['internal', 'Internal'], ['external', 'MIDI in']], 'internal', value => handlers.transport?.({ clockSource: value }), 'Clock source');
  const clockStatus = node('output', 'Internal', 'studio-clock-status');
  clockStatus.setAttribute('aria-label', 'Musical bar and denominator-note beat');
  const clockHealth = node('output', 'Internal clock', 'studio-clock-source-status'); clockHealth.setAttribute('aria-label', 'Clock source status');
  const displayStatus = node('output', 'Display ready', 'studio-display-status visually-hidden'); displayStatus.setAttribute('aria-live', 'polite');
  const retryDisplay = button('Retry display', () => handlers.retryDisplay?.(), 'Retry canvas display after context loss'); retryDisplay.hidden = true;
  const stopOutput = button('Stop music', () => handlers.stopOutput?.(), 'Stop the musical transport and flush pending output'); stopOutput.id = 'studioStopOutput';
  let fullscreenSession = null;
  const fullscreenCommand = () => { void fullscreenSession?.toggle(); };
  const fullscreenMenu = node('details', null, 'studio-transport-overflow');
  const fullscreenSummary = node('summary', 'View actions'); fullscreenMenu.append(fullscreenSummary);
  const commandSearch = node('input'); commandSearch.type = 'search'; commandSearch.placeholder = 'Find command';
  commandSearch.setAttribute('aria-label', 'Find workstation command');
  const fullscreenAction = button('Expand fullscreen', fullscreenCommand);
  on(commandSearch, 'input', () => { fullscreenAction.hidden = !!commandSearch.value.trim() &&
    !/fullscreen|expand|exit|presentation/i.test(commandSearch.value); });
  fullscreenMenu.append(commandSearch, fullscreenAction);
  const displayPage = select(LANE_DISPLAY_PAGES.map(page => [page, page[0].toUpperCase() + page.slice(1)]), 'identity', page => {
    laneDisplayPages.set(state.laneId, page); laneMixSurface.invalidate();
  }, 'Selected lane display page');
  const expandDisplay = button('Read selected lane display', () => { paintLaneDisplays(); laneDisplayDialog.showModal(); }, 'Expand the complete lane name, cause and output evidence');
  const displayPageLabel = node('label', 'Lane display page'); displayPageLabel.append(displayPage); fullscreenMenu.append(displayPageLabel, expandDisplay);
  const laneDisplayDialog = node('dialog', null, 'studio-dialog studio-lane-display-dialog'); laneDisplayDialog.setAttribute('aria-label', 'Selected lane display details');
  const laneDisplayDetails = node('pre');
  laneDisplayDialog.append(node('h2', 'Lane display evidence'), laneDisplayDetails, button('Close lane display', () => laneDisplayDialog.close())); presentationRoot.append(laneDisplayDialog);
  const causalView = createCausalVisualView({ document, stage, actions: fullscreenMenu, parent: presentationRoot, resourceBudget, getDocumentIdentity,
    read: readLaneDisplayValues, invalidate: () => laneMixSurface.invalidate() });
  const stageModeButton = button('Stage mode', () => handlers.stage?.(), 'Protect live performance and prepare an explicit NEXT score');
  stageModeButton.textContent = 'Stage'; stageModeButton.setAttribute('aria-label', 'Stage mode');
  const fullscreenExit = button('Exit fullscreen', fullscreenCommand); fullscreenExit.id = 'studioFullscreenExit'; fullscreenExit.hidden = true;
  // Opening the command and changing presentation geometry must not blur a numeric draft.
  for (const action of [fullscreenSummary, fullscreenAction, fullscreenExit]) on(action, 'pointerdown', event => {
    if (event.button === 0) event.preventDefault();
  });
  const syncFullscreen = () => {
    const current = fullscreenSession?.getState();
    const entered = !!current?.entered;
    fullscreenAction.textContent = entered ? 'Exit fullscreen' : current?.state === 'requesting' ? 'Cancel fullscreen request' : 'Expand fullscreen';
    fullscreenAction.disabled = current?.state === 'exiting';
    fullscreenExit.hidden = !entered; fullscreenExit.setAttribute('aria-pressed', String(entered));
  };
  labeled('View', layoutMode, transport); labeled('Speed', speedMode, transport); labeled('BPM', bpm, transport); labeled('Link world', linked, transport);
  labeled('Key', root, transport); labeled('Scale', scale, transport); labeled('Clock', clock, transport);
  transport.append(stopOutput, dock.toggle, dock.mode, stageModeButton, clockStatus, clockHealth, displayStatus, retryDisplay, fullscreenMenu, fullscreenExit);
  fullscreenSession = createProcgenFullscreenSession({ document, root: presentationRoot, control: fullscreenAction,
    getGeneration: () => handlers.presentationGeneration?.() ?? 0,
    onTransition: () => { beginGeometry(); syncFullscreen(); },
    onReflow: () => { syncFullscreen(); reflowGeometry(); },
    onStatus: message => { status.textContent = message; },
    focusFallback: () => byId('procgenPause') });
  syncFullscreen();
  const tool = select(['select', 'draw', 'erase'], state.tool, value => { state.tool = value; }, 'Step editing tool');
  const laneRange = node('output', '', 'studio-lane-range'); laneRange.setAttribute('aria-label', 'Visible lane range');
  const moveLanes = delta => { state.firstLane += delta; layout(); renderRows(); handlers.preferences?.(); };
  const previousLanes = button('↑', () => moveLanes(-projection.count), 'Show previous lanes');
  const nextLanes = button('↓', () => moveLanes(projection.count), 'Show next lanes');
  const laneNavigation = node('span', null, 'studio-lane-navigation'); laneNavigation.append(previousLanes, laneRange, nextLanes); footer.append(laneNavigation, button('Clear all solos', () => handlers.clearSolos?.(), 'Clear solo on every lane; does not change self-mute or level'));
  footer.append(inMenu('Edit', button('+ Lane', () => handlers.addLane?.())), inMenu('Edit', button('− Lane', () => handlers.removeLane?.())), inMenu('Edit', button('Duplicate', () => handlers.duplicate?.())), inMenu('Edit', button('Clear', () => handlers.clear?.())), inMenu('Edit', tool),
    inMenu('Edit', button('Copy', () => handlers.copy?.())), inMenu('Edit', button('Paste', () => handlers.paste?.())), button('Undo', () => handlers.undo?.()), button('Redo', () => handlers.redo?.()));
  const records = button('● Record', () => handlers.record?.(!state.recording), 'Record MIDI input into the selected phrase'); records.id = 'studioRecord';
  const exportDesk = node('details', null, 'studio-export-desk'); exportDesk.setAttribute('aria-label', 'Prepared export'); exportDesk.hidden = true;
  const exportSummary = node('summary', 'No prepared file');
  const exportDetails = node('output', 'Choose Export or MIDI to prepare a file.', 'studio-export-details');
  const retryExport = button('Retry file', () => handlers.retryExport?.(), 'Request the same prepared file again'); retryExport.disabled = true;
  const savePrepared = button('Save file', () => handlers.savePreparedExport?.(), 'Stream the prepared file to a selected destination'); savePrepared.disabled = true;
  const cancelDelivery = button('Cancel delivery', () => handlers.cancelExportDelivery?.(), 'Stop the current file write but keep the prepared file'); cancelDelivery.disabled = true;
  const discardPrepared = button('Discard file', () => handlers.discardExport?.(), 'Release the prepared file without changing the project'); discardPrepared.disabled = true;
  exportDesk.append(exportSummary, exportDetails, retryExport, savePrepared, cancelDelivery, discardPrepared);
  footer.append(inMenu('Edit', records), status, storageStatus, recoveryStatus, button('Save', () => handlers.save?.()), inMenu('Project', button('Save As', () => handlers.saveAs?.())),
    button('Scenes', () => handlers.scenes?.(), 'Inspect and explicitly prepare a paused physical score'), inMenu('Project', button('Rename', () => handlers.rename?.())), inMenu('Project', button('Load', () => handlers.load?.())), inMenu('Project', button('New', () => handlers.new?.())),
    inMenu('Project', button('Export', () => handlers.export?.())), inMenu('Project', button('MIDI', () => handlers.exportMidi?.())),
    inMenu('World tools', button('Physical authoring…', () => handlers.openPhysicalAuthoring?.(), 'Preview and safely apply terrain or pinned fragments with whole-world Undo')),
    inMenu('World tools', button('Release…', () => handlers.openReleaseGestures?.(), 'Perform finite, phased or physically clock-locked cohort releases')),
    inMenu('World tools', button('Physical scene…', () => handlers.openPhysicalScene?.(), 'Author physical gates, cargo stations and their causal instruments')),
    inMenu('World tools', button('Feedback…', () => handlers.openPhysicalFeedback?.(), 'Author, inspect and explicitly arm physical conductors and intervention layers')),
    inMenu('World tools', button('Junctions…', () => handlers.openPhysicalJunctions?.(), 'Request safe physical route changes and inspect pending versus applied configurations')),
    inMenu('Sound tools', button('Quarry Echo…', () => handlers.openQuarryEcho?.(), 'Prepare an original echo rack for the physical audio owner')),
    inMenu('Sound tools', button('Record audio…', () => handlers.openMasterCapture?.(), 'Capture the running shared browser master as a bounded stereo WAV')),
    inMenu('Sound tools', button('Prelisten', () => handlers.openPrelistenMonitor?.(), 'Choose cue routing and stop the foreground preview')), exportDesk);
  const importInput = input('', () => {}, { type: 'file' }); importInput.accept = '.json,.procgen'; importInput.hidden = true; footer.append(importInput);
  on(importInput, 'change', () => { if (importInput.files?.[0]) handlers.import?.(importInput.files[0]); importInput.value = ''; });
  footer.append(inMenu('Project', button('Import', () => importInput.click())));
  const projectList = node('dialog', null, 'studio-dialog'); projectList.setAttribute('aria-label', 'Saved projects'); presentationRoot.append(projectList);
  let pickerOwner = null, pendingPickerCloses = 0;
  const retirePicker = (owner, { cancel = false, close = false } = {}) => {
    if (!owner || owner.closed || pickerOwner !== owner) return;
    owner.closed = true; owner.generation++; pickerOwner = null;
    if (cancel) handlers.cancelProjectPicker?.();
    if (close && projectList.open) { pendingPickerCloses++; projectList.close(); }
  };
  on(projectList, 'cancel', event => {
    if (event.defaultPrevented || !pickerOwner) return;
    event.preventDefault(); retirePicker(pickerOwner, { cancel: true, close: true });
  });
  on(projectList, 'close', () => {
    if (pendingPickerCloses) { pendingPickerCloses--; return; }
    retirePicker(pickerOwner, { cancel: true });
  });
  const showProjectPage = (page, load, fetchPage = null) => {
    if (disposed) return;
    retirePicker(pickerOwner);
    const owner = { generation: 0, closed: false, loading: false, query: '', cursor: null, back: [] }; pickerOwner = owner;
    const current = generation => !disposed && pickerOwner === owner && !owner.closed && owner.generation === generation;
    const items = node('div', null, 'studio-project-items'), feedback = node('p', '', 'studio-project-feedback');
    const search = node('input'); search.type = 'search'; search.placeholder = 'Search project names'; search.setAttribute('aria-label', 'Search project names');
    const more = button('More projects', async () => {
      if (!current(owner.generation) || owner.loading || !page.nextCursor || !fetchPage) return;
      const generation = owner.generation, cursor = page.nextCursor, query = owner.query;
      const restorePageFocus = document.activeElement === more;
      owner.loading = true;
      more.disabled = true; feedback.textContent = 'Loading more projects…';
      try {
        const next = await fetchPage(cursor, query);
        if (!current(generation) || owner.query !== query || page.nextCursor !== cursor || !next) return;
        owner.back.push(owner.cursor); owner.cursor = cursor; page = next; append(next.items, restorePageFocus); feedback.textContent = next.items.length ? '' : next.nextCursor ?
          'No matches in this page. Continue the search with More projects.' : 'No more matching projects.';
      } catch (error) { if (current(generation)) feedback.textContent = error?.message || 'Could not load more projects. Retry.'; }
      finally { if (current(generation)) { owner.loading = false; more.disabled = !page.nextCursor; more.hidden = !page.nextCursor; } }
    });
    const previous = button('Previous projects', async () => {
      if (!fetchPage || owner.loading || !owner.back.length || !current(owner.generation)) return;
      const generation = owner.generation, cursor = owner.back.at(-1); owner.loading = true;
      try { const next = await fetchPage(cursor, owner.query); if (!current(generation) || !next) return;
        owner.back.pop(); owner.cursor = cursor; page = next; append(next.items); more.disabled = !page.nextCursor; more.hidden = !page.nextCursor;
      } catch (error) { if (current(generation)) feedback.textContent = error.message; }
      finally { if (current(generation)) owner.loading = false; }
    });
    const append = (entries, restorePageFocus = false) => {
      const focused = document.activeElement, focusedId = focused?.dataset?.projectId;
      const restoreFocus = items.contains(focused) || focused === more || focused === previous || restorePageFocus && (focused === document.body || focused === projectList);
      items.replaceChildren(); previous.hidden = !owner.back.length;
      for (const entry of entries) {
        const choice = button(`${entry.name} · ${new Date(entry.savedAt).toLocaleString()} · ${String(entry.id).slice(-6)}`, async () => {
          if (!current(owner.generation) || owner.loading) return;
          const generation = owner.generation; owner.loading = true; search.disabled = true; more.disabled = true;
          feedback.textContent = 'Opening project…';
          try {
            const loaded = await load(entry.id); if (!current(generation)) return;
            if (loaded) retirePicker(owner, { close: true });
            else feedback.textContent = 'Project could not be opened. It may have changed or been removed; choose another or retry.';
          } catch (error) { if (current(generation)) feedback.textContent = error?.message || 'Project could not be opened.'; }
          finally { if (current(generation)) { owner.loading = false; search.disabled = false; more.disabled = !page.nextCursor; } }
        });
        choice.dataset.projectId = entry.id; items.append(choice);
      }
      if (restoreFocus) ([...items.children].find(choice => choice.dataset.projectId === focusedId) || items.firstElementChild || search).focus();
      if (!items.childElementCount) feedback.textContent = page.nextCursor ? 'No matches in this page. Continue the search with More projects.' :
        'No matching projects. Save here or import a project file.';
    };
    search.addEventListener('change', async () => {
      if (!fetchPage || !current(owner.generation) || search.disabled) return;
      const generation = ++owner.generation, query = search.value.trim(); owner.query = query; owner.loading = true;
      owner.cursor = null; owner.back.length = 0; previous.hidden = true; page = { items: [], nextCursor: null }; items.replaceChildren(); more.disabled = true; more.hidden = true;
      feedback.textContent = 'Searching projects…';
      try {
        const next = await fetchPage(null, query); if (!current(generation) || !next) return;
        page = next; append(next.items); if (next.items.length) feedback.textContent = '';
      } catch (error) { if (current(generation)) feedback.textContent = error?.message || 'Project search failed. Retry.'; }
      finally { if (current(generation)) { owner.loading = false; more.disabled = !page.nextCursor; more.hidden = !page.nextCursor; } }
    });
    projectList.replaceChildren(node('h2', 'Saved projects'), button('Close', () => retirePicker(owner, { cancel: true, close: true })), search, items, feedback, previous, more);
    append(page.items); more.hidden = !page.nextCursor;
    if (handlers.reclaimRecovery) projectList.append(button('Remove recovery checkpoint', () => handlers.reclaimRecovery()));
    projectList.showModal();
  };
  const refreshMacroState = () => { for (const [key, control] of macroControls) { const [laneId, macroId] = JSON.parse(key), receipt = handlers.macroGestureState?.(laneId, macroId); if (receipt) control.setObservations({ pickupValue: receipt.pickup01 }); } };
  const showProjects = (entries, load) => showProjectPage({ items: entries, nextCursor: null }, load);
  const selected = () => { const project = getProject(), lane = project.procgen.lanes.find(item => item.id === state.laneId) || project.procgen.lanes[0]; state.laneId = lane.id; return lane; };
  const viewLease = () => Object.freeze({ revision: viewRevision, selectionKey: parameterScope, laneId: state.laneId, tab: state.tab, slot: state.slot, step: state.step, documentIdentity: getDocumentIdentity() });
  const currentViewLease = lease => !disposed && !superseded && lease.revision === viewRevision && lease.selectionKey === parameterScope && lease.documentIdentity === getDocumentIdentity() && lease.laneId === state.laneId && lease.tab === state.tab && lease.slot === state.slot && lease.step === state.step;
  const selectSound = (laneId, patch) => {
    renderInspector(); const lease = viewLease(); handlers.status?.('Preparing native sound; the accepted sound and physical world are unchanged.');
    Promise.resolve().then(() => currentViewLease(lease) ? handlers.selectSoundAlias(laneId, patch) : null).catch(error => {
      if (!currentViewLease(lease)) return;
      handlers.status?.(error.message + ' Keep the previous sound, enable local listening for worklet sources, or explicitly select the Soft triangle fallback.'); renderInspector();
    });
  };
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
    if (disposed) return;
    if (!dock.visible()) { viewRevision++; parameterScope = JSON.stringify([getDocumentIdentity(), state.laneId, state.tab, state.slot, state.tab === 'Step' || state.tab === 'Chord' ? state.step : null]); return; }
    const nextFields = node('div'), nextTabs = node('div'); macroControls.clear(); parameterSeen = new Set(); viewRevision++;
    if (state.tab !== 'MIDI') { midiRouteView?.dispose(); midiRouteView = null; }
    const lane = selected(); state.slot = Math.max(0, Math.min(3, state.slot));
    const pattern = lane.mode === 'pattern' ? lane.patterns[state.slot] : null;
    state.step = pattern ? Math.max(0, Math.min(state.step, pattern.length - 1)) : 0;
    const step = pattern?.steps[state.step];
    if (!pattern && ['Step', 'Chord'].includes(state.tab)) state.tab = 'Lane';
    parameterScope = JSON.stringify([getDocumentIdentity(), state.laneId, state.tab, state.slot, state.tab === 'Step' || state.tab === 'Chord' ? state.step : null]);
    for (const tab of (pattern ? ['Lane', 'Step', 'Chord', 'MIDI', 'World', 'Selection', 'Automation'] : ['Lane', 'Physical', 'MIDI', 'World', 'Selection', 'Automation'])) { const el = button(tab, () => { state.tab = tab; render(); handlers.preferences?.(); }); el.id = 'procgen-dock-tab-' + tab; el.setAttribute('role', 'tab'); el.setAttribute('aria-selected', String(state.tab === tab)); el.setAttribute('aria-controls', dock.panelId(tab)); el.tabIndex = state.tab === tab ? 0 : -1; nextTabs.append(el); }
    fields.setAttribute('aria-labelledby', 'procgen-dock-tab-' + state.tab);
    nextFields.replaceChildren(node('div', `${lane.family.toUpperCase()} / ${lane.role}`, 'studio-eyebrow'), node('h2', state.tab === 'Step' || state.tab === 'Chord' ? `Step ${state.step + 1} · Phrase ${state.slot + 1}` : lane.name));
    if (state.tab === 'Lane') {
      labeled('Name', input(lane.name, name => changeLane({ name }), { type: 'text' }), nextFields);
      labeled('Sound collection (legacy aliases)', select(PROCGEN_SOUND_COLLECTIONS.map(c => [c.id, c.name]), lane.family, family => selectSound(lane.id, { family }), 'Sound collection'), nextFields);
      labeled('Role', select(PROCGEN_ROLES, lane.role, role => selectSound(lane.id, { role }), 'Instrument role'), nextFields);
      const collection = PROCGEN_SOUND_COLLECTIONS.find(c => c.id === lane.family).roles.find(r => r.id === lane.role);
      labeled('Patch', select(collection.patches.map(p => [p.id, p.name]), lane.patch, patch => selectSound(lane.id, { patch }), 'Sound patch'), nextFields);
      nextFields.append(node('p', `World: ${lane.worldThemeId} · sound: ${lane.instrumentPatchId} · ${lane.linkedThemePresetId === lane.worldThemeId ? 'matching theme suggestion' : 'independent world'} · ${lane.soundChangePolicy === 'new-notes-only' ? 'new notes only; held voices retain their renderer' : 'held crossfade requires adapter support'}`, 'studio-hint'));
      labeled('Patch change policy', select([['new-notes-only', 'New notes only'], ...(lane.soundChangePolicy === 'crossfade-held' ? [['crossfade-held', 'Held crossfade — unsupported by this adapter']] : [])], lane.soundChangePolicy, soundChangePolicy => changeLane({ soundChangePolicy }), 'Patch change policy'), nextFields);
      nextFields.append(button('Select Soft triangle fallback', () => { Promise.resolve().then(() => handlers.selectNativeSound(lane.id, 'foundation.soft-triangle')).catch(error => handlers.status?.(error.message)); }, 'Explicit native oscillator fallback; keeps the world, performance recipe and hardware mapping unchanged'));
      const matchingWorld = button('Apply matching world', () => handlers.applyMatchingWorld?.(lane.id), 'Explicitly stage a physical world rebuild; not a sound edit'); matchingWorld.disabled = !lane.linkedThemePresetId || lane.linkedThemePresetId === lane.worldThemeId; nextFields.append(matchingWorld);
      if (lane.instrumentRef) nextFields.append(node('p', `${lane.instrumentRef.definition.name || lane.instrumentRef.patchId} · saved revision ${lane.instrumentRef.revision}`, 'studio-hint'));
      if (lane.instrumentRef?.definition?.macros?.length) nextFields.append(button('Commit performed macros', () => handlers.commitPerformedMacros?.()), button('Return macros to saved values', () => handlers.returnPerformedMacros?.()));
      const visibleMacroKeys = new Set((lane.instrumentRef?.definition?.macros || []).map(macro => JSON.stringify([lane.id, macro.id])));
      for (const key of macroModes.keys()) if (!visibleMacroKeys.has(key)) macroModes.delete(key);
      for (const macro of lane.instrumentRef?.definition?.macros || []) {
        const macroKey = JSON.stringify([lane.id, macro.id]), mode = macroModes.get(macroKey) || { momentary: !!macro.momentary, pressure: false }; let handle = null;
        const begin = () => handle ||= handlers.beginMacroGesture(lane.id, macro.id, { momentary: mode.momentary || mode.pressure, origin: mode.pressure ? 'pressure' : 'manual' });
        const cancel = () => { const previous = handle; handle = null; if (previous) { try { handlers.finishMacroGesture(previous, { cancel: true }); } catch (error) { handlers.status?.(error.message); } } };
        const control = parameter(lane.instrumentControls?.macros?.[macro.id] ?? macro.default01, value => {
          const previous = begin(); handle = null; handlers.previewMacroGesture(previous, value); handlers.finishMacroGesture(previous);
        }, { id: 'macro:' + macro.id, name: macro.name, quantity: 'authored-performance-macro', unit: 'normalized', min: 0, max: 1, step: 0.01, fineStep: 0.001, defaultValue: macro.default01, detents: macro.bipolar ? [macro.default01] : [] },
        { macroKey, momentary: mode.momentary || mode.pressure, readOnly: macro.mode !== 'onset-only', preview(value, meta) {
          if (meta.phase === 'cancel' || meta.phase === 'return') { cancel(); return; }
          try { const baseline = lane.instrumentControls?.macros?.[macro.id] ?? macro.default01, pressure = mode.pressure && ['pen', 'touch'].includes(meta.pointerType) && meta.normalizedPressure != null
            ? meta.normalizedPressure * (macro.bipolar && value < baseline ? -1 : 1) : null;
          handlers.previewMacroGesture(begin(), value, pressure); } catch (error) { cancel(); handlers.status?.(error.message); }
        }, onCancel: cancel, onFinish: cancel });
        control.title = macro.perceptualDirection;
        labeled(macro.name + ' · next onset', control, nextFields); nextFields.append(node('p', macro.perceptualDirection, 'studio-hint'));
        labeled('Momentary ' + macro.name, input(mode.momentary, momentary => { macroModes.set(macroKey, { ...mode, momentary }); renderInspector(); }, { type: 'checkbox' }), nextFields);
        labeled('Pen/touch pressure ' + macro.name, input(mode.pressure, pressure => { macroModes.set(macroKey, { ...mode, pressure }); renderInspector(); }, { type: 'checkbox' }), nextFields);
        nextFields.append(button('Learn ' + macro.name + ' controller', () => { try { handlers.learnMacro(lane.id, macro.id); } catch (error) { handlers.status?.(error.message); } }, 'Observed MIDI controller with scoped pickup; pressure is normalized model input, not newtons'));
      }
      const variation = lane.instrumentRef?.definition?.variation;
      if (variation) {
        labeled('Identity amount · next onset', input(lane.instrumentControls?.variationAmount01 ?? variation.amount01,
          variationAmount01 => changeLane({ instrumentControls: { ...lane.instrumentControls, variationAmount01 } }), { type: 'range', min: 0, max: 1, step: 0.01 }), nextFields);
        nextFields.append(button('Reroll timbre', () => changeLane({ instrumentControls: { ...lane.instrumentControls,
          variationSeed: ((lane.instrumentControls?.variationSeed ?? variation.seed) + 1) | 0 } }), 'Change only the saved musical seed for future onsets'));
      }
      nextFields.append(button('Sound library…', () => handlers.openSoundLibrary?.(), 'Import, audition, install and explicitly apply a saved instrument'));
      nextFields.append(button('Shape foundry…', () => handlers.openShapeFoundry?.(), 'Prepare an original solid body, prelisten a selected strike site and apply its ordinary saved instrument'));
      labeled('Mode', select([['physical', 'Physical causes'], ['pattern', 'Complementary pattern']], lane.mode, mode =>
        changeLane(mode === 'pattern' ? { mode, patternPurpose: 'Clocked support for physical events' } :
          { mode, patternPurpose: null, patterns: [] }), 'Lane playback mode'), nextFields);
      if (pattern) {
        labeled('Physical purpose', input(lane.patternPurpose || '', patternPurpose => changeLane({ patternPurpose }), { type: 'text' }), nextFields);
        labeled('Pattern length', input(pattern.length, length => changePattern({ length }), { min: 1, max: 64 }), nextFields);
        labeled('Playback rate', select([0.125, 0.25, 0.5, 1, 2, 4, 8].map(v => [v, v + '×']), pattern.rate, value => changePattern({ rate: Number(value) }), 'Lane playback rate'), nextFields);
      } else nextFields.append(node('p', 'This lane follows committed world causes. The Physical tab edits the live instrument mapping.', 'studio-hint'));
      labeled('Level', parameter(lane.gain, gain => changeLane({ gain }), { id: 'lane-gain', name: 'Level', quantity: 'lane-gain', unit: '×', min: 0, max: 2, step: 0.01, defaultValue: 1 }), nextFields);
      labeled('Game accent', parameter(lane.eventAccent, eventAccent => changeLane({ eventAccent }), { id: 'event-accent', name: 'Game accent', quantity: 'event-velocity-multiplier', unit: '×', min: 0, max: 2, step: 0.01, defaultValue: 1 }), nextFields);
      labeled('Pan', parameter(lane.pan, pan => changeLane({ pan }), { id: 'lane-pan', name: 'Pan', quantity: 'stereo-position', unit: 'pan units', min: -127, max: 127, step: 1, fineStep: 1, defaultValue: 0, detents: [0] }), nextFields);
      const events = node('fieldset', null, 'studio-event-mask'); events.append(node('legend', 'Game events'));
      for (const action of ['build', 'bash', 'mine', 'dig', 'fall', 'land', 'spawn']) labeled(action, input(lane.eventMask?.[action] !== false, enabled => changeLane({ eventMask: { ...lane.eventMask, [action]: enabled } }), { type: 'checkbox' }), events);
      nextFields.append(events);
      if (pattern) nextFields.append(button('Reset phrase to this sound', () => handlers.resetPattern?.()));
    } else if (state.tab === 'Physical') {
      nextFields.append(node('p', 'Physical instruments use committed world facts from all actors. Pitch and velocity belong to the physical engine; no preview note is started here.', 'studio-hint'));
      const take = handlers.causalTakeState?.();
      if (take) {
        const controls = node('fieldset', null, 'studio-physical-take');
        controls.append(node('legend', 'Causal take'));
        if (take.physicalRecoveryRequired) {
          controls.append(node('p', 'Physical source coverage was lost. Held voices remain disarmed until you explicitly discard unknown state.', 'studio-hint'));
          const rearm = button('Discard unknown held state and rearm', () => handlers.rearmPhysicalMusic?.());
          rearm.disabled = take.recording || take.starting || take.recovering; controls.append(rearm);
        }
        state.takeNameDraft ||= 'Untitled take'; state.takeMarkerDraft ||= 'Marker';
        labeled('Take name', input(state.takeNameDraft, takeName => {
          state.takeNameDraft = takeName.slice(0, 120); handlers.preferences?.();
        }, { type: 'text', max: 120 }), controls);
        const toggle = button(take.starting ? 'Cancel arming' : take.recovering ? 'Retry saving take' : take.recording ? 'Stop causal take' : 'Record causal take', () =>
          take.starting ? handlers.cancelCausalTakeArm?.() : take.recording || take.recovering ? handlers.stopCausalTake?.() :
            handlers.startCausalTake?.({ takeName: state.takeNameDraft }));
        toggle.disabled = take.stopping;
        controls.append(toggle);
        if (take.recovering && !take.stopping) controls.append(button('Discard unsaved tail', () => handlers.discardCausalTail?.(),
          'Confirm permanent loss of unsaved records and preserve a partial take with its exact omitted range'));
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
          controls.append(button('Render sine WAV…', () => handlers.openCausalAudioRender?.(), 'Render immutable captured intent through a selected sine realization with explicit range, tail and dry stems'));
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
        if (take.branchAvailable && !take.recording && !take.recovering && (take.selectedTakeId || take.last)) {
          const branch = take.workbench, branchControls = node('fieldset', null, 'studio-causal-branch'); branchControls.append(node('legend', 'Take comparison and branch'));
          const boundary = input(state.branchSequenceDraft ?? '', value => { state.branchSequenceDraft = value; }, { type: 'number', min: 0, step: 1, nullable: true });
          boundary.disabled = branch?.busy || !!branch?.active; labeled('Through record (empty = durable end)', boundary, branchControls);
          const options = () => ({ throughSequence: state.branchSequenceDraft === '' || state.branchSequenceDraft == null ? null : Number(state.branchSequenceDraft),
            takeName: (state.takeNameDraft || 'Untitled take').slice(0, 110) + ' branch' });
          if (!branch?.active) {
            const compare = button('Compare in isolated world', () => handlers.compareCausalTake?.(options())); compare.disabled = !!branch?.busy;
            const prepare = button('Prepare physical branch', () => handlers.prepareCausalBranch?.(options())); prepare.disabled = !!branch?.busy; branchControls.append(compare, prepare);
          } else {
            const step = button('Step branch 32 ticks', () => handlers.advanceCausalBranch?.({ ticks: 32 })); step.disabled = !branch.canStep;
            const finish = button('Save and close branch', () => handlers.finishCausalBranch?.()); finish.disabled = !!branch.busy; branchControls.append(step, finish);
            const feedback = button(branch.active.inspection?.physicalLayers ? 'Disarm branch feedback' : 'Regenerate physical feedback', () => branch.active.inspection?.physicalLayers ? handlers.disarmCausalBranchFeedback?.() : handlers.armCausalBranchFeedback?.()); feedback.disabled = !branch.canStep; branchControls.append(feedback);
            if (branch.active.playbackAdmission) {
              const interpretation = button(branch.active.interpretationPlaying ? 'Pause branch interpretation' : 'Enable branch interpretation', () => handlers.setCausalBranchPlayback?.(!branch.active.interpretationPlaying));
              interpretation.disabled = !branch.canStep; branchControls.append(interpretation);
            }
            if (branch.phase === 'recovery-required') branchControls.append(button('Discard unsaved branch tail', () => handlers.finishCausalBranch?.({ discard: true })));
          }
          if (branch?.busy) branchControls.append(button('Cancel comparison / step', () => handlers.cancelCausalWorkbench?.()));
          branchControls.append(node('p', branch?.active ? `${branch.active.takeId} · ${branch.phase} · tick ${branch.active.tick} · ${branch.active.completedBatches} new physical batches · output off` :
            `${branch?.phase || 'idle'} · isolated current-runtime comparison · current project unchanged · output off`, 'studio-hint'));
          if (branch?.receipt?.firstDivergence) branchControls.append(node('p', 'First recorded divergence: ' + JSON.stringify(branch.receipt.firstDivergence).slice(0, 1024), 'studio-hint'));
          controls.append(branchControls);
        }
        if (take.selectedTakeId || take.last) {
          if (take.scoreRetirement) controls.append(node('p', 'Score view resource retirement is unresolved. The stored take is unchanged.', 'studio-hint'));
          state.scoreTimeDomain ||= 'physical-source-time';
          labeled('Score axis', select([['physical-source-time', 'Source time'], ['causal-order', 'Causal order'], ['musical-score-time', 'Musical score time']],
            state.scoreTimeDomain, timeDomain => { state.scoreTimeDomain = timeDomain; handlers.preferences?.(); handlers.readPhysicalScore?.({ timeDomain }); }, 'Physical score time axis'), controls);
          controls.append(button('Read causal score', () => handlers.readPhysicalScore?.({ timeDomain: state.scoreTimeDomain }),
            'Inspect a bounded window of recorded physical facts without playing hardware'));
        }
        if (take.physicalScore) {
          const score = take.physicalScore, scoreList = node('div', null, 'studio-physical-score');
          scoreList.append(node('p', `${score.counts.glyphs} source glyphs · ${score.counts.physicalBatches} captured batches · ${score.unknownRegions.length} uncertain regions · inspection paused`, 'studio-hint'));
          for (const glyph of score.glyphs) {
            const axis = glyph.axis.status === 'known' ? `${glyph.axis.value} ${glyph.axis.unit}` : `${glyph.axis.unit} unavailable`;
            const outcomes = glyph.intents.flatMap(intent => intent.sinkEvidence);
            const evidence = outcomes.length ? outcomes.map(outcome => outcome.status).join(', ') : 'output unknown';
            scoreList.append(button(`Tick ${glyph.source.tick} · ${glyph.factKind} · actor ${glyph.actorId ?? 'world'} · ${axis} · ${glyph.intents.length} intents · ${evidence}`,
              () => handlers.inspectPhysicalScoreCause?.({ sourceSequence: glyph.source.sequence, eventId: glyph.glyphId }),
              'Inspect the exact recorded causal parent of this source fact'));
          }
          if (score.continuation) scoreList.append(button('More source glyphs', () => handlers.readPhysicalScore?.({ timeDomain: state.scoreTimeDomain, more: true })));
          if (take.physicalScoreParent) scoreList.append(node('p', `${take.physicalScoreParent.eventId} · parents ${take.physicalScoreParent.parentCauseIds.join(', ') || 'none recorded'} · command ${take.physicalScoreParent.commandId || 'none recorded'}`, 'studio-hint'));
          controls.append(scoreList);
        }
        nextFields.append(controls);
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
        articulation: sourceKind === 'MotionCommitted' ? instrument.articulation : null, contactTravel: sourceKind === 'ContactSpanBegan' ? instrument.contactTravel : null });
      const renderPhysicalList = () => {
        const needle = (state.physicalSearch || '').trim().toLowerCase();
        const matching = graph.instruments.filter(instrument => `${instrument.id} ${instrument.sourceKind} ${instrument.role}`.toLowerCase().includes(needle));
        const visible = matching.slice(0, 40);
        list.replaceChildren(node('p', `Showing ${visible.length} of ${matching.length} matching instruments${matching.length > visible.length ? ' · refine the search' : ''}.`, 'studio-hint'));
        for (const instrument of visible) {
          const group = node('fieldset', null, 'studio-physical-instrument');
          group.dataset.controlKey = 'instrument:' + instrument.id; group.dataset.mappingId = instrument.id; group.append(node('legend', instrument.id));
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
          labeled('Sample gesture', input(instrument.sampleGesture || '', value => changePhysicalInstrument(instrument.id, { sampleGesture: value.trim() || null }),
            { type: 'text' }), group);
          labeled('Sample kit', input(instrument.sampleKitId || '', value => changePhysicalInstrument(instrument.id, { sampleKitId: value.trim() || null }),
            { type: 'text' }), group);
          list.append(group);
        }
      };
      search.dataset.fieldKey = 'Physical:search'; search.id = 'studio-field-' + encodeURIComponent(parameterScope + ':Physical:search');
      const searchChanged = event => { state.physicalSearch = event.currentTarget.value; render({ partial: true }); };
      controlTree.bind(search, { change: searchChanged, input: searchChanged });
      nextFields.append(search, list); renderPhysicalList();
    } else if (state.tab === 'Step' || state.tab === 'Chord') {
      labeled('Trigger', input(step.enabled, enabled => changeStep({ enabled }), { type: 'checkbox' }), nextFields);
      labeled('Scale degree', input(step.degree, degree => changeStep({ degree }), { min: -56, max: 56 }), nextFields);
      labeled('Fixed MIDI note', input(step.note ?? '', note => changeStep({ note }), { min: 0, max: 127, nullable: true }), nextFields);
      labeled('Velocity', input(step.velocity, velocity => changeStep({ velocity }), { min: 1, max: 127 }), nextFields);
      labeled('Duration / beats', input(step.duration, duration => changeStep({ duration }), { min: 0.01, max: 32, step: 0.0625 }), nextFields);
      labeled('Probability %', input(Math.round(step.probability * 100), value => changeStep({ probability: value / 100 }), { min: 0, max: 100 }), nextFields);
      labeled('Chance counter', select(['event', 'pass', 'bar'], step.probabilityBasis, probabilityBasis => changeStep({ probabilityBasis }), 'Probability counter'), nextFields);
      labeled('Condition', select(['none', 'event', 'pass', 'bar', 'terrain', 'action'], step.condition?.kind || 'none', kind => changeStep({ condition: kind === 'none' ? null : { kind, value: kind === 'terrain' ? 'ground' : kind === 'action' ? 'walk' : '', every: 2, offset: 0 } }), 'Step condition'), nextFields);
      if (step.condition) {
        if (['terrain', 'action'].includes(step.condition.kind)) {
          const choices = step.condition.kind === 'terrain' ? ['ground', 'gap', 'wall', 'steel', 'hazard'] : ['walk', 'build', 'bash', 'mine', 'dig', 'fall', 'jump', 'climb', 'float', 'block', 'idle'];
          if (step.condition.value && !choices.includes(step.condition.value)) choices.push(step.condition.value);
          labeled('Match', select(choices, step.condition.value, value => changeStep({ condition: { ...step.condition, value } }), 'Observed condition match'), nextFields);
        }
        else { labeled('Every', input(step.condition.every, every => changeStep({ condition: { ...step.condition, every } }), { min: 1, max: 64 }), nextFields); labeled('Offset', input(step.condition.offset, offset => changeStep({ condition: { ...step.condition, offset } }), { min: 0, max: 63 }), nextFields); }
      }
      labeled('Repeats', input(step.repeats, repeats => changeStep({ repeats }), { min: 1, max: 8 }), nextFields);
      for (const key of ['tie', 'hold']) labeled(key, input(step[key], value => changeStep({ [key]: value }), { type: 'checkbox' }), nextFields);
      labeled('Chord', input(!!step.chord, value => changeStep({ chord: value ? { degrees: [0, 2, 4], inversion: 0, spread: 0 } : null }), { type: 'checkbox' }), nextFields);
      if (step.chord) {
        labeled('Chord degrees', input(step.chord.degrees.join(', '), value => changeStep({ chord: { ...step.chord, degrees: value.split(',').map(Number).filter(Number.isFinite) } }), { type: 'text' }), nextFields);
        labeled('Inversion', input(step.chord.inversion, inversion => changeStep({ chord: { ...step.chord, inversion } }), { min: -7, max: 7 }), nextFields);
        labeled('Spread / octaves', input(step.chord.spread, spread => changeStep({ chord: { ...step.chord, spread } }), { min: 0, max: 3 }), nextFields);
        const pitches = procgenStepNotes(step, resolveProcgenSound(lane.family, lane.role, lane.patch), getProject().global.scale).map(note => note % 12);
        const keys = node('div', null, 'studio-keyboard'); for (let i = 0; i < 12; i++) { const key = node('i', NOTES[i]); key.className = [1, 3, 6, 8, 10].includes(i) ? 'black' : ''; if (pitches.includes(i)) key.classList.add('lit'); keys.append(key); } nextFields.append(keys);
      }
    } else if (state.tab === 'MIDI') {
      const ports = handlers.devices?.() || { inputs: [], outputs: [] };
      labeled('Input', select([['', 'None'], ...ports.inputs.map(p => [p.id, p.name || p.id])], state.inputId || '', id => handlers.input?.(id), 'MIDI input'), nextFields);
      labeled('Lane output', select([['', 'Default output'], ...ports.outputs.map(p => [p.id, p.name || p.id])], lane.outputId || '', outputId => changeLane({ outputId: outputId || null }), 'Lane MIDI output'), nextFields);
      midiRouteView ||= createMidiRouteDiagnostics({ document, onPolicy: policy => handlers.midiRoutePolicy?.(policy) });
      midiRouteView.element.__ownedControl = true; nextFields.append(midiRouteView.element.isConnected ? controlTree.retain(midiRouteView.element) : midiRouteView.element);
      labeled('Channel', input(lane.channel, channel => changeLane({ channel }), { min: 1, max: 16 }), nextFields);
      labeled('Clock output', select([['', 'Off'], ...ports.outputs.map(p => [p.id, p.name || p.id])], state.clockOutputId || '', id => handlers.clockOutput?.(id), 'MIDI clock output'), nextFields);
      labeled('MIDI Thru', input(state.thru, value => handlers.thru?.(value), { type: 'checkbox' }), nextFields);
      labeled('Owned external program (zero based)', input(lane.externalProgram ?? '', externalProgram => changeLane({ externalProgram }), { min: 0, max: 127, nullable: true }), nextFields);
      labeled('External percussion mapping', input(lane.externalPercussion, externalPercussion => changeLane({ externalPercussion }), { type: 'checkbox' }), nextFields);
      for (const [key, title] of [['bankMSB', 'Bank MSB'], ['bankLSB', 'Bank LSB']]) labeled(title, input(lane[key] ?? '', value => changeLane({ [key]: value }), { min: 0, max: 127, nullable: true }), nextFields);
      nextFields.append(button('Connect MIDI', () => handlers.connect?.()),
        ...(pattern ? [button('Learn step note', () => handlers.learn?.())] : []),
        node('p', 'Clock and note routing are independent. Incoming clock is never echoed.', 'studio-hint'));
      for (const [type, title, low, high] of [['sustain', 'Sustain', 0, 127], ['bend', 'Pitch bend', -8192, 8191], ['pressure', 'Pressure', 0, 127]]) {
        const target = { type, laneId: lane.id, channel: lane.channel, outputId: lane.outputId }, evidence = handlers.expressionState?.(target);
        const group = node('div', null, 'studio-midi-expression'); group.dataset.controlKey = 'midi-expression:' + (evidence?.targetKey || type);
        const control = labeled(title, input(evidence?.requestedValue ?? '', value => {
          const result = handlers.expression?.({ ...target, value, targetKey: evidence?.targetKey });
          if (result !== false) return result;
          const current = handlers.expressionState?.(target); return current?.targetKey === evidence?.targetKey && current?.requestedValue === value;
        }, {
          min: low, max: high, step: 1, placeholder: 'Unknown', getIdentity: () => handlers.expressionState?.(target)?.targetKey || null }), group);
        control.disabled = !evidence?.targetKey || evidence.canRequest === false;
        const submitted = evidence?.submittedValue == null ? '' : 'API submission ' + evidence.submittedValue;
        const state = node('output', evidence?.requestedValue == null ? 'No request observed; receiver state unknown.' :
          `Last request ${evidence.requestedValue}; ${evidence.delivery === 'submitted' ? submitted + ' accepted' : evidence.delivery === 'requested' ? 'submission pending' : 'submission unconfirmed' + (submitted ? '; earlier ' + submitted : '')}; receiver state unknown.`);
        state.setAttribute('aria-label', title + ' request evidence'); state.dataset.evidenceState = evidence?.delivery || 'unknown'; group.append(state); nextFields.append(group);
      }
      nextFields.append(node('output', state.lastMidi || 'No input received', 'studio-midi-monitor'));
      nextFields.append(node('p', pattern ? (state.inputId ? `Input ready · recording targets ${lane.name}, phrase ${state.slot + 1}.` :
        'Connect and select a MIDI input to record notes or learn a step.') :
        'Physical instruments use committed world facts. MIDI input remains available for transport and capture.', 'studio-hint'));
    } else if (state.tab === 'World') {
      nextFields.append(button('Reroll world', () => handlers.reroll?.()), button('Replay seed', () => handlers.replay?.()));
      labeled('Seed', input(getRuntime()?.world?.seed || 0, seed => handlers.seed?.(seed), { min: 0, max: 4294967295 }), nextFields);
      labeled('Trap spacing / pixels', input(state.hazardSpacing, value => { handlers.rebuild?.({ hazardSpacing: value }); }, { min: 80, max: 1024, step: 16 }), nextFields);
      labeled('Minimum display row', input(state.minimumRow, value => { state.minimumRow = value; layout(); renderRows(); }, { min: 56, max: 220, step: 4 }), nextFields);
      const observe = patch => { Object.assign(state, { observerMode: patch.mode ?? state.observerMode, observerLane: patch.laneId ?? state.observerLane, observerHold: patch.holdSeconds ?? state.observerHold }); handlers.observe?.(patch); handlers.preferences?.(); };
      labeled('Observer', select([['overview', 'Overview'], ['follow', 'Follow lane'], ['director', 'Automatic director']], state.observerMode || 'overview', mode => observe({ mode }), 'Observer mode'), nextFields);
      labeled('Follow lane', select(getProject().procgen.lanes.map(item => [item.id, item.name]), state.observerLane || lane.id, laneId => observe({ laneId }), 'Observer lane'), nextFields);
      labeled('Director hold / seconds', input(state.observerHold || 8, holdSeconds => observe({ holdSeconds }), { min: 2, max: 60 }), nextFields);
      nextFields.append(node('p', 'Scenery grows ahead through a dithered reveal. The world is shared; each lane keeps its own visual and musical character.', 'studio-hint'), button('Advanced world controls', () => byId('procgenTab')?.click()));
    } else if (state.tab === 'Automation') {
      nextFields.append(node('p', 'Controller curves repeat with musical beats or the observed lane frontier. Points are position:value pairs.', 'studio-hint'));
      const curves = lane.ccAutomation || [];
      const update = (id, patch) => changeLane({ ccAutomation: curves.map(curve => curve.id === id ? { ...curve, ...patch } : curve) });
      for (const curve of curves) {
        const group = node('fieldset', null, 'studio-automation-curve'); group.dataset.controlKey = 'curve:' + curve.id; group.append(node('legend', `CC ${curve.controller} · ${curve.id}`));
        labeled('Enabled', input(curve.enabled, enabled => update(curve.id, { enabled }), { type: 'checkbox' }), group);
        labeled('Controller', input(curve.controller, controller => update(curve.id, { controller }), { min: 0, max: 127 }), group);
        labeled('Position', select([['beat', 'Beats'], ['distance', 'World pixels']], curve.axis, axis => update(curve.id, { axis }), 'Automation position'), group);
        labeled('Loop length', input(curve.length, length => update(curve.id, { length }), { min: 0.25, max: 65536, step: 0.25 }), group);
        labeled('Curve', select(['linear', 'step'], curve.mode, mode => update(curve.id, { mode }), 'Automation curve'), group);
        group.append(automationEditor(lane, curve));
        group.append(button('Remove curve', () => changeLane({ ccAutomation: curves.filter(item => item.id !== curve.id) }))); nextFields.append(group);
      }
      if (curves.length < 16) nextFields.append(button('Add CC curve', () => { let index = 1; while (curves.some(curve => curve.id === `cc-${index}`)) index++; changeLane({ ccAutomation: [...curves, { id: `cc-${index}`, controller: 74, length: 4, points: [{ beat: 0, value: 32 }, { beat: 2, value: 100 }, { beat: 4, value: 32 }] }] }); }));
      const automation = byId('procgenSpanControls') || byId('procgenSpanFields');
      if (automation) nextFields.append(button('Open automation editor', () => { byId('procgenTab')?.click(); automation.scrollIntoView?.({ block: 'center' }); }));
      nextFields.append(button('Record MIDI CC', () => { handlers.record?.(true); handlers.status?.('MIDI recording armed. CC events are captured with the performance.'); }));
    } else if (state.tab === 'Selection') {
      nextFields.append(node('p', 'World selection uses the accepted physical presentation. No accepted inspection source is attached to this view.', 'studio-hint'));
    }
    controlTree.reconcile(tabs, nextTabs, 'tabs:' + JSON.stringify([getDocumentIdentity(), !!pattern]));
    controlTree.reconcile(fields, nextFields, parameterScope);
    for (const entry of curveEditors.values()) if (entry.laneId === state.laneId) { const curve = lane.ccAutomation.find(curve => curve.id === entry.curveId); if (curve) entry.control.update(curve); }
    for (const [id, entry] of parameterCache) if (!parameterSeen.has(id)) {
      entry.control.dispose(); parameterControls.splice(parameterControls.indexOf(entry.control), 1); parameterCache.delete(id);
    }
    parameterSeen = null; refreshMidiRoute();

  }
  function layout(measured = null) {
    if (disposed) return;
    const width = Math.max(1, measured?.width ?? stage.clientWidth), height = Math.max(1, measured?.height ?? stage.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const laneCount = getProject().procgen.lanes.length, physicalHeight = getRuntime()?.world?.laneHeight || 144;
    const minimumRow = Math.max(getProject().procgen.lanes.some(lane => lane.mode === 'pattern') ? 144 : 116, state.minimumRow);
    const key = JSON.stringify([width, height, dpr, laneCount, state.firstLane, state.layout, physicalHeight, minimumRow, state.workspaceMode, state.dockHeight]);
    const changed = key !== layoutKey;
    if (changed) {
      projection = createProcgenLaneProjection({ laneCount, height, firstLane: state.firstLane, mode: state.layout, physicalHeight, minimumRow });
      state.firstLane = projection.firstLane;
      layoutKey = JSON.stringify([width, height, dpr, laneCount, state.firstLane, state.layout, physicalHeight, minimumRow, state.workspaceMode, state.dockHeight]);
      shell.dataset.layout = state.layout; shell.style.setProperty('--row-height', projection.rowHeight + 'px');
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    }
    const renderer = getRuntime()?.lanes?.renderer || null;
    const rendererChanged = renderer !== attachedRenderer;
    if (renderer !== attachedRenderer) detachRenderer();
    if (renderer && !superseded) {
      if (!attachedRenderer) {
        const previous = rendererLeases.get(renderer);
        previous?.relinquish();
        rendererLeases.set(renderer, { owner, baseLayout: previous ? previous.baseLayout : renderer.workstationLayout,
          baseFrame: previous ? previous.baseFrame : renderer.onWorkstationFrame, relinquish: () => { superseded = true; cancelPresentationGestures('view-replaced'); causalView.bind(null); attachedRenderer = null; } });
        attachedRenderer = renderer;
        causalView.bind(renderer);
      }
      renderer.workstationLayout = projection; renderer.onWorkstationFrame = frame; if (changed || rendererChanged) renderer.resize({ width: Math.max(1, Math.floor(width * dpr)), height: Math.max(1, Math.floor(height * dpr)) });
    }
    return changed || rendererChanged;
  }
  const createLaneFader = (laneId, value, documentIdentity) => {
    const token = {};
    return createParameterKnob({ document, window, presentation: 'fader', value, compact: true, contextName: laneId + ' · Level', compactLabel: 'Level / dB',
      compactFormat: gain => gain === 0 ? '−∞' : (20 * Math.log10(gain)).toFixed(1),
      focusFallback: () => lanes.querySelector('.selected .studio-lane-title') || dock.toggle, onEntryActivity: () => { if (!disposed) laneMixSurface.invalidate(); },
      descriptor: { id: 'lane-fader:' + laneId, name: 'Level', quantity: 'lane-gain', unit: 'dB', min: 0, max: 2, step: 0.01, fineStep: 0.001, defaultValue: 1, detents: [1],
        format: formatLaneGain, formatInput: value => value === 0 ? '-inf' : (20 * Math.log10(value)).toFixed(2), parse: parseLaneGain },
      getIdentity: () => !disposed && !superseded && getDocumentIdentity() === documentIdentity && procgenLane(getProject().procgen.lanes, laneId) ? token : null,
      onCancel: reason => { if (reason === 'external-edit') status.textContent = 'Lane level changed outside this gesture; its draft was canceled.'; }, commit: gain => dispatch({ type: 'procgen/lane', laneId, patch: { gain } }) });

  };
  const createLanePan = (laneId, value, documentIdentity) => {
    const token = {};
    return createParameterKnob({ document, window, value, compact: true, contextName: laneId + ' · Pan',
      descriptor: { id: 'lane-pan:' + laneId, name: 'Pan', quantity: 'stereo-position', unit: 'pan units', min: -127, max: 127, step: 1, fineStep: 0.1, defaultValue: 0, detents: [0],
        format: pan => pan === 0 ? 'Center' : `${Math.abs(Number(pan.toFixed(1)))} ${pan < 0 ? 'L' : 'R'}`,
        parse: text => { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Enter a signed decimal pan position.'); return Number(text); } },
      getIdentity: () => !disposed && !superseded && getDocumentIdentity() === documentIdentity && procgenLane(getProject().procgen.lanes, laneId) ? token : null,
      focusFallback: () => lanes.querySelector('.selected .studio-lane-title') || dock.toggle, onEntryActivity: () => { if (!disposed) laneMixSurface.invalidate(); },
      onCancel: reason => { if (reason === 'external-edit') status.textContent = 'Lane pan changed outside this gesture; its draft was canceled.'; },
      commit: pan => dispatch({ type: 'procgen/lane', laneId, patch: { pan } }) });
  };
  function renderRows({ laneIds = null } = {}) {
    if (!projection) return;
    queuedBeat = null; playheadSurface.invalidate();
    const nextLanes = node('div'), nextGrid = node('div'), visibleIds = new Set(), documentIdentity = getDocumentIdentity();
    if (mixDocumentIdentity !== documentIdentity) {
      for (const control of laneMixControls.values()) control.dispose(); laneMixControls.clear();
      for (const control of lanePanControls.values()) control.dispose(); lanePanControls.clear();
      for (const display of laneDisplays.values()) display.dispose(); laneDisplays.clear(); laneDisplayPages.clear();
      laneDisplayDialog.close(); laneDisplayDetails.textContent = ''; mixDocumentIdentity = documentIdentity;
    }
    const place = (parent, child) => (parent === lanes ? nextLanes : nextGrid).append(child);
    const project = getProject();
    laneRange.textContent = `${projection.firstLane + 1}–${projection.firstLane + projection.count} of ${project.procgen.lanes.length}`;
    previousLanes.disabled = projection.firstLane === 0; nextLanes.disabled = projection.firstLane + projection.count >= project.procgen.lanes.length;
    for (let row = 0; row < projection.count; row++) {
      const laneIndex = projection.firstLane + row, lane = project.procgen.lanes[laneIndex], displaySlot = state.laneId === lane.id ? state.slot : lane.activeSlot, pattern = lane.mode === 'pattern' ? lane.patterns[displaySlot] : null;
      visibleIds.add(lane.id);
      if (laneIds && !laneIds.includes(lane.id)) {
        const previousHeader = [...lanes.children].find(item => item.dataset.laneId === lane.id), previousRow = [...grid.children].find(item => item.dataset.laneId === lane.id);
        if (previousHeader && previousRow) { nextLanes.append(controlTree.retain(previousHeader)); nextGrid.append(controlTree.retain(previousRow)); continue; }
      }
      const header = node('section', null, 'studio-lane-header'); header.dataset.laneId = lane.id; header.dataset.controlKey = 'lane:' + lane.id; header.style.setProperty('--lane-color', COLORS[laneIndex % 8]); header.classList.toggle('selected', state.laneId === lane.id);
      const label = button(`${laneIndex + 1} · ${lane.name}`, () => { state.laneId = lane.id; state.slot = lane.activeSlot; state.tab = 'Lane'; render(); }, lane.name); label.className = 'studio-lane-title'; label.setAttribute('aria-label', `Lane ${laneIndex + 1}: ${lane.name}`); label.setAttribute('aria-pressed', String(state.laneId === lane.id));
      const controls = node('div', null, 'studio-lane-mini');
      for (const [key, text] of [['solo', 'S'], ['mute', 'M']]) { const el = button(text, () => dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { [key]: !procgenLane(getProject().procgen.lanes, lane.id)?.[key] } }), `${key} ${lane.name}`); el.dataset.laneControl = key; el.setAttribute('aria-pressed', String(lane[key])); controls.append(el); }
      const slots = node('div', null, 'studio-slots');
      if (pattern) for (let slot = 0; slot < 4; slot++) { const el = button(String(slot + 1), () => { state.laneId = lane.id; state.slot = slot; dispatch({ type: 'procgen/launch', laneId: lane.id, slot }); }, `Launch phrase ${slot + 1} on next bar`); el.setAttribute('aria-pressed', String(lane.activeSlot === slot)); el.classList.toggle('queued', lane.queuedSlot === slot); slots.append(el); }
      else slots.hidden = true;
      const fader = laneMixControls.get(lane.id) || createLaneFader(lane.id, lane.gain, documentIdentity);
      fader.element.classList.add('studio-lane-fader'); fader.element.dataset.laneId = lane.id; fader.element.dataset.controlKey = 'fader:' + lane.id; fader.element.__ownedControl = true; laneMixControls.set(lane.id, fader);
      fader.setState({ value: lane.gain, effectiveValue: handlers.laneMixView?.(lane.id)?.effectiveGain ?? null });
      const pan = lanePanControls.get(lane.id) || createLanePan(lane.id, lane.pan, documentIdentity);
      pan.element.classList.add('studio-lane-pan'); pan.element.dataset.laneId = lane.id; pan.element.dataset.controlKey = 'pan:' + lane.id; pan.element.__ownedControl = true; lanePanControls.set(lane.id, pan); pan.setState({ value: lane.pan });
      const display = laneDisplays.get(lane.id) || createLaneDisplayView({ document, laneId: lane.id }); laneDisplays.set(lane.id, display);
      display.element.dataset.controlKey = 'display:' + lane.id; display.element.__ownedControl = true;
      const performance = node('div', null, 'studio-lane-performance'); performance.dataset.controlKey = 'performance:' + lane.id;
      performance.append(display.element.isConnected ? controlTree.retain(display.element) : display.element, fader.element.isConnected ? controlTree.retain(fader.element) : fader.element, pan.element.isConnected ? controlTree.retain(pan.element) : pan.element);
      header.append(label, controls, performance, slots); place(lanes, header);
      const sequence = node('div', null, 'studio-sequence'); sequence.dataset.laneId = lane.id; sequence.dataset.controlKey = 'row:' + lane.id + ':' + displaySlot; sequence.dataset.slot = displaySlot; sequence.style.setProperty('--lane-color', COLORS[laneIndex % 8]); sequence.style.gridTemplateColumns = `repeat(${pattern?.length || 1}, minmax(0, 1fr))`;
      sequence.style.top = (row * projection.rowHeight + projection.rowHeight - (state.layout === 'strip' ? 25 : Math.min(44, projection.rowHeight * 0.48))) + 'px';
      sequence.style.height = (state.layout === 'strip' ? 25 : Math.min(44, projection.rowHeight * 0.48)) + 'px';
      if (!pattern) {
        sequence.classList.add('studio-physical-row');
        sequence.style.gridTemplateColumns = '1fr';
        sequence.append(node('span', 'Physical causes · live world', 'studio-physical-label'));
        place(grid, sequence);
        continue;
      }
      for (let index = 0; index < pattern.length; index++) {
        const step = pattern.steps[index], cell = button(step.tie ? '―' : step.enabled ? step.chord ? '◆' : '●' : '·', event => {
          if (state.tool !== 'select' && event?.detail > 0) return;
          state.laneId = lane.id; state.step = index; state.slot = displaySlot; state.tab = procgenLane(getProject().procgen.lanes, lane.id)?.patterns[displaySlot]?.steps[index]?.chord ? 'Chord' : 'Step';
          if (state.tool !== 'select') dispatch({ type: 'procgen/step', laneId: lane.id, slot: state.slot, index, patch: { enabled: state.tool === 'draw' } }); else render();
        }, `${lane.role}, step ${index + 1}, ${step.enabled ? 'on' : 'off'}, probability ${Math.round(step.probability * 100)}%`);
        cell.className = 'studio-cell'; cell.dataset.index = index; cell.dataset.controlKey = 'step:' + index; cell.classList.toggle('enabled', step.enabled); cell.classList.toggle('conditional', !!step.condition || step.probability < 1); cell.classList.toggle('selected', state.laneId === lane.id && state.step === index); cell.setAttribute('aria-pressed', String(step.enabled));
        cell.addEventListener('dblclick', () => {
          if (disposed || !cell.isConnected || state.tool !== 'select') return;
          const current = getProject().procgen.lanes.find(item => item.id === lane.id)?.patterns[displaySlot]?.steps[index];
          if (current) dispatch({ type: 'procgen/step', laneId: lane.id, slot: displaySlot, index, patch: { enabled: !current.enabled } });
        });
        sequence.append(cell);
      }
      place(grid, sequence);
    }
    const identity = 'rows:' + JSON.stringify(documentIdentity);
    controlTree.reconcile(lanes, nextLanes, identity); controlTree.reconcile(grid, nextGrid, identity);
    for (const [id, control] of laneMixControls) if (!visibleIds.has(id)) { control.dispose(); laneMixControls.delete(id); }
    for (const [id, control] of lanePanControls) if (!visibleIds.has(id)) { control.dispose(); lanePanControls.delete(id); }
    for (const [id, display] of laneDisplays) if (!visibleIds.has(id)) { display.dispose(); laneDisplays.delete(id); }
    paintLaneDisplays();
  }
  function frame(beat = state.beat || 0) {
    if (disposed || superseded) return;
    if (beat === queuedBeat) return; queuedBeat = beat;
    playheadSurface.publish(Object.freeze({ beat })); laneMixSurface.invalidate();
  }
  function paintPlayheads(_measured, packet) {
    if (disposed || superseded) return;
    const beat = packet.value?.beat ?? state.beat ?? 0, byId = currentLaneIndex();
    for (const row of grid.children) {
      const lane = byId.get(row.dataset.laneId); if (!lane) continue;
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
    if (curveDocumentIdentity !== getDocumentIdentity()) { for (const entry of curveEditors.values()) entry.control.dispose(); curveEditors.clear(); curveDocumentIdentity = getDocumentIdentity(); }
    for (const [key, entry] of curveEditors) if (!procgenLane(getProject().procgen.lanes, entry.laneId)?.ccAutomation.some(curve => curve.id === entry.curveId)) { entry.control.dispose(); curveEditors.delete(key); }
    dock.update();
    selected(); handlers.reconcileSoundPreview?.(); controlTree.update(layoutMode, state.layout, { identity: getDocumentIdentity() }); controlTree.update(root, String(getProject().global.scale.root), { identity: getDocumentIdentity() });
    const current = getProject().global.scale;
    const matched = Object.keys(SCALES).find(name => JSON.stringify(SCALES[name]) === JSON.stringify(current.degrees));
    if (!matched && ![...scale.options].some(option => option.value === current.name)) { const option = node('option', current.name); option.value = current.name; scale.append(option); }
    controlTree.update(scale, matched || current.name, { identity: getDocumentIdentity() });
    if (!partial) { layout(); renderRows(); }
    renderInspector();
    operationalSurface.invalidate(); laneMixSurface.invalidate(); records.setAttribute('aria-pressed', String(!!state.recording));
  }

  function patchStep(action) {
    if (disposed) return;
    const lane = procgenLane(getProject().procgen.lanes, action.laneId);
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
    if (state.laneId === action.laneId) render({ partial: true });
  }
  function patchProject(action, change) {
    if (disposed || !action) return;
    if (action.type === 'procgen/step') { patchStep(action); return; }
    if (change.structural || action.type === 'procgen/seed') { render(); return; }
    if (['procgen/palette', 'procgen/pattern'].includes(action.type) || change.fields.some(key => ['family', 'role', 'mode', 'patterns'].includes(key))) {
      const geometryChanged = layout(); renderRows(geometryChanged ? {} : { laneIds: change.laneIds });
    }
    else for (const id of change.laneIds) {
      const lane = procgenLane(getProject().procgen.lanes, id), header = [...lanes.children].find(item => item.dataset.laneId === id);
      if (!lane || !header) continue;
      laneMixControls.get(id)?.setState({ value: lane.gain, effectiveValue: handlers.laneMixView?.(id)?.effectiveGain ?? null });
      lanePanControls.get(id)?.setState({ value: lane.pan });
      for (const control of header.querySelectorAll('[data-lane-control]')) control.setAttribute('aria-pressed', String(lane[control.dataset.laneControl]));
      for (const [slot, control] of [...header.querySelector('.studio-slots').children].entries()) {
        control.setAttribute('aria-pressed', String(slot === lane.activeSlot)); control.classList.toggle('queued', slot === lane.queuedSlot);
      }
    }
    laneMixSurface.invalidate();
    if (!change.laneIds.length || change.laneIds.includes(state.laneId)) render({ partial: true });
  }
  on(lanes, 'wheel', event => { if (event.defaultPrevented) return; if (getProject().procgen.lanes.length <= projection.count) return; event.preventDefault(); state.firstLane += Math.sign(event.deltaY); layout(); renderRows(); }, { passive: false });
  on(lanes, 'keydown', event => {
    if (event.defaultPrevented || event.target?.closest?.('.parameter-knob')) return;
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
    const source = getProject(), transform = projection;
    const lease = pointerArbiter.acquire({ pointerId: event.pointerId, targetKey: `pattern:${lane.id}:${slot}`, identity: source,
      getIdentity: () => getProject() === source && projection === transform ? source : null,
      onCancel: () => { stroke = null; try { grid.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ } if (!disposed) renderRows(); } });
    if (!lease) return;
    stroke = { lease, pointerId: event.pointerId, laneId: lane.id, slot, steps: lane.patterns[slot].steps.slice(), enabled: state.tool === 'draw', changed: false };
    grid.setPointerCapture?.(event.pointerId);
    state.laneId = lane.id; state.slot = slot; state.tab = 'Step'; paint(cell);
  });
  on(window, 'pointermove', event => { if (stroke?.lease.owns(event)) paint(document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.studio-cell')); });
  on(window, 'pointerup', event => {
    if (!stroke?.lease.finish(event)) return;
    const completed = stroke; stroke = null; try { grid.releasePointerCapture?.(completed.pointerId); } catch { /* Capture may already be released. */ }
    if (completed.changed) dispatch({ type: 'procgen/pattern', laneId: completed.laneId, slot: completed.slot, patch: { steps: completed.steps } });
    else render();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) on(window, type, event => { if (stroke?.lease.owns(event)) stroke.lease.cancel(type); });
  on(window, 'blur', () => stroke?.lease.cancel('blur'));
  on(document, 'keydown', event => { if (event.key === 'Escape' && stroke) { event.preventDefault(); event.stopPropagation(); stroke.lease.cancel('escape'); } });
  const layoutSurface = displayScheduler.register({ id: 'workstation-layout', element: stage, intervalMs: 0,
    read: () => ({ width: stage.clientWidth, height: stage.clientHeight }), write: measured => { if (layout(measured)) renderRows(); },
    onError: message => { displayStatus.classList.remove('visually-hidden'); displayStatus.textContent = message; } });
  const playheadSurface = displayScheduler.register({ id: 'workstation-playheads', element: grid, intervalMs: 32, write: paintPlayheads });
  function focusedDisplayControl(laneId) {
    const active = document.activeElement, knob = active?.closest?.('[data-parameter-id]');
    if (knob && (knob.closest('[data-lane-id]')?.dataset.laneId || state.laneId) === laneId) {
      const name = knob.dataset.parameterName || knob.querySelector('.parameter-knob-label')?.textContent || 'Parameter';
      return { name, value: active.matches('input') ? active.value : knob.querySelector('.parameter-knob-value')?.textContent || knob.querySelector('.parameter-knob-number')?.value,
        error: active.getAttribute('aria-invalid') === 'true' ? knob.querySelector('.parameter-knob-error')?.textContent || 'Invalid parameter draft' : null };
    }
    const field = active?.closest?.('.studio-field'), name = field?.querySelector('span')?.textContent;
    return laneId === state.laneId && active?.matches?.('input') && ['Sustain', 'Pitch bend', 'Pressure'].includes(name) ? { name, value: active.value } : null;
  }
  function readLaneDisplayValues() {
    const ids = [...laneDisplays.keys()]; if (!ids.includes(state.laneId)) ids.push(state.laneId);
    return handlers.laneDisplayState?.(ids) || ids.map(id => ({ lane: procgenLane(getProject().procgen.lanes, id), mix: handlers.laneMixView?.(id), evidence: { available: true } })).filter(value => value.lane);
  }
  function paintLaneDisplays() {
    if (disposed || !projection) return;
    const values = readLaneDisplayValues();
    controlTree.update(displayPage, laneDisplayPages.get(state.laneId) || 'identity', { identity: getDocumentIdentity() });
    for (const value of values) {
      const snapshot = createLaneDisplaySnapshot({ ...value, page: laneDisplayPages.get(value.lane.id) || 'identity', activeControl: focusedDisplayControl(value.lane.id) });
      laneDisplays.get(value.lane.id)?.update(snapshot);
      if (value.lane.id === state.laneId && laneDisplayDetails.textContent !== snapshot.detail) laneDisplayDetails.textContent = snapshot.detail;
    }
    causalView.render(values);
  }
  const laneMixSurface = displayScheduler.register({ id: 'workstation-lane-mix', element: lanes, intervalMs: 100, write: () => {
    for (const [id, control] of laneMixControls) {
      const mix = handlers.laneMixView?.(id), lane = procgenLane(getProject().procgen.lanes, id); if (!mix || !lane) continue;
      if (control.inspect().gestureId == null) control.setState({ value: lane.gain, effectiveValue: mix.effectiveGain });
    }
    for (const [id, control] of lanePanControls) { const lane = procgenLane(getProject().procgen.lanes, id); if (lane && control.inspect().gestureId == null) control.setState({ value: lane.pan }); }
    paintLaneDisplays();
  } });
  for (const type of ['focusin', 'focusout', 'input', 'keydown', 'pointermove', 'pointerup', 'pointercancel']) on(shell, type, () => laneMixSurface.invalidate());
  const macroSurface = displayScheduler.register({ id: 'workstation-macro-pickup', element: fields, intervalMs: 50, write: refreshMacroState });
  function refreshMidiRoute() {
    if (!midiRouteView) return;
    const lane = procgenLane(getProject().procgen.lanes, state.laneId);
    midiRouteView.update({ midi: midiRouteState || handlers.midiRouteState?.() || {}, output: handlers.outputState?.() || {}, outputId: lane?.outputId, mpe: getProject().global?.mpe || {} });
  }
  const midiSurface = displayScheduler.register({ id: 'workstation-midi', element: fields, intervalMs: 50, write: () => {
    const monitor = fields.querySelector('.studio-midi-monitor'); if (monitor && monitor.textContent !== state.lastMidi) monitor.textContent = state.lastMidi;
    refreshMidiRoute();
  } });
  const paintTransport = position => {
    if (!position || disposed || position.documentIdentity !== getDocumentIdentity()) return;
    bpm.disabled = position.clockSource === 'external';
    controlTree.update(bpm, String(Math.round((position.clockSource === 'external' ? position.bpm : position.baseBpm ?? position.bpm) * 100) / 100), { identity: getDocumentIdentity() });
    const meter = quarterMeterPosition(position.beat, getProject().transport?.timeSignature);
    const text = meter ? `${meter.bar} : ${meter.beat}` : '—'; if (clockStatus.textContent !== text) clockStatus.textContent = text;
    clockStatus.title = meter ? `${meter.beats}/${meter.unit} · bar : denominator-note beat · ${position.beat} quarters` : 'Musical position unavailable';
    clockHealth.textContent = position.clockSource === 'external' ? `MIDI clock · ${position.clockStatus}` : 'Internal clock';
    for (const [control, value] of [[linked, position.linked], [speedMode, position.speedMode], [clock, position.clockSource]]) controlTree.update(control, value, { identity: getDocumentIdentity() });
  };
  const transportSurface = displayScheduler.register({ id: 'workstation-transport', element: transport, intervalMs: 50, write: (_measured, packet) => paintTransport(packet.value) });
  const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(() => layoutSurface.invalidate()) : null;
  resizeObserver?.observe(stage); on(window, 'resize', () => layoutSurface.invalidate());
  const commandDispatcher = getProcgenCommandDispatcher({ document, window });
  const commandContext = () => { const world = getRuntime?.()?.world; return { project: new WeakRef(getProject()), laneId: state.laneId, slot: state.slot, step: state.step, tab: state.tab,
    world: world ? new WeakRef(world) : null, generation: world?.generation }; };
  const commandCurrent = context => !disposed && context.project.deref() === getProject() && context.laneId === state.laneId && context.slot === state.slot &&
    context.step === state.step && context.tab === state.tab && (!context.world || context.world.deref() !== undefined) && context.world?.deref() === (getRuntime?.()?.world || undefined) && context.generation === getRuntime?.()?.world?.generation;
  const patternReady = () => !stageActive && selected().mode === 'pattern' && !!selected().patterns[state.slot]?.steps[state.step];
  const bindingDefaults = { undo: ['Ctrl+KeyZ', 'Meta+KeyZ'], redo: ['Ctrl+Shift+KeyZ', 'Meta+Shift+KeyZ', 'Ctrl+KeyY', 'Meta+KeyY'],
    copy: ['Ctrl+KeyC', 'Meta+KeyC'], paste: ['Ctrl+KeyV', 'Meta+KeyV'] };
  const commands = ['undo', 'redo', 'copy', 'paste'].map(action => ({ id: 'workstation.' + action, label: ({ undo: 'Undo the last edit', redo: 'Redo the last edit', copy: 'Copy the selected pattern', paste: 'Paste into the selected pattern' })[action],
    contexts: [action === 'undo' || action === 'redo' ? 'project-history' : 'optional-pattern'], bindings: bindingDefaults[action],
    enabled: () => canCommand(action) && (['undo', 'redo'].includes(action) || patternReady()), execute: () => handlers[action]?.() }));
  commands.push({ id: 'pattern.clearStep', label: 'Clear the selected step', contexts: ['optional-pattern'], bindings: ['Delete', 'Backspace'],
    enabled: () => patternReady() && state.tab === 'Step', execute: () => changeStep({ enabled: false }) });
  for (const [key, direction] of [['ArrowLeft', -1], ['ArrowRight', 1]]) commands.push({ id: 'pattern.' + (direction < 0 ? 'previousStep' : 'nextStep'),
    label: direction < 0 ? 'Select the previous step' : 'Select the next step', contexts: ['optional-pattern'], bindings: [key], repeat: true, enabled: patternReady,
    execute: () => { const length = selected().patterns[state.slot].length; state.step = (state.step + length + direction) % length; state.tab = 'Step'; render(); } });
  for (const [action, label] of [['openSoundLibrary', 'Open the sound library'], ['openShapeFoundry', 'Open Shape Foundry'],
    ['openPhysicalAuthoring', 'Open physical authoring'], ['openPhysicalJunctions', 'Inspect physical junctions'], ['openPhysicalScene', 'Open physical scene and cargo authoring'],
    ['openMasterCapture', 'Record the browser master'], ['openPrelistenMonitor', 'Open Prelisten routing'], ['save', 'Save the current project'], ['load', 'Open a saved project'], ['export', 'Prepare a performance file']]) {
    commands.push({ id: 'workstation.' + action, label, contexts: ['selected-lane'], enabled: () => canCommand(action), execute: () => handlers[action]?.() });
  }
  commands.push({ id: 'workstation.import', label: 'Import a performance file', contexts: ['project'], enabled: () => canCommand('import'), execute: () => importInput.click() });
  commands.push({ id: 'workstation.inspectLane', label: 'Inspect the selected lane in the instrument dock', contexts: ['selected-lane'], enabled: () => !stageActive, execute: () => dock.open() },
    { id: 'workstation.perform', label: 'Return to performance and close the instrument dock', contexts: ['selected-lane'], enabled: () => !stageActive, execute: () => dock.choose('perform') });
  const commandRegistration = commandDispatcher.register({ commands, priority: 100, getContext: commandContext, isCurrent: commandCurrent,
    accepts: (_event, input) => !projectList.open && (!input.interactive || input.path.some(target => target?.classList?.contains('studio-cell'))) && !input.path.some(target => target?.id === 'gameCanvas'),
    onError: error => { status.textContent = error.message; } });
  const outputCommandRegistration = commandDispatcher.register({ priority: 200, isCurrent: () => !disposed,
    commands: [['panicOutput', 'Panic: release musical output'], ['stopOutput', 'Stop musical output']].map(([action, label]) => ({
      id: 'workstation.' + action, label, contexts: ['musical-output'], bindings: [], emergency: true,
      enabled: () => canCommand(action), execute: () => handlers[action]?.() })), onError: error => { status.textContent = error.message; } });
  const commandPalette = createProcgenCommandPalette({ document, dispatcher: commandDispatcher, getScopeLabel: () => 'Selected lane: ' + (selected().name || selected().id),
    onStatus: message => { status.textContent = message; } });
  fullscreenMenu.append(button('Commands…', () => commandPalette.open(), 'Find a desktop action and inspect its actual shortcuts'));
  fullscreenMenu.append(button('Inspect world selection', () => { state.tab = 'Selection'; if (dock.visible()) render(); else dock.open(); }, 'Read selected actors and physical objects without changing their world'));

  const setupMusic = node('div', null, 'studio-setup-music'); setupMusic.setAttribute('role', 'group'); setupMusic.setAttribute('aria-label', 'Musical setup');
  const setupMusicalFields = [speedMode.parentElement, linked.parentElement, root.parentElement, scale.parentElement, clock.parentElement, clockHealth];
  for (const field of setupMusicalFields) setupMusic.append(field);
  const workspaceField = node('label', null, 'studio-menu-field'); workspaceField.append(node('span', 'Workspace mode'), dock.mode);
  const worldControls = topbar.querySelector('.procgen-world-controls');
  const chrome = createWorkstationChrome({ document, window, topbar, footer, health: operationalView.element, viewMenu: fullscreenMenu,
    setupFields: [worldControls, byId('procgenAudioControls'), setupMusic, topbar.querySelector('.procgen-status-strip')],
    viewFields: [layoutMode.parentElement, workspaceField, byId('procgenFollow')?.parentElement, byId('procgenHelp')], stageRestricted: [worldControls, setupMusic] });
  fullscreenSummary.textContent = 'View'; fullscreenSummary.setAttribute('aria-label', 'View actions');

  let stageFocus = null; const stageHidden = new Map();
  const setStageMode = enabled => {
    if (stageActive === !!enabled || disposed) return; stageActive = !!enabled;
    shell.dataset.stageMode = String(stageActive); presentationRoot.dataset.stageMode = String(stageActive); cueStrip.hidden = !stageActive;
    stageModeButton.textContent = stageActive ? 'Exit stage' : 'Stage'; stageModeButton.setAttribute('aria-label', stageActive ? 'Exit stage' : 'Stage mode'); stageModeButton.setAttribute('aria-pressed', String(stageActive));
    if (stageActive) {
      cancelPresentationGestures('stage-mode');
      stageFocus = document.activeElement;
      const roots = [inspector, footer, panel, grid, dock.toggle, dock.mode, root.parentElement, scale.parentElement, clock.parentElement, layoutMode.parentElement,
        ...topbar.querySelectorAll('.procgen-world-controls'), byId('procgenOutput')?.parentElement, byId('procgenMidiDevice')];
      for (const element of roots) if (element && !stageHidden.has(element)) { stageHidden.set(element, { hidden: element.hidden, inert: element.inert }); element.hidden = true; element.inert = true; }
      stopOutput.focus();
    } else { for (const [element, previous] of stageHidden) { element.hidden = previous.hidden; element.inert = previous.inert; } stageHidden.clear(); stageFocus?.focus?.(); stageFocus = null; }
    chrome.stage(stageActive); dock.update(); reflowGeometry();
  };
  const sceneCue = (value, current, active = stageActive) => {
    currentCue.textContent = 'CURRENT · ' + (current?.title || 'Physical world'); nextCue.textContent = 'NEXT · ' + (value?.selection?.title || 'No candidate');
    cueGo.disabled = !active || value?.canApply !== true; cueState.textContent = value?.prepared && !value.canApply ? 'Base changed · prepare again' : value?.phase === 'ready' ? 'Prepared stopped replacement · starts paused' : value?.phase || 'No prepared scene';
    sceneControls.refresh();
  };
  const sceneControls = createPerformanceSceneControlView({ document, parent: presentationRoot, displayScheduler,
    getScene: () => getProject().procgen.sceneOrigin?.manifest || null, getWorld: () => getRuntime()?.world || null,
    performReleaseGesture: gesture => handlers.performReleaseGesture(gesture), requestJunction: (...args) => handlers.requestJunction(...args), onStatus: text => { status.textContent = text; },
    getSceneMacroState: id => readSceneMacroControl(getProject(), id), performSceneMacro: input => handlers.performSceneMacro(input),
    openControl: (control, scene) => {
      if (control.target.startsWith('effect-macro:THROW;') || control.target.startsWith('quarry-echo:')) return handlers.openQuarryEcho?.();
      if (control.target.startsWith('scene-browser:')) return handlers.scenes?.();
      if (control.target.startsWith('release-gesture:')) return handlers.openReleaseGestures?.();
      if (control.target.startsWith('physical-authoring:terrain-edit')) return handlers.openPhysicalAuthoring?.();
      if (control.target.startsWith('patch-macro:')) {
        if (stageActive) { status.textContent = 'Exit stage to open the lane macro editor.'; return; }
        const macroId = control.target.split(';')[0].slice('patch-macro:'.length), lane = getProject().procgen.lanes.find(lane => scene.patchRefs.some(patch => patch.laneId === lane.id) && lane.instrumentRef?.definition.macros?.some(macro => macro.id === macroId));
        if (!lane) throw new Error('This score macro is unavailable in the current lane instruments.'); state.laneId = lane.id; state.tab = 'Lane'; dock.open(); render(); return;
      }
      return handlers.openPhysicalScene?.();
    } });
  const api = { render, patchStep, patchProject, layout, dock, openInspector: () => { if (dock.visible()) render(); else dock.open(); }, revealGlobalControl: element => chrome.reveal(element), viewSession: viewLease, stageMode: setStageMode, sceneCue, renderInspector: render, requestProjectName: nameDialog.request, showProjects, showProjectPage, macroState: () => macroSurface.invalidate(), displayScheduler, status: text => { status.textContent = text; },
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
      displayStatus.classList.toggle('visually-hidden', current === 'ready');
      retryDisplay.hidden = !['lost', 'unavailable'].includes(current);
    },
    revealPreparedExport() {
      exportDesk.open = true; exportDesk.scrollIntoView?.({ block: 'nearest' });
      (savePrepared.disabled ? retryExport : savePrepared).focus?.({ preventScroll: true });
    },
    exportState(artifact, delivery) {
      const ready = !!artifact?.retained && Date.now() < artifact.expiresAt;
      const writing = delivery?.state === 'writing';
      exportDesk.hidden = !artifact?.retained && !delivery?.errorKind && !['writing', 'failed', 'interrupted', 'canceled'].includes(delivery?.state);
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
    refreshOperational: () => { operationalSurface.invalidate(); laneMixSurface.invalidate(); },
    refreshLaneDisplays: () => laneMixSurface.invalidate(),
    transport(position) {
      state.beat = position.beat;
      operationalSurface.invalidate(); transportSurface.publish(Object.freeze({ documentIdentity: getDocumentIdentity(), beat: position.beat, bpm: position.bpm, baseBpm: position.baseBpm, gameSpeed: position.gameSpeed, clockSource: position.clockSource,
        clockStatus: position.clockStatus, linked: position.linked, speedMode: position.speedMode })); frame(position.beat);
    },
    recording(value, midiState = null) {
      if (midiState) { midiRouteState = midiState; midiSurface.invalidate(); }
      state.recording = !!value;
      records.setAttribute('aria-pressed', String(value));
      const partial = midiState?.recordingComplete === false;
      records.textContent = partial ? '● Partial take' : '● Record';
      records.title = partial ? `Recording incomplete: ${midiState.incompleteReason}. Export labels the partial window.`
        : midiState?.recordingPressure >= 0.8 ? `Recording storage ${Math.round(midiState.recordingPressure * 100)}% full.`
          : 'Record MIDI input into the selected phrase';
      records.dataset.state = partial ? 'partial' : midiState?.recordingPressure >= 0.8 ? 'near-cap' : value ? 'recording' : 'idle';
    },
    midi(text) { state.lastMidi = text; midiSurface.invalidate(); },
    dispose() {
      midiRouteView?.dispose(); midiRouteView = null;
      if (stageActive) setStageMode(false);
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      if (mountedViews.get(canvas) === api) mountedViews.delete(canvas);
      return retirement.retire([
        { name: 'project-picker', run: () => retirePicker(pickerOwner, { cancel: true, close: true }) }, { name: 'fullscreen', run: () => fullscreenSession.dispose() },
        { name: 'geometry-subscription', run: () => geometryUnsubscribe?.() }, { name: 'geometry-transition', run: () => { geometryRelease?.(); state.presentationTransition = false; } },
        { name: 'modal-output-safety', run: () => modalSafety.dispose() }, { name: 'operational-view', run: () => operationalView.dispose() }, { name: 'keyed-controls', run: () => { controlTree.dispose(); parameterCache.clear(); } }, { name: 'desktop-commands', run: () => { commandPalette.dispose(); outputCommandRegistration.dispose(); commandRegistration.dispose(); } }, { name: 'resize-observer', run: () => resizeObserver?.disconnect() }, { name: 'name-dialog', run: () => nameDialog.dispose() }, { name: 'parameter-gestures', run: () => { stroke?.lease.cancel('disposed'); for (const control of parameterControls.splice(0)) control.dispose(); } },
        { name: 'workstation-chrome', run: () => chrome.dispose() }, { name: 'instrument-dock', run: () => dock.dispose() }, { name: 'curve-editors', run: () => { for (const entry of curveEditors.values()) entry.control.dispose(); curveEditors.clear(); } },
        { name: 'lane-mix-controls', run: () => { for (const control of [...laneMixControls.values(), ...lanePanControls.values()]) control.dispose(); laneMixControls.clear(); lanePanControls.clear(); } },
        { name: 'lane-displays', run: () => { for (const display of laneDisplays.values()) display.dispose(); laneDisplays.clear(); laneDisplayPages.clear(); laneDisplayDialog.close(); laneDisplayDialog.remove(); } },
        { name: 'causal-visual-view', run: () => causalView.dispose() },
        { name: 'current-score-controls', run: () => sceneControls.dispose() },
        { name: 'display-scheduler', run: () => displayScheduler.dispose() },
        { name: 'renderer', run: detachRenderer }, ...listeners.map((unlisten, index) => ({ name: 'view-listener-' + index, run: unlisten })),
        { name: 'canvas', run: () => { if (canvasParent) canvasParent.insertBefore(canvas, canvasSibling?.parentNode === canvasParent ? canvasSibling : null); } },
        ...[projectList, cueStrip, shell, footer, transport, heading].map((element, index) => ({ name: 'view-element-' + index, run: () => element.remove() })),
        { name: 'legacy-panel', run: () => { if (panelParent) panelParent.insertBefore(panel, panelSibling?.parentNode === panelParent ? panelSibling : null); } },
        { name: 'topbar', run: () => topbarParent.insertBefore(topbar, topbarSibling?.parentNode === topbarParent ? topbarSibling : null) },
        { name: 'presentation-root', run: () => presentationRoot.remove() }
      ]);
    },
    getProjection: () => projection,
    getFullscreenState: () => fullscreenSession.getState()
  };
  mountedViews.set(canvas, api); return api;
}
export { createProcgenWorkstationView };
