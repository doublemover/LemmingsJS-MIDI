import { createLazyWorkstationToolGate } from './LazyWorkstationToolGate.js';
import { loadDeferredWebMidi } from '../DeferredWebMidi.js';
import { createProcgenOperationalSnapshot } from './ProcgenOperationalState.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { normalizeWorkstationDockPreferences } from './WorkstationDockState.js';
import { createMidiParameterEvidence } from './MidiParameterEvidence.js';
import { getActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { prepareSceneMacroAction } from './SceneMacroAction.js';
import { performanceSceneHash } from './PerformanceScene.js';
import { createPerformanceStageSession } from './PerformanceStageSession.js';
import { createSympatheticMapView } from '../../midi-ui/SympatheticMapView.js';
import { sealMidiProjectSnapshot } from '../../../midi/project/MidiProjectSnapshot.js';
import { createPhysicalDomainEditor } from './PhysicalDomainEditor.js';
import { createPhysicalFeedbackController } from './physical/PhysicalFeedback.js';
import { createPhysicalFeedbackView } from './PhysicalFeedbackView.js';
import { createReleaseGestureView } from './ReleaseGestureView.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { createPhysicalAuthoringView } from './PhysicalAuthoringView.js';
import { createPhysicalAuthoringHistory } from './PhysicalAuthoringHistory.js';
import { capturePhysicalScoreFragment, selectSpatialFragmentGraph, planPhysicalScoreFragment, fragmentPlacementCommand } from './PhysicalScoreFragment.js';
import { normalizeTerrainCommand, planTerrainCommand, digestPlan } from '../TerrainAuthoringAdapter.js';
import { prepareProjectJunctions } from './PhysicalJunctionProject.js';
import { createPhysicalJunctionView } from './PhysicalJunctionView.js';
import { getProcgenRecoveryJournal } from './ProcgenRecoveryJournal.js';
import { prepareProcgenRecoveryJournal } from './ProcgenRecoveryCapture.js';
import { createProcgenPreferenceWriter } from './ProcgenPreferenceWriter.js';
import { procgenLane, procgenProjectChange } from './ProcgenProjectIndex.js';
import { createProcgenPageLifecycle } from './ProcgenPageLifecycle.js';
import { sanitizeMidiProject, reduceMidiProject, projectToMidiConfig, isCanonicalMidiProject, markCanonicalMidiProject, sameMidiRuntimeInputs } from '../../../midi/project/MidiProject.js';
import { createProcgenWorkstationProject, createProcgenPattern, convertLegacyProcgenWorkstationProject } from './ProcgenWorkstationProject.js';
import { createProcgenPatternEngine } from './ProcgenPatternEngine.js';
import { createProcgenTransport } from './ProcgenTransport.js';
import { createProcgenMidiPorts } from './ProcgenMidiPorts.js';
import { createProcgenWorkstationView } from './ProcgenWorkstationView.js';
import { createLaneDisplayEvidence } from './LaneDisplayEvidence.js';
import { captureProcgenCheckpoint, assetIdentity } from './ProcgenCheckpoint.js';
import { causalRuntimeSourceVersions } from './CausalRuntimeIdentity.js';
import { borrowCausalPage, borrowCausalTake, retireCausalRead } from './CausalReadLeases.js';
import { createProcgenLaneObserver } from './ProcgenLaneObservation.js';
import { createProcgenSession, validateProcgenSession, createProcgenSessionStorage, createProcgenDocumentId, freshProcgenSeed } from './ProcgenSessionStorage.js';
import { createProcgenPhysicalScoreClock } from './ProcgenPhysicalScoreClock.js';
import { createProcgenPhysicalPlayback } from './ProcgenPhysicalPlayback.js';
import { createCausalMidiSink } from './CausalMidiSink.js';
import { createProcgenCausalJournal } from './ProcgenCausalJournal.js';
import { createCausalTakeRecorder } from './CausalTake.js';
import { captureCausalPerformanceState, diffCausalPerformanceState, diffCausalLanePerformance } from './CausalPerformanceState.js';
import { prepareCausalTakeArchive } from './CausalTakeArchive.js';
import { createPhysicalScoreProjection } from './PhysicalScoreProjection.js';
import { createProcgenWorldInspector } from './ProcgenWorldInspector.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { resolveProcgenStartupIntent } from './ProcgenStartupIntent.js';
import { deliverArtifactToAnchor, deliverArtifactToFileHandle, prepareExportArtifact, requestExportFileHandle } from '../../export/ExportArtifact.js';
import { backgroundJobService } from '../../resources/BackgroundJobService.js';
import { readBrowserBuildResponse } from '../../../runtime/BrowserGenerationService.js';
import { createInstrumentMacroGestures } from '../../midi-ui/InstrumentMacroGestures.js';
import { createLaneSoundTransaction } from '../../midi-ui/LaneSoundTransaction.js';
import { createNativeSoundSelection } from '../../midi-ui/NativeSoundSelection.js';
import { resolveLegacySoundAlias } from './NativeSoundCollections.js';
import { createPatchVariationOwner } from '../../midi-ui/PatchVariationOwner.js';
import { createPatchVariationView } from '../../midi-ui/PatchVariationView.js';
import { createSoundSeedLabView } from '../../midi-ui/SoundSeedLabView.js';
import { createMasterCaptureView } from '../../midi-ui/MasterCaptureView.js';
import { createPrelistenMonitor } from '../../midi-ui/PrelistenMonitor.js';
import { createCausalTakeAudioRenderView } from '../../midi-ui/CausalTakeAudioRenderView.js';

const STORAGE_KEY = 'lemmings.procgen.workstation.v1';
const MAX_SESSION_FILE_BYTES = 64 * 1048576;
const WORLD_HISTORY_ACTIONS = new Set(['procgen/worldTheme', 'procgen/addLane', 'procgen/removeLane', 'procgen/seed',
  'procgen/physicalGraph', 'procgen/junctions', 'procgen/fragments', 'procgen/detachFragment', 'procgen/releaseGesture']);
const FAST_PROCGEN_ACTIONS = new Set(['procgen/sceneMacro', 'procgen/worldTheme', 'procgen/releaseGesture', 'procgen/fragments', 'procgen/detachFragment', 'procgen/junctions', 'procgen/physicalGraph', 'procgen/effectRack', 'procgen/seed', 'procgen/addLane', 'procgen/removeLane', 'procgen/lane', 'procgen/palette',
  'procgen/step', 'procgen/pattern', 'procgen/launch', 'procgen/launched', 'procgen/launchedBatch']);
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const historyPatchBytes = (before, after, action) => {
  const commandBytes = JSON.stringify(action).length * 2;
  const structuralBytes = before.procgen.lanes.length * 8 + 1024;
  const lane = procgenLane(before.procgen.lanes, action.laneId);
  if (action.type === 'procgen/step') {
    const pattern = lane?.patterns[action.slot ?? lane.activeSlot];
    return commandBytes + JSON.stringify(pattern?.steps[action.index] ?? null).length * 2 + structuralBytes;
  }
  if (action.type === 'procgen/pattern') return commandBytes + JSON.stringify(lane?.patterns[action.slot ?? lane.activeSlot] ?? null).length * 2 + structuralBytes;
  if (action.type === 'procgen/sceneMacro') return commandBytes + action.targets.reduce((bytes, target) => bytes + JSON.stringify(procgenLane(before.procgen.lanes, target.laneId)?.instrumentControls ?? null).length * 2, 0) + structuralBytes;
  if (action.type === 'procgen/lane') return commandBytes + JSON.stringify(Object.fromEntries(Object.keys(action.patch || {}).map(key => [key, lane?.[key]]))).length * 2 + structuralBytes;
  if (action.type === 'procgen/palette' || action.type === 'procgen/removeLane')
    return commandBytes + JSON.stringify(lane ?? null).length * 2 + structuralBytes;
  if (action.type === 'procgen/addLane') return commandBytes + JSON.stringify(after.procgen.lanes.at(-1)).length * 2 + structuralBytes;
  return commandBytes + structuralBytes;
};

// Keep musical edits made while assets were loading if the candidate world fails.
function rollbackWorldProject(previous, staged, current) {
  const restored = { ...previous, procgen: { ...previous.procgen } };
  for (const key of Object.keys(current)) if (key !== 'procgen' && !equal(current[key], staged[key])) restored[key] = current[key];
  for (const key of Object.keys(current.procgen)) if (!['lanes', 'seed'].includes(key) && !equal(current.procgen[key], staged.procgen[key])) restored.procgen[key] = current.procgen[key];
  restored.procgen.lanes = previous.procgen.lanes.map(lane => {
    const before = staged.procgen.lanes.find(value => value.id === lane.id), after = current.procgen.lanes.find(value => value.id === lane.id);
    if (!before || !after) return lane;
    const next = { ...lane };
    for (const key of Object.keys(after)) if (key !== 'id' && key !== 'worldThemeId' && !equal(before[key], after[key])) next[key] = after[key];
    return next;
  });
  return restored;
}

export function createProcgenWorkstation({ document, window, legacy, getRuntime, restart,
  createView = createProcgenWorkstationView, storage = createProcgenSessionStorage(window.indexedDB),
  captureCheckpoint = captureProcgenCheckpoint, transportOptions = {}, historyBytesLimit = 32 * 1024 * 1024,
  resourceBudget = null, startupIntent, startupSource = null, backgroundJobs = backgroundJobService, prepareInspectionWorld = null, prepareSceneWorld = null, getInstrumentCatalog }) {
  if (!Number.isSafeInteger(historyBytesLimit) || historyBytesLimit < 1024) throw new Error('Invalid history byte limit.');
  const now = () => window.performance?.now?.() ?? performance.now();
  let saved = null;
  try { saved = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) || 'null'); } catch { /* Keep the default project. */ }
  if (saved?.version !== 1 || !saved.project || typeof saved.project !== 'object') saved = null;
  const initialSeed = legacy.settings.seed ?? freshProcgenSeed(window.crypto);
  const startupPlan = resolveProcgenStartupIntent({ search: window.location?.search || '', ...(startupIntent ? { intent: startupIntent } : {}), seed: initialSeed,
    legacyProject: legacy.getProject(), legacySettings: legacy.settings, saved, session: startupSource?.session, documentIdentity: startupSource?.documentIdentity, sceneRecipe: startupSource?.sceneRecipe });
  startupSource = null;
  Object.assign(legacy.settings, startupPlan.worldOptions);
  let project = sealMidiProjectSnapshot(markCanonicalMidiProject(startupPlan.project));
  const state = { laneId: project.procgen.lanes[0].id, slot: 0, step: 0, tab: 'Lane', tool: 'select', layout: 'strip',
    inspectorWidth: 304, firstLane: 0, minimumRow: 64, hazardSpacing: 160, observerMode: 'overview', observerLane: null, observerHold: 6,
    inputId: null, clockOutputId: null, thru: false, recording: false, lastMidi: '', ...(startupPlan.mode === 'previous-setup' ? saved?.ui || {} : {}), ...normalizeWorkstationDockPreferences(saved?.ui) };
  let acceptedWorldSettings = { ...legacy.settings, hazardSpacing: legacy.settings.hazardSpacing ?? state.hazardSpacing };
  state.hazardSpacing = acceptedWorldSettings.hazardSpacing;
  state.recording = false; state.thru = false; state.inputId = null; state.clockOutputId = null;
  let startupCommitted = false, deferredPersist = false, startupFailure = null;
  const operationalExecution = getActiveExecutionIdentity('browser-native-audio');
  let operationalLessonAvailable = operationalExecution.activeExecution === 'bound' && ['worklet-sine', 'worklet-pluck'].every(id => operationalExecution.instrumentArtifacts?.some(artifact => artifact.engineId === id));
  let view = null, disposed = false, boundRuntime = null, boundSession = null, unhookRouter = null, unhookWorld = null;
  const sessionIdentities = new WeakMap();
  let ports, engine, lastPlaying = false, lastLegacySpeed = legacy.settings.speed, pendingResume = false, lastTempo = null;
  let savedName = 'Untitled session', documentId = null, documentRevision = 0, clipboard = null, loadSerial = 0, suppressPersistence = false;
  let recordingOrigin = null;
  let lastCausalTransport = null;
  let operationSerial = 0, currentOperation = null;
  let lastRecovery = now(), recoveryPending = false, recoveryTimer = null, persistTimer = null, recoveryAbort = null;
  const recoverySnapshotStats = { calls: 0, totalMs: 0, maximumMs: 0, lastMs: null };
  let recoveryState = 'unsaved', recoveryError = null, durableRecoveryRevision = -1, durableRecoveryTick = null, durableRecoveryGeneration = null, recoveryRetirement = null, lastRecoveryCommit = null;
  let lastRecoveryError = -Infinity;
  let lastBudgetNotice = -Infinity;
  let lastObserverAt = -Infinity, observerCursor = 0;
  let writingLegacy = false;
  let worldBusy = false, pendingWorldSettings = null;
  let laneObserver = null;
  let physicalScoreClock = createProcgenPhysicalScoreClock(), physicalClockError = false, physicalPlayback = null, physicalFeedback = null, physicalFeedbackView = null, physicalDomainEditor = null, feedbackEpoch = 0, worldInspector = null;
  let causalJournal = null, causalTake = null, causalTakeStart = null, causalTakeStop = null, causalMarkerCheckpoint = null;
  let causalWorkbench = null, causalWorkbenchLoading = null, causalWorkbenchSourceSerial = 0;
  let causalTakeArmCanceled = false;
  let lastCausalTake = null, lastCausalInspection = null, physicalReceiptBuffer = null, physicalProvenanceBuffer = null, physicalProvenanceDropped = 0, physicalReceiptBoundary = null, causalTakeErrorReported = false;
  let selectedCausalTakeId = null, causalTakePage = null, causalTakeCursor = null, causalTakeBack = [], causalTakeListSerial = 0;
  let physicalScoreProjection = null, physicalScore = null, physicalScoreQuery = null, physicalScoreAbort = null, physicalScoreSerial = 0, physicalScoreParent = null;
  let physicalScoreLease = null, physicalScoreParentLease = null, scoreViewRetirement = null;
  let soundLibrary = null, nativeSoundSelection = null, patchVariations = null;
  let masterCapture = null, soundSeedLab = null, shapeFoundry = null;
  let releaseGestureView = null, releaseGestureSerial = 0, physicalAuthoringView = null, quarryEchoView = null, crossExcitationView = null, travelColorationView = null, spectralFreezeView = null, sympatheticMapView = null, rectangularMembraneView = null, physicalJunctionView = null, junctionRequestSerial = 0;
  let stageSession = null;
  let sceneCatalog = null, sceneLoader = null, sceneBrowser = null, physicalLessonView = null, physicalLessonDefaultId = null, sceneToolsPending = null;
  let prelistenMonitor = null;
  let causalAudioRender = null;
  let pendingHistory = null;
  const routerRestores = new Map();
  const undo = [], redo = [], listeners = [], noteEntries = new Map();
  const retirement = createProcgenRetirementScope();
  const midiParameterEvidence = createMidiParameterEvidence({ resourceBudget });
  const laneDisplayEvidence = createLaneDisplayEvidence({ resourceBudget });
  let laneDisplayWorldEpoch = 0;
  const laneDisplaySource = (world = runtime()?.world, generation = world?.generation) => JSON.stringify([documentGeneration, laneDisplayWorldEpoch, world?.worldId ?? null, generation ?? null]);
  let lastHistoryGroup = null, inputGestureSerial = 0;
  let documentGeneration = 1, projectRevision = 0, inputLease = null;
  let editRevision = 0, savedRevision = -1, lastSavedAt = null, lastStorageError = null;
  const pendingSaveGenerations = new Set();
  let transportStopGeneration = 0;
  const historySizes = new WeakMap();
  const physicalHistory = createPhysicalAuthoringHistory({ resourceBudget, maxBytes: Math.max(1048576, Math.min(128 * 1048576, historyBytesLimit)) });
  let physicalAuthoringAbort = null, pendingPhysicalAuthoring = null, physicalAuthoringSerial = 0;
  let historyDropped = 0;
  const historyBytes = value => {
    let bytes = historySizes.get(value);
    if (bytes == null) { bytes = JSON.stringify(value).length * 2; historySizes.set(value, bytes); }
    return bytes;
  };
  const retainedHistoryBytes = () => [...undo, ...redo].reduce((sum, entry) => sum + historyBytes(entry) + physicalHistory.bytesFor(entry), 0);
  const trimHistory = () => {
    let bytes = retainedHistoryBytes();
    while ((bytes > historyBytesLimit || [...undo, ...redo].reduce((sum, entry) => sum + physicalHistory.bytesFor(entry), 0) > physicalHistory.diagnostics().retainedLimitBytes) && (undo.length || redo.length)) {
      const entry = undo.length ? undo.shift() : redo.shift();
      bytes -= historyBytes(entry) + physicalHistory.bytesFor(entry); historyDropped++;
    }
    physicalHistory.prune(new Set([...undo, ...redo]));
  };
  const status = text => { if (!disposed) view?.status(text); };
  let midiConnectSerial = 0;
  const toolGate = createLazyWorkstationToolGate({
    getIdentity: () => JSON.stringify([disposed, documentGeneration, projectRevision, laneDisplayWorldEpoch, state.laneId, stageSession?.active() || false]),
    getInteraction: () => ({ hidden: document.hidden === true, focus: document.activeElement, body: document.body, dialog: document.querySelector?.('dialog[open]') || null }),
    onError: (name, error) => status(name + ' could not open: ' + String(error?.message || error).slice(0, 512))
  });
  const retirePhysicalScoreViews = ({ parentOnly = false } = {}) => {
    physicalScoreParent = null; if (!parentOnly) { physicalScore = null; physicalScoreQuery = null; }
    scoreViewRetirement = createProcgenRetirementScope().retire([
      ...(!parentOnly ? [{ name: 'physical-score-view', run: () => { if (physicalScoreLease) { retireCausalRead(physicalScoreLease); physicalScoreLease = null; } } }] : []),
      { name: 'causal-parent-view', run: () => { if (physicalScoreParentLease) { retireCausalRead(physicalScoreParentLease); physicalScoreParentLease = null; } } }
    ]); return scoreViewRetirement;
  };
  const currentStorageError = () => lastStorageError?.generation === documentGeneration ? lastStorageError.error : null;
  const storageStatus = error => {
    if (error) lastStorageError = { generation: documentGeneration, error: Object.freeze({ message: String(error.message || error).slice(0, 240) }) };
    view?.storage?.({ dirty: editRevision !== savedRevision, savedAt: lastSavedAt, error: currentStorageError(),
      recovery: { state: recoveryState, durableRevision: durableRecoveryRevision, durableTick: durableRecoveryTick,
        pendingRevision: editRevision, error: recoveryError, retirement: recoveryRetirement } });
  };
  const inputTarget = lease => {
    const lane = project.procgen.lanes.find(item => item.id === lease.laneId);
    const pattern = lane?.patterns?.[lease.slot];
    return pattern && lease.index < pattern.length && pattern.steps?.[lease.index] ? { lane, pattern } : null;
  };
  const cancelInputEdits = reason => {
    if (inputLease) { inputLease = null; ports?.cancelLearn(); view?.refreshLaneNavigation?.(); status(`MIDI Learn canceled: ${reason}.`); }
    noteEntries.clear();
  };
  const beginOperation = kind => {
    cancelInputEdits('project transition');
    currentOperation?.controller.abort();
    const lease = { ownerId: 'procgen-workstation', generation: ++operationSerial, kind, controller: new AbortController() };
    lease.signal = lease.controller.signal;
    currentOperation = lease;
    return lease;
  };
  const ownsOperation = lease => !disposed && currentOperation === lease && !lease.signal.aborted;
  const finishOperation = lease => { if (currentOperation === lease) currentOperation = null; };
  const listen = (target, event, handler, options) => { target?.addEventListener?.(event, handler, options); listeners.push(() => target?.removeEventListener?.(event, handler, options)); };
  listen(document, 'keydown', event => { if (event.key === 'Escape') toolGate.cancel(); });
  listen(document, 'pointerdown', () => toolGate.cancel(), true);
  const runtime = () => getRuntime?.();
  const renderer = () => runtime()?.lanes?.renderer;
  const router = () => runtime()?.view?.midiPreviewRouter;
  const selected = () => procgenLane(project.procgen.lanes, state.laneId) || project.procgen.lanes[0];
  let sampledMacroRevision = 0, sampledMacroPerformance = null, macroInputEndpoint = null;
  const macroGestures = createInstrumentMacroGestures({ resourceBudget, getLane: laneId => procgenLane(project.procgen.lanes, laneId), getDocumentEpoch: () => documentGeneration,
    commit: (laneId, instrumentControls, gestureId) => dispatch({ type: 'procgen/lane', laneId, patch: { instrumentControls } }, { historyGroup: 'macro:' + documentGeneration + ':' + gestureId }),
    onState: () => view?.macroState?.() });
  const effectiveSoundLanes = lanes => macroGestures.lanes(soundTransactions.lanes(lanes));
  const sampleMacroPerformance = boundary => {
    const revision = macroGestures.revision(); if (revision === sampledMacroRevision) return;
    const next = captureCausalPerformanceState(effectiveSoundLanes(project.procgen.lanes)), previous = sampledMacroPerformance || captureCausalPerformanceState(project.procgen.lanes);
    const change = diffCausalPerformanceState(previous, next);
    if (causalTake && change) { const receipt = causalTake.recordPerformance(change, boundary); if (receipt.status !== 'accepted') throw new Error('Causal take cannot admit this macro sample: ' + receipt.reason); }
    sampledMacroRevision = revision; sampledMacroPerformance = next;
  };
  const soundTransactions = createLaneSoundTransaction({ resourceBudget,
    getSource: laneId => ({ available: !macroGestures.diagnostics().active && !disposed && !worldBusy && !pendingHistory && !physicalAuthoringAbort && !causalTake && !causalTakeStart && !causalTakeStop && !!physicalPlayback,
      owner: physicalPlayback, documentGeneration, worldGeneration: runtime()?.world?.generation, selectedLaneId: selected().id,
      lane: procgenLane(project.procgen.lanes, laneId || selected().id), reason: 'Finish the current world/history/take operation before selecting sound.' }),
    prepare: (laneId, reference, options) => physicalPlayback.prepareLaneInstrument(laneId, reference, options),
    publish: (laneId, reference, patch) => dispatch({ type: 'procgen/lane', laneId, patch: { ...patch, instrumentRef: reference, instrumentControls: { macros: {} } } }),
    onState: event => { if (event.state === 'preview') status('Previewing incoming physical events. Release restores the prior sound; held voices keep their onset renderer.');
    else if (event.state === 'committed') status('Sound committed as one musical edit. The physical world and hardware mapping are unchanged.');
    else if (event.reason) status(event.reason); }
  });
  const setLegacyProject = (next, options = { persist: false }) => { writingLegacy = true; try { legacy.setProject(next, options); } finally { writingLegacy = false; } };
  const budgetNotice = () => { if (now() - lastBudgetNotice > 1000) { lastBudgetNotice = now(); status('Output budget reached; some notes or CC were thinned. The musical clock continues.'); } };
  const reportRouting = () => {
    const addresses = new Map(), hardware = new Map();
    for (const lane of project.procgen.lanes) {
      if (lane.mute) continue; const key = `${lane.outputId || 'default'}:${lane.channel}`, signature = JSON.stringify([lane.externalProgram, lane.bankMSB, lane.bankLSB, lane.externalPercussion]), prior = hardware.get(key);
      if (prior && prior.signature !== signature) { status(`External program/bank/percussion mapping conflicts on channel ${lane.channel} between ${prior.name} and ${lane.name}. Select separate hardware channels; native sound selection does not change this mapping.`); return; }
      hardware.set(key, { signature, name: lane.name });
    }
    for (const lane of project.procgen.lanes) for (const curve of lane.ccAutomation || []) {
      if (!curve.enabled || lane.mute) continue;
      const key = `${lane.outputId || 'default'}:${lane.channel}:${curve.controller}`;
      if (addresses.has(key)) { status(`CC ${curve.controller} on channel ${lane.channel} is shared by ${addresses.get(key)} and ${lane.name}. Use separate channels to control them independently.`); return; }
      addresses.set(key, lane.name);
    }
  };
  const syncWorldSeed = () => {
    if (worldBusy) return;
    const seed = runtime()?.world?.seed;
    if (Number.isFinite(seed) && seed !== project.procgen.seed) { project = sealMidiProjectSnapshot(markCanonicalMidiProject({ ...project, procgen: { ...project.procgen, seed } })); legacy.settings.seed = seed; setLegacyProject(project); persist(); }
  };
  const observeFrame = timestamp => {
    timestamp = renderer()?.motionPolicy?.presentationTime() ?? timestamp;
    if (state.presentationTransition || renderer()?.junctionInspectionOwner || renderer()?.motionPolicy?.automaticCamera === false || state.observerMode !== 'director' || timestamp - lastObserverAt < Math.max(2, Number(state.observerHold) || 6) * 1000) return;
    lastObserverAt = timestamp;
    const world = runtime()?.world, render = renderer(); if (!world || !render) return;
    const ranked = project.procgen.lanes.map((lane, index) => ({ index, distance: world.stall?.lanes?.[index]?.maxX || world.frontiers?.[index] || 0 })).sort((a, b) => b.distance - a.distance || a.index - b.index);
    const count = Math.min(8, ranked.length), selectedLane = ranked[observerCursor++ % count];
    if (selectedLane) { state.firstLane = selectedLane.index; render.followLaneIndex = selectedLane.index; render.camera?.followFrontier?.(); view?.layout?.(); view?.launched?.(); }
  };
  const preferenceWriter = window.setTimeout ? createProcgenPreferenceWriter({ jobs: backgroundJobs, resourceBudget,
    storage: window.localStorage, key: STORAGE_KEY, getGeneration: () => documentGeneration,
    onState: result => { if (result.error) status('Project preferences could not be stored. Export a project file to save.'); } }) : null;
  const writePersist = () => {
    if (suppressPersistence || disposed) return;
    if (!startupCommitted) return;
    if (worldBusy) { deferredPersist = true; return; }
    try {
      const value = { version: 1, documentRevision: editRevision, project, ui: { ...state, hazardSpacing: acceptedWorldSettings.hazardSpacing, recording: false, thru: false, lastMidi: '' }, transport: transport.snapshot() };
      if (preferenceWriter) preferenceWriter.request(value, editRevision);
      else window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
    }
    catch { status('Project preferences could not be stored. Export a project file to save.'); }
  };
  const persist = ({ immediate = false } = {}) => {
    if (suppressPersistence || disposed) return;
    if (!startupCommitted) return;
    if (worldBusy) { deferredPersist = true; return; }
    deferredPersist = false;
    if (immediate || !window.setTimeout) {
      if (persistTimer != null) { window.clearTimeout?.(persistTimer); persistTimer = null; }
      writePersist(); return;
    }
    if (persistTimer == null) persistTimer = window.setTimeout(() => { persistTimer = null; writePersist(); }, 250);
  };
  const scheduleRecovery = (delay = 2000) => {
    if (disposed || suppressPersistence || !boundRuntime || !window.setTimeout) return;
    if (recoveryTimer != null) window.clearTimeout?.(recoveryTimer);
    recoveryState = 'pending'; storageStatus();
    recoveryTimer = window.setTimeout(() => { recoveryTimer = null; void recover(); }, delay);
  };
  const syncProject = (next, { history = true, historyGroup = null, historyCost = null, render = true, renderAction = null, fromLegacy = false, restoringWorld = false } = {}) => {
    if (physicalAuthoringAbort && !restoringWorld) throw new Error('Physical authoring owns this paused project boundary.');
    const change = procgenProjectChange(project, next);
    const runtimeUnchanged = sameMidiRuntimeInputs(project, next);
    const instrumentRefsChanged = change && !change.structural ? change.laneIds.some(id => {
      const before = procgenLane(project.procgen.lanes, id)?.instrumentRef, after = procgenLane(next.procgen.lanes, id)?.instrumentRef;
      return before !== after && !equal(before ?? null, after ?? null);
    }) : project.procgen.lanes.some((lane, index) => lane.instrumentRef !== next.procgen.lanes[index]?.instrumentRef &&
      !equal(lane.instrumentRef ?? null, next.procgen.lanes[index]?.instrumentRef ?? null)) || next.procgen.lanes.some((lane, index) => lane.instrumentRef && !project.procgen.lanes[index]);
    if ((causalTake || causalTakeStart || causalTakeStop) && instrumentRefsChanged) throw new Error('Finish the causal take before changing its pinned lane instrument.');
    if ((causalTake || causalTakeStart || causalTakeStop) && !equal(project.procgen.effectRack ?? null, next.procgen.effectRack ?? null)) throw new Error('Finish the causal take before changing its saved effect defaults.');
    if (causalTake) { const world = runtime()?.world; sampleMacroPerformance({ tick: world?.tickIndex ?? 0, generation: world?.generation ?? 0 }); }
    const beforePerformanceLanes = macroGestures.lanes(project.procgen.lanes), afterPerformanceLanes = macroGestures.lanes(next.procgen.lanes);
    const performanceChange = causalTake || causalTakeStart || causalTakeStop ? change && !change.structural
      ? diffCausalLanePerformance(beforePerformanceLanes, afterPerformanceLanes, change.fields.some(key => ['instrumentControls', 'instrumentRef', 'gain', 'pan', 'mute', 'solo'].includes(key)) ? change.laneIds : [])
      : diffCausalPerformanceState(captureCausalPerformanceState(beforePerformanceLanes), captureCausalPerformanceState(afterPerformanceLanes)) : null;
    if ((causalTakeStart || causalTakeStop) && performanceChange) throw new Error('Wait for causal take arming or saving before changing instrument controls.');
    const junctionsChanged = !equal(project.procgen.junctions || [], next.procgen.junctions || []);
    if (junctionsChanged && (causalTake || causalTakeStart || causalTakeStop)) throw new Error('Finish the causal take before editing junction definitions. Existing junction requests remain available while recording.');
    if (!restoringWorld && junctionsChanged) next = { ...next, procgen: { ...next.procgen, junctions: (next.procgen.junctions || []).map(value => {
      const previous = project.procgen.junctions?.find(prior => prior.id === value.id); if (!previous || equal(previous, value) || value.revision > previous.revision) return value;
      if (!Number.isSafeInteger(previous.revision + 1)) throw new Error('Junction revision exhausted.'); return { ...value, revision: previous.revision + 1 };
    }) } };
    const junctionProposal = junctionsChanged && runtime()?.world ? prepareProjectJunctions(runtime().world, next.procgen.junctions || []) : null;
    if (!restoringWorld && project.procgen.physicalGraph !== next.procgen.physicalGraph) for (const collection of ['harmonicFields', 'topologyRegions']) {
      const previous = project.procgen.physicalGraph[collection] || [], values = next.procgen.physicalGraph[collection];
      if (!values) continue;
      const rebased = values.map(value => { const old = previous.find(prior => prior.id === value.id); if (!old || equal(old, value) || value.revision > old.revision) return value; if (!Number.isSafeInteger(old.revision + 1)) throw new Error('Physical region revision exhausted.'); return { ...value, revision: old.revision + 1 }; });
      if (rebased.some((value, index) => value !== values[index])) next = { ...next, procgen: { ...next.procgen, physicalGraph: { ...next.procgen.physicalGraph, [collection]: rebased } } };
    }
    if (!restoringWorld && project.procgen.physicalGraph !== next.procgen.physicalGraph && JSON.stringify(project.procgen.physicalGraph.harmonicFields || []) !== JSON.stringify(next.procgen.physicalGraph.harmonicFields || [])) {
      next = { ...next, procgen: { ...next.procgen, physicalGraph: { ...next.procgen.physicalGraph, editCommandId: `field-edit:${project.procgen.physicalGraph.revision + 1}` } } };
    }
    const graphChanged = project.procgen.physicalGraph !== next.procgen.physicalGraph && !equal(project.procgen.physicalGraph, next.procgen.physicalGraph);
    if (!restoringWorld && graphChanged && next.procgen.physicalGraph.revision <= project.procgen.physicalGraph.revision) {
      if (!Number.isSafeInteger(project.procgen.physicalGraph.revision + 1)) throw new Error('Physical mapping revision exhausted.');
      next = { ...next, procgen: { ...next.procgen, physicalGraph: { ...next.procgen.physicalGraph, revision: project.procgen.physicalGraph.revision + 1 } } };
    }
    const publishedProject = sealMidiProjectSnapshot(isCanonicalMidiProject(next) ? next : markCanonicalMidiProject(createProcgenWorkstationProject(sanitizeMidiProject(next))));
    const authoringChanged = graphChanged || project.procgen.fragmentInstances !== next.procgen.fragmentInstances && !equal(project.procgen.fragmentInstances || [], next.procgen.fragmentInstances || []);
    const authoringProposal = authoringChanged ? runtime()?.world?.preparePhysicalAuthoring?.(next.procgen.physicalGraph, next.procgen.fragmentInstances || []) : null;
    authoringProposal?.admit();
    try {
      if (!restoringWorld && graphChanged && !equal(project.procgen.physicalGraph.feedback, next.procgen.physicalGraph.feedback)) physicalFeedback?.disarm();
      const mappingChanged = causalTake && graphChanged;
      if (causalTake && (mappingChanged || performanceChange)) {
        const world = runtime()?.world, boundary = { tick: world?.tickIndex ?? 0, generation: world?.generation ?? 0 };
        const receipt = performanceChange ? causalTake.recordPerformance(performanceChange, boundary, mappingChanged ? next.procgen.physicalGraph : null)
          : causalTake.recordMapping(next.procgen.physicalGraph, boundary);
        if (receipt.status !== 'accepted') throw new Error(`Causal take could not admit the performance change: ${receipt.reason}. Stop the take before editing it.`);
        if (performanceChange) sampledMacroPerformance = captureCausalPerformanceState(afterPerformanceLanes);
      }
      authoringProposal?.commit(); junctionProposal?.commit();
    } catch (error) { try { authoringProposal?.cancel(); } catch (retirementError) { error.retirementError = retirementError; } throw error; }
    if (history) {
      if (historyGroup == null || historyGroup !== lastHistoryGroup) {
        if (historyCost != null) historySizes.set(project, historyCost);
        undo.push(project); if (undo.length > 1000) { undo.shift(); historyDropped++; }
      }
      redo.length = 0;
      trimHistory();
    }
    lastHistoryGroup = history ? historyGroup : null;
    project = publishedProject;
    projectRevision++; macroGestures.reconcile(); soundTransactions.reconcile(); physicalPlayback?.synchronizeLaneMix();
    if (instrumentRefsChanged) void physicalPlayback?.synchronizeLaneInstruments(project.procgen.lanes).catch(error => status('Lane instrument requirements: ' + error.message));
    editRevision++; storageStatus(); refreshSceneCue();
    if (inputLease && !inputTarget(inputLease)) cancelInputEdits('target was removed');
    if (!procgenLane(project.procgen.lanes, state.laneId)) state.laneId = project.procgen.lanes[0].id;
    state.slot = Math.max(0, Math.min(3, state.slot || 0));
    state.step = Math.max(0, Math.min((selected().patterns?.[state.slot]?.length || 1) - 1, state.step || 0));
    if (!fromLegacy) setLegacyProject(project);
    if (!runtimeUnchanged) ports?.configure({ schedulerConfig: projectToMidiConfig(project) });
    persist();
    if (!transport.getState().playing) scheduleRecovery();
    if (render) {
      if (change && renderAction && view?.patchProject) view.patchProject(renderAction, change);
      else if (renderAction?.type === 'procgen/step' && view?.patchStep) view.patchStep(renderAction); else view?.render();
      if (!change || change.structural || change.fields.some(key => ['ccAutomation', 'mute', 'channel', 'outputId', 'externalProgram', 'externalPercussion', 'bankMSB', 'bankLSB'].includes(key))) reportRouting();
    } return project;
  };
  const dispatch = (action, { historyGroup = null } = {}) => {
    if (stageSession && !stageSession.permitsEdit(action)) return stageSession.reject();
    if (physicalAuthoringAbort) { status('Finish the paused physical authoring transaction before editing.'); return false; }
    if (disposed) return project;
    if (pendingHistory) {
      if (WORLD_HISTORY_ACTIONS.has(action.type) ||
          action.type === 'procgen/lane' && action.patch?.worldThemeId) {
        status('Wait for Undo or Redo to finish before changing the world.'); return false;
      }
      const next = reduceMidiProject(project, action);
      if (equal(next, project)) return project;
      const serialized = JSON.stringify(action), bytes = serialized.length * 2;
      if (pendingHistory.bytes + bytes > 1048576 || pendingHistory.commands.length >= 256) {
        status('Undo or Redo is still preparing. Finish it before adding more edits.'); return false;
      }
      const transaction = pendingHistory, command = { action: JSON.parse(serialized), historyGroup }, previous = project;
      transaction.commands.push(command); transaction.bytes += bytes;
      let updated;
      try { updated = syncProject(next, { history: false, renderAction: action }); }
      catch (error) {
        if (project === previous) { transaction.commands.splice(transaction.commands.indexOf(command), 1); transaction.bytes -= bytes; }
        throw error;
      }
      if (action.type === 'procgen/lane' && action.patch?.outputId !== undefined) syncPorts({ rearm: true });
      return updated;
    }
    if (action.type === 'procgen/worldTheme' && action.worldThemeId && procgenLane(project.procgen.lanes, action.laneId)?.worldThemeId !== action.worldThemeId || action.type === 'procgen/lane' && action.patch?.worldThemeId && procgenLane(project.procgen.lanes, action.laneId)?.worldThemeId !== action.patch.worldThemeId) {
      return safe(() => rebuild({ projectNext: reduceMidiProject(project, action) }))();
    }
    const reduced = reduceMidiProject(project, action);
    if (reduced === project || !FAST_PROCGEN_ACTIONS.has(action.type) && equal(reduced, project)) return project;
    const historyCost = isCanonicalMidiProject(project) && FAST_PROCGEN_ACTIONS.has(action.type) ?
      historyPatchBytes(project, reduced, action) : null;
    const launchAcknowledgment = action.type === 'procgen/launched' || action.type === 'procgen/launchedBatch';
    const next = syncProject(reduced, { history: !launchAcknowledgment, historyGroup, historyCost,
      render: !launchAcknowledgment, renderAction: action });
    if (action.type === 'procgen/lane' && action.patch?.outputId !== undefined) syncPorts({ rearm: true });
    if (launchAcknowledgment) view?.launched?.();
    return next;
  };
  const transport = createProcgenTransport({ now, ...startupPlan.transport, ...transportOptions,
    onBeat: position => {
      const held = position.source === 'external' && pendingResume ? engine?.snapshot().active : null;
      if (held) pendingResume = false;
      engine?.onBeat({ ...position, preserveAhead: true });
      if (held?.length) engine.resume({ ...position, activeNotes: held });
    },
    onSpeed(speed) { const timer = runtime()?.world?.timer; if (timer) timer.speedFactor = speed; },
    onFlush(reason) {
      ports?.flush(); router()?.scheduler?.allNotesOff?.();
      physicalPlayback?.stop();
      if (['seek', 'stopped', 'midi-start', 'restored'].includes(reason)) { engine?.reset(); pendingResume = false; }
      else pendingResume = (engine?.getState().beat ?? -1) >= 0;
    },
    onStop(reason) {
      transportStopGeneration++;
      if (!disposed && ['clock-lost', 'suspended', 'clock-overload', 'output-disconnected'].includes(reason)) status('Transport stopped: ' + reason.replaceAll('-', ' ') + '. Press Play or send MIDI Start/Continue to resume.');
    },
    onPosition(position) {
      if (disposed) return;
      if (physicalAuthoringAbort && position.playing) { transport.pause(); return; }
      if (position.playing !== lastPlaying) { lastPlaying = position.playing; legacy.setPaused(!position.playing); }
      recordAcceptedCausalTransport(position);
      if (position.playing) runtime()?.lanes?.pump?.(position.timestamp);
      syncWorldSeed(); observeFrame(position.timestamp);
      if (position.bpm !== lastTempo) { lastTempo = position.bpm; ports?.recordTempo(position.bpm, position.beat, position.timestamp); }
      view?.transport(position);
      if (position.playing && position.timestamp - lastRecovery >= 30000 && !recoveryPending && recoveryTimer == null) {
        lastRecovery = position.timestamp;
        scheduleRecovery(0);
      }
    }
  });
  const inputStep = (event, learned = false, target = null) => {
    if (event.type !== 'noteOn' && event.type !== 'noteOff') return;
    const key = `${event.channel}:${event.note}`;
    if (event.type === 'noteOn') {
      const lane = target ? project.procgen.lanes.find(item => item.id === target.laneId) : selected();
      const laneId = lane?.id, slot = target?.slot ?? state.slot, pattern = lane?.patterns?.[slot], position = transport.getState(), beat = event.beat ?? position.beat;
      if (!pattern) return false;
      const index = target ? target.index : !learned && state.recording && position.playing
        ? ((Math.floor((beat - (engine.getLanePosition(laneId)?.origin || 0)) * 4 * pattern.rate + 1e-7) % pattern.length) + pattern.length) % pattern.length : state.step;
      if (index < 0 || index >= pattern.length || !pattern.steps[index]) return false;
      const chord = learned ? [] : [...noteEntries.values()].filter(entry => entry.laneId === laneId && entry.slot === slot && entry.index === index && Math.abs(entry.beat - beat) < 0.25 / pattern.rate);
      const notes = [...new Set([...chord.map(entry => entry.note), event.note])].sort((a, b) => a - b),
        group = chord[0]?.group || { duration: 0, historyGroup: ++inputGestureSerial };
      dispatch({ type: 'procgen/step', laneId, slot, index, patch: { enabled: true, note: notes[0], velocity: event.velocity,
        chord: notes.length > 1 ? { degrees: notes.map(note => note - notes[0]), inversion: 0, spread: 0 } : null } },
      { historyGroup: group.historyGroup });
      if (!learned) noteEntries.set(key, { laneId, slot, index, beat, note: event.note, group });
      status(`Recorded note ${event.note} into step ${index + 1}.`);
      return true;
    } else {
      const start = noteEntries.get(key); if (!start) return;
      noteEntries.delete(key); start.group.duration = Math.max(start.group.duration, 1 / 96, (event.beat ?? transport.getState().beat) - start.beat);
      dispatch({ type: 'procgen/step', laneId: start.laneId, slot: start.slot, index: start.index, patch: { duration: start.group.duration } },
        { historyGroup: start.group.historyGroup });
    }
  };
  const recordingViewState = midiState => ({ ...midiState, recordingOrigin,
    foreignRecording: !!(midiState.recordedEvents && recordingOrigin && recordingOrigin.generation !== documentGeneration) });
  ports = createProcgenMidiPorts({ transport, now, resourceBudget, schedulerConfig: projectToMidiConfig(project),
    onMonitor(event) { const endpoint = ports?.getState(); if (endpoint?.inputId) macroGestures.observeController(event, { endpointId: endpoint.inputId, endpointEpoch: endpoint.inputLiveness.connectionEpoch }); state.lastMidi = event.type === 'system' ? `MIDI ${event.data[0].toString(16).toUpperCase()}` : `${event.type} · ch ${event.channel} · ${event.note ?? event.controller ?? ''} ${event.velocity ?? event.value ?? ''}`; view?.midi?.(state.lastMidi); },
    onState(midiState) {
      const endpoint = { id: midiState.inputId, epoch: midiState.inputLiveness.connectionEpoch }, prior = macroInputEndpoint; macroInputEndpoint = endpoint;
      if (prior?.id && (prior.id !== endpoint.id || prior.epoch !== endpoint.epoch)) { try { macroGestures.disconnect(prior.id, prior.epoch); } catch (error) { status('Controller disconnected; its final macro value was not committed: ' + error.message); } }
      if (inputLease && midiState.inputLiveness.connectionEpoch !== inputLease.inputEndpointEpoch) cancelInputEdits('input changed');
      const wasRecording = state.recording;
      state.recording = midiState.recording;
      view?.recording?.(midiState.recording, recordingViewState(midiState));
      view?.refreshOperational?.();
      if (wasRecording && !midiState.recording && midiState.incompleteReasons.includes('recording-cap-reached'))
        status('Recording storage full. Performance continues; export is labeled partial.');
    },
    onRecord: event => { if (event.source === 'input' && !inputLease) inputStep(event); }
  });
  const localEnabled = () => legacy.local.getState().enabled && legacy.local.getState().selectedBackend !== 'midi';
  let outputEpoch = 0;
  const admission = (status, sinkId, spec, meta, reason = null) => ({ status, reason, sinkId,
    eventId: meta?.eventId ?? meta?.automationEventId ?? null, voiceId: meta?.voiceId ?? null,
    connectionEpoch: outputEpoch, targetTime: spec?.timeMs ?? null, timeDomain: 'performance-ms',
    ackState: status === 'accepted' ? 'scheduled' : 'none' });
  engine = createProcgenPatternEngine({ getProject: () => project, now,
    getSinkKey: () => { const output = legacy.local.getState(); return `${output.selectedBackend}:${output.outputId || ''}:${output.enabled}:${outputEpoch}`; },
    getLaneDistance: index => runtime()?.world?.frontiers?.[index] || 0,
    getLaneObservation: index => laneObserver?.(index),
    getLaneSpatialPosition: index => {
      const world = runtime()?.world, observed = laneObserver?.(index);
      return { x: observed?.x, y: observed?.y, levelWidth: world?.width, levelHeight: world?.height };
    },
    emit(spec, meta) {
      if (!transport.getState().playing) return admission('rejected', null, spec, meta, 'transport-stopped');
      if (localEnabled()) {
        const scheduler = router()?.scheduler;
        if (scheduler?.sendNote({ ...spec, outputId: null, durationTicks: (spec.durationMs || 0) / (scheduler.tickMs || 60) }, meta)) {
          ports.recordOutput(spec, { ...meta, source: 'local-preview' });
          return admission('accepted', 'local-preview', spec, meta);
        }
        if (scheduler?.getOutputPressure?.().throttled) budgetNotice();
        return admission('rejected', 'local-preview', spec, meta, 'scheduler-rejected');
      }
      if (legacy.local.getState().selectedBackend === 'midi' && legacy.local.getState().enabled) {
        if (ports.sendNote(spec, meta)) return admission('accepted', spec.outputId || 'midi-default', spec, meta);
        budgetNotice(); return admission('rejected', spec.outputId || 'midi-default', spec, meta, 'output-rejected');
      }
      return admission('rejected', null, spec, meta, 'no-enabled-sink');
    },
    emitCC(spec, meta) {
      const event = { ...spec, type: 'cc', timestamp: spec.timeMs };
      if (localEnabled()) {
        const scheduler = router()?.scheduler, channel = scheduler?.output?.channels?.[spec.channel];
        const localMeta = { ...meta, outputId: scheduler?._resolveOutputId?.(null) ?? scheduler?.output?.id ?? null };
        const reservation = scheduler?.evaluateAndReserve?.({ on: { timeMs: spec.timeMs, count: 1, bytes: 3 } }, localMeta, now());
        if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); budgetNotice(); return admission('rejected', 'local-preview', spec, meta, reservation.reason); }
        let submitted = false;
        try {
          if (!channel?.sendControlChange) return admission('rejected', 'local-preview', spec, meta, 'channel-unavailable');
          channel.sendControlChange(spec.controller, spec.value, { time: spec.timeMs });
          submitted = true;
          if (reservation?.reservationId != null) scheduler._commitReservationMessage(reservation.reservationId, 'on', 3, localMeta, now());
          ports.recordEvent(event, { ...meta, source: 'local-preview' });
          return admission('accepted', 'local-preview', spec, meta);
        } catch (error) { return admission(submitted ? 'accepted' : 'rejected', 'local-preview', spec, meta, error?.message || 'channel-unavailable'); }
        finally { scheduler?._releaseReservation?.(reservation?.reservationId, true); }
      }
      if (legacy.local.getState().selectedBackend === 'midi' && legacy.local.getState().enabled) {
        if (ports.sendEvent(event)) return admission('accepted', spec.outputId || 'midi-default', spec, meta);
        budgetNotice(); return admission('rejected', spec.outputId || 'midi-default', spec, meta, 'output-rejected');
      }
      return admission('rejected', null, spec, meta, 'no-enabled-sink');
    },
    onLaunchBatch: launches => dispatch({ type: 'procgen/launchedBatch', launches })
  });
  const devices = () => ({ inputs: Array.from(window.WebMidi?.inputs || []).filter(port => port.state !== 'disconnected'), outputs: Array.from(window.WebMidi?.outputs || []).filter(port => port.state !== 'disconnected') });
  let routedPortReferences = [];
  const syncPorts = ({ rearm = false, rearmDefault = false } = {}) => {
    const available = devices(), outputState = legacy.local.getState();
    const midiEnabled = outputState.selectedBackend === 'midi' && outputState.enabled;
    const selectedOutput = midiEnabled ? available.outputs.find(port => port.id === outputState.outputId) || null : null;
    const routedIds = new Set(midiEnabled ? project.procgen.lanes.map(lane => lane.outputId).filter(Boolean) : []);
    if (selectedOutput) routedIds.add(selectedOutput.id);
    const routedOutputs = available.outputs.filter(port => routedIds.has(port.id));
    const selectedInput = available.inputs.find(port => port.id === state.inputId) || null;
    const selectedClock = available.outputs.find(port => port.id === state.clockOutputId) || null;
    const references = [selectedOutput, selectedInput, selectedClock, ...routedOutputs];
    if (references.length !== routedPortReferences.length || references.some((port, index) => port !== routedPortReferences[index])) outputEpoch++;
    routedPortReferences = references;
    const laneRoutes = new Map();
    if (midiEnabled) project.procgen.lanes.forEach((lane, index) => {
      if (!lane.outputId) return;
      if (!laneRoutes.has(lane.outputId)) laneRoutes.set(lane.outputId, []);
      laneRoutes.get(lane.outputId).push(index);
    });
    ports.setNoteOutputs(available.outputs);
    ports.setNoteOutput(selectedOutput, rearmDefault ? { rearm: true } : undefined);
    ports.setActiveNoteOutputs?.([...laneRoutes].map(([outputId, laneIndices]) => ({ outputId, laneIndices, role: 'lane-note' })),
      rearm ? { rearm: true } : undefined);
    ports.setInput(selectedInput);
    ports.setClockOutput(selectedClock);
  };
  const recordCausalControl = (kind, payload) => {
    if (!causalTake) return;
    const world = runtime()?.world, tick = Number.isSafeInteger(world?.tickIndex) && world.tickIndex >= 0 ? world.tickIndex : 0;
    const generation = Number.isSafeInteger(world?.generation) && world.generation >= 0 ? world.generation : 0;
    const boundary = { tick, generation };
    try {
      const receipt = kind === 'timeline' ? causalTake.recordTimeline(payload, boundary) : causalTake.recordInput(payload, boundary);
      if (receipt.status !== 'accepted') {
        causalTake.markGap({ kind: 'all', firstTick: tick, lastTick: tick, generation, reason: 'control-record-rejected' });
        status(`Causal take control record was not admitted: ${receipt.reason}.`);
      }
    } catch (error) {
      try { causalTake.markGap({ kind: 'all', firstTick: tick, lastTick: tick, generation, reason: 'control-record-exception' }); } catch { /* Finalization retains the writer failure. */ }
      status('Causal take control record failed: ' + error.message);
    }
  };
  let pageLifecycle = null;
  function recordAcceptedCausalTransport(position) {
    if (!lastCausalTransport || !causalTake || causalTakeStop) return;
    const previous = lastCausalTransport;
    if (previous.bpm !== position.bpm) recordCausalControl('timeline', { version: 1, kind: 'tempo', bpm: position.bpm });
    if (previous.playing !== position.playing || previous.speedFactor !== position.effectiveSpeed)
      recordCausalControl('input', { version: 2, kind: 'transport-state', playing: position.playing, speedFactor: position.effectiveSpeed });
    if (previous.bpm !== position.bpm || previous.playing !== position.playing || previous.speedFactor !== position.effectiveSpeed)
      lastCausalTransport = { playing: position.playing, bpm: position.bpm, speedFactor: position.effectiveSpeed };
  }
  const play = () => {
    if (physicalAuthoringAbort) { status('Wait for physical history preparation before playing.'); return; }
    if (pageLifecycle && !pageLifecycle.resumeExplicitly()) { status('Page is suspended; return to the visible instrument before pressing Play.'); return; }
    const held = pendingResume ? engine.snapshot().active : null; pendingResume = false;
    transport.play(); if (held?.length) engine.resume({ ...transport.getState(), timestamp: now(), activeNotes: held });
    return transport.getState();
  };
  const configureTransport = patch => {
    const previous = transport.getState(), held = previous.playing ? engine.snapshot().active : null;
    transport.configure(patch);
    const next = transport.getState();
    if (held && previous.bpm !== next.bpm) { pendingResume = false; if (held.length) engine.resume({ ...next, timestamp: now(), activeNotes: held }); }
  };
  const beforeRestart = () => {
    midiConnectSerial++;
    toolGate.cancel();
    macroGestures.cancelAll(); soundTransactions.cancel('The world or transport is being replaced.');
    physicalFeedback?.disarm();
    recoveryAbort?.abort();
    if (causalTake) {
      const world = runtime()?.world, tick = Number.isSafeInteger(world?.tickIndex) && world.tickIndex >= 0 ? world.tickIndex : 0;
      const generation = Number.isSafeInteger(world?.generation) && world.generation >= 0 ? world.generation : 0;
      causalTake.markGap({ kind: 'all', firstTick: tick, lastTick: tick, generation, reason: 'transport-reset-during-take' });
    }
    transport.pause(); ports.flush(); physicalPlayback?.stop(); return transport.snapshot();
  };
  const causalBoundary = () => {
    const physical = physicalPlayback?.engine.snapshot();
    return { ...(runtime()?.world?.physicalFeedback ? { 'physical-feedback': runtime().world.physicalFeedback } : {}), sourceTimeMs: runtime()?.world?.simulationTimeMs ?? null, voices: physical?.active || [], travel: physical?.travel || null,
      contactSpans: physical?.active?.filter(voice => voice.lifetimeScope === 'contactSpan') || [],
      ...(physical?.preparedSurfaces ? { 'prepared-surfaces': physical.preparedSurfaces } : {}),
      ...(physical?.performanceInputs ? { 'instrument-performance': physical.performanceInputs } : {}),
      ...(physical?.swarm ? { swarm: physical.swarm } : {}), ...(physical?.cargo ? { cargo: physical.cargo } : {}), ...(physical?.activity ? { activity: physical.activity } : {}), ...(physical?.motifs ? { motifs: physical.motifs } : {}), ...(physical?.encounters ? { encounters: physical.encounters } : {}),
      ...(physical?.physicalDomain ? { 'physical-domain': physical.physicalDomain } : {}),
      ...(physical?.rhythmicResponses ? { 'rhythmic-responses': physical.rhythmicResponses } : {}),
      ...(physical?.actionAdmission ? { 'action-admission': physical.actionAdmission } : {}),
      ...(physical?.tonalInterpretation ? { 'tonal-interpretation': physical.tonalInterpretation } : {}),
      timeline: physicalScoreClock.snapshot() };
  };
  const causalTakeState = () => Object.freeze({ recording: !!causalTake && !causalTake.status().captureStopped,
    recovering: !!causalTake?.status().captureStopped && !causalTake.canReplaceDocument(),
    starting: !!causalTakeStart, stopping: !!causalTakeStop,
    physicalRecoveryRequired: physicalPlayback?.engine.diagnostics().recoveryRequired === true,
    active: causalTake?.status() || null, last: lastCausalTake, inspection: lastCausalInspection,
    selectedTakeId: selectedCausalTakeId, takePage: causalTakePage, takePageNumber: causalTakeBack.length + 1,
    hasPreviousTakePage: causalTakeBack.length > 0, physicalScore, physicalScoreParent,
    scoreRetirement: scoreViewRetirement?.outcome === 'partial' ? { state: scoreViewRetirement.state, outcome: scoreViewRetirement.outcome } : null,
    branchAvailable: typeof prepareInspectionWorld === 'function' && !!resourceBudget,
    workbench: causalWorkbench?.state() || (causalWorkbenchLoading ? { phase: 'loading', busy: true } : null) });
  const getCausalWorkbench = async () => {
    if (disposed || typeof prepareInspectionWorld !== 'function' || !resourceBudget) throw new Error('Isolated take worlds are unavailable.');
    if (causalWorkbench?.state().phase === 'disposed') causalWorkbench = null;
    if (causalWorkbench) return causalWorkbench;
    if (!causalWorkbenchLoading) {
      causalWorkbenchLoading = import('./CausalTakeWorkbench.js').then(({ createCausalTakeWorkbench }) => {
        if (disposed) throw new Error('The workstation closed before take preparation.');
        return causalWorkbench = createCausalTakeWorkbench({ journal: causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs }),
          createWorld: prepareInspectionWorld, resourceBudget, getRuntimeIdentity: manifest => {
            const world = runtime()?.world; if (disposed || !world || worldBusy) throw new Error('Wait for a committed current world before comparing a take.');
            return { sourceVersions: causalRuntimeSourceVersions(world, manifest.mapping.revision), assetRefs: assetIdentity(world), liveWorld: world };
          }, onState: () => view?.renderInspector?.() });
      }).finally(() => { causalWorkbenchLoading = null; view?.renderInspector?.(); }); view?.renderInspector?.();
    }
    return causalWorkbenchLoading;
  };
  const openCausalWorkbench = async ({ throughSequence = null, branch = false, takeName = null } = {}) => {
    if (causalTake || causalTakeStart || causalTakeStop || worldBusy) throw new Error('Finish the current take and world operation before comparing a stored take.');
    const takeId = selectedCausalTakeId || lastCausalTake?.takeId; if (!takeId) throw new Error('Select a stored take first.');
    beforeRestart(); const sourceSerial = causalWorkbenchSourceSerial, owner = await getCausalWorkbench();
    if (disposed || sourceSerial !== causalWorkbenchSourceSerial) throw new Error('The selected take changed before comparison began.');
    const result = await owner.open({ takeId, throughSequence, takeName, branchTakeId: branch ? createProcgenDocumentId(window.crypto).replace(/^doc:/, 'take:') : null });
    status(result.active ? 'Physical branch prepared paused. Step explicitly; the current project remains unchanged.' :
      result.receipt?.compatibilityMatch ? 'Stored take matches this current runtime. Exact archived execution and listening are separate qualifications.' :
        'Stored take comparison: ' + (result.receipt?.status || 'unavailable') + (result.receipt?.failure?.message ? ' · ' + result.receipt.failure.message : ''));
    return result;
  };
  const finishCausalBranch = async ({ discard = false } = {}) => {
    if (!causalWorkbench?.state().active) throw new Error('No physical branch is open.');
    if (discard && !window.confirm?.('Permanently discard only the unsaved branch tail? The durable prefix and omitted range will remain recorded.')) return false;
    const result = await causalWorkbench.finish({ discardPendingReason: discard ? 'performer-discarded-undurable-branch-tail' : null });
    selectedCausalTakeId = result.takeId; lastCausalTake = result; lastCausalInspection = null;
    physicalScoreAbort?.abort(); physicalScoreSerial++; retirePhysicalScoreViews();
    status(result.complete ? 'Physical branch saved. The current live project is unchanged.' : 'Physical branch saved as partial. Inspect its recorded coverage.');
    view?.renderInspector?.(); return result;
  };
  const browseCausalTakes = async (direction = 'first') => {
    if (typeof storage.listCausalTakes !== 'function') throw new Error('Causal take browsing is unavailable in this browser.');
    if (!['first', 'next', 'previous'].includes(direction)) throw new Error('Invalid take page direction.');
    if (direction === 'next' && !causalTakePage?.nextCursor || direction === 'previous' && !causalTakeBack.length) return causalTakePage;
    const cursor = direction === 'first' ? null : direction === 'next' ? causalTakePage.nextCursor : causalTakeBack.at(-1);
    const serial = ++causalTakeListSerial;
    const page = await storage.listCausalTakes({ limit: 20, cursor });
    if (disposed || serial !== causalTakeListSerial) return null;
    if (direction === 'first') causalTakeBack = [];
    else if (direction === 'next') causalTakeBack.push(causalTakeCursor);
    else causalTakeBack.pop();
    causalTakeCursor = cursor; causalTakePage = page;
    view?.renderInspector?.();
    return page;
  };
  const selectCausalTake = takeId => {
    if (!causalTakePage?.items.some(item => item.takeId === takeId)) throw new Error('Choose a take from the current page.');
    causalWorkbenchSourceSerial++;
    if (causalWorkbench?.state().busy && !causalWorkbench.state().active) causalWorkbench.cancel();
    physicalScoreAbort?.abort(); physicalScoreSerial++; retirePhysicalScoreViews();
    selectedCausalTakeId = takeId; lastCausalInspection = null; view?.renderInspector?.();
    return takeId;
  };
  const readPhysicalScore = async ({ timeDomain = 'physical-source-time', more = false } = {}) => {
    const takeId = selectedCausalTakeId || lastCausalTake?.takeId;
    if (!takeId) throw new Error('Select a saved causal take before reading its score.');
    if (more && (!physicalScore?.continuation || physicalScoreQuery?.takeId !== takeId || physicalScoreQuery.timeDomain !== timeDomain))
      throw new Error('This score window has no continuation. Start a new reading.');
    physicalScoreAbort?.abort();
    const controller = new AbortController(), serial = ++physicalScoreSerial; physicalScoreAbort = controller;
    const journal = causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs });
    let query = physicalScoreQuery;
    if (!more) {
      const metadata = await borrowCausalTake(journal, takeId, { signal: controller.signal });
      try {
        const manifest = metadata.value;
        const source = await borrowCausalPage(journal, { takeId, takeRevision: manifest.revision, kinds: ['physical-batch'], limit: 1, signal: controller.signal });
        try {
          const first = source.value;
          const batch = first.records[0];
          if (!batch || manifest.coverage?.sourceRange?.firstTick == null || manifest.coverage.sourceRange.lastTick == null)
            throw new Error('This take has no committed physical score range to read.');
          query = { takeId, takeRevision: manifest.revision, generation: batch.generation,
            coverageRange: { firstTick: manifest.coverage.sourceRange.firstTick,
              lastTick: Math.min(manifest.coverage.sourceRange.lastTick, manifest.coverage.sourceRange.firstTick + 63) },
            timeDomain, resolution: { mode: 'exact' } };
        } finally { retireCausalRead(source); }
      } finally { retireCausalRead(metadata); }
    }
    const projection = physicalScoreProjection ||= createPhysicalScoreProjection({ journal, resourceBudget, jobs: backgroundJobs, maxRecords: 512, maxSourceFacts: 1024, maxGlyphs: 64, maxBytes: 1048576 });
    const prepared = await projection.queryPhysicalScoreOwned({ ...query, cursor: more ? physicalScore.continuation : null,
      requestId: `workstation-score-${serial}`, signal: controller.signal });
    let adopted = false;
    try {
      if (disposed || controller.signal.aborted || serial !== physicalScoreSerial) return null;
      const cleanup = retirePhysicalScoreViews();
      if (cleanup.outcome !== 'complete') throw Object.assign(new Error('The previous score view has unresolved resource retirement.'), { retirement: cleanup });
      if (disposed || controller.signal.aborted || serial !== physicalScoreSerial) return null;
      const result = prepared.value; physicalScoreLease = prepared; adopted = true;
      physicalScoreQuery = query; physicalScore = result;
      view?.renderInspector?.();
      status(`Physical score: ${result.counts.glyphs} source glyphs in this bounded window; ${result.unknownRegions.length} uncertain regions.`);
      return result;
    } finally { if (!adopted) retireCausalRead(prepared); }
  };
  const inspectPhysicalScoreCause = async ({ sourceSequence, eventId } = {}) => {
    if (!physicalScoreQuery || !physicalScore?.glyphs.some(glyph => glyph.glyphId === eventId && glyph.source.sequence === sourceSequence))
      throw new Error('Choose a source glyph from the current score window.');
    physicalScoreAbort?.abort(); const controller = new AbortController(); physicalScoreAbort = controller;
    const serial = ++physicalScoreSerial, requestId = `workstation-score-parent-${serial}`;
    const prepared = await physicalScoreProjection.queryCausalParentOwned({ ...physicalScoreQuery, sourceSequence, eventId, requestId, signal: controller.signal });
    let adopted = false;
    try {
      if (disposed || controller.signal.aborted || serial !== physicalScoreSerial) return null;
      const cleanup = retirePhysicalScoreViews({ parentOnly: true });
      if (cleanup.outcome !== 'complete') throw Object.assign(new Error('The previous causal parent view has unresolved resource retirement.'), { retirement: cleanup });
      if (disposed || controller.signal.aborted || serial !== physicalScoreSerial) return null;
      const result = prepared.value; physicalScoreParentLease = prepared; adopted = true;
      physicalScoreParent = result; view?.renderInspector?.(); return result;
    } finally { if (!adopted) retireCausalRead(prepared); }
  };
  const stopCausalTake = async ({ reason = 'user-stop' } = {}) => {
    if (causalTakeStart) { try { await causalTakeStart; } catch { if (!causalTake) return lastCausalTake; } }
    if (causalMarkerCheckpoint) await causalMarkerCheckpoint.catch(() => {});
    if (causalTakeStop) return causalTakeStop;
    if (!causalTake) return lastCausalTake;
    const recorder = causalTake;
    let finalCheckpoint = null;
    try {
      const world = runtime()?.world;
      if (!world) throw new Error('The recorded world is no longer available.');
      sampleMacroPerformance({ tick: world.tickIndex, generation: world.generation });
      if (!recorder.status().captureStopped) finalCheckpoint = { world: captureCheckpoint(world), engine: physicalPlayback?.engine.snapshot() || null,
        timeline: physicalScoreClock.snapshot(), replay: { version: 2, bpm: transport.getState().bpm, scoreTimeline: true, playing: transport.getState().playing } };
    } catch (error) {
      const world = runtime()?.world, tick = Number.isSafeInteger(world?.tickIndex) && world.tickIndex >= 0 ? world.tickIndex : 0;
      const generation = Number.isSafeInteger(world?.generation) && world.generation >= 0 ? world.generation : 0;
      try { recorder.markGap({ kind: 'all', firstTick: tick, lastTick: tick, generation, reason: 'final-checkpoint-unavailable' }); }
      catch { /* The recorder still owns its pending durable prefix. */ }
      status('Causal take final checkpoint unavailable: ' + error.message);
    }
    causalTakeStop = recorder.stop({ boundaryState: causalBoundary(), finalCheckpoint, reason }).then(receipt => {
      lastCausalTake = receipt;
      selectedCausalTakeId = receipt.takeId;
      physicalAuthoringAbort?.abort(); physicalScoreAbort?.abort(); physicalScoreSerial++; retirePhysicalScoreViews();
      if (!recorder.canReplaceDocument()) throw new Error('Causal take saving needs recovery. Retry saving, or explicitly discard the unsaved tail before replacing the world.');
      if (causalTake === recorder) causalTake = null;
      status(receipt.complete ? `Causal take ${receipt.takeId} saved.` :
        `Causal take ${receipt.takeId} saved as partial. Inspect its coverage before relying on it.`);
      return receipt;
    }).finally(() => { causalTakeStop = null; view?.renderInspector?.(); });
    return causalTakeStop;
  };
  const discardCausalTail = async () => {
    if (!causalTake?.status().captureStopped || causalTakeStop) throw new Error('Finish the current saving attempt before discarding its unsaved tail.');
    if (!window.confirm?.('Permanently discard the unsaved causal take tail? The saved prefix and exact omitted range will remain inspectable.')) return false;
    causalTake.discardPending({ reason: 'performer-discarded-undurable-tail' });
    return stopCausalTake({ reason: 'explicit-tail-discard' });
  };
  const startCausalTake = async ({ takeName = 'Untitled take' } = {}) => {
    if (causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current causal take first.');
    if (worldBusy || !runtime()?.world || !physicalPlayback) throw new Error('Wait for the committed world before recording a causal take.');
    if (!['commitCausalTake', 'loadCausalTake', 'loadCausalChunk', 'loadCausalCheckpoint'].every(key => typeof storage[key] === 'function'))
      throw new Error('Causal take storage is unavailable in this browser.');
    const wasPlaying = transport.getState().playing;
    beforeRestart();
    causalTakeArmCanceled = false;
    const sourceRuntime = runtime();
    try {
      const capturedWorld = captureCheckpoint(sourceRuntime.world);
      const physical = physicalPlayback.engine.snapshot(), timeline = physicalScoreClock.snapshot();
      const takeId = createProcgenDocumentId(window.crypto).replace(/^doc:/, 'take:');
      const sourceVersions = causalRuntimeSourceVersions(sourceRuntime.world, project.procgen.physicalGraph.revision, capturedWorld.version);
      const journal = causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs });
      const pending = createCausalTakeRecorder({ journal, takeId, takeName, documentId: documentId || `unsaved:${takeId}`,
        sourceVersions, initialCheckpoint: { world: capturedWorld, engine: physical, timeline,
          replay: { version: 2, bpm: transport.getState().bpm, scoreTimeline: true, playing: wasPlaying } },
        mapping: project.procgen.physicalGraph, assetRefs: capturedWorld.assets || [], boundaryState: causalBoundary() });
      causalTakeStart = pending;
      view?.renderInspector?.();
      const recorder = await pending;
      if (disposed || causalTakeArmCanceled || runtime() !== sourceRuntime) {
        await recorder.stop({ boundaryState: causalBoundary(), reason: 'source-replaced-during-arm' });
        throw new Error(causalTakeArmCanceled ? 'Causal take arming was canceled.' : 'The world changed while the causal take was arming.');
      }
      causalTake = recorder; sampledMacroPerformance = captureCausalPerformanceState(project.procgen.lanes); sampledMacroRevision = macroGestures.revision();
      lastCausalTransport = { playing: wasPlaying, bpm: transport.getState().bpm, speedFactor: sourceRuntime.world.timer.speedFactor };
      lastCausalInspection = null;
      causalTakeErrorReported = false;
      status(`Causal take ${takeId} recording committed world facts and musical intents.`);
      return recorder.status();
    } finally {
      causalTakeStart = null;
      if (wasPlaying && !disposed && runtime() === sourceRuntime) play();
      view?.renderInspector?.();
    }
  };
  const cancelCausalTakeArm = () => {
    if (!causalTakeStart) return false;
    causalTakeArmCanceled = true; status('Canceling causal take preparation after storage responds.');
    return true;
  };
  const markCausalTake = async (label, { checkpoint = false } = {}) => {
    if (!causalTake || causalTakeStop) throw new Error('Arm a causal take before adding a marker.');
    if (typeof checkpoint !== 'boolean' || checkpoint && causalMarkerCheckpoint) throw new Error('Wait for the active component checkpoint before requesting another.');
    const recorder = causalTake, world = runtime()?.world, cursor = recorder.status().sourceBoundary;
    if (!Number.isSafeInteger(cursor?.tick) || !Number.isSafeInteger(cursor?.generation)) throw new Error('Record a committed physical batch before marking its boundary.');
    let workspace = null, pending = null;
    try {
      let value = null;
      if (checkpoint) {
        if (!world || worldBusy || world.tickIndex !== cursor.tick || world.generation !== cursor.generation || !physicalPlayback) throw new Error('A component checkpoint needs the current committed physical boundary.');
        workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-marker-checkpoint', kind: 'component-snapshot-workspace-estimate', bytes: 64 * 1048576 });
        recordAcceptedCausalTransport(transport.getState()); sampleMacroPerformance(cursor);
        value = { world: captureCheckpoint(world), engine: physicalPlayback.engine.snapshot(), timeline: physicalScoreClock.snapshot(),
          replay: { version: 2, bpm: transport.getState().bpm, scoreTimeline: true, playing: transport.getState().playing } };
      }
      const receipt = recorder.mark({ label: String(label || 'Marker').slice(0, 120), boundary: 'last-committed-physical-tick' }, { tick: cursor.tick, generation: cursor.generation });
      if (receipt.status !== 'accepted') throw new Error(`The causal marker was not admitted: ${receipt.reason}.`);
      let component = null;
      if (checkpoint) { pending = recorder.checkpoint({ value, tick: cursor.tick, generation: cursor.generation }); causalMarkerCheckpoint = pending; component = await pending; }
      if (!disposed && causalTake === recorder) status(`Marker added at committed physical tick ${cursor.tick}${component ? ' with a durable component checkpoint' : ''}.`);
      return component ? Object.freeze({ ...receipt, checkpoint: component }) : receipt;
    } finally { if (causalMarkerCheckpoint === pending) causalMarkerCheckpoint = null; workspace?.release(); }
  };
  let causalInspectionRevision = 0;
  const inspectLastCausalTake = async () => {
    const request = ++causalInspectionRevision, ownerGeneration = documentGeneration;
    const takeId = selectedCausalTakeId || lastCausalTake?.takeId;
    if (!takeId) throw new Error('Select a causal take before inspecting it.');
    const journal = causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs });
    const current = () => !disposed && request === causalInspectionRevision && documentGeneration === ownerGeneration && takeId === (selectedCausalTakeId || lastCausalTake?.takeId);
    const verification = await journal.verify(takeId);
    if (!current()) return Object.freeze({ status: 'superseded', takeId });
    const manifest = await journal.openTake(takeId);
    if (!current()) return Object.freeze({ status: 'superseded', takeId });
    lastCausalInspection = Object.freeze({ takeId, takeName: manifest.takeName, revision: manifest.revision,
      status: verification.status, durableSequence: manifest.durableSequence,
      firstTick: manifest.coverage?.sourceRange?.firstTick ?? null,
      lastTick: manifest.coverage?.sourceRange?.lastTick ?? null,
      gaps: manifest.coverage?.gaps?.length ?? 0, paused: manifest.inspection.paused });
    view?.renderInspector?.();
    status(`Verified ${manifest.takeName}: ${verification.status}, ${manifest.durableSequence} durable records.`);
    return lastCausalInspection;
  };
  const settingsFor = (source = project, patch = {}) => ({ ...acceptedWorldSettings, ...patch, workstation: true,
    speed: transport.getState().gameSpeed, laneCount: source.procgen.lanes.length, seed: source.procgen.seed,
    laneAssignments: source.procgen.lanes.map(lane => lane.worldThemeId) });
  const prepareSettings = () => { Object.assign(legacy.settings, settingsFor(project, pendingWorldSettings || {})); return legacy.settings; };
  const acceptWorldSettings = settings => {
    acceptedWorldSettings = { ...settings, laneAssignments: [...(settings.laneAssignments || [])] };
    state.hazardSpacing = acceptedWorldSettings.hazardSpacing;
  };
  const attachRouter = next => {
    if (!next) return;
    if (!routerRestores.has(next)) routerRestores.set(next, { event: next.workstationEventHandler, automation: next.getAutomationSpanState });
    next.workstationEventHandler = () => true;
    next.getAutomationSpanState = (id, lane) => engine.getAutomationSpanState?.(id, lane);
    next.resetClock?.({ preserveGamePhrases: true });
  };
  const bindRuntime = ({ session, historyRestore = false } = {}) => {
    if (disposed) return null;
    let sessionIdentity = null;
    if (session) { sessionIdentity = sessionIdentities.get(session); if (!sessionIdentity) { sessionIdentity = Object.freeze({}); sessionIdentities.set(session, sessionIdentity); } }
    const next = runtime(); if (!next || (next === boundRuntime && sessionIdentity === boundSession)) return next;
    if (causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the causal take before replacing its world.');
    recoveryAbort?.abort(); soundTransactions.cancel('The physical playback owner changed.');
    unhookRouter?.(); unhookWorld?.(); physicalPlayback?.dispose(); physicalPlayback = null; laneDisplayWorldEpoch++; boundRuntime = next; boundSession = sessionIdentity;
    const boundProject = session?.project || project; let bindingSession = !!session;
    const playbackProject = () => bindingSession ? boundProject : project;
    next.world?.configurePhysicalAuthoring?.(boundProject.procgen.physicalGraph, boundProject.procgen.fragmentInstances || []);
    if (next.world?.prepareInterventions) prepareProjectJunctions(next.world, boundProject.procgen.junctions || []).commit();
    laneObserver = createProcgenLaneObserver(next.world);
    const bus = next.world?.soundEvents?.onEvent;
    const physicalBus = next.world?.soundEvents?.onBatch;
    physicalScoreClock = createProcgenPhysicalScoreClock(); physicalClockError = false;
    if (session?.physicalTimeline) physicalScoreClock.restore(session.physicalTimeline);
    let physicalDocumentEpoch = documentGeneration;
    const onPhysicalReceipt = receipt => {
      if (physicalDocumentEpoch !== documentGeneration || runtime()?.world !== next.world) return;
      physicalLessonView?.observeReceipt(receipt, physicalDocumentEpoch);
      if (causalTake && physicalReceiptBoundary && receipt.stage === 'effect-performance-capture') causalTake.markGap({ kind: 'effect-performance', firstTick: physicalReceiptBoundary.tick, lastTick: physicalReceiptBoundary.tick, generation: physicalReceiptBoundary.generation, reason: 'effect-performance-not-admitted' });
      if (physicalReceiptBuffer) physicalReceiptBuffer.push(receipt);
      else if (causalTake && physicalReceiptBoundary) { const recorded = causalTake.recordSinkOutcome(receipt, physicalReceiptBoundary); if (receipt.schema === 'lemmings-effect-performance/v1' && recorded.status !== 'accepted') causalTake.markGap({ kind: 'effect-performance', firstTick: physicalReceiptBoundary.tick, lastTick: physicalReceiptBoundary.tick, generation: physicalReceiptBoundary.generation, reason: 'effect-performance-not-admitted' }); }
      if (!physicalReceiptBuffer) { try { if (laneDisplayEvidence.receipt(laneDisplaySource(next.world), receipt)) view?.refreshLaneDisplays?.(); } catch {} }
    };
    const physicalMidi = createCausalMidiSink({ ports, now, getLanes: () => effectiveSoundLanes(playbackProject().procgen.lanes),
      isEnabled: () => { const output = legacy.local.getState(); return output.selectedBackend === 'midi' && output.enabled; }, onReceipt: onPhysicalReceipt });
    physicalPlayback = createProcgenPhysicalPlayback({ initialMorphMechanism: boundProject.procgen.sceneOrigin?.recipe.initialMorphMechanism || null, documentEpoch: 'procgen-document-' + documentGeneration, isEffectCaptureEnabled: () => !!causalTake, world: next.world, audio: legacy.local.audio, getInstrumentCatalog, renderer: next.lanes?.renderer, resourceBudget,
      additionalOutputs: [physicalMidi],
      onIntentProvenance: value => {
        if (!physicalProvenanceBuffer || physicalDocumentEpoch !== documentGeneration || runtime()?.world !== next.world) return;
        if (value.kind === 'omitted') { physicalProvenanceDropped += value.count; return; }
        if (physicalProvenanceBuffer.length < 512) physicalProvenanceBuffer.push(value); else physicalProvenanceDropped++;
      },
      getGraph: () => next.world.physicalAuthoring?.graph || playbackProject().procgen.physicalGraph, getLanes: () => effectiveSoundLanes(playbackProject().procgen.lanes), isPlaybackEnabled: localEnabled, scoreTimeline: physicalScoreClock, now,
      onInstrumentState: event => { if (event.state === 'unavailable' || event.state === 'retirement-unknown') status('Lane ' + event.laneId + ' instrument: ' + event.code); },
      onReceipt: onPhysicalReceipt });
    void physicalPlayback.synchronizeLaneInstruments(boundProject.procgen.lanes).catch(error => status('Saved lane instruments: ' + error.message));
    if (session?.physicalState) physicalPlayback.engine.restore(session.physicalState);
    if (typeof next.world.step === 'function') physicalFeedback = createPhysicalFeedbackController({ world: next.world, resourceBudget, getGraph: () => project.procgen.physicalGraph, recordInput: (input, boundary) => causalTake ? causalTake.recordInput(input, boundary) : { status: 'accepted' }, onStatus: status, onFailure: () => { transport.pause(); physicalPlayback?.stop(); } });
    const onGameEvent = event => { if (transport.getState().playing) engine.onGameEvent(event, now()); };
    const markPhysicalGap = (batch, reason) => {
      if (!causalTake) return;
      const tick = Number.isSafeInteger(batch?.tick) && batch.tick >= 0 ? batch.tick : 0;
      const generation = Number.isSafeInteger(batch?.generation) && batch.generation >= 0 ? batch.generation : 0;
      try { causalTake.markGap({ kind: 'physical-facts', firstTick: tick, lastTick: tick, generation, reason }); }
      catch (error) { status('Causal take coverage gap could not be written: ' + error.message); }
    };
    const onPhysicalBatch = batch => {
      const applied = Array.isArray(batch?.facts) ? batch.facts.findLast(fact => fact.kind === 'CommandApplied' && fact.terrain?.authoring) : null;
      if (applied) {
        const authored = next.world.physicalAuthoring;
        if (authored.lastApplied?.transactionId === applied.transactionId) {
          const previous = project;
          if (pendingPhysicalAuthoring?.commandId === applied.commandId) { pendingPhysicalAuthoring.capsule.promote(previous); pendingPhysicalAuthoring.promoted = true; }
          project = sealMidiProjectSnapshot(markCanonicalMidiProject({ ...project, procgen: { ...project.procgen, revision: project.procgen.revision + 1, physicalGraph: authored.graph, fragmentInstances: authored.instances, junctions: next.world.physicalJunctions.definitions } }));
          undo.push(previous); redo.length = 0; lastHistoryGroup = null; trimHistory(); projectRevision++; editRevision++; storageStatus(); view?.render(); persist();
        }
      }
      physicalJunctionView?.refresh(); physicalAuthoringView?.refresh();
      let position;
      try {
        position = physicalScoreClock.observe(batch, transport.getState());
      } catch (error) {
        markPhysicalGap(batch, 'clock-observation-failed');
        if (!physicalClockError) status('Physical score clock: ' + error.message);
        physicalClockError = true; return;
      }
      try {
        physicalReceiptBoundary = { tick: batch.tick, generation: batch.generation }; sampleMacroPerformance(physicalReceiptBoundary);
        physicalReceiptBuffer = []; physicalProvenanceBuffer = []; physicalProvenanceDropped = 0;
        const intents = physicalPlayback?.processBatch(batch, { bpm: transport.getState().bpm,
          playing: transport.getState().playing, position });
        try { laneDisplayEvidence.observe({ sourceKey: laneDisplaySource(next.world, batch.generation), batch, intents: intents || [], receipts: physicalReceiptBuffer, provenances: physicalProvenanceBuffer, provenanceDropped: physicalProvenanceDropped, lanes: playbackProject().procgen.lanes }); view?.refreshLaneDisplays?.(); } catch {}
        if (causalTake) {
          const receipt = causalTake.recordCommittedBatch({ batch, intents: intents || [], deliveryOutcomes: physicalReceiptBuffer, bodyCommands: physicalPlayback?.engine.bodyPreparations()?.batchId === batch.batchId ? physicalPlayback.engine.bodyPreparations().commands : [], probability: physicalPlayback?.engine.probabilityAnalysis()?.batchId === batch.batchId ? physicalPlayback.engine.probabilityAnalysis() : null });
          if (receipt.status === 'rejected') { physicalFeedback?.disarm(); markPhysicalGap(batch, 'capture-admission-rejected'); }
          if (receipt.status === 'rejected' && !causalTakeErrorReported) {
            status(`Causal take became partial: ${receipt.reason}. Stop and inspect it.`); causalTakeErrorReported = true;
          }
        }
        if (physicalLessonView?.isObserving()) physicalLessonView.observe({ batch, intents: intents || [], receipts: physicalReceiptBuffer || [], context: { assists: next.world.assists, junctionDefinitions: next.world.physicalJunctions.definitions, junctionStates: next.world.physicalJunctions.definitions.map(value => next.world.queryJunction(value.id, { includeDefinition: false }).actual).filter(Boolean), documentEpoch: physicalDocumentEpoch, activeActors: next.world.activeCount, graph: next.world.physicalAuthoring?.graph || project.procgen.physicalGraph, releaseGesture: next.world.population?.releaseGesture, soundIdentity: effectiveSoundLanes(playbackProject().procgen.lanes).map(lane => lane.instrumentRef?.definitionHash || lane.instrumentPatchId).join('|') } });
        physicalFeedback?.observe(batch, physicalPlayback?.engine.physicalAnalysis());
      }
      catch (error) {
        markPhysicalGap(batch, 'capture-exception');
        if (!causalTakeErrorReported) status('Physical performance capture: ' + error.message);
        causalTakeErrorReported = true;
      }
      finally { physicalReceiptBuffer = null; physicalProvenanceBuffer = null; }
    };
    bus?.on?.(onGameEvent); physicalBus?.on?.(onPhysicalBatch);
    const display = next.lanes?.renderer;
    const previousDisplayStatus = display?.onDisplayState;
    const onDisplayStatus = receipt => {
      try { previousDisplayStatus?.call(display, receipt); } finally { view?.displayState?.(receipt); }
    };
    if (display) { display.onDisplayState = onDisplayStatus; view?.displayState?.(display.getDisplayState?.()); }
    unhookWorld = () => {
      bus?.off?.(onGameEvent); physicalBus?.off?.(onPhysicalBatch);
      physicalFeedback?.dispose(); physicalFeedback = null;
      worldInspector?.dispose(); worldInspector = null;
      physicalPlayback?.dispose(); physicalPlayback = null;
      if (display?.onDisplayState === onDisplayStatus) display.onDisplayState = previousDisplayStatus;
    };
    next.lanes?.setClockDriven?.(true);
    if (next.view?.setMidiPreviewRouter) {
      const owner = next.view, original = owner.setMidiPreviewRouter;
      owner.setMidiPreviewRouter = function(value, ...args) { const result = original.call(this, value, ...args); attachRouter(value); syncPorts(); return result; };
      unhookRouter = () => {
        owner.setMidiPreviewRouter = original;
        for (const [attached, previous] of routerRestores) { attached.workstationEventHandler = previous.event; attached.getAutomationSpanState = previous.automation; }
        routerRestores.clear();
      };
    }
    attachRouter(next.view?.midiPreviewRouter);
    if (session) {
      ports.configure({ recording: false, thru: false });
      documentGeneration++;
      physicalDocumentEpoch = documentGeneration;
      if (legacy.local.getState().selectedBackend === 'midi') legacy.local.stop?.();
      cancelInputEdits('project loaded');
      if (!historyRestore) { documentId = null; documentRevision = 0; savedRevision = -1; lastSavedAt = null; } storageStatus();
      suppressPersistence = true;
      try {
        syncProject(session.project, { history: false, render: false, restoringWorld: true }); Object.assign(legacy.settings, session.settings, { workstation: true });
        acceptWorldSettings(legacy.settings);
        lastLegacySpeed = legacy.settings.speed;
        Object.assign(state, session.ui || {}, { hazardSpacing: acceptedWorldSettings.hazardSpacing, recording: false, thru: false, inputId: null, clockOutputId: null }); savedName = session.name;
        transport.restore(session.project?.procgen?.sceneOrigin ? { ...session.transport, playing: false } : session.transport); engine.restore(session.patterns); pendingResume = true;
        if (session.camera) renderer()?.camera?.applyState?.(session.camera);
      } finally { suppressPersistence = false; }
      view?.recording?.(false, recordingViewState(ports.getState())); if (!historyRestore) { undo.length = 0; redo.length = 0; physicalHistory.clear(); } status(historyRestore ? 'Physical history restored at its checkpoint, paused.' : 'Project loaded paused. Press Play to resume.');
    }
    bindingSession = false; prepareSettings(); legacy.setPaused(!transport.getState().playing); lastPlaying = transport.getState().playing;
    const timer = next.world?.timer; if (timer) timer.speedFactor = transport.getState().effectiveSpeed;
    syncPorts(); view?.render(); view?.transport(transport.getState());
    worldInspector = createProcgenWorldInspector({ renderer: display, document, window,
      parent: document.querySelector?.('.studio-inspector'), getLaneInfo: lane => project.procgen.lanes[lane] || null,
      onRevealLane: lane => view?.revealLane?.(project.procgen.lanes[lane]?.id) });
    if (legacy.local.getState().status === 'suspended') Promise.resolve(legacy.local.resumeGame?.()).catch(error => status(error?.message || 'Reconnect the audio output.'));
    if (!session && !pendingResume && !project.procgen.sceneOrigin) play();
    if (!startupCommitted && startupPlan.mode === 'document') {
      documentId = startupPlan.sourceIdentity.id; documentRevision = startupPlan.sourceIdentity.revision;
      savedRevision = editRevision; lastSavedAt = session?.savedAt || null;
    }
    startupCommitted = true; startupFailure = null;
    persist(); return next;
  };
  const snapshotSession = (name, { recovery = false } = {}) => {
    if (worldBusy) throw new Error('Wait for the world change to finish before saving.');
    syncWorldSeed();
    const journal = recovery && getProcgenRecoveryJournal(runtime().world);
    return createProcgenSession({ name, project: recovery ? project : clone(project), settings: clone(settingsFor()),
      world: journal ? journal.checkpoint() : captureCheckpoint(runtime().world), recoveryJournal: journal ? journal.snapshot() : null,
      transport: transport.snapshot(), patterns: engine.snapshot(), physicalTimeline: physicalScoreClock.snapshot(),
      physicalState: physicalPlayback?.engine.snapshot() || null,
      camera: renderer()?.camera?.getState?.(), ui: { ...state, hazardSpacing: acceptedWorldSettings.hazardSpacing, recording: false, thru: false, lastMidi: '' } });
  };
  const capturePhysicalHistory = async (sourceWorld, sourceProject, signal) => {
    const sourceGeneration = documentGeneration, sourceTick = sourceWorld.tickIndex;
    return physicalHistory.capture(sourceWorld, sourceProject, (checkpoint, capturedProject) => createProcgenSession({ name: savedName, project: capturedProject, settings: clone(settingsFor(capturedProject)), world: checkpoint,
      transport: transport.snapshot(), patterns: engine.snapshot(), physicalTimeline: physicalScoreClock.snapshot(), physicalState: physicalPlayback?.engine.snapshot() || null,
      camera: renderer()?.camera?.getState?.(), ui: { ...state, hazardSpacing: acceptedWorldSettings.hazardSpacing, recording: false, thru: false, lastMidi: '' } }),
    { signal, isCurrent: () => !disposed && runtime()?.world === sourceWorld && project === sourceProject && documentGeneration === sourceGeneration && sourceWorld.tickIndex === sourceTick && !transport.getState().playing });
  };
  const applyPausedPhysicalCommand = async buildCommand => {
    if (disposed || worldBusy || pendingHistory || physicalAuthoringAbort || causalTake || causalTakeStart || causalTakeStop || transport.getState().playing) throw new Error('Pause playback and finish the take/world operation before physical authoring. Use a physical branch for recorded performance edits.');
    const sourceWorld = runtime()?.world, previous = project; if (sourceWorld?.interventionState.pending.length) throw new Error('Let existing physical requests reach a boundary before authoring a new transaction.'); if (!sourceWorld || sourceWorld._failedTick || !Number.isSafeInteger(project.procgen.revision + 1)) throw new Error('No writable physical authoring boundary.');
    beforeRestart(); const controller = new AbortController(); physicalAuthoringAbort = controller; worldBusy = true; let capsule = null;
    try {
      capsule = await capturePhysicalHistory(sourceWorld, previous, controller.signal); controller.signal.throwIfAborted();
      if (!Number.isSafeInteger(++physicalAuthoringSerial)) throw new Error('Physical authoring command identity exhausted.');
      const command = buildCommand(sourceWorld, project, `physical-author:${sourceWorld.generation}:${sourceWorld.tickIndex}:${physicalAuthoringSerial}`), proposal = sourceWorld.prepareIntervention(command);
      if (proposal.outcome.status !== 'queued') throw new Error('Physical authoring was not admitted: ' + proposal.outcome.reason);
      pendingPhysicalAuthoring = { commandId: command.id, capsule, promoted: false }; proposal.commit(); sourceWorld.step();
      const receipt = sourceWorld.interventionState.receipts.findLast(value => value.commandId === command.id);
      if (receipt?.status !== 'accepted') throw new Error('Physical authoring rejected without a partial candidate: ' + (receipt?.reason || 'missing receipt'));
      if (!pendingPhysicalAuthoring.promoted || project.procgen.physicalGraph !== sourceWorld.physicalAuthoring.graph || !undo.includes(previous)) { if (pendingPhysicalAuthoring.promoted && !undo.includes(previous)) undo.push(previous); throw new Error('Physical authoring applied but its project/history publication failed. Prior checkpoint retained; export recovery before continuing.'); }
      status(`Physical authoring applied at tick ${sourceWorld.tickIndex}; playback remains paused.`); return receipt;
    } finally {
      if (!pendingPhysicalAuthoring?.promoted) capsule?.discard(); pendingPhysicalAuthoring = null;
      if (physicalAuthoringAbort === controller) physicalAuthoringAbort = null; worldBusy = false; if (!disposed) { persist(); view?.render(); }
    }
  };
  const recover = async () => {
    if (disposed || worldBusy || recoveryPending || !runtime()?.world) return false;
    if (recoveryTimer != null) { window.clearTimeout?.(recoveryTimer); recoveryTimer = null; }
    recoveryPending = true; lastRecovery = now(); recoveryState = 'saving'; recoveryError = null; storageStatus();
    const controller = new AbortController(); recoveryAbort = controller;
    const sourceDocumentGeneration = documentGeneration;
    let capturedRevision = editRevision, capturedTick = runtime().world.tickIndex ?? null;
    try {
      const world = runtime().world, journal = getProcgenRecoveryJournal(world);
      if (journal && !journal.stats().complete) {
        if (transport.getState().playing) throw new Error('Recovery journal needs compaction. Pause playback to capture a new bounded checkpoint.');
        await prepareProcgenRecoveryJournal(world, { resourceBudget, signal: controller.signal,
          isCurrent: () => !disposed && runtime()?.world === world && documentGeneration === sourceDocumentGeneration && !transport.getState().playing });
      }
      const captureRecovery = () => {
        if (disposed || documentGeneration !== sourceDocumentGeneration) throw new Error('Recovery document changed before snapshot admission.');
        const snapshotStarted = now(); let session;
        try { session = snapshotSession(savedName + ' (recovery)', { recovery: true }); }
        finally { const elapsed = Math.max(0, now() - snapshotStarted); recoverySnapshotStats.calls++; recoverySnapshotStats.lastMs = elapsed; recoverySnapshotStats.totalMs += elapsed; recoverySnapshotStats.maximumMs = Math.max(recoverySnapshotStats.maximumMs, elapsed); }
        capturedRevision = editRevision; capturedTick = runtime().world.tickIndex ?? null; return session;
      };
      const source = storage.supportsRecoveryFactory ? captureRecovery : captureRecovery();
      const receipt = storage.saveRecovery ? await storage.saveRecovery(source, { signal: controller.signal, documentRevision: capturedRevision, tick: capturedTick,
        laneCount: runtime().world.laneCount, incremental: !!getProcgenRecoveryJournal(runtime().world), snapshotMetadata: () => ({ documentRevision: capturedRevision, tick: capturedTick }) }) : await storage.save('__recovery__', source);
      if (receipt?.durable) lastRecoveryCommit = Object.freeze({ documentGeneration: sourceDocumentGeneration, documentRevision: capturedRevision, tick: capturedTick, generation: receipt.generation, canceledAfterCommit: receipt.canceledAfterCommit || controller.signal.aborted, retirement: receipt.retirement || null });
      if (disposed) return false;
      if (documentGeneration !== sourceDocumentGeneration || controller.signal.aborted && !receipt?.durable) { recoveryState = 'pending'; storageStatus(); return false; }
      recoveryRetirement = receipt?.retirement || null;
      if (recoveryRetirement?.status === 'unknown') status('Recovery is durably saved; resource cleanup is unresolved. New large operations may remain blocked.');
      durableRecoveryRevision = capturedRevision; durableRecoveryTick = capturedTick;
      durableRecoveryGeneration = receipt?.generation ?? durableRecoveryGeneration;
      recoveryState = editRevision === capturedRevision ? 'saved' : 'pending'; storageStatus();
      return true;
    }
    catch (error) {
      if (disposed) return false;
      if (controller.signal.aborted) { recoveryState = 'pending'; storageStatus(); return false; }
      recoveryState = 'unavailable'; recoveryError = error; storageStatus();
      if (now() - lastRecoveryError >= 60000) {
        lastRecoveryError = now(); status('Recovery checkpoint was not saved. Export this project if storage remains unavailable. ' + (error?.message || ''));
      }
      return false;
    }
    finally {
      if (recoveryAbort === controller) recoveryAbort = null;
      recoveryPending = false;
      if (!disposed && recoveryState === 'pending' && !transport.getState().playing) scheduleRecovery();
    }
  };
  const capture = (name = savedName, { resume = true } = {}) => {
    if (worldBusy) throw new Error('Wait for the world change to finish before saving.');
    if (!runtime()?.world) throw new Error('The world is not ready to save.');
    const wasPlaying = transport.getState().playing; beforeRestart();
    try {
      return snapshotSession(name);
    } finally { if (resume && wasPlaying) play(); }
  };
  let preparedExport = null, lastDelivery = null, activeExportAbort = null, midiExportPreparation = null, archiveExportPreparation = null, lastMidiExportReceipt = null, exportPreparationRevision = 0;
  const archiveExportTasks = new Set();
  const exportPreparationState = () => archiveExportPreparation && !archiveExportPreparation.controller.signal.aborted ? Object.freeze({ kind: 'causal-take', phase: 'verifying sources', completedUnits: 0, totalUnits: null }) : midiExportPreparation && !midiExportPreparation.controller.signal.aborted ? Object.freeze({ kind: 'midi', phase: midiExportPreparation.phase,
    completedUnits: midiExportPreparation.completedUnits, totalUnits: midiExportPreparation.totalUnits }) : null;
  const publishExportState = () => { if (!disposed) view?.exportState?.(preparedExport?.metadata() || null, lastDelivery, exportPreparationState()); };
  const prepareDownload = ({ bytes, filename, type, sourceRef, formatVersion, lossRef = null }) => {
    if (disposed) throw new Error('The export owner is retired.');
    ++exportPreparationRevision;
    const artifact = prepareExportArtifact({ bytes, immutableSourceRef: sourceRef, formatVersion,
      mediaType: type, suggestedFilename: filename, coverageLossReportRef: lossRef, budgetAdapter: resourceBudget });
    preparedExport?.discard(); preparedExport = artifact; lastDelivery = null; publishExportState();
    artifact.digest().then(() => { if (preparedExport === artifact && !disposed) publishExportState(); });
    return artifact;
  };
  const prepareCausalArchive = ({ signal } = {}) => {
    signal?.throwIfAborted();
    if (disposed) throw new Error('The export owner is retired.');
    if (causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the causal take before preparing its archive.');
    const takeId = selectedCausalTakeId || lastCausalTake?.takeId;
    if (!takeId) throw new Error('No finished causal take is selected.');
    if (archiveExportTasks.size >= 4) throw new Error('Previous archive preparations are still retiring. Retry after their source reads settle.');
    archiveExportPreparation?.controller.abort(); midiExportPreparation?.controller.abort();
    if (currentOperation?.kind === 'export') currentOperation.controller.abort();
    const request = ++exportPreparationRevision, ownerGeneration = documentGeneration, controller = new AbortController();
    const pending = { controller }, cancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true }); archiveExportPreparation = pending; publishExportState();
    const isCurrent = () => !disposed && !controller.signal.aborted && request === exportPreparationRevision && ownerGeneration === documentGeneration && takeId === (selectedCausalTakeId || lastCausalTake?.takeId);
    const journal = causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs });
    const work = (async () => {
      try {
        const prepared = await prepareCausalTakeArchive({ journal, storage, takeId, resourceBudget, jobs: backgroundJobs, signal: controller.signal });
        if (!isCurrent()) { prepared.artifact.discard(); return Object.freeze({ status: 'superseded', takeId }); }
        preparedExport?.discard(); preparedExport = prepared.artifact; lastDelivery = null;
        publishExportState(); status(`Causal take ${prepared.manifest.takeName} archive ready. Use Save file to stream its verified source records.`);
        return prepared.artifact.metadata();
      } catch (error) { if (!isCurrent()) return Object.freeze({ status: 'superseded', takeId }); throw error; }
      finally {
        signal?.removeEventListener('abort', cancel);
        if (archiveExportPreparation === pending) { archiveExportPreparation = null; if (request === exportPreparationRevision) publishExportState(); }
      }
    })();
    archiveExportTasks.add(work); work.then(() => archiveExportTasks.delete(work), () => archiveExportTasks.delete(work)); return work;
  };
  const deliverPrepared = () => {
    if (!preparedExport) return null;
    lastDelivery = deliverArtifactToAnchor(preparedExport, { document, windowRef: window });
    if (lastDelivery.errorKind === 'artifact-expired') { preparedExport.discard(); status('Prepared file expired. Export again.'); }
    else if (lastDelivery.state === 'failed') status('File is prepared, but the browser download request failed. Use Retry file.');
    publishExportState();
    return lastDelivery;
  };
  const prepareProjectExport = async ({ deliver = true, signal } = {}) => {
    signal?.throwIfAborted();
    if (worldBusy) throw new Error('Wait for the world change to finish before exporting.');
    archiveExportPreparation?.controller.abort(); midiExportPreparation?.controller.abort();
    const lease = beginOperation('export'), generation = documentGeneration, revision = editRevision, id = documentId, name = savedName;
    const request = ++exportPreparationRevision, cancel = () => lease.controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    let computed = null, sourceTick = null, sourceGeneration = null;
    try {
      computed = await backgroundJobs.compute({ kind: 'encode-json', ownerId: 'procgen-export', ownerEpoch: generation,
        sourceRevision: `${generation}:${revision}`, inputBytes: 0, estimatedPeakBytes: 128 * 1048576 + project.procgen.lanes.length * 131072,
        signal: lease.signal, budgetAdapter: resourceBudget, isCurrent: () => ownsOperation(lease) && documentGeneration === generation && editRevision === revision && request === exportPreparationRevision,
        prepareInput: () => {
          const snapshot = capture(), world = snapshot.world?.graph?.owners?.find(owner => owner.name === 'world')?.props;
          sourceTick = world?.tickIndex ?? snapshot.world?.tickIndex ?? null; sourceGeneration = world?.generation ?? null; return snapshot;
        }, onProgress: phase => status(`Preparing project file: ${phase.phase}.`) });
      if (!ownsOperation(lease) || documentGeneration !== generation || editRevision !== revision || request !== exportPreparationRevision) return null;
      const artifact = prepareDownload({ bytes: computed.value, filename: name.replace(/[^a-z0-9_-]+/gi, '-') + '.procgen.json', type: 'application/json',
        sourceRef: `project:${id}:${revision}:${sourceGeneration ?? 'unknown'}:${sourceTick ?? 'unknown'}`, formatVersion: 'procgen-session/v1' });
      if (deliver && deliverPrepared()?.state === 'delivery-requested') status('Project download requested. Check your browser downloads. Retry file uses the same prepared project.');
      else if (!deliver) status('Project checkpoint ready. Choose Save file or Retry file to request delivery.');
      return artifact.metadata();
    } catch (error) { if (!ownsOperation(lease) || request !== exportPreparationRevision || generation !== documentGeneration) return null; throw error; }
    finally { computed?.release(); signal?.removeEventListener('abort', cancel); finishOperation(lease); }
  };
  const prepareMidiExport = async () => {
    archiveExportPreparation?.controller.abort();
    if (currentOperation?.kind === 'export') currentOperation.controller.abort();
    midiExportPreparation?.controller.abort();
    const controller = new AbortController(), source = ports.createRecordingExportSource(), generation = documentGeneration, id = recordingOrigin ? recordingOrigin.documentId : documentId,
      request = ++exportPreparationRevision, state = source.state;
    const pending = { controller, phase: 'queued', completedUnits: 0, totalUnits: source.count }; midiExportPreparation = pending; publishExportState();
    const isCurrent = () => !disposed && !controller.signal.aborted && documentGeneration === generation && request === exportPreparationRevision && source.isCurrent();
    let computed = null;
    try {
      const options = { bpm: transport.getState().bpm, beatsPerBar: project.transport?.timeSignature?.beats, beatUnit: project.transport?.timeSignature?.unit };
      const window = { recordingComplete: state.recordingComplete, incompleteReason: state.incompleteReason, incompleteReasons: state.incompleteReasons,
        retainedRange: state.retainedRange, firstLostSequence: state.firstLostSequence, droppedRecords: state.droppedRecords, droppedCategories: state.droppedCategories };
      computed = await backgroundJobs.compute({ kind: 'encode-recorded-midi', ownerId: 'procgen-midi-export', ownerEpoch: generation,
        sourceRevision: `${source.id}:${source.revision}:${source.count}`, inputBytes: source.inputBytes, estimatedPeakBytes: source.estimatedPeakBytes,
        signal: controller.signal, budgetAdapter: resourceBudget, isCurrent, retainInput: true, releasePreparedInput: source.release,
        prepareInput: async ({ signal }) => ({ snapshot: await source.prepareInput({ signal, onProgress: progress => {
          if (isCurrent()) { Object.assign(pending, progress); publishExportState(); }
        } }), window, options }), onProgress: progress => { if (isCurrent()) { Object.assign(pending, progress); publishExportState(); } } });
      if (!isCurrent()) return null;
      const { bytes, manifest } = computed.value;
      const artifact = prepareDownload({ bytes, filename: manifest.complete ? 'procgen-performance.mid' : 'procgen-performance-partial.mid', type: 'audio/midi',
        sourceRef: `recording:${source.id}:${id ?? 'unsaved'}:${source.revision}:${source.count}:${state.retainedRange.firstSequence ?? 0}:${state.retainedRange.lastSequence ?? 0}`,
        formatVersion: 'smf1/v1', lossRef: 'embedded-midi-manifest' });
      lastMidiExportReceipt = Object.freeze({ artifactId: artifact.artifactId, receipt: computed.receipt });
      if (deliverPrepared()?.state === 'delivery-requested') {
        const evidence = manifest.evidence === 'api-accepted' ? 'submitted output' : 'rendered preview intent';
        const reasons = state.incompleteReasons.length ? state.incompleteReasons.join(', ') : manifest.reason;
        status(manifest.complete ? `Recorded ${evidence} download requested. Check your browser downloads.` :
          `Partial ${evidence} download requested: ${reasons}; ${manifest.omittedOnsets} unmatched onset(s) omitted.`);
      }
      return artifact.metadata();
    } catch (error) { if (!isCurrent()) return null; throw error; }
    finally { computed?.release(); source.release(); if (midiExportPreparation === pending) { midiExportPreparation = null; publishExportState(); } }
  };
  const getShareExportDescriptor = () => {
    const world = runtime()?.world, takeId = selectedCausalTakeId || lastCausalTake?.takeId;
    const capture = masterCapture?.state().capture;
    const busy = disposed || !world || worldBusy || pendingHistory || physicalAuthoringAbort || currentOperation || causalTake || causalTakeStart || causalTakeStop || state.recording ||
      capture?.unresolvedOwnership || ['preparing', 'recording', 'stopping'].includes(capture?.state);
    const kind = takeId ? 'causal-take' : 'project';
    return Object.freeze({ kind, available: !busy,
      sourceToken: JSON.stringify([documentGeneration, editRevision, world?.generation ?? null, world?.sourceEditRevision ?? null, takeId ?? null]),
      title: takeId ? 'Selected causal take archive' : 'Current project checkpoint',
      scope: busy ? 'Finish active world, document, history and recording operations before preparing a performance file.' : takeId
        ? 'Uses the selected finished take, its verified source hashes, physical checkpoints and journal records. Complete or partial coverage is retained in the archive.'
        : 'Captures the current edited project and physical world when preparation begins. This checkpoint does not contain a recorded causal take.',
      omitted: takeId ? 'External instrument or source assets may need a separate package. MIDI or audio alone does not preserve this physical take.'
        : 'Stored takes, their causal history, audio and separately supplied assets are not included. Select a finished causal take first to export its archive.' });
  };
  const prepareShareExport = (reviewed, { signal } = {}) => {
    signal?.throwIfAborted();
    const current = getShareExportDescriptor();
    if (!current.available || reviewed?.kind !== current.kind || reviewed?.sourceToken !== current.sourceToken) throw new Error('The reviewed performance source changed. Open sharing again to select the current source.');
    return current.kind === 'causal-take' ? prepareCausalArchive({ signal }) : prepareProjectExport({ deliver: false, signal });
  };
  const safe = fn => async (...args) => { try { return await fn(...args); } catch (error) { status(error?.message || String(error)); return false; } };
  const adoptSceneRecipe = recipe => {
    if (disposed || worldBusy || pendingHistory || physicalAuthoringAbort || causalTake || causalTakeStart || causalTakeStop || state.recording || masterCapture?.state?.().capture?.unresolvedOwnership || ['preparing', 'recording', 'stopping'].includes(masterCapture?.state?.().capture?.state)) throw new Error('Finish active document, history and recording operations before applying a scene.');
    transport.stop(); cancelInputEdits('scene applied'); soundTransactions.cancel('A prepared scene is replacing this document.');
    documentGeneration++; documentId = null; documentRevision = 0; savedRevision = -1; lastSavedAt = null; savedName = recipe.name;
    project = sealMidiProjectSnapshot(markCanonicalMidiProject(recipe.project)); projectRevision++; editRevision++;
    Object.assign(legacy.settings, recipe.settings, { workstation: true }); acceptWorldSettings(legacy.settings); lastLegacySpeed = legacy.settings.speed;
    setLegacyProject(project, { persist: false }); transport.configure({ ...recipe.transport, clockSource: 'internal', linked: true, baseBpm: recipe.transport.bpm }); engine.reset(); pendingResume = true;
    undo.length = 0; redo.length = 0; lastHistoryGroup = null; trimHistory(); state.laneId = project.procgen.lanes[0].id; state.firstLane = 0; state.slot = state.step = 0;
    macroGestures.reconcile(); storageStatus(); persist();
  };
  function refreshSceneCue() { if (disposed) return; try { sceneBrowser?.refresh(); view?.sceneCue?.(sceneLoader?.state(), project.procgen.sceneOrigin?.manifest || null, stageSession?.active()); } catch { /* Cue display cannot own a performance mutation. */ } }
  const sceneBaseIdentity = () => {
    if (disposed || !runtime()?.world || worldBusy || pendingHistory || physicalAuthoringAbort || causalTake || causalTakeStart || causalTakeStop || state.recording || masterCapture?.state?.().capture?.unresolvedOwnership || ['preparing', 'recording', 'stopping'].includes(masterCapture?.state?.().capture?.state)) throw new Error('Finish active world, history and recording operations before preparing a scene.');
    const audio = legacy.local.getState(), world = runtime().world, clock = transport.getState();
    return JSON.stringify([documentGeneration, projectRevision, editRevision, world.generation, world.sourceEditRevision ?? null, state.outputId ?? null, state.inputId ?? null, state.clockOutputId ?? null, !!state.thru, audio.enabled, audio.selectedBackend, audio.outputId ?? audio.selectedOutputId ?? null, audio.outputSinkId ?? null, clock.bpm, clock.baseBpm, clock.gameSpeed, clock.speedMode, clock.linked, clock.clockSource]);
  };
  const openPerformanceScenes = async ({ showBrowser = true } = {}) => {
    if (disposed) return;
    if (!sceneBrowser) {
      sceneToolsPending ||= (async () => {
        const [installed, loading, adapter, browsing, audio, rehearsal, lessons, lessonView] = await Promise.all([
          import('./PerformanceSceneInstalledCatalog.js'), import('./PerformanceSceneLoader.js'), import('./PerformanceSceneWorldAdapter.js'), import('./PerformanceSceneBrowser.js'), import('../../midi-ui/NativeInstrumentSchema.js'), import('./PerformanceSceneRehearsal.js'), import('./PhysicalLessonCatalog.js'), import('./PhysicalLessonView.js')
        ]);
        if (disposed) return;
        const getCatalog = getInstrumentCatalog || audio.getNativeInstrumentCatalog;
        sceneCatalog = await installed.createInstalledPerformanceSceneCatalog({ getCatalog }); if (disposed) return;
        sceneLoader = loading.createPerformanceSceneLoader({ getBaseIdentity: sceneBaseIdentity, resolveDependency: sceneCatalog.resolveDependency,
          prepareCandidate: typeof prepareSceneWorld === 'function' ? adapter.createPerformanceSceneWorldAdapter({ getCatalog, getOrigin: (scene, variants) => sceneCatalog.origin(scene, variants), prepareWorld: prepareSceneWorld, resourceBudget, getMaterialProvider: legacy.local.audio?.getSoundMaterialProvider ? () => legacy.local.audio.getSoundMaterialProvider() : null }) : async () => { throw new Error('This host does not provide staged world publication.'); },
          preparePreview: typeof prepareInspectionWorld === 'function' && legacy.local.audio && resourceBudget ? rehearsal.createPerformanceSceneRehearsal({ audio: legacy.local.audio, prepareInspectionWorld, jobs: backgroundJobs, resourceBudget }) : null,
          beforeCommit: async ({ scene }) => editRevision === savedRevision || window.confirm?.('Replace this edited world with ' + scene.title + '? The prepared scene changes the world, sound and physical mappings, and starts paused. Save the current project first to keep it.' ) === true,
          onState: refreshSceneCue });
        const definitions = await lessons.createInstalledPhysicalLessons(sceneCatalog); if (disposed) return; physicalLessonDefaultId = definitions[0]?.setupScene.id || null; operationalLessonAvailable = !!physicalLessonDefaultId; view?.refreshOperational?.();
        if (definitions.length) physicalLessonView = lessonView.createPhysicalLessonView({ document, window, definitions, cancelLoad: () => sceneLoader.cancel(), onStatus: status,
          loadScene: async (reference, { signal }) => {
            if (stageSession?.active()) throw new Error('Exit Stage before loading a lesson world.');
            signal.throwIfAborted(); const scene = sceneCatalog.registry.resolve(reference);
            if (await performanceSceneHash(scene) !== reference.hash) throw new Error('The lesson source changed.'); signal.throwIfAborted(); sceneLoader.select(scene);
            const prepared = await sceneLoader.prepare(); signal.throwIfAborted(); if (prepared.status !== 'ready') throw new Error('Lesson setup requirements are unavailable; the current world remains active.');
            const applied = await sceneLoader.apply(); signal.throwIfAborted(); if (applied.status !== 'committed') throw new Error('Lesson setup was canceled.');
            const world = runtime().world; return { sceneHash: reference.hash, worldId: world.worldId, generation: world.generation, documentEpoch: documentGeneration, assists: world.assists, junctionDefinitions: world.physicalJunctions.definitions, junctionStates: world.physicalJunctions.definitions.map(value => world.queryJunction(value.id, { includeDefinition: false }).actual).filter(Boolean), graph: world.physicalAuthoring.graph, releaseGesture: world.population.releaseGesture, soundIdentity: effectiveSoundLanes(project.procgen.lanes).map(lane => lane.instrumentRef?.definitionHash || lane.instrumentPatchId).join('|') };
          } });
        sceneBrowser = browsing.createPerformanceSceneBrowser({ document, window, registry: sceneCatalog.registry, loader: sceneLoader,
          onCreateNursery: sceneCatalog.available ? async () => { const identity = sceneBaseIdentity(), reference = selected().instrumentRef; if (!reference) throw new Error('Prepare, save and apply a finite sample/FM → body graft in Seed Lab, then select that lane before opening Nursery.'); const row = await sceneCatalog.addNurseryStrike(reference); if (disposed || sceneBaseIdentity() !== identity) throw new Error('The selected lane or document changed during Nursery assembly. Select the current strike again.'); return row; } : null,
          canTeachScene: scene => definitions.some(value => value.setupScene.id === scene.id && value.setupScene.version === scene.version), onLesson: scene => physicalLessonView?.open(scene.id),
          keepPreparedOnClose: () => stageSession?.active(), unavailableReason: sceneCatalog.reason, getLiveScene: () => project.procgen.sceneOrigin?.manifest || null, onSavedTakes: () => handlers.load(), onStatus: status });
      })().catch(error => { sceneToolsPending = null; throw error; });
      await sceneToolsPending;
    }
    if (!disposed && showBrowser) sceneBrowser?.open();
  };
  async function loadSession(value, admittedLease = null, { signal, historyRestore = false } = {}) {
    if (stageSession?.active()) return stageSession.reject();
    signal?.throwIfAborted();
    if (disposed || (admittedLease && !ownsOperation(admittedLease))) return false;
    if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.');
    if (causalTake || causalTakeStart || causalTakeStop) await stopCausalTake({ reason: 'document-replacement' });
    signal?.throwIfAborted();
    const lease = admittedLease || beginOperation('load');
    let session = validateProcgenSession(value);
    const serial = ++loadSerial;
    if (session.project?.procgen?.version !== 2) {
      const conversion = convertLegacyProcgenWorkstationProject(session.project, { strategy: 'physical-default' });
      const summary = `Convert this legacy project to physical playback? ${conversion.report.discardedEnabledSteps} enabled phrase steps will be removed across ${conversion.report.laneCount} lanes. The imported source will not be overwritten.`;
      if (typeof window.confirm !== 'function' || !window.confirm(summary)) return false;
      session = { ...session, project: conversion.project, patterns: null, physicalTimeline: null, physicalState: null };
    }
    if (session.physicalTimeline) createProcgenPhysicalScoreClock().restore(session.physicalTimeline);
    const validatedProject = createProcgenWorkstationProject(sanitizeMidiProject(session.project));
    if (validatedProject.procgen.lanes.length !== session.world.laneCount) throw new Error('Project lanes and world checkpoint do not match.');
    const preparedEngine = createProcgenPatternEngine({ getProject: () => validatedProject, now });
    if (session.patterns) preparedEngine.restore(session.patterns);
    else session = { ...session, patterns: preparedEngine.snapshot() };
    signal?.throwIfAborted();
    const cancel = () => lease.controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    worldBusy = true;
    const previous = transport.getState(), oldSettings = { ...legacy.settings };
    const previousRuntime = runtime();
    let loaded = false;
    const prepared = { ...session, project: validatedProject, camera: session.camera || null, ui: session.ui || {} };
    beforeRestart();
    try {
      const restarted = await restart({ session: prepared, lease });
      if (!ownsOperation(lease) || serial !== loadSerial) return false;
      if (restarted === false) throw new Error('World preparation was canceled.');
      bindRuntime({ session: prepared, historyRestore }); loaded = true; return true;
    } catch (error) {
      if (!ownsOperation(lease)) return false;
      if (runtime() !== previousRuntime) {
        transport.pause(); ports.flush(); suppressPersistence = false;
        status('The new world is paused after a presentation error. Export a recovery copy before continuing.');
        throw error;
      }
      Object.assign(legacy.settings, oldSettings); lastLegacySpeed = legacy.settings.speed; if (previous.playing) play(); throw error;
    } finally {
      signal?.removeEventListener('abort', cancel); worldBusy = false;
      if (loaded || lease.kind !== 'select-session' || runtime() !== previousRuntime) finishOperation(lease);
      if (deferredPersist && startupCommitted && (loaded || runtime() === previousRuntime)) persist();
    }
  }
  async function rebuild({ seed = project.procgen.seed, fresh = false, projectNext = null, history = true, worldSettings = {} } = {}) {
    if (disposed) return false;
    if (stageSession?.active()) return stageSession.reject();
    if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.');
    if (causalTake || causalTakeStart || causalTakeStop) await stopCausalTake({ reason: 'world-rebuild' });
    const lease = beginOperation('rebuild');
    worldBusy = true;
    const previous = project, oldSettings = settingsFor(), previousTransport = transport.getState(), previousPatterns = engine.snapshot();
    const priorHistory = new Set(undo), previousRedo = [...redo];
    const previousRuntime = runtime();
    let completed = false, rolledBack = false, staged = previous, candidateSettings = oldSettings;
    try {
      beforeRestart();
      if (Object.keys(worldSettings).some(key => key !== 'hazardSpacing') || worldSettings.hazardSpacing != null &&
      (!Number.isFinite(worldSettings.hazardSpacing) || worldSettings.hazardSpacing < 80 || worldSettings.hazardSpacing > 1024)) throw new Error('Invalid world recipe patch.');
      const source = projectNext || project;
      const freshPlan = fresh ? resolveProcgenStartupIntent({ search: '?startup=fresh', seed }) : null;
      const next = freshPlan?.project || { ...source, procgen: { ...source.procgen, seed } };
      if (fresh) { Object.assign(legacy.settings, freshPlan.worldOptions); transport.configure({ ...freshPlan.transport, baseBpm: 120 }); legacy.setSpeed(freshPlan.worldOptions.speed); lastLegacySpeed = legacy.settings.speed; }
      candidateSettings = settingsFor(next, { ...(freshPlan?.worldOptions || {}), ...worldSettings });
      pendingWorldSettings = candidateSettings;
      syncProject(next, { history }); staged = project;
      Object.assign(legacy.settings, candidateSettings);
      const restarted = await restart({ lease });
      if (!ownsOperation(lease)) return false;
      if (restarted === false) throw new Error('World preparation was canceled.');
      acceptWorldSettings(candidateSettings);
      engine.reset(); transport.stop(); pendingResume = false;
      if (fresh) { ports.configure({ recording: false }); documentGeneration++; view?.recording?.(false, recordingViewState(ports.getState())); }
      bindRuntime();
      if (fresh) { savedName = 'Untitled session'; documentId = null; documentRevision = 0; savedRevision = -1; lastSavedAt = null; storageStatus(); }
      if (previousTransport.playing) play(); status(fresh ? 'New project ready.' : 'World rebuilt.'); completed = true; return true;
    } catch (error) {
      if (!ownsOperation(lease)) return false;
      if (runtime() !== previousRuntime) {
        transport.pause(); ports.flush(); suppressPersistence = false;
        acceptWorldSettings(candidateSettings);
        status('The rebuilt world is paused after a presentation error. Export a recovery copy before continuing.');
        throw error;
      }
      const restored = rollbackWorldProject(previous, staged, project);
      // Remove only this terrain transaction. Rebase every later accepted edit
      // independently, retaining its Undo boundary instead of collapsing history.
      const rebased = undo.filter(entry => priorHistory.has(entry) || entry !== previous).map(entry => {
        if (priorHistory.has(entry)) return entry;
        const value = rollbackWorldProject(previous, staged, entry);
        historySizes.set(value, historyBytes(entry)); return value;
      });
      const hadConcurrentHistory = undo.some(entry => !priorHistory.has(entry) && entry !== previous);
      syncProject(restored, { history: false, render: false });
      undo.splice(0, undo.length, ...rebased);
      if (!hadConcurrentHistory) redo.splice(0, redo.length, ...previousRedo);
      trimHistory();
      acceptWorldSettings(oldSettings); Object.assign(legacy.settings, oldSettings);
      lastLegacySpeed = legacy.settings.speed;
      transport.restore(previousTransport); engine.restore(previousPatterns); pendingResume = true;
      rolledBack = true;
      if (previousTransport.playing) play();
      try { view?.render(); } catch { /* Rollback authority remains recoverable without its presentation. */ }
      throw error;
    } finally { pendingWorldSettings = null; worldBusy = false; finishOperation(lease); if (deferredPersist && startupCommitted && (completed || rolledBack)) persist(); }
  }
  const changesWorld = next => next.procgen.seed !== project.procgen.seed || next.procgen.lanes.length !== project.procgen.lanes.length || next.procgen.lanes.some((lane, index) => lane.worldThemeId !== project.procgen.lanes[index]?.worldThemeId);
  const historyMove = async (from, to) => {
    if (!from.length || pendingHistory || worldBusy) return false;
    cancelInputEdits('history changed');
    const previous = project, next = from.at(-1), movedCost = historyBytes(next), physicalSnapshot = physicalHistory.get(next);
    if (physicalSnapshot) {
      if (causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the take or use a physical branch before rewinding physical history.');
      beforeRestart(); const controller = new AbortController(); physicalAuthoringAbort = controller; worldBusy = true; let capsule = null;
      try {
        capsule = await capturePhysicalHistory(runtime().world, previous, controller.signal); worldBusy = false;
        const loaded = await loadSession(physicalSnapshot, null, { signal: controller.signal, historyRestore: true }); if (!loaded) return false;
        from.pop(); capsule.promote(previous); historySizes.set(previous, movedCost); to.push(previous); trimHistory(); return true;
      } finally { capsule?.discard(); physicalAuthoringAbort = null; worldBusy = false; }
    }
    if (!changesWorld(next)) {
      syncProject(next, { history: false }); from.pop(); historySizes.set(previous, movedCost); to.push(previous); trimHistory(); return true;
    }
    const undoBefore = [...undo], redoBefore = [...redo];
    const transaction = { commands: [], bytes: 0 }; pendingHistory = transaction;
    let committed = false, failure = null;
    try { committed = !!await rebuild({ projectNext: next, seed: next.procgen.seed, history: false }); }
    catch (error) { failure = error; }
    if (disposed) { pendingHistory = null; return false; }
    undo.splice(0, undo.length, ...undoBefore); redo.splice(0, redo.length, ...redoBefore);
    if (committed) { from.pop(); historySizes.set(previous, movedCost); to.push(previous); trimHistory(); }
    syncProject(committed ? next : previous, { history: false, render: false });
    pendingHistory = null;
    for (const { action, historyGroup } of transaction.commands) {
      const reduced = reduceMidiProject(project, action);
      if (!equal(reduced, project)) syncProject(reduced, { historyGroup, render: false });
    }
    view?.render();
    if (failure) throw failure;
    return committed;
  };
  const ensureSoundSeedLab = () => { if (disposed || !resourceBudget || !legacy.local.audio) throw new Error('Sound authoring ownership is unavailable.'); return soundSeedLab ||= createSoundSeedLabView({ document, window, audio: legacy.local.audio, getPlayback: () => physicalPlayback, resourceBudget, jobs: backgroundJobs,
    displayScheduler: view?.displayScheduler, getTargetIdentity: () => ({ documentGeneration, projectRevision, laneId: selected().id }),
    getTravelMappings: () => { const lane = project.procgen.lanes.findIndex(value => value.id === selected().id); return (runtime()?.world.physicalAuthoring?.graph?.instruments || []).filter(value => { const a = value.articulation; return value.route === 'local' && (!value.sourceLanes || value.sourceLanes.includes(lane)) && (value.sourceKind === 'ContactSpanBegan' && value.causeKind === 'support' && value.contactTravel?.lifetimeScope === 'contactSpan' || value.sourceKind === 'MotionCommitted' && a?.sustain && a.lifetimeScope === 'actorJourney' && a.metric === 'axis-projection' && ['signedX', 'signedY'].includes(a.orientation) && a.phaseMode === 'direction-reversing'); }); }, onApply: (candidate, options) => handlers.applyInstalledInstrument(candidate, options), onStatus: status }); };
  const getOperationalSnapshot = () => {
    const world = runtime()?.world, laneRuntime = runtime()?.lanes?.getOperationalState?.(), output = legacy.local.getOperationalState?.() || legacy.local.getState(), midi = ports.getOperationalState(), position = transport.getState(), metrics = legacy.getOperationalMetrics?.();
    const identity = JSON.stringify([documentGeneration, projectRevision, editRevision, world?.worldId || null, world?.generation, outputEpoch, midi.routeRevision,
      output.selectedOutputId || output.outputId || null, output.enabled, output.status, position.clockSource, position.clockStatus, state.laneId, !!currentStorageError(), recoveryState, !!stageSession?.active(), startupFailure]);
    return createProcgenOperationalSnapshot({ identity, simulation: { available: !!world && !startupFailure, preparing: !startupFailure && (worldBusy || !world && !startupCommitted), failure: startupFailure,
      canStartFresh: !!document.getElementById('procgenStartupFresh'),
      paused: laneRuntime?.paused ?? (world?.timer?.speedFactor === 0 || (legacy.isPaused?.() ?? !position.playing)), requestedSpeed: legacy.settings.speed,
      achievedTicksPerSecond: metrics && world && metrics.generation === world.generation ? metrics.achievedTicksPerSecond : null, measurementTime: metrics?.observedAt, tickDurationMs: world?.timer?.TIME_PER_FRAME_MS },
    transport: position, output, midi, physical: physicalPlayback?.operationalState?.() || null, lanes: project.procgen.lanes,
    storage: { error: currentStorageError() }, recovery: { state: recoveryState, error: recoveryError, lessonAvailable: operationalLessonAvailable }, stage: !!stageSession?.active() });
  };
  const reportStartupFailure = error => {
    if (disposed || startupCommitted) return false;
    startupFailure = String(error?.message || 'The initial world could not be prepared.').slice(0, 200); view?.refreshOperational?.(); return true;
  };
  const expressionTarget = (event, { requireSelected = true, output = null, midi = null } = {}) => {
    if (disposed || !event || !['sustain', 'bend', 'pressure'].includes(event.type)) return null;
    const lane = event.laneId ? procgenLane(project.procgen.lanes, event.laneId) : selected();
    if (!lane || requireSelected && lane.id !== selected().id) return null;
    const channel = event.channel ?? lane.channel;
    if (!Number.isInteger(channel) || channel < 1 || channel > 16 || event.laneId && (event.laneId !== lane.id || channel !== lane.channel || (event.outputId ?? null) !== (lane.outputId ?? null))) return null;
    output ||= legacy.local.getOperationalState?.() || legacy.local.getState(); midi ||= ports.getOperationalState();
    const outputId = event.outputId || lane.outputId || output.outputId || output.selectedOutputId || midi.noteOutputId || null;
    const route = midi.outputRoutes.find(value => value.outputId === outputId), key = JSON.stringify([documentGeneration, lane.id, output.selectedBackend,
      output.outputGeneration ?? null, outputId, route?.connectionEpoch ?? null, channel, 'owned-channel-expression', event.type]);
    if (key.length > 1024) return null;
    return Object.freeze({ key, parameter: event.type, outputId, channel, endpointEpoch: route?.connectionEpoch ?? null,
      endpointName: route?.name || output.selectedOutputName || outputId || 'No MIDI destination', available: route?.active === true });
  };
  const handlers = {
    laneDisplayState(laneIds) {
      laneDisplayEvidence.setLanes(laneIds);
      const operational = getOperationalSnapshot(), sourceKey = laneDisplaySource(), output = legacy.local.getOperationalState?.() || legacy.local.getState(), midi = ports.getOperationalState();
      return laneIds.map(laneId => {
        const lane = procgenLane(project.procgen.lanes, laneId); if (!lane) return null;
        const parameters = ['sustain', 'bend', 'pressure'].map(type => { const target = expressionTarget({ type, laneId, channel: lane.channel, outputId: lane.outputId }, { requireSelected: false, output, midi }); return target && midiParameterEvidence.read(target); }).filter(value => value?.revision);
        const parameter = parameters.reduce((latest, value) => !latest || value.revision > latest.revision ? value : latest, null);
        return { lane, revision: projectRevision, simulation: operational.simulation, operational, mix: physicalPlayback?.laneMixView(laneId) || null, evidence: laneDisplayEvidence.read(laneId, sourceKey), parameter };
      }).filter(Boolean);
    },
    operationalState: getOperationalSnapshot,
    recoverOperational: async (action, identity) => {
      const current = getOperationalSnapshot();
      if (disposed || identity !== current.identity || action !== current.recoveryAction.id) { status('Operational state changed. Review the current action.'); return false; }
      if (action === 'discover') return legacy.local.discover?.();
      if (action === 'listen' || action === 'activate') return legacy.local.start();
      if (action === 'export') return handlers.export();
      if (action === 'play') return handlers.stagePlay();
      if (action === 'exit-stage') return handlers.stageExit();
      if (action === 'startup-fresh') { const control = document.getElementById('procgenStartupFresh'); if (!control) return false; control.click(); return true; }
      if (action === 'review-output' || action === 'review-backend') {
        const control = document.getElementById(action === 'review-output' ? 'procgenMidiDevice' : 'procgenOutput'); if (control) view.revealGlobalControl?.(control); control?.focus?.({ preventScroll: true }); return !!control;
      }
      if (action === 'inspect-midi' || action === 'inspect-clock') { state.tab = 'MIDI'; view.openInspector(); return true; }
      if (action === 'inspect-physical' || action === 'inspect-mix') { state.tab = action === 'inspect-mix' ? 'Lane' : selected().mode === 'pattern' ? 'Lane' : 'Physical'; view.openInspector(); return true; }
      if (action === 'lesson') { await openPerformanceScenes({ showBrowser: false }); if (disposed || getOperationalSnapshot().identity !== identity) return false;
        if (!physicalLessonView || !physicalLessonDefaultId) throw new Error('No installed isolated lesson is available. The current world is unchanged.');
        physicalLessonView.open(physicalLessonDefaultId); return true; }
      return false;
    },
    clearSolos: () => {
      if (!project.procgen.lanes.some(lane => lane.solo)) return;
      if (!Number.isSafeInteger(project.procgen.revision + 1)) throw new Error('Project revision exhausted.');
      syncProject(markCanonicalMidiProject({ ...project, procgen: { ...project.procgen, revision: project.procgen.revision + 1, lanes: project.procgen.lanes.map(lane => lane.solo ? { ...lane, solo: false } : lane) } }));
    },
    openCausalAudioRender: safe(async () => {
      const takeId = selectedCausalTakeId || lastCausalTake?.takeId;
      if (disposed || !resourceBudget || !takeId || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish and select a saved causal take before rendering its intent.');
      const journal = causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs });
      causalAudioRender ||= createCausalTakeAudioRenderView({ document, window, journal, resourceBudget, jobs: backgroundJobs,
        audio: legacy.local.audio, onPrelisten: () => handlers.openPrelistenMonitor(),
        getMaterialProvider: () => legacy.local.audio?.getSoundMaterialProvider(),
        getSavedRack: () => project.procgen.effectRack || null,
        onHarvest: source => handlers.harvestSoundSeed(source), displayScheduler: view?.displayScheduler, onStatus: status }); await causalAudioRender.open({ takeId, instrumentRef: selected().instrumentRef || null });
    }),
    openPrelistenMonitor() {
      if (disposed || !legacy.local.audio) return;
      prelistenMonitor ||= createPrelistenMonitor({ document, audio: legacy.local.audio, displayScheduler: view?.displayScheduler,
        home: document.getElementById('procgenStudioFooter') || document.body, onStatus: status });
      prelistenMonitor.mountHome(); return prelistenMonitor;
    },
    openPhysicalScene() { physicalDomainEditor ||= createPhysicalDomainEditor({ document, getOwner: () => documentGeneration, getGraph: () => project.procgen.physicalGraph, saveGraph: graph => dispatch({ type: 'procgen/physicalGraph', graph }), getInspection: () => ({ terrainRevision: runtime()?.world?.terrainRevision ?? null, preparedSurfaces: physicalPlayback?.engine.diagnostics().preparedSurfaces, bodyBindings: physicalPlayback?.preparedSurfaceBodies(), swarm: physicalPlayback?.engine.diagnostics().swarm, cargo: physicalPlayback?.engine.diagnostics().cargo, physical: physicalPlayback?.engine.physicalAnalysis() }), onStatus: status }); physicalDomainEditor.open(); },
    openPhysicalFeedback() { physicalFeedbackView ||= createPhysicalFeedbackView({ document, getOwner: () => documentGeneration, getGraph: () => project.procgen.physicalGraph, getState: () => physicalFeedback?.diagnostics(), save: feedback => dispatch({ type: 'procgen/physicalGraph', graph: { ...project.procgen.physicalGraph, revision: project.procgen.physicalGraph.revision + 1, feedback } }), arm: () => handlers.armPhysicalFeedback(), disarm: () => physicalFeedback?.disarm(), mute: (id, muted) => physicalFeedback?.muteLayer(id, muted), capture: input => handlers.captureInterventionLayer(input), onStatus: status }); physicalFeedbackView.open(); },
    armPhysicalFeedback() { if (!physicalFeedback || worldBusy || pendingHistory || physicalAuthoringAbort) throw new Error('No writable live physical world.'); if (!Number.isSafeInteger(++feedbackEpoch)) throw new Error('Feedback epoch exhausted.'); return physicalFeedback.arm({ mode: 'live', epoch: `live:${documentGeneration}:${runtime().world.generation}:${runtime().world.tickIndex}:${feedbackEpoch}` }); },
    disarmPhysicalFeedback: () => physicalFeedback?.disarm(),
    captureInterventionLayer(input) { if (!physicalFeedback) throw new Error('No physical command capture owner.'); const graph = project.procgen.physicalGraph, layer = physicalFeedback.capture(input), feedback = graph.feedback || { version: 1, conductors: [], layers: [] }; dispatch({ type: 'procgen/physicalGraph', graph: { ...graph, revision: graph.revision + 1, feedback: { ...feedback, layers: [...feedback.layers.filter(value => value.id !== layer.id), layer] } } }); return layer; },
    openReleaseGestures() {
      releaseGestureView ||= createReleaseGestureView({ document, getOwner: () => documentGeneration, displayScheduler: view?.displayScheduler, getProject: () => project, getState: () => ({ population: runtime()?.world?.population.snapshot(), pending: (runtime()?.world?.interventionState.pending || []).filter(command => command.kind === 'set-release-gesture').map(command => ({ id: command.id, applyAtTick: command.applyAtTick })) }), save: gesture => dispatch({ type: 'procgen/releaseGesture', gesture: { ...gesture, revision: Math.max(gesture.revision, project.procgen.releaseGesture?.id === gesture.id ? project.procgen.releaseGesture.revision : 0) + 1 } }), perform: gesture => handlers.performReleaseGesture(gesture), cancel: () => handlers.cancelReleaseGestures(), onStatus: status }); releaseGestureView.open();
    },
    performReleaseGesture(input) {
      const world = runtime()?.world; if (!world || worldBusy || pendingHistory || physicalAuthoringAbort) throw new Error('Wait for an available physical command boundary.');
      const current = world.population.pendingReleaseGesture || world.population.releaseGesture, revision = Math.max(input.revision, current?.id === input.id ? current.revision : 0) + 1, gesture = validateReleaseGesture({ ...input, revision }, world.laneCount);
      if (!Number.isSafeInteger(++releaseGestureSerial)) throw new Error('Release gesture identity exhausted.');
      const command = { id: `release:${world.generation}:${world.tickIndex}:${releaseGestureSerial}`, kind: 'set-release-gesture', origin: 'manual', target: { generation: world.generation }, parameters: { gesture } }, proposal = world.prepareIntervention(command);
      if (causalTake && causalTake.recordIntervention(command, proposal.outcome, { tick: world.tickIndex, generation: world.generation }).status !== 'accepted') throw new Error('Take could not admit the release gesture.');
      return proposal.commit();
    },
    cancelReleaseGestures() { const world = runtime()?.world; if (!world || worldBusy || pendingHistory || physicalAuthoringAbort) return { cancelled: 0 }; let cancelled = 0; for (const command of [...world.interventionState.pending]) if (command.kind === 'set-release-gesture') { if (causalTake && causalTake.recordInput({ version: 1, kind: 'intervention-cancel', commandId: command.id }, { tick: world.tickIndex, generation: world.generation }).status !== 'accepted') throw new Error('Take could not admit cancellation.'); if (world.cancelIntervention(command.id, 'release-user-cancelled')) cancelled++; } return { cancelled, alreadyAdmittedCohortsUnchanged: true }; },
    openPhysicalAuthoring() {
      physicalAuthoringView ||= createPhysicalAuthoringView({ document, resourceBudget, displayScheduler: view?.displayScheduler, getWorld: () => runtime()?.world, getProject: () => project, getAnalysis: () => physicalPlayback?.engine.physicalAnalysis(),
        previewTerrain: input => handlers.previewTerrainAuthoring(input), applyTerrain: input => handlers.applyTerrainAuthoring(input), captureFragment: input => handlers.capturePhysicalFragment(input),
        previewFragment: (id, options) => handlers.previewPhysicalFragment(id, options), placeFragment: (id, options) => handlers.placePhysicalFragment(id, options),
        saveFragments: fragments => dispatch({ type: 'procgen/fragments', fragments }), detachFragment: instanceId => dispatch({ type: 'procgen/detachFragment', instanceId }), cancelPending: () => physicalAuthoringAbort?.abort(), discardPhysicalHistory: () => handlers.discardPhysicalHistory(), onStatus: status });
      physicalAuthoringView.open();
    },
    discardPhysicalHistory() {
      if (worldBusy || physicalAuthoringAbort || pendingHistory) throw new Error('Finish the physical history operation first.');
      for (const stack of [undo, redo]) { const index = stack.findLastIndex(entry => physicalHistory.get(entry)); if (index >= 0) { historyDropped += index + 1; stack.splice(0, index + 1); } }
      physicalHistory.clear(); trimHistory(); return { status: 'history-discarded', worldUnchanged: true, retained: physicalHistory.diagnostics() };
    },
    previewTerrainAuthoring(input) {
      const world = runtime()?.world; if (!world || world._stepping) throw new Error('Wait for a completed physical boundary.');
      const plan = planTerrainCommand({ ...input, generation: world.generation, transactionId: `terrain-preview:${world.generation}:${world.tickIndex}` }, world);
      return { status: plan.status, reason: plan.reason, counts: plan.counts, conflicts: plan.rejected, patchCount: plan.patchCount, previewHardwareNotes: false };
    },
    applyTerrainAuthoring(input) {
      const frozenInput = clone(input);
      return applyPausedPhysicalCommand((world, source, id) => ({ id, transactionId: id, kind: 'physical-authoring', origin: 'manual', target: { generation: world.generation }, parameters: { authoring: {
        version: 1, operation: 'terrain-and-graph', transactionId: id, expectedRevision: world.physicalAuthoring.revision, expectedJunctionRevision: world.physicalJunctions.revision, expectedGraphDigest: digestPlan(world.physicalAuthoring.graph),
        graph: { ...source.procgen.physicalGraph, revision: source.procgen.physicalGraph.revision + 1, editCommandId: id }, instances: source.procgen.fragmentInstances || [], junctions: source.procgen.junctions || [],
        terrain: normalizeTerrainCommand({ ...frozenInput, generation: world.generation, transactionId: id })
      } } }));
    },
    capturePhysicalFragment(input) {
      const world = runtime()?.world; if (!world || worldBusy || physicalAuthoringAbort || world._stepping) throw new Error('Wait for an available authoring boundary.');
      const previous = project.procgen.fragments?.find(fragment => fragment.id === input.id), b = input.bounds;
      const junctions = input.junctions ?? (project.procgen.junctions || []).filter(junction => junction.influence.x1 >= b.x1 && junction.influence.x2 <= b.x2 && junction.influence.y1 >= b.y1 && junction.influence.y2 <= b.y2);
      const fragment = capturePhysicalScoreFragment(world, { ...input, revision: previous ? previous.revision + 1 : 1, source: { revision: `project:${project.procgen.revision}`, projectId: documentId }, junctions,
        graph: input.graph || selectSpatialFragmentGraph(project.procgen.physicalGraph, b) });
      dispatch({ type: 'procgen/fragments', fragments: [...(project.procgen.fragments || []).filter(value => value.id !== fragment.id), fragment] });
      return { status: 'captured', id: fragment.id, revision: fragment.revision, externalReferences: fragment.externalReferences, geometrySpans: fragment.collision.spans.length, existingInstancesUpdated: false };
    },
    previewPhysicalFragment(id, options) {
      const fragment = project.procgen.fragments?.find(value => value.id === id); if (!fragment) throw new Error('Select a saved fragment.');
      const plan = planPhysicalScoreFragment(runtime().world, project, fragment, options);
      return { status: plan.status, issues: plan.issues, unresolved: plan.unresolved, counts: plan.terrain.counts, alignments: plan.alignments, instance: plan.instance, previewHardwareNotes: false };
    },
    placePhysicalFragment(id, options) {
      const frozenOptions = clone(options);
      return applyPausedPhysicalCommand((world, source, commandId) => {
        const fragment = source.procgen.fragments?.find(value => value.id === id); if (!fragment) throw new Error('Saved fragment is unavailable.');
        const plan = planPhysicalScoreFragment(world, source, fragment, frozenOptions); if (plan.status !== 'prepared') throw new Error('Fragment placement is blocked: ' + JSON.stringify(plan.issues));
        return fragmentPlacementCommand(world, source, plan, commandId);
      });
    },
    openPhysicalJunctions() {
      view?.openInspector?.();
      physicalJunctionView ||= createPhysicalJunctionView({ document, window, getRuntime: runtime, displayScheduler: view?.displayScheduler,
        canRequest: () => !disposed && !worldBusy && !pendingHistory && !physicalAuthoringAbort && !causalTakeStart && !causalTakeStop,
        canAuthor: () => !disposed && !stageSession?.active() && !worldBusy && !pendingHistory && !physicalAuthoringAbort,
        onRevealLane: lane => { state.firstLane = lane; state.laneId = project.procgen.lanes[lane]?.id || state.laneId; state.tab = 'Physical'; view?.renderInspector?.(); view?.layout?.(); view?.launched?.(); },
        onObserveCrossing: crossing => { runtime()?.lanes?.renderer?.render?.(true); if (worldInspector?.select(`${crossing.generation}:actor:${crossing.actorId}`)) { worldInspector.reveal(); state.tab = 'Selection'; view?.openInspector?.(); } else status('This observed actor is no longer in the current visible actor index.'); },
        getDefinitions: () => project.procgen.junctions || [], query: id => runtime()?.world?.queryJunction?.(id, { includeDefinition: false }),
        save: junctions => { if (stageSession?.active()) throw new Error('Exit Stage before editing junction definitions.'); if (worldBusy || pendingHistory || physicalAuthoringAbort) throw new Error('Wait for the world/history transaction.'); const result = dispatch({ type: 'procgen/junctions', junctions }); if (result === false) throw new Error('Junction definitions were not admitted. Finish the current edit operation.'); return result; },
        request: (junctionId, configurationId, policy) => handlers.requestJunction(junctionId, configurationId, policy), cancel: id => handlers.cancelJunctionRequest(id), onStatus: status });
      physicalJunctionView.open();
    },
    requestJunction(junctionId, configurationId, policy = 'waitForSafeBoundary') {
      const world = runtime()?.world; if (!world || worldBusy || pendingHistory || physicalAuthoringAbort || causalTakeStart || causalTakeStop) throw new Error('Wait for a committed world boundary.');
      const definition = world.physicalJunctions.definitions.find(value => value.id === junctionId); if (!definition) throw new Error('Junction definition has not reached its command boundary.');
      if (!Number.isSafeInteger(++junctionRequestSerial)) throw new Error('Junction request identity exhausted.');
      const id = `junction:${world.generation}:${world.tickIndex}:${junctionRequestSerial}`, command = { id, transactionId: id, kind: 'junction-request', origin: 'manual', target: { generation: world.generation },
        parameters: { request: { junctionId, configurationId, authoringRevision: definition.revision, expiryTick: world.tickIndex + 120, policy, coalesce: true } } };
      const proposal = world.prepareIntervention(command);
      if (causalTake && causalTake.recordIntervention(command, proposal.outcome, { tick: world.tickIndex, generation: world.generation }).status !== 'accepted') throw new Error('Junction request was not admitted by the take.');
      const result = proposal.commit(); if (result.status !== 'queued') throw new Error(result.reason); status('Junction request queued; no route success is implied.'); return result;
    },
    cancelJunctionRequest(commandId) {
      const world = runtime()?.world; if (!world || worldBusy || causalTakeStart || causalTakeStop) throw new Error('Wait for the committed world.');
      if (!world.interventionState.pending.some(command => command.id === commandId && command.kind === 'junction-request')) return false;
      if (causalTake && causalTake.recordInput({ version: 1, kind: 'intervention-cancel', commandId }, { tick: world.tickIndex, generation: world.generation }).status !== 'accepted') throw new Error('Take could not admit the cancellation.');
      return world.cancelIntervention(commandId);
    },
    openRectangularMembrane() {
      if (disposed || !physicalPlayback) { status('The shared skin is unavailable.'); return; }
      return toolGate.open('Shared skin', () => import('../../midi-ui/RectangularMembraneView.js'), ({ createRectangularMembraneView }) => {
        rectangularMembraneView ||= createRectangularMembraneView({ document, getPlayback: () => physicalPlayback, getLanes: () => project.procgen.lanes,
          saveRack: rack => { if (disposed || worldBusy || pendingHistory || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current world or take operation before saving effect defaults.'); dispatch({ type: 'procgen/effectRack', rack }); }, onStatus: status });
        rectangularMembraneView.open();
      });
    },
    openSympatheticMap(foundryModel = null) {
      if (disposed || !physicalPlayback) { status('Shared audio bodies are unavailable.'); return; }
      sympatheticMapView ||= createSympatheticMapView({ document, resourceBudget, getPlayback: () => physicalPlayback, getLanes: () => project.procgen.lanes,
        saveRack: rack => { if (disposed || worldBusy || pendingHistory || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current world or take operation before saving effect defaults.'); dispatch({ type: 'procgen/effectRack', rack }); }, onStatus: status });
      sympatheticMapView.open(foundryModel);
    },
    openSpectralFreeze() {
      if (disposed || !physicalPlayback) { status('Physical spectral freeze is unavailable.'); return; }
      return toolGate.open('Spectral freeze', () => import('../../midi-ui/SpectralFreezeView.js'), ({ createSpectralFreezeView }) => {
        spectralFreezeView ||= createSpectralFreezeView({ document, window, getPlayback: () => physicalPlayback, getLanes: () => project.procgen.lanes,
          saveRack: rack => { if (disposed || worldBusy || pendingHistory || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current world or take operation before saving effect defaults.'); dispatch({ type: 'procgen/effectRack', rack }); }, onStatus: status });
        spectralFreezeView.open();
      });
    },
    openTravelColoration() {
      if (disposed || !physicalPlayback) { status('Physical travel color is unavailable.'); return; }
      return toolGate.open('Travel color', () => import('../../midi-ui/TravelColorationView.js'), ({ createTravelColorationView }) => {
        travelColorationView ||= createTravelColorationView({ document, getPlayback: () => physicalPlayback,
          saveRack: rack => { if (disposed || worldBusy || pendingHistory || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current world or take operation before saving effect defaults.'); dispatch({ type: 'procgen/effectRack', rack }); }, onStatus: status });
        travelColorationView.open();
      });
    },
    openCrossExcitation() {
      if (disposed || !physicalPlayback) { status('Physical lane effects are unavailable.'); return; }
      return toolGate.open('Cross excitation', () => import('../../midi-ui/CrossExcitationView.js'), ({ createCrossExcitationView }) => {
        crossExcitationView ||= createCrossExcitationView({ document, getPlayback: () => physicalPlayback, getLanes: () => project.procgen.lanes,
          saveRack: rack => { if (disposed || worldBusy || pendingHistory || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current world or take operation before saving effect defaults.'); dispatch({ type: 'procgen/effectRack', rack }); }, onStatus: status });
        crossExcitationView.open();
      });
    },
    openQuarryEcho() {
      if (disposed || !physicalPlayback) { status('Physical owner effects are unavailable.'); return; }
      return toolGate.open('Quarry Echo', () => import('../../midi-ui/QuarryEchoView.js'), ({ createQuarryEchoView }) => {
        quarryEchoView ||= createQuarryEchoView({ document, window, onRectangularMembrane: () => handlers.openRectangularMembrane(), onSympatheticMap: () => handlers.openSympatheticMap(), onSpectralFreeze: () => handlers.openSpectralFreeze(), onTravelColoration: () => handlers.openTravelColoration(), onCrossExcitation: () => handlers.openCrossExcitation(), getPlayback: () => physicalPlayback, getSavedRack: () => project.procgen.effectRack || null,
          saveRack: rack => { if (disposed || worldBusy || pendingHistory || causalTake || causalTakeStart || causalTakeStop) throw new Error('Finish the current world or take operation before saving effect defaults.'); dispatch({ type: 'procgen/effectRack', rack }); }, onStatus: status });
        quarryEchoView.open();
      });
    },
    harvestSoundSeed(source) {
      if (disposed || !resourceBudget || !legacy.local.audio) throw new Error('Sound-seed ownership is unavailable.');

      return ensureSoundSeedLab().open(source);
    },
    openMasterCapture() {
      if (disposed || !resourceBudget || !legacy.local.audio) { status('Browser master capture is unavailable.'); return; }
      masterCapture ||= createMasterCaptureView({ document, window, preview: legacy.local.audio, resourceBudget, onHarvest: source => handlers.harvestSoundSeed(source), onStatus: status });
      masterCapture.open();
    },
    applyMatchingWorld(laneId = selected().id) { const lane = procgenLane(project.procgen.lanes, laneId); if (!lane?.linkedThemePresetId) throw new Error('This sound has no matching physical world suggestion.'); return dispatch({ type: 'procgen/worldTheme', laneId, worldThemeId: lane.linkedThemePresetId }); },
    openSoundLibrary() {
      if (disposed || !resourceBudget || !legacy.local.audio) { status('Sound library resource ownership is unavailable.'); return; }
      return toolGate.open('Sound library', () => import('../../midi-ui/SoundContentLibrary.js'), ({ createSoundContentLibrary }) => {
        soundLibrary ||= createSoundContentLibrary({ document, window, audio: legacy.local.audio, resourceBudget, jobs: backgroundJobs,
          onApply: (candidate, options) => handlers.applyInstalledInstrument(candidate, options), onStatus: status, monitor: handlers.openPrelistenMonitor() });
        soundLibrary.open();
      });
    },
    createVariationsView() {
      if (disposed || !resourceBudget || !legacy.local.audio) return null;
      patchVariations ||= createPatchVariationOwner({ window, audio: legacy.local.audio, resourceBudget, jobs: backgroundJobs,
        ...(getInstrumentCatalog ? { getCatalog: getInstrumentCatalog } : {}),
        getJournal: () => causalJournal ||= createProcgenCausalJournal({ storage, resourceBudget, jobs: backgroundJobs }),
        getSource: () => ({ identity: { documentId, documentGeneration, documentRevision: editRevision, laneId: selected().id, worldGeneration: runtime()?.world?.generation ?? null },
          reference: selected().instrumentRef || null, takeId: selectedCausalTakeId || lastCausalTake?.takeId || null,
          available: !disposed && !worldBusy && !pendingHistory && !physicalAuthoringAbort && !causalTakeStart && !causalTakeStop }),
        onReveal: () => handlers.openPrelistenMonitor(), onApply: async (candidate, options) => {
          const transaction = await soundTransactions.select(candidate, { signal: options.signal, laneId: options.laneId, hold: true });
          if (!options.isCurrent()) { transaction.cancel(); throw new Error('The variation source changed before lane publication.'); }
          return transaction.commit();
        } });
      return createPatchVariationView({ document, window, owner: patchVariations });
    },
    async offerMorphSource(index, kind, source, options = {}) {
      if (disposed || !resourceBudget || !legacy.local.audio) throw new Error('Resonator authoring ownership is unavailable.');

      return ensureSoundSeedLab().offerMorphSource(index, kind, source, options);
    },
    openShapeFoundry() {
      if (disposed || !resourceBudget || !legacy.local.audio) { status('Shape foundry resource ownership is unavailable.'); return; }
      return toolGate.open('Shape foundry', () => import('../../midi-ui/ShapeFoundryView.js'), ({ createShapeFoundryView }) => {
        shapeFoundry ||= createShapeFoundryView({ document, audio: legacy.local.audio, resourceBudget, jobs: backgroundJobs, getTargetIdentity: () => ({ documentGeneration, projectRevision, laneId: selected().id }),
          onApply: (candidate, options) => handlers.applyInstalledInstrument(candidate, options), onOfferSharedBody: model => handlers.openSympatheticMap(model), onOfferResonatorSource: (index, file, options) => handlers.offerMorphSource(index, 'shape', file, options), onStatus: status }); shapeFoundry.open();
      });
    },
    applyInstalledInstrument(candidate, { signal, hold = false, isCurrent } = {}) { return soundTransactions.select(candidate, { signal, hold, isCurrent, laneId: selected().id }); },
    canvasToolAuthorityChanged() { legacy.refreshCanvasToolAuthority?.(); },
    selectNativeSound(laneId, patchId) {
      if (!resourceBudget || !window.fetch) return Promise.reject(new Error('Native sound source ownership is unavailable. Keep the previous sound.'));
      nativeSoundSelection ||= createNativeSoundSelection({ fetch: window.fetch.bind(window), jobs: backgroundJobs, resourceBudget, ...(getInstrumentCatalog ? { getCatalog: getInstrumentCatalog } : {}) });
      return soundTransactions.select(signal => nativeSoundSelection.prepare(patchId, { signal }), { laneId });
    },
    selectSoundAlias(laneId, patch) {
      const lane = procgenLane(project.procgen.lanes, laneId); if (!lane || selected().id !== laneId) return Promise.reject(new Error('Select this lane before changing sound.'));
      const alias = resolveLegacySoundAlias({ family: patch.family ?? lane.family, role: patch.role ?? lane.role, patch: patch.patch ?? null });
      if (!resourceBudget || !window.fetch) return Promise.reject(new Error('Native sound source ownership is unavailable. The prior sound is unchanged.'));
      nativeSoundSelection ||= createNativeSoundSelection({ fetch: window.fetch.bind(window), jobs: backgroundJobs, resourceBudget, ...(getInstrumentCatalog ? { getCatalog: getInstrumentCatalog } : {}) });
      return soundTransactions.select(signal => nativeSoundSelection.prepare(alias.patchId, { signal }), { laneId, patch: alias.lanePatch });
    },
    performSceneMacro(input) {
      if (worldBusy || pendingHistory || physicalAuthoringAbort || causalTakeStart || causalTakeStop || soundTransactions.diagnostics().active || macroGestures.diagnostics().active) throw new Error('Finish the current world, sound, take or macro gesture before applying a scene macro.');
      const action = prepareSceneMacroAction(project, input), before = project, result = dispatch(action);
      if (!result || result === false) throw new Error('The scene macro edit was not admitted.');
      return Object.freeze({ status: result === before ? 'unchanged' : 'committed', value01: action.value01, laneIds: Object.freeze(action.targets.map(target => target.laneId)), physicalMutation: false, application: 'next-causal-onset' });
    },
    beginMacroGesture: (laneId, macroId, options) => { if (worldBusy || pendingHistory || physicalAuthoringAbort || causalTakeStart || causalTakeStop || soundTransactions.diagnostics().active) throw new Error('Finish the pending sound/world/take operation before a macro gesture.'); return macroGestures.begin(laneId, macroId, options); },
    previewMacroGesture: (handle, value, pressure = null) => pressure == null ? macroGestures.set(handle, value) : macroGestures.pressure(handle, pressure),
    finishMacroGesture: (handle, options) => macroGestures.finish(handle, options), macroGestureState: (laneId, macroId) => macroGestures.state(laneId, macroId),
    commitPerformedMacros: () => macroGestures.commitAll(), returnPerformedMacros: () => macroGestures.cancelAll(),
    learnMacro(laneId, macroId) { const endpoint = ports.getState(), epoch = documentGeneration, reference = procgenLane(project.procgen.lanes, laneId)?.instrumentRef;
      if (!endpoint.inputId || !reference) throw new Error('Select a connected input and an admitted instrument first.');
      ports.learnNext(event => { const current = ports.getState(); if (documentGeneration !== epoch || current.inputId !== endpoint.inputId || current.inputLiveness.connectionEpoch !== endpoint.inputLiveness.connectionEpoch || procgenLane(project.procgen.lanes, laneId)?.instrumentRef !== reference) { status('Macro Learn source changed; no mapping was installed.'); return; }
        if (!['cc', 'pressure', 'bend'].includes(event.type)) { status('Macro Learn needs a CC, channel pressure or pitch-bend observation; notes are not macro triggers.'); return; }
        macroGestures.bindController(laneId, macroId, { endpointId: endpoint.inputId, endpointEpoch: endpoint.inputLiveness.connectionEpoch, channel: event.channel, controller: event.controller, type: event.type });
        status(event.type === 'pressure' ? 'Pressure learned as momentary normalized model input. Release returns to the saved baseline.' : 'Controller learned with pickup. Commit performed macros saves one edit per gesture; disconnect keeps the exact last accepted value.');
      }); status('Move the selected input controller to observe a scoped macro mapping.');
    },
    reconcileSoundPreview: () => { macroGestures.reconcile(); return soundTransactions.reconcile(); }, cancelSoundPreview: () => soundTransactions.cancel(), soundSelectionState: () => soundTransactions.diagnostics(),
    status, preferences: persist, presentationGeneration: () => documentGeneration,
    laneMixView: laneId => physicalPlayback?.laneMixView(laneId),
    devices, midiRouteState: () => ports.getState(), outputState: () => legacy.local.getState(),
    midiRoutePolicy: safe(policy => {
      if (policy === 'local') {
        const selector = document.getElementById('procgenOutput');
        if (!selector) throw new Error('Browser preview selection is unavailable.');
        selector.value = 'synth'; selector.dispatchEvent(new window.Event('change', { bubbles: true }));
        syncPorts(); view.renderInspector(); persist(); status('Browser preview selected. Press Listen locally to start.'); return;
      }
      const mpe = { ...project.global.mpe };
      if (policy === 'shared') mpe.enabled = false;
      else if (['reject', 'steal-oldest'].includes(policy)) mpe.voicePolicy = policy;
      else if (['manual', 'send-zone'].includes(policy)) mpe.configuration = policy;
      else throw new Error('Unknown MIDI expression policy.');
      dispatch({ type: 'procgen/global', patch: { mpe } });
    }),
    engineState: () => engine.getState(), playhead: id => engine.getLanePosition?.(id),
    rearmPhysicalMusic: safe(() => {
      if (disposed || worldBusy || causalTake || causalTakeStart) throw new Error('Stop recording and finish world operations before discarding unknown held state.');
      physicalPlayback?.engine.rearm({ discardUnknownHeldState: true });
      status('Physical music rearmed at the next complete boundary; unknown held state was discarded.'); view.renderInspector();
    }),
    causalTakeState, startCausalTake: safe(startCausalTake), stopCausalTake: safe(stopCausalTake), discardCausalTail: safe(discardCausalTail), cancelCausalTakeArm,
    markCausalTake: safe(markCausalTake), inspectLastCausalTake: safe(inspectLastCausalTake),
    prepareCausalArchive: safe(prepareCausalArchive), browseCausalTakes: safe(browseCausalTakes), selectCausalTake: safe(selectCausalTake),
    readPhysicalScore: safe(readPhysicalScore), inspectPhysicalScoreCause: safe(inspectPhysicalScoreCause),
    compareCausalTake: safe(options => openCausalWorkbench(options)), prepareCausalBranch: safe(options => openCausalWorkbench({ ...options, branch: true })),
    armCausalBranchFeedback: safe(() => { if (!causalWorkbench) throw new Error('Prepare an explicit physical branch first.'); return causalWorkbench.armFeedback(); }),
    disarmCausalBranchFeedback: safe(() => causalWorkbench?.disarmFeedback()),
    advanceCausalBranch: safe(options => { if (!causalWorkbench) throw new Error('Prepare a physical branch first.'); return causalWorkbench.advance(options); }),
    setCausalBranchPlayback: safe(playing => { if (!causalWorkbench) throw new Error('Prepare a physical branch first.'); return causalWorkbench.setPlayback(playing); }),
    cancelCausalWorkbench: () => causalWorkbench?.cancel(), finishCausalBranch: safe(finishCausalBranch),
    historyBusy: () => pendingHistory !== null,
    historyState: () => Object.freeze({ undo: undo.length, redo: redo.length,
      retainedBytes: retainedHistoryBytes(), physical: physicalHistory.diagnostics(), byteLimit: historyBytesLimit, dropped: historyDropped }),
    stopOutput() {
      soundSeedLab?.suspend(); shapeFoundry?.suspend(); physicalFeedback?.disarm();
      transport.stop(); pendingResume = false;
      status('Transport stopped and output flushed.');
      return transport.getState();
    },
    stage: safe(async () => {
      stageSession ||= createPerformanceStageSession({ canEnter: () => !disposed && !startupFailure && !!runtime()?.world && legacy.local.getState().status !== 'starting' && !worldBusy && !pendingHistory && !physicalAuthoringAbort && !soundTransactions.diagnostics().active && !macroGestures.diagnostics().active && !document.querySelector?.('dialog[open]'),
        getIdentity: () => JSON.stringify([documentGeneration, projectRevision]), setPresentation: value => view?.stageMode?.(value), getCandidate: () => sceneLoader?.state(),
        applyCandidate: () => sceneLoader.apply(), cancelCandidate: () => sceneLoader?.cancel(), onStatus: status });
      const result = await (stageSession.active() ? stageSession.exit() : stageSession.enter()); legacy.refreshShortcutHints?.(); view?.sceneCue?.(sceneLoader?.state(), project.procgen.sceneOrigin?.manifest || null, stageSession.active()); return result;
    }),
    stageExit: safe(async () => { const result = await stageSession?.exit(); legacy.refreshShortcutHints?.(); return result; }), stageGo: safe(() => stageSession?.go()),
    stagePlay: () => play(), stagePause() { transport.pause(); },
    panicOutput() { midiConnectSerial++; soundSeedLab?.suspend(); shapeFoundry?.suspend(); physicalFeedback?.disarm(); ports.panic(); physicalPlayback?.setEffectBypass?.('panic'); status('Owned output and effect memory cleared.'); },
    scenes: safe(openPerformanceScenes),
    transport(patch) { configureTransport(patch); if (patch.gameSpeed != null) legacy.setSpeed(patch.gameSpeed, { owned: true }); editRevision++; storageStatus(); persist(); if (!transport.getState().playing) scheduleRecovery(); },
    addLane: safe(async () => { if (!await rebuild({ projectNext: reduceMidiProject(project, { type: 'procgen/addLane' }) })) return false; state.laneId = project.procgen.lanes.at(-1).id; view.render(); return true; }),
    removeLane: safe(async () => { await rebuild({ projectNext: reduceMidiProject(project, { type: 'procgen/removeLane', laneId: selected().id }) }); }),
    duplicate() { const lane = selected(), pattern = lane.patterns?.[state.slot]; if (!pattern) return false; const slot = (state.slot + 1) % 4; dispatch({ type: 'procgen/pattern', laneId: lane.id, slot, patch: clone(pattern) }); state.slot = slot; view.render(); return true; },
    clear() { const lane = selected(), pattern = lane.patterns?.[state.slot]; if (!pattern) return false; dispatch({ type: 'procgen/pattern', laneId: lane.id, slot: state.slot, patch: { steps: pattern.steps.map(step => ({ ...step, enabled: false, tie: false })) } }); return true; },
    copy() { const pattern = selected().patterns?.[state.slot]; if (!pattern) return false; clipboard = clone(pattern); status('Phrase copied.'); return true; },
    paste() { if (!clipboard || !selected().patterns?.[state.slot]) return false; dispatch({ type: 'procgen/pattern', laneId: selected().id, slot: state.slot, patch: clone(clipboard) }); return true; },
    undo: safe(() => historyMove(undo, redo)),
    redo: safe(() => historyMove(redo, undo)),
    resetPattern() { if (!selected().patterns?.[state.slot]) return false; dispatch({ type: 'procgen/pattern', laneId: selected().id, slot: state.slot, patch: createProcgenPattern(selected().family, selected().role, state.slot) }); return true; },
    record(value) {
      if (disposed) return false;
      const before = ports.getState();
      if (value && recordingViewState(before).foreignRecording) { status('MIDI recording belongs to an earlier project state. Export it or clear the recording before starting another.'); return false; }
      const midiState = ports.configure({ recording: !!value }); state.recording = midiState.recording; noteEntries.clear();
      if (state.recording && (!recordingOrigin || !before.recordedEvents)) recordingOrigin = Object.freeze({ generation: documentGeneration, documentId });
      view.recording(state.recording, recordingViewState(midiState));
      if (state.recording) ports.recordTempo(transport.getState().bpm, transport.getState().beat);
      else if (value && midiState.lastConfigurationFailure?.reason === 'recording-index-budget') status('MIDI recording not started: ' + midiState.lastConfigurationFailure.message);
      return state.recording;
    },
    clearMidiRecording() {
      if (disposed) return false;
      if (ports.getState().recording) { status('Stop MIDI recording before clearing its retained events.'); return false; }
      ports.clearRecording(); recordingOrigin = null; noteEntries.clear(); view.recording(false, recordingViewState(ports.getState()));
      status('MIDI recording cleared. Prepared files and causal takes are unchanged.'); return true;
    },
    learn() {
      if (inputLease) { cancelInputEdits('canceled by user'); return false; }
      const lane = selected(), lease = { id: ++inputGestureSerial, documentGeneration, projectRevision,
        laneId: lane.id, slot: state.slot, index: state.step,
        inputEndpointEpoch: ports.getState().inputLiveness.connectionEpoch, armedAt: now(), policy: 'fixed-target' };
      if (!inputTarget(lease)) return false;
      inputLease = lease;
      view?.refreshLaneNavigation?.();
      const accept = event => {
        if (inputLease !== lease || lease.documentGeneration !== documentGeneration ||
            lease.inputEndpointEpoch !== ports.getState().inputLiveness.connectionEpoch || !inputTarget(lease)) {
          if (inputLease === lease) cancelInputEdits('target or input changed');
          return;
        }
        if (event.type !== 'noteOn') { ports.learnNext(accept); return; }
        inputLease = null;
        view?.refreshLaneNavigation?.();
        inputStep(event, true, lease);
      };
      ports.learnNext(accept); status('Play a MIDI note to learn this step.'); return true;
    },
    cancelLearn() { cancelInputEdits('canceled by user'); },
    input(id) { cancelInputEdits('input changed'); state.inputId = id || null; syncPorts(); view.renderInspector(); persist(); },
    clockOutput(id) { state.clockOutputId = id || null; syncPorts(); persist(); },
    thru(value) { state.thru = !!value; ports.configure({ thru: state.thru }); },
    connect: safe(async () => {
      const request = ++midiConnectSerial, generation = documentGeneration, world = runtime()?.world;
      const current = () => !disposed && request === midiConnectSerial && generation === documentGeneration && world === runtime()?.world;
      try {
        const midi = window.WebMidi || await loadDeferredWebMidi({ document, window });
        if (!current()) return false;
        if (!midi || midi.supported === false) throw new Error('Web MIDI is unavailable in this browser.');
        bindMidiEvents(midi);
        if (!midi.enabled) await midi.enable({ sysex: false });
        if (!current()) return false;
        if (!midi.enabled) throw new Error('MIDI access did not become available. Connect again to retry.');
        syncPorts({ rearmDefault: true }); view.renderInspector(); status('MIDI connected. Choose note and clock ports, then press Play.'); return true;
      } catch (error) { if (current()) throw error; return false; }
    }),
    expressionState(event) {
      const target = expressionTarget(event); return target ? Object.freeze({ ...midiParameterEvidence.read(target), endpointName: target.endpointName,
        endpointEpoch: target.endpointEpoch, available: target.available, channel: target.channel, canRequest: !stageSession?.active() }) : null;
    },
    expression(event) {
      const request = { ...event, type: event.type === 'pitchBend' ? 'bend' : event.type }, target = expressionTarget(request);
      if (!target || request.targetKey && request.targetKey !== target.key) { status('MIDI expression target changed. Review the current output before sending.'); return false; }
      let ticket;
      try { ticket = midiParameterEvidence.request(target, request.value, now()); }
      catch (error) { status('MIDI expression was not sent: ' + error.message); return false; }
      let submitted = false;
      try { submitted = ports.sendEvent({ type: target.parameter, value: request.value, channel: target.channel, outputId: target.outputId }) === true; }
      catch (error) { status('MIDI expression submission is unconfirmed: ' + error.message); }
      finally { midiParameterEvidence.settle(ticket, submitted, now()); view?.renderInspector?.(); }
      return submitted;
    },
    save: safe(async ({ asCopy = false, rename = false } = {}) => {
      if (pendingSaveGenerations.has(documentGeneration)) return false;
      if (worldBusy) throw new Error('Wait for the world change to finish before saving.');
      pendingSaveGenerations.add(documentGeneration);
      const wasPlaying = transport.getState().playing; beforeRestart();
      const saveDocumentGeneration = documentGeneration, saveOperationSerial = operationSerial;
      let resumeStopGeneration = transportStopGeneration;
      try {
        const promptName = asCopy || rename || !documentId;
        const name = promptName ? await view.requestProjectName({ value: savedName, title: asCopy ? 'Save project copy' : rename ? 'Rename project' : 'Project name' }) : savedName;
        if (name == null || disposed || documentGeneration !== saveDocumentGeneration || operationSerial !== saveOperationSerial) return false;
        if (!name.trim()) { status('Enter a project name to save.'); return false; }
        const session = capture(name, { resume: false }), revision = editRevision;
        resumeStopGeneration = transportStopGeneration;
        const id = asCopy || !documentId ? createProcgenDocumentId(window.crypto) : documentId;
        const expectedRevision = asCopy || !documentId ? 0 : documentRevision;
        const receipt = storage.saveDocument ? await storage.saveDocument(id, expectedRevision, session, createProcgenDocumentId(window.crypto).replace(/^doc:/, 'commit:')) :
          (await storage.save(name, session), null);
        if (disposed) return false;
        if (documentGeneration !== saveDocumentGeneration || operationSerial !== saveOperationSerial) return true;
        if (receipt) { documentId = receipt.id; documentRevision = receipt.revision; }
        savedName = name; savedRevision = revision; lastSavedAt = session.savedAt; lastStorageError = null; storageStatus();
        status(editRevision === revision ? 'Saved ' + name + '.' : 'Snapshot saved; newer edits are unsaved.'); return true;
      } catch (error) {
        if (documentGeneration === saveDocumentGeneration && operationSerial === saveOperationSerial) storageStatus(error);
        throw error;
      } finally {
        pendingSaveGenerations.delete(saveDocumentGeneration);
        if (!disposed && wasPlaying && documentGeneration === saveDocumentGeneration && operationSerial === saveOperationSerial &&
            transportStopGeneration === resumeStopGeneration && !transport.getState().playing) play();
      }
    }),
    saveAs: safe(() => handlers.save({ asCopy: true })),
    rename: safe(() => handlers.save({ rename: true })),
    cancelProjectPicker() {
      if (currentOperation?.kind === 'select-session') { currentOperation.controller.abort(); currentOperation = null; }
    },
    load: safe(async () => {
      if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.');
      const lease = beginOperation('select-session');
      const page = storage.listDocumentPage ? await storage.listDocumentPage({ signal: lease.signal }) : null;
      const entries = page ? null : storage.listDocuments ? await storage.listDocuments() : await storage.list();
      if (!ownsOperation(lease)) return false;
      const loadSelected = safe(async id => {
        if (!ownsOperation(lease)) return false;
        const record = storage.loadDocumentOwned ? await storage.loadDocumentOwned(id, { signal: lease.signal }) : storage.loadDocument ? await storage.loadDocument(id) : { session: await storage.load(id), id: null, revision: 0 };
        try {
          if (!ownsOperation(lease)) return false;
          const loaded = await loadSession(record.session, lease, { signal: record.signal });
          if (loaded) { documentId = record.id; documentRevision = record.revision; savedRevision = editRevision; lastSavedAt = record.session.savedAt; storageStatus(); }
          return loaded;
        } finally { record.release?.(); }
      });
      if (page && view.showProjectPage) view.showProjectPage(page, loadSelected, async (cursor, query) => {
        if (!ownsOperation(lease)) return null;
        const next = await storage.listDocumentPage({ cursor, query, signal: lease.signal });
        return ownsOperation(lease) ? next : null;
      });
      else view.showProjects(entries || page.items, loadSelected);
      return true;
    }),
    reclaimRecovery: safe(async () => { await storage.removeRecovery?.(); status('Old recovery checkpoint removed. Named projects were kept.'); }),
    import: safe(async file => {
      if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.');
      const lease = beginOperation('import');
      if (file?.size != null && (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_SESSION_FILE_BYTES)) throw new Error('Project file exceeds the 64 MiB import limit.');
      const generation = documentGeneration, revision = editRevision, inputBytes = file.size ?? 0;
      let computed = null;
      try {
        computed = await backgroundJobs.compute({ kind: 'parse-json', ownerId: 'procgen-import', ownerEpoch: generation,
          sourceRevision: `${generation}:${revision}`, inputBytes, estimatedPeakBytes: Math.min(400 * 1048576, 64 * 1048576 + inputBytes * 24),
          signal: lease.signal, budgetAdapter: resourceBudget, isCurrent: () => ownsOperation(lease) && documentGeneration === generation && editRevision === revision,
          prepareInput: async ({ signal }) => {
            if (typeof file.stream !== 'function') return file.text();
            const bytes = await readBrowserBuildResponse(new globalThis.Response(file.stream()), MAX_SESSION_FILE_BYTES, signal);
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          }, onProgress: phase => status(`Preparing project: ${phase.phase}.`) });
        if (!ownsOperation(lease)) return false;
        return await loadSession(computed.value, lease);
      } finally { computed?.release(); finishOperation(lease); }
    }),
    export: safe(() => prepareProjectExport()),
    exportMidi: safe(prepareMidiExport),
    retryExport() {
      const receipt = deliverPrepared();
      if (!receipt) { status('No prepared file is available to retry.'); return null; }
      if (receipt.state === 'delivery-requested') status('Prepared file download requested again. Check your browser downloads.');
      return receipt;
    },
    discardExport() {
      const preparing = !!archiveExportPreparation || !!midiExportPreparation || currentOperation?.kind === 'export';
      archiveExportPreparation?.controller.abort(); midiExportPreparation?.controller.abort();
      if (currentOperation?.kind === 'export') currentOperation.controller.abort();
      ++exportPreparationRevision;
      if (!preparedExport) { publishExportState(); if (preparing) status('File preparation canceled. The source project is unchanged.'); return preparing; }
      preparedExport.discard(); preparedExport = null; lastDelivery = null;
      publishExportState(); status('Prepared file discarded. The source project is unchanged.'); return true;
    },
    cancelExportDelivery() {
      if (archiveExportPreparation) { archiveExportPreparation.controller.abort(); status('Canceling archive preparation. The previous prepared file remains ready.'); return true; }
      if (midiExportPreparation) { midiExportPreparation.controller.abort(); status('Canceling MIDI preparation. The previous prepared file remains ready.'); return true; }
      if (!activeExportAbort) return false;
      activeExportAbort.abort(); status('Canceling file delivery. The prepared file remains ready.'); return true;
    },
    retryDisplay() { return renderer()?.recover?.() || false; },
    async savePreparedExport() {
      if (!preparedExport) { status('Prepare a project or MIDI export first.'); return null; }
      if (activeExportAbort) { status('A file delivery is already in progress.'); return null; }
      const artifact = preparedExport;
      const selected = await requestExportFileHandle(artifact, { windowRef: window });
      if (disposed || preparedExport !== artifact) return Object.freeze({ deliveryId: null, artifactId: artifact.artifactId,
        sinkKind: 'file-picker', state: 'canceled', bytesWritten: 0, errorKind: 'source-replaced', evidence: 'artifact-retired-before-delivery' });
      if (selected.state !== 'selected') {
        if (selected.errorKind === 'artifact-expired') artifact.discard();
        lastDelivery = Object.freeze({ deliveryId: null, artifactId: artifact.artifactId, sinkKind: 'file-picker',
          state: selected.state, bytesWritten: 0, errorKind: selected.errorKind, evidence: 'picker-result' });
        status(selected.state === 'canceled' ? 'File picker canceled. The prepared file remains ready.' :
          `Save file unavailable: ${selected.errorKind}. The prepared file remains ready.`);
        publishExportState();
        return lastDelivery;
      }
      const controller = new AbortController(); activeExportAbort = controller;
      lastDelivery = Object.freeze({ deliveryId: null, artifactId: artifact.artifactId, sinkKind: 'file-handle',
        state: 'writing', bytesWritten: 0, errorKind: null, evidence: 'delivery-in-progress' });
      publishExportState();
      let delivery;
      try { delivery = await deliverArtifactToFileHandle(artifact, selected.handle, { signal: controller.signal }); }
      finally { if (activeExportAbort === controller) activeExportAbort = null; }
      if (!disposed && preparedExport === artifact) {
        lastDelivery = delivery;
        status(delivery.state === 'close-acknowledged' ? 'File stream closed successfully. Verify the saved file before relying on it.' :
          `File delivery ${delivery.state}: ${delivery.errorKind}. The prepared file remains ready.`);
        publishExportState();
      }
      return delivery;
    },
    new: safe(() => rebuild({ seed: freshProcgenSeed(window.crypto, project.procgen.seed), fresh: true })),
    reroll: safe(() => rebuild({ seed: freshProcgenSeed(window.crypto, project.procgen.seed) })),
    replay: safe(() => rebuild()), rebuild: safe(worldSettings => rebuild({ worldSettings })), seed: safe(seed => rebuild({ seed: Number(seed) >>> 0 })),
    observe(patch) {
      state.observerMode = patch.mode ?? state.observerMode; state.observerLane = patch.laneId ?? state.observerLane; state.observerHold = patch.holdSeconds ?? state.observerHold;
      const render = renderer(), index = project.procgen.lanes.findIndex(lane => lane.id === state.observerLane);
      if (state.observerMode === 'overview') { if (render) render.followLaneIndex = null; render?.camera?.setZoom?.(render.camera.minimumScale()); }
      else if (state.observerMode === 'follow') { if (index >= 0) { state.firstLane = index; if (render) render.followLaneIndex = index; } render?.camera?.followFrontier?.(); view.render(); }
      else { render?.cctv?.setEnabled?.(true); render?.cctv?.setMode?.('director'); lastObserverAt = -Infinity; observeFrame(now()); }
      persist();
    }
  };
  const canCommand = (name, args = []) => {
    if (disposed || typeof handlers[name] !== 'function' || stageSession && !stageSession.permitsCommand(name, args)) return false;
    if (name === 'copy' || name === 'paste') return !!selected().patterns?.[state.slot] && (name === 'copy' || !!clipboard);
    if (name === 'undo' || name === 'redo') {
      const stack = name === 'undo' ? undo : redo;
      return !pendingHistory && !worldBusy && !physicalAuthoringAbort && stack.length > 0 &&
        (!physicalHistory.get(stack.at(-1)) || !(causalTake || causalTakeStart || causalTakeStop));
    }
    return true;
  };
  for (const [name, action] of Object.entries(handlers)) if (typeof action === 'function') handlers[name] = (...args) => {
    if (stageSession && !stageSession.permitsCommand(name, args)) return stageSession.reject();
    try { const result = action(...args); refreshSceneCue(); return result?.then ? Promise.resolve(result).finally(refreshSceneCue) : result; } catch (error) { refreshSceneCue(); throw error; }
  };
  view = createView({ document, window, resourceBudget, getProject: () => project, getRuntime, getDocumentIdentity: () => documentGeneration,
    getArmedLaneIds: () => [inputLease?.laneId, state.recording && procgenLane(project.procgen.lanes, state.laneId)?.mode === 'pattern' ? state.laneId : null].filter(Boolean), dispatch, handlers, canCommand, state });
  const outputRouteKey = state => JSON.stringify([state.selectedBackend, state.enabled === true, state.outputId ?? null]);
  const expressionOutputKey = state => JSON.stringify([state.selectedBackend, state.enabled === true, state.outputId ?? state.selectedOutputId ?? null, state.outputGeneration ?? null]);
  const initialOutput = legacy.local.getState();
  let observedOutputRoute = outputRouteKey(initialOutput), observedMidiActivation = initialOutput.selectedBackend === 'midi' && initialOutput.enabled === true;
  let observedExpressionOutput = expressionOutputKey(initialOutput);
  const unsubscribeOutputState = legacy.local.subscribe?.(state => {
    if (disposed) return; const current = state || legacy.local.getState(), next = outputRouteKey(current), midiActivation = current.selectedBackend === 'midi' && current.enabled === true, rearmDefault = midiActivation && !observedMidiActivation;
    observedMidiActivation = midiActivation;
    if (next !== observedOutputRoute) { observedOutputRoute = next; syncPorts({ rearmDefault }); }
    view?.refreshOperational?.();
    const expressionOutput = expressionOutputKey(current);
    if (expressionOutput !== observedExpressionOutput) { observedExpressionOutput = expressionOutput; view?.renderInspector?.(); }
  });
  if (typeof unsubscribeOutputState === 'function') listeners.push(unsubscribeOutputState);
  if (saved?.project?.procgen?.version !== 2 && saved?.project?.procgen) {
    try {
      const conversion = convertLegacyProcgenWorkstationProject(saved.project, { strategy: 'physical-default' });
      view.offerLegacyConversion?.(conversion.report, safe(async () => {
        if (!await rebuild({ projectNext: conversion.project })) return false;
        view.clearLegacyConversion?.(); status('Previous setup converted to the physical play model.');
        return true;
      }));
    } catch (error) { status(error?.message || 'Previous setup requires an explicit physical conversion.'); }
  }
  const unsubscribeProject = legacy.subscribeProject?.(next => { if (!disposed && !writingLegacy && next !== project) syncProject(next, { fromLegacy: true }); });
  if (unsubscribeProject) listeners.push(unsubscribeProject);
  const syncLegacyControls = () => {
    if (legacy.settings.speed !== lastLegacySpeed) { lastLegacySpeed = legacy.settings.speed; configureTransport({ gameSpeed: lastLegacySpeed }); persist(); }
    if (legacy.isPaused() === transport.getState().playing) { if (legacy.isPaused()) transport.pause(); else play(); }
  };
  for (const id of ['procgenPause', 'procgenSpeedUp', 'procgenSpeedDown', 'procgenSpeed', 'procgenSpeedReadout']) {
    const el = document.getElementById(id); listen(el, 'click', syncLegacyControls); listen(el, 'change', syncLegacyControls); listen(el, 'contextmenu', syncLegacyControls);
  }
  listen(document, 'keyup', syncLegacyControls);
  listen(document, 'keydown', event => { if (event.key === 'Escape' && inputLease) cancelInputEdits('canceled by user'); });
  pageLifecycle = createProcgenPageLifecycle({ document, window, suspend: ({ reason }) => {
    toolGate.cancel();
    physicalAuthoringAbort?.abort(); physicalAuthoringView?.suspend(); quarryEchoView?.suspend(); crossExcitationView?.suspend(); travelColorationView?.suspend(); spectralFreezeView?.suspend(); sympatheticMapView?.suspend(); rectangularMembraneView?.suspend(); physicalJunctionView?.suspend();
    soundSeedLab?.suspend(); shapeFoundry?.suspend();
    void masterCapture?.suspend();
    causalAudioRender?.suspend();
    causalWorkbenchSourceSerial++;
    const workbench = causalWorkbench;
    if (workbench) void workbench.dispose().then(() => { if (causalWorkbench === workbench) causalWorkbench = null; }, error => status('Branch recovery: ' + error.message));
    beforeRestart(); persist({ immediate: true }); recover();
    if (causalTake || causalTakeStart) void stopCausalTake({ reason }).catch(error => status('Causal take finalization: ' + error.message));
    status('Page suspended. Press Play after returning to resume.');
  }, restore: ({ paused }) => {
    if (!paused) return;
    transport.pause(); ports.flush(); view?.transport(transport.getState());
    status('Page restored paused. Press Play to resume.');
  } });
  listeners.push(() => pageLifecycle.dispose());
  listen(document.getElementById('procgenPanic'), 'click', () => handlers.panicOutput());
  const disconnected = () => { syncPorts(); view.renderInspector(); };
  const connected = () => { syncPorts(); view.renderInspector(); status('MIDI device connected. Press Play or send MIDI Start/Continue to resume.'); };
  let midiEventOwner = null;
  const bindMidiEvents = midi => {
    if (midiEventOwner === midi) return;
    midiEventOwner?.removeListener?.('disconnected', disconnected); midiEventOwner?.removeListener?.('connected', connected);
    midiEventOwner = midi; midiEventOwner?.addListener?.('disconnected', disconnected); midiEventOwner?.addListener?.('connected', connected);
  };
  bindMidiEvents(window.WebMidi);
  listeners.push(() => bindMidiEvents(null));
  let interventionSerial = 0;
  const canWorldShortcut = action => !disposed && (action === 'restartLevel' ? !stageSession?.active() :
    action === 'nuke' || action === 'nukeInstant' ? !stageSession?.active() && !!runtime()?.world && !worldBusy && !causalTakeStart && !causalTakeStop : true);
  const releasePhysicalControls = legacy.setPhysicalControlOwner?.({
    getRecipeSpeed: () => transport.getState().gameSpeed, canActivateOutput: () => !stageSession?.active(), canShortcut: canWorldShortcut,
    getShareExportDescriptor, prepareShareExport, revealPreparedExport: () => view?.revealPreparedExport?.(),
    canRestart: () => !stageSession?.active() || stageSession.reject(), outputChanged: refreshSceneCue, operationalChanged: () => view?.refreshOperational?.(),
    speed(value) { configureTransport({ gameSpeed: value }); legacy.setSpeed(value, { owned: true }); lastLegacySpeed = legacy.settings.speed; persist(); refreshSceneCue(); return value; },
    nuke(laneId) {
      const world = runtime()?.world; if (!canWorldShortcut('nuke')) return false;
      const command = { id: `manual-nuke:${world.generation}:${world.tickIndex}:${++interventionSerial}`, kind: laneId == null ? 'nuke-all' : 'nuke-lane',
        origin: 'manual', target: { generation: world.generation, ...(laneId == null ? {} : { laneId }) }, applyAtTick: world.tickIndex + 1 };
      const proposal = world.prepareIntervention(command);
      if (causalTake) {
        const receipt = causalTake.recordIntervention(command, proposal.outcome, { tick: world.tickIndex, generation: world.generation });
        if (receipt.status !== 'accepted') { status('Nuke was not applied: take input admission failed.'); return false; }
      }
      return proposal.commit().status === 'queued';
    }
  });
  prepareSettings(); setLegacyProject(project, { persist: false }); legacy.setSpeed(transport.getState().gameSpeed); lastLegacySpeed = legacy.settings.speed; view.render(); view.transport(transport.getState()); storageStatus();
  return { getProject: () => project, getInputEditLease: () => inputLease && Object.freeze({ ...inputLease }),
    getMidiRecordingState: () => Object.freeze(recordingViewState(ports.getState())),
    getExportState: () => Object.freeze({ artifact: preparedExport?.metadata() || null, delivery: lastDelivery, preparation: exportPreparationState(),
      preparationReceipt: lastMidiExportReceipt?.artifactId === preparedExport?.artifactId ? lastMidiExportReceipt?.receipt || null : null }),
    getDisplayDiagnostics: () => view.displayScheduler?.diagnostics() || null,
    getNavigationDiagnostics: () => view.navigationDiagnostics?.() || null,
    getVariationState: () => patchVariations?.state() || null,
    getSoundSeedState: () => soundSeedLab?.state() || null,
    getPreferenceState: () => preferenceWriter?.state() || null,
    getDocumentState: () => Object.freeze({ id: documentId, revision: documentRevision, editRevision, savedRevision,
      dirty: editRevision !== savedRevision, savedAt: lastSavedAt }),
    getRecoveryState: () => Object.freeze({ snapshot: Object.freeze({ ...recoverySnapshotStats }), state: recoveryState, pendingRevision: editRevision, durableRevision: durableRecoveryRevision,
      durableTick: durableRecoveryTick, durableGeneration: durableRecoveryGeneration, error: recoveryError, retirement: recoveryRetirement, lastCommit: lastRecoveryCommit, journal: getProcgenRecoveryJournal(runtime()?.world)?.stats() || null, storage: storage.getState?.().recoveryPages || null }),
    getStartupPlan: () => ({ ...startupPlan, project: clone(startupPlan.project) }), getLaneAssignments: () => project.procgen.lanes.map(lane => lane.worldThemeId),
    laneMixView: laneId => physicalPlayback?.laneMixView(laneId),
    getOperationalSnapshot, reportStartupFailure,
    getPlaybackState: () => { const output = legacy.local.getState(); return { ...output,
      ...(output.selectedBackend === 'midi' ? ports.getOutputActivity() : { activeNotes: router()?.scheduler?._activeNotes?.size || 0, pendingNotes: router()?.scheduler?._pendingNoteOns?.size || 0 }),
      pressure: output.selectedBackend === 'midi' ? ports.getState().pressure : router()?.scheduler?.getOutputPressure?.() || ports.getState().pressure }; },
    prepareSettings, bindRuntime, beforeRestart, stopCausalTake, adoptSceneRecipe, loadSession, capture, recover, dispatch, play, handlers, state, transport, ports, engine,
    getPhysicalAnalysis: () => physicalPlayback?.engine.physicalAnalysis() || null, getPhysicalDiagnostics: () => physicalPlayback?.engine.diagnostics() || null,
    getPhysicalOutputDiagnostics: () => physicalPlayback?.diagnostics() || null,
    getPhysicalScoreClock: () => physicalScoreClock, getWorldInspector: () => worldInspector,
    get settings() { return legacy.settings; },
    dispose() {
      if (disposed) return retirement.retire();
      physicalScoreAbort?.abort();
      cancelInputEdits('workstation closed');
      persist({ immediate: true });
      disposed = true; loadSerial++;
      const operation = currentOperation; currentOperation = null;
      const timer = recoveryTimer; recoveryTimer = null;
      const pendingPersist = persistTimer; persistTimer = null;
      const removeListeners = listeners.splice(0);
      const pendingCausalStop = causalTake || causalTakeStart || causalTakeStop ? stopCausalTake({ reason: 'workstation-disposed' }) : null;
      const pendingWorkbenchStop = causalWorkbench?.dispose();
      return retirement.retire([
        { name: 'preference-writer', run: () => preferenceWriter?.dispose({ flush: true }) },
        { name: 'operation', run: () => operation?.controller.abort() },
        { name: 'recovery-write', run: () => recoveryAbort?.abort() },
        { name: 'recovery-timer', run: () => { if (timer != null) window.clearTimeout?.(timer); } },
        { name: 'persist-timer', run: () => { if (pendingPersist != null) window.clearTimeout?.(pendingPersist); } },
        { name: 'physical-control-owner', run: () => releasePhysicalControls?.() },
        { name: 'prepared-export', run: () => { archiveExportPreparation?.controller.abort(); midiExportPreparation?.controller.abort(); activeExportAbort?.abort(); preparedExport?.discard(); } },
        { name: 'router-hook', run: () => unhookRouter?.() },
        { name: 'world-hook', run: () => unhookWorld?.() },
        { name: 'macro-gestures', run: () => macroGestures.dispose() },
        { name: 'sound-transactions', run: () => soundTransactions.dispose() },
        { name: 'stage-session', run: () => stageSession?.dispose() },
        { name: 'scene-tools', run: async () => { await sceneToolsPending?.catch(() => {}); const lessons = physicalLessonView?.dispose(); if (lessons) { await lessons.completion; if (lessons.outcome !== 'complete') throw new Error('Lesson preparation retirement remains unresolved.'); } await sceneBrowser?.dispose(); await sceneLoader?.dispose(); } },
        { name: 'native-sound-selection', run: () => nativeSoundSelection?.dispose() },
        { name: 'physical-playback', run: () => physicalPlayback?.dispose() },
        { name: 'physical-score-views', run: () => retirePhysicalScoreViews() },
        { name: 'causal-workbench', run: () => pendingWorkbenchStop },
        { name: 'sound-library', run: () => soundLibrary?.dispose() },
        { name: 'patch-variations', run: () => patchVariations?.dispose() },
        { name: 'release-gesture-view', run: () => releaseGestureView?.dispose() },
        { name: 'physical-authoring-view', run: () => physicalAuthoringView?.dispose() },
        { name: 'physical-authoring-history', run: () => physicalHistory.dispose() },
        { name: 'physical-junction-view', run: () => physicalJunctionView?.dispose() },
        { name: 'lazy-tool-requests', run: () => toolGate.dispose() },
        { name: 'rectangular-membrane-view', run: () => rectangularMembraneView?.dispose() },
        { name: 'sympathetic-map-view', run: () => sympatheticMapView?.dispose() },
        { name: 'spectral-freeze-view', run: () => spectralFreezeView?.dispose() },
        { name: 'travel-colour-view', run: () => travelColorationView?.dispose() },
        { name: 'cross-excitation-view', run: () => crossExcitationView?.dispose() },
        { name: 'quarry-echo-view', run: () => quarryEchoView?.dispose() },
        { name: 'sound-seed-lab', run: () => soundSeedLab?.dispose() },
        { name: 'shape-foundry', run: () => shapeFoundry?.dispose() },
        { name: 'master-capture', run: async () => { const seed = soundSeedLab?.dispose(); if (seed) { await seed.completion; if (seed.outcome !== 'complete') throw new Error('Sound-seed readers still own the capture source.'); } return masterCapture?.dispose(); } },
        { name: 'causal-audio-render', run: async () => { const seed = soundSeedLab?.dispose(); if (seed) { await seed.completion; if (seed.outcome !== 'complete') throw new Error('Sound-seed readers still own the render source.'); } return causalAudioRender?.dispose(); } },
        { name: 'prelisten-monitor', run: () => prelistenMonitor?.dispose() },
        { name: 'transport', run: () => transport.dispose()?.completion },
        { name: 'midi-ports', run: () => ports.dispose() },
        { name: 'midi-parameter-evidence', run: () => midiParameterEvidence.dispose() },
        { name: 'lane-display-evidence', run: () => laneDisplayEvidence.dispose() },
        ...removeListeners.map((remove, index) => ({ name: `listener-${index}`, run: remove })),
        { name: 'view', run: () => view.dispose() },
        { name: 'storage', run: () => {
          const close = () => createProcgenRetirementScope().retire([
            { name: 'journal-qualifications', run: () => causalJournal?.releaseQualifications() }, { name: 'database', run: () => storage.close?.() }
          ]);
          return pendingCausalStop || pendingWorkbenchStop || archiveExportTasks.size ?
            Promise.all([pendingCausalStop, pendingWorkbenchStop, Promise.allSettled([...archiveExportTasks])]).then(close) : close();
        } }
      ]);
    }
  };
}
