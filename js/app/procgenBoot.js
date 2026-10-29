import { configurePhysicalJunctions } from './procgen/PhysicalJunctions.js';
import { ProcgenScoredTerrain } from './procgen/ProcgenScoredTerrain.js';
import { getActiveExecutionIdentity } from '../runtime/ActiveExecutionIdentity.js';
import { verifyPerformanceSceneOrigin } from './procgen/workstation/PerformanceSceneRecipe.js';
import { prepareProcgenRecoveryJournal } from './procgen/workstation/ProcgenRecoveryCapture.js';
import { replayProcgenRecoveryJournal } from './procgen/workstation/ProcgenRecoveryJournal.js';
import { getDecorationPack } from '../decorations/ProcgenDecorationPacks.js';
import { ProcgenBitmapHud } from './procgen/ProcgenBitmapHud.js';
import { createProcgenUiController } from './procgen/ProcgenUiController.js';
import { loadProcgenPackTerrain, loadProcgenMixedTerrain } from './procgen/ProcgenPackTerrain.js';
import { ProcgenLaneWorld, normalizeLaneHeight } from './procgen/ProcgenLaneWorld.js';
import { estimateProcgenCandidateBytes as estimateCandidateWorldBytes } from './procgen/ProcgenCandidateBudget.js';
import { ParticleTable } from '../render/ParticleTable.js';
import { createProcgenWorkstation } from './procgen/workstation/ProcgenWorkstation.js';
import { restoreProcgenCheckpoint } from './procgen/workstation/ProcgenCheckpoint.js';
import { freshProcgenSeed, validateProcgenSession, createProcgenSessionStorage } from './procgen/workstation/ProcgenSessionStorage.js';
import { parseProcgenStartupIntent, loadProcgenStartupSource } from './procgen/workstation/ProcgenStartupIntent.js';
import { loadTerrainRecipeBook } from './procgen/ProcgenTerrainRecipes.js';
import { createProcgenLaneRuntime } from './procgen/ProcgenLaneRuntime.js';
import { createProcgenRetirementScope, afterProcgenRetirement, retireProcgenWorldResources } from './procgen/ProcgenRetirement.js';
import { createResourceBudget } from './resources/ResourceBudget.js';
import { createProcgenResourceFactory } from './procgen/ProcgenResourceFactory.js';
import { GameTypes } from '../game/GameTypes.js';
import { EditorLevel } from '../editor/EditorLevel.js';
import { getStyle, getStyleNames } from '../editor/StyleRegistry.js';
import { ProcgenController } from './procgenController.js';
import { ProcgenAssetManager } from './procgenAssetManager.js';
import { ProcgenTerrainStamper } from './procgenTerrainStamper.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import { ProcgenStageAdapter } from './procgenStageAdapter.js';
import { ANALYTICS_EVENT_TYPES, createAnalyticsService } from './analytics.js';
import {
  normalizeSeed,
  deriveSeed,
  createSeededRandom
} from '../core/seededRandom.js';

const PROCGEN_GAME_TYPE = GameTypes.LEMMINGS;
const PROCGEN_LEVEL_WIDTH = 65535;
const PROCGEN_LEVEL_HEIGHT = DEFAULT_LEVEL_HEIGHT;
const PROCGEN_RELEASE_RATE = 50;
const PROCGEN_RELEASE_COUNT = 50;
const PROCGEN_GROUND_HEIGHT = 4;
const PROCGEN_ENTRANCE_OFFSET = 80;
const PROCGEN_INITIAL_GROUND_WIDTH = 280;
const PROCGEN_ENTRANCE_CLEARANCE = 28;
const PROCGEN_SEED_PARAM = 'seed';
const PROCGEN_SEED_STORAGE_KEY = 'procgen.seed';
const PROCGEN_GROUND_SETS_BY_PATH = {
  lemmings: [0, 1, 2, 3, 4],
  lemmings_ohNo: [0, 1, 2, 3],
  xmas91: [0, 2],
  xmas92: [0, 2],
  holiday93: [1, 2],
  holiday94: [1, 2]
};
const PROCGEN_SKILLS = {
  CLIMBER: 9999,
  FLOATER: 9999,
  BOMBER: 9999,
  BLOCKER: 9999,
  BUILDER: 9999,
  BASHER: 9999,
  MINER: 9999,
  DIGGER: 9999
};

let activeProcgenRuntime = null;
const procgenResourceBudget = createResourceBudget();
const renderBudget = { budgetAdapter: procgenResourceBudget };
procgenResourceBudget.registerEvictor('cold-render-buffers', ({ neededBytes }) => activeProcgenRuntime?.lanes?.renderer?.resources?.reclaim?.(neededBytes), { priority: -2 });

let analytics = null;
let procgenUi = null;
let procgenStudio = null;
let workstationInitSerial = 0;
const readProcgenDistances = () => {
  try { const values = JSON.parse(window.localStorage?.getItem('procgen.laneDistances.v1') || '[]'); return Array.isArray(values) ? values.slice(0, 1024).map(n => Number.isFinite(n) ? Math.max(0, n) : 0) : []; }
  catch { return []; }
};
const saveProcgenDistances = world => {
  if (!world?.stall?.lanes) return;
  const values = readProcgenDistances();
  world.stall.lanes.forEach((lane, index) => { values[index] = Math.max(values[index] || 0, lane.bestDistance, lane.previousDistance, lane.maxX - 36); });
  try { window.localStorage?.setItem('procgen.laneDistances.v1', JSON.stringify(values)); } catch { /* Session values remain available. */ }
};
let procgenBootListeners = [];
let procgenBarObserver = null;
let lastProcgenRuntimeRetirement = null;
let startupController = null, startupPending = false, startupBlocked = null;

const runFocusBlurCleanup = (runtime) => {
  const cleanup = runtime?.focusBlurCleanup;
  if (typeof cleanup === 'function') {
    try { cleanup(); } finally { runtime.focusBlurCleanup = null; }
  }
  if (runtime) {
    runtime.focusBlurCleanup = null;
  }
};

/**
 * Ensure repeat procgen init/start cycles do not leak timers/listeners.
 * Cleanup order matters: controller first (detaches timer/event hooks), then
 * stage adapter/view/game teardown.
 */
const disposeProcgenRuntime = () => {
  const runtime = activeProcgenRuntime;
  if (!runtime) return lastProcgenRuntimeRetirement;
  activeProcgenRuntime = null;
  const scope = createProcgenRetirementScope(), readers = createProcgenRetirementScope(), sources = createProcgenRetirementScope(), providers = createProcgenRetirementScope();
  lastProcgenRuntimeRetirement = scope.retire([
    { name: 'runtime-readers', run: () => readers.retire([
      { name: 'save-distances', run: () => saveProcgenDistances(runtime.world) },
      { name: 'focus-blur-listener', run: () => runFocusBlurCleanup(runtime) },
      { name: 'local-output', run: () => procgenUi?.local.suspendGame() },
      { name: 'lanes', run: () => runtime.lanes?.stop()?.completion },
      { name: 'controller', run: () => runtime.controller?.stop?.() },
      { name: 'view-controller', run: () => {
        if (runtime.view && runtime.view.procgenController === runtime.controller) runtime.view.procgenController = null;
      } },
      { name: 'debug-state', run: () => {
        if (typeof window !== 'undefined') { window.procgenDebugState = null; window.__PROCGEN_LANES__ = null; }
      } },
      { name: 'stage-adapter', run: () => runtime.stageAdapter?.dispose?.() },
      { name: 'game', run: () => runtime.game?.stop?.() },
      { name: 'view', run: () => runtime.view?.dispose?.() }
    ]) },
    { name: 'runtime-sources', run: () => sources.retire([{ name: 'game-resources', run: () => afterProcgenRetirement([readers.getReceipt()], () => runtime.resources?.dispose?.()) }]) },
    { name: 'runtime-providers', run: () => providers.retire([
      { name: 'asset-provider-lease', run: () => afterProcgenRetirement([readers.getReceipt(), sources.getReceipt()], () => runtime.providerLease?.release()) },
      { name: 'asset-provider', run: () => afterProcgenRetirement([readers.getReceipt(), sources.getReceipt()], () => runtime.fileProvider?.dispose?.()) }
    ]) },
    { name: 'world-budget', run: () => afterProcgenRetirement([readers.getReceipt(), sources.getReceipt(), providers.getReceipt()], () => runtime.worldBudgetToken && procgenResourceBudget.release({
      token: runtime.worldBudgetToken, owner: 'active-world' })) }
  ]);
  return lastProcgenRuntimeRetirement;
};

const addProcgenBootListener = (target, eventName, handler, options) => {
  if (!target?.addEventListener || typeof handler !== 'function') return;
  target.addEventListener(eventName, handler, options);
  procgenBootListeners.push({ target, eventName, handler, options });
};

const disposeProcgenBootListeners = () => {
  startupController?.abort(); startupController = null; startupPending = false;
  try { procgenBarObserver?.disconnect(); } catch { /* Remove the remaining listeners. */ }
  procgenBarObserver = null;
  while (procgenBootListeners.length) {
    const { target, eventName, handler, options } = procgenBootListeners.pop();
    try { target?.removeEventListener?.(eventName, handler, options); } catch { /* Continue retiring owned listeners. */ }
  }
};

const installProcgenBootListeners = () => {
  disposeProcgenBootListeners();
  const reportStartupFailure = error => {
    startupBlocked = error;
    const status = document.getElementById('procgenRunStatus');
    if (status) status.textContent = `Could not open startup intent: ${error.message}`;
    if (!status?.parentNode || typeof document.createElement !== 'function') return;
    document.getElementById('procgenStartupFresh')?.remove();
    const fresh = document.createElement('button'); fresh.id = 'procgenStartupFresh'; fresh.type = 'button'; fresh.textContent = 'Start fresh';
    fresh.title = 'Open a new session with default settings.';
    addProcgenBootListener(fresh, 'click', () => {
      const target = new URL(window.location.href); target.search = ''; target.hash = ''; target.username = ''; target.password = '';
      target.searchParams.set('startup', 'fresh');
      if (new URLSearchParams(window.location.search).has('e2e')) target.searchParams.set('e2e', '1');
      window.location.assign(target.href);
    });
    document.getElementById('procgenStartupError')?.remove();
    const panel = document.createElement('section'); panel.id = 'procgenStartupError'; panel.className = 'procgen-startup-error'; panel.setAttribute('role', 'alert');
    const title = document.createElement('h2'); title.textContent = 'Could not open this session';
    panel.append(title, status, fresh); document.body.appendChild(panel); procgenStudio?.reportStartupFailure?.(error); fresh.focus();
  };
  const boot = async () => {
    const controller = new AbortController(); startupController?.abort(); startupController = controller;
    startupPending = true; startupBlocked = null; let startupStorage = null, startupSource = null, storageTransferred = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const startupIntent = parseProcgenStartupIntent(params);
      if (params.get('workstation') === '0' && (startupIntent.sceneRecipe || ['document', 'recovery'].includes(startupIntent.mode))) throw new Error('Document, recovery and authored scene startup require the workstation surface.');
      document.body?.classList?.toggle('procgen-workstation', params.get('workstation') !== '0');
      resizeCanvas();
      if (!procgenUi && document.getElementById('procgenDrawer')) {
        procgenUi = createProcgenUiController({ document, window, getRuntime: () => activeProcgenRuntime, restart: init,
          resourceBudget: procgenResourceBudget,
          initial: { laneCount: params.get('lanes'), speed: params.get('speed'), pack: params.get('pack') } });
        if (params.get('workstation') !== '0') {
          procgenUi.settings.seed = resolveProcgenSeed(params);
          try {
            startupStorage = createProcgenSessionStorage(window.indexedDB, { budgetAdapter: procgenResourceBudget });
            let savedPreferences; const restorePrevious = !startupIntent.mode || startupIntent.mode === 'previous-setup';
            try { savedPreferences = await startupStorage.loadPreferences({ signal: controller.signal, includeProject: restorePrevious }); }
            catch (error) { controller.signal.throwIfAborted(); if (restorePrevious && (error.code === 'invalid-preferences' || error.preferenceSourcePublished)) throw error; }
            startupSource = await loadProcgenStartupSource(startupIntent, { storage: startupStorage, signal: controller.signal });
            controller.signal.throwIfAborted();
            procgenStudio = createProcgenWorkstation({ document, window, legacy: procgenUi, getRuntime: () => activeProcgenRuntime,
              restart: options => init({ ...options, startupOwner: controller.signal }),
              prepareSceneWorld: options => initWorkstation({ ...options, prepareOnly: true }),
              prepareInspectionWorld: request => import('./procgen/workstation/ProcgenInspectionWorld.js').then(module => module.prepareProcgenInspectionWorld({ ...request, rootPath: activeProcgenRuntime?.assetRootPath, resourceBudget: procgenResourceBudget })), resourceBudget: procgenResourceBudget, startupIntent, startupSource, savedPreferences: savedPreferences || undefined, storage: startupStorage });
            storageTransferred = true;
            procgenStudio.prepareSettings();
            if (startupSource.sceneSelection) {
              const selection = startupSource.sceneSelection;
              const [loading, adapter, audio] = await Promise.all([import('./procgen/workstation/PerformanceSceneLoader.js'), import('./procgen/workstation/PerformanceSceneWorldAdapter.js'), import('./midi-ui/NativeInstrumentSchema.js')]);
              controller.signal.throwIfAborted();
              const baseIdentity = 'scene-startup:' + selection.identity.hash;
              const loader = loading.createPerformanceSceneLoader({ getBaseIdentity() { controller.signal.throwIfAborted(); startupSource.signal.throwIfAborted(); return baseIdentity; },
                resolveDependency: selection.catalog.resolveDependency,
                prepareCandidate: adapter.createPerformanceSceneWorldAdapter({ getCatalog: audio.getNativeInstrumentCatalog, getOrigin: (scene, variants) => selection.catalog.origin(scene, variants),
                  prepareWorld: options => initWorkstation({ ...options, prepareOnly: true }), resourceBudget: procgenResourceBudget,
                  getMaterialProvider: procgenUi.local.audio?.getSoundMaterialProvider ? () => procgenUi.local.audio.getSoundMaterialProvider() : null }) });
              const cancel = () => { loader.cancel().catch(() => {}); };
              controller.signal.addEventListener('abort', cancel, { once: true }); startupSource.signal.addEventListener('abort', cancel, { once: true });
              try {
                loader.select(selection.origin.manifest);
                const prepared = await loader.prepare(); controller.signal.throwIfAborted(); startupSource.signal.throwIfAborted();
                if (prepared.status !== 'ready') throw new Error('The starting scene assets cannot be prepared; the previous recovery remains available.');
                const applied = await loader.apply();
                if (applied.status !== 'committed') throw new Error('Starting scene replacement was canceled.');
              } finally { controller.signal.removeEventListener('abort', cancel); startupSource.signal.removeEventListener('abort', cancel); await loader.dispose(); }
            } else if (startupSource.session) await procgenStudio.loadSession(startupSource.session, null, { signal: startupSource.signal || controller.signal });
            else await init({ startupOwner: controller.signal, lease: { signal: controller.signal } });
            controller.signal.throwIfAborted(); startupSource.signal?.throwIfAborted();
          } catch (error) {
            if (!controller.signal.aborted) reportStartupFailure(error);
            return;
          }
          if (params.has('e2e')) window.__PROCGEN_STUDIO__ = procgenStudio;
          resizeCanvas();
        }
      }
      const bar = document.getElementById('procgenTopbar');
      if (bar && typeof window.ResizeObserver === 'function') { procgenBarObserver = new window.ResizeObserver(() => resizeCanvas()); procgenBarObserver.observe(bar); const stage = document.getElementById('procgenStudioStage'); if (stage) procgenBarObserver.observe(stage); }
      startupPending = false;
      if (!procgenStudio) await init();
    } catch (error) {
      if (!controller.signal.aborted) reportStartupFailure(error);
    } finally {
      startupSource?.release?.(); startupSource = null;
      if (!storageTransferred) startupStorage?.close();
      if (startupController === controller) { startupController = null; startupPending = false; }
    }
  };
  addProcgenBootListener(window, 'resize', () => resizeCanvas());
  addProcgenBootListener(window, 'pagehide', () => {
    startupController?.abort();
    if (!procgenStudio) activeProcgenRuntime?.lanes?.pause?.();
    procgenUi?.local?.suspendGame?.();
  });
  addProcgenBootListener(window, 'pageshow', event => { if (event.persisted) resizeCanvas(); });
  addProcgenBootListener(window, 'orientationchange', () => resizeCanvas());

  if (document.readyState === 'loading') {
    addProcgenBootListener(document, 'DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
};

const setActiveProcgenRuntimeForTest = (runtime) => {
  activeProcgenRuntime = runtime || null;
};
const getProcgenResourceBudgetState = () => procgenResourceBudget.diagnostics();

const getProcgenGroundSets = (config) => {
  const key = config?.path || null;
  const sets = key ? PROCGEN_GROUND_SETS_BY_PATH[key] : null;
  return Array.isArray(sets) && sets.length ? sets : null;
};

const getCompatibleProcgenStyleNames = (config) => {
  const names = getStyleNames();
  const allowedGroundSets = getProcgenGroundSets(config);
  if (!allowedGroundSets) return names;
  return names.filter(name => {
    const style = getStyle(name);
    return Number.isFinite(style?.groundSet)
      && allowedGroundSets.includes(style.groundSet | 0);
  });
};

const rotateFromRandomIndex = (list, rng = Math.random) => {
  if (!Array.isArray(list) || list.length === 0) return [];
  const start = Math.floor(rng() * list.length) % list.length;
  return list.slice(start).concat(list.slice(0, start));
};

const buildProcgenThemeContract = (styleName, config = null) => {
  const style = getStyle(styleName);
  return {
    selectedTheme: style?.name || styleName || null,
    styleName: style?.name || styleName || null,
    groundSet: Number.isFinite(style?.groundSet) ? style.groundSet | 0 : null,
    packPath: config?.path || null
  };
};

const pickProcgenStyle = async (fileProvider, config, rng = Math.random) => {
  const names = getStyleNames();
  if (!names.length) return 'fire';
  const compatible = getCompatibleProcgenStyleNames(config);
  const list = rotateFromRandomIndex(compatible.length ? compatible : names, rng);
  let choice = names[0];
  if (fileProvider && config) {
    for (const candidate of list) {
      const style = getStyle(candidate);
      const groundSet = Number.isFinite(style?.groundSet) ? style.groundSet | 0 : null;
      if (groundSet == null) continue;
      try {
        await Promise.all([
          fileProvider.loadBinary(config.path, `VGAGR${groundSet}.DAT`),
          fileProvider.loadBinary(config.path, `GROUND${groundSet}O.DAT`)
        ]);
        choice = candidate;
        break;
      } catch (err) {
        continue;
      }
    }
  } else {
    choice = list[Math.floor(rng() * list.length)] || names[0];
  }
  try {
    window.localStorage?.setItem('procgen.style', choice);
  } catch (err) {
    // ignore storage failures
  }
  return choice;
};

const resolveProcgenSeed = (params) => {
  const requestedSeed = params?.get?.(PROCGEN_SEED_PARAM);
  if (requestedSeed != null && requestedSeed !== '') {
    return normalizeSeed(requestedSeed);
  }
  return freshProcgenSeed(window?.crypto);
};

const readFiniteQueryOption = (params, name) => {
  if (!params?.has?.(name)) return null;
  const value = Number(params.get(name));
  return Number.isFinite(value) ? value : null;
};

const readBooleanQueryOption = (params, name) => {
  if (!params?.has?.(name)) return null;
  const value = String(params.get(name) ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', ''].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return null;
};

const buildProcgenControllerOptions = (params, baseOptions = {}) => {
  const options = { ...baseOptions };
  for (const name of [
    'gapChance',
    'gapMinWidth',
    'gapMaxWidth',
    'recentCertificateLimit'
  ]) {
    const value = readFiniteQueryOption(params, name);
    if (value != null) options[name] = value;
  }
  const verify = readBooleanQueryOption(params, 'procgenCertificateVerification');
  if (verify != null) options.procgenCertificateVerification = verify;
  return options;
};

const buildProcgenEditorLevel = (styleName) => {
  const level = new EditorLevel();
  level.setHeader('TITLE', 'Procgen');
  level.setHeader('STYLE', styleName);
  level.setHeader('WIDTH', PROCGEN_LEVEL_WIDTH);
  level.setHeader('HEIGHT', PROCGEN_LEVEL_HEIGHT);
  level.setHeader('LEMMINGS', PROCGEN_RELEASE_COUNT);
  level.setHeader('SAVE_REQUIREMENT', 0);
  level.setHeader('MAX_SPAWN_INTERVAL', PROCGEN_RELEASE_RATE);
  level.setHeader('TIME_LIMIT', 'INFINITE');
  const entranceX = 64;
  const entranceY = PROCGEN_LEVEL_HEIGHT - PROCGEN_GROUND_HEIGHT - PROCGEN_ENTRANCE_OFFSET;
  level.setHeader('START_X', entranceX);
  for (const [skill, count] of Object.entries(PROCGEN_SKILLS)) {
    level.setSkill(skill, count);
  }
  level.gadgets.push({
    props: { PIECE: 1, X: entranceX, Y: entranceY }
  });
  return { level, entranceX, entranceY };
};

const initWorkstation = async ({ session, lease, prepareOnly = false, sceneRecipe = null } = {}) => {
  if (session) { validateProcgenSession(session); if (session.project?.procgen?.sceneOrigin) {
    const source = getActiveExecutionIdentity('browser-survey-core'); if (source.activeExecution !== 'bound') throw new Error('Reopening a pinned scene requires its immutable application build.');
    await verifyPerformanceSceneOrigin(session.project.procgen.sceneOrigin, { sourceHash: source.buildId });
  } }
  const serial = ++workstationInitSerial, canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const settings = sceneRecipe ? { ...sceneRecipe.settings } : session ? { ...session.settings, laneCount: session.world.laneCount, laneHeight: session.world.laneHeight, seed: session.world.seed } : { ...procgenStudio.prepareSettings() };
  let candidate = null, lanes = null, terrain = null, assets = null, committed = false, staged = false, preparationError = null;
  let stagedOwner = null, fileProvider = null, resourceLease = null, resources = null, resourcePromise = null, candidateBudgetToken = null, candidateBudgetOwner = 'candidate-world';
  const canCommit = () => serial === workstationInitSerial && !lease?.signal?.aborted;
  try {
    const factory = createProcgenResourceFactory();
    fileProvider = factory.fileProvider;
    fileProvider?.setBudgetAdapter?.(procgenResourceBudget);
    resourceLease = fileProvider?.acquireLease?.() || null;
    resourcePromise = factory.getGameResources(GameTypes.LEMMINGS);
    const [configs, preparedResources, book] = await Promise.all([
      Promise.all([GameTypes.LEMMINGS, GameTypes.OHNO, GameTypes.HOLIDAY94].map(type => factory.getConfig(type))),
      resourcePromise, loadTerrainRecipeBook(fileProvider)
    ]);
    resources = preparedResources;
    if (!canCommit()) return false;
    terrain = await loadProcgenMixedTerrain({ configs, fileProvider, book,
      laneAssignments: (sceneRecipe?.project || session?.project)?.procgen?.lanes?.map(lane => lane.worldThemeId || lane.family) || procgenStudio.getLaneAssignments(),
      requiredFamilies: session?.world?.assets?.map(asset => asset.family) ?? null,
      signal: lease?.signal, operationId: lease?.id });
    if (!canCommit()) return false;
    const initialTerrainLayout = sceneRecipe?.initialTerrainLayout ?? session?.project?.procgen?.sceneOrigin?.recipe?.initialTerrainLayout ?? null;
    if (initialTerrainLayout) { terrain = new ProcgenScoredTerrain(terrain, initialTerrainLayout, { resourceBudget: procgenResourceBudget, ownerEpoch: serial, isCurrent: canCommit }); await terrain.prepare({ signal: lease?.signal }); if (!canCommit()) return false; }
    assets = new ProcgenAssetManager({ styleName: 'crystal', groundSet: 4, config: configs[0], fileProvider });
    await assets.load({ signal: lease?.signal, operationId: lease?.id });
    if (!canCommit()) return false;
    assets.decorationPack = getDecorationPack(settings.decoration);
    const palette = assets.assets?.gadgetImages?.find(image => image?.palette)?.palette || assets.groundPieces[0].image.palette;
    const [sprites, masks, hudSprites] = await Promise.all([resources.getLemmingsSprite(palette), resources.getMasks(), resources.getSkillPanelSprite(palette)]);
    if (!canCommit()) return false;
    await procgenUi.prepareCharacters(sprites);
    if (!canCommit()) return false;
    candidateBudgetToken = {};
    procgenResourceBudget.reserve({ token: candidateBudgetToken, owner: candidateBudgetOwner,
      generation: serial, kind: 'candidate', bytes: estimateCandidateWorldBytes(settings),
      pinned: true, reloadable: false });
    candidate = new ProcgenLaneWorld({ laneCount: settings.laneCount, laneHeight: settings.laneHeight, seed: settings.seed, sprites, masks, terrain,
      speed: settings.speed, cohorts: true, workstation: true, assists: (sceneRecipe?.assistPolicy ?? session?.project?.procgen?.sceneOrigin?.recipe?.assistPolicy) !== 'manual-only', hazardSpacing: settings.hazardSpacing,
      previousDistances: sceneRecipe ? [] : readProcgenDistances(), workerLimits: settings.workerLimits, populationPolicy: settings.populationPolicy, initialReleaseGesture: sceneRecipe?.initialReleaseGesture ?? null, actorBirthAbilities: sceneRecipe?.actorBirthAbilities ?? session?.project?.procgen?.sceneOrigin?.recipe?.actorBirthAbilities ?? session?.world?.actorBirthAbilities ?? null, particleTable: new ParticleTable(palette) });
    if (session) restoreProcgenCheckpoint(candidate, session.world);
    if (session?.recoveryJournal) await replayProcgenRecoveryJournal(candidate, session.recoveryJournal, { signal: lease?.signal });
    if (sceneRecipe) { candidate.configurePhysicalAuthoring(sceneRecipe.project.procgen.physicalGraph, sceneRecipe.project.procgen.fragmentInstances || []); if (sceneRecipe.project.procgen.junctions?.length) configurePhysicalJunctions(candidate, sceneRecipe.project.procgen.junctions, 1); }
    await prepareProcgenRecoveryJournal(candidate, { resourceBudget: procgenResourceBudget, signal: lease?.signal, isCurrent: () => canCommit() && !committed });
    lanes = createProcgenLaneRuntime({ canvas, resources, resourceLease, renderBudget, sprites, masks, assets, terrain, initialWorld: candidate, workstation: true, initiallySuspended: true,
      onMetrics: state => procgenUi?.syncMetrics(state), onActiveCount: count => procgenUi?.syncActiveCount(count), windowRef: window });
    resourceLease = null;
    lanes.renderer.hud = new ProcgenBitmapHud({ canvas, sprites: hudSprites });
    if ((prepareOnly || activeProcgenRuntime) && lanes.renderer.getDisplayState().state !== 'ready') throw new Error('The candidate display is unavailable. The live world remains active.');
    if (!canCommit()) return false;
    const publish = ({ isCurrent = () => true } = {}) => {
      if (!canCommit() || !isCurrent() || committed) throw new Error('The prepared world is stale or already published.');
      procgenResourceBudget.transfer({ token: candidateBudgetToken, owner: candidateBudgetOwner,
        generation: serial, toOwner: 'active-world' });
      candidateBudgetOwner = 'active-world';
      if (activeProcgenRuntime) procgenStudio.beforeRestart();
      disposeProcgenRuntime();
      if (sceneRecipe) procgenStudio.adoptSceneRecipe(sceneRecipe);
      activeProcgenRuntime = { lanes, world: candidate, assetRootPath: factory.rootPath, worldBudgetToken: candidateBudgetToken,
        recipeSettings: Object.freeze({ seed: candidate.seed, laneCount: candidate.laneCount,
          laneHeight: candidate.laneHeight, pack: settings.pack, decoration: settings.decoration,
          preset: settings.preset, mode: settings.mode }),
        view: lanes.view, game: lanes.game, stageAdapter: { updateStageSize: () => lanes.resize() }, controller: null, focusBlurCleanup: null };
      committed = true;
      if (!lanes.activate()) throw new Error('The admitted world presentation could not activate.');
      window.procgenSeed = candidate.seed; window.procgenSelectedTheme = 'mixed'; window.procgenDebugState = lanes.getDebugState;
      const params = new URLSearchParams(window.location.search);
      if (params.has('e2e')) window.__PROCGEN_LANES__ = { world: candidate, renderer: lanes.renderer, getState: lanes.getDebugState, pause: lanes.pause, resume: lanes.resume, step: lanes.step };
      procgenUi.sync({ charactersReady: true }); procgenStudio.bindRuntime({ session }); resizeCanvas();
      registerServiceWorker({ profile: 'perf' }); return activeProcgenRuntime;
    };
    if (prepareOnly) {
      staged = true; const owner = createProcgenRetirementScope();
      stagedOwner = Object.freeze({ world: candidate, settings: Object.freeze({ ...settings }), generation: serial,
        isCurrent: () => canCommit() && !committed && !owner.getReceipt(),
        commit(options) { if (owner.getReceipt()) throw new Error('The prepared world is retired.'); return publish(options); },
        retire() { let stopped; return owner.retire(committed ? [] : [
          { name: 'candidate-runtime', run: () => stopped = lanes.stop() },
          { name: 'candidate-budget', run: async () => { await stopped.completion; if (stopped.outcome !== 'complete') throw new Error('Candidate world resources remain unresolved.'); procgenResourceBudget.release({ token: candidateBudgetToken, owner: candidateBudgetOwner }); } }
        ]); } });
      return stagedOwner;
    }
    if (activeProcgenRuntime) {
      await procgenStudio.stopCausalTake({ reason: 'world-replacement' });
      if (!canCommit()) return false;
    }
    return publish();
  } catch (error) { preparationError = error; throw error; }
  finally {
    const candidateRetirement = createProcgenRetirementScope();
    const retirement = createProcgenRetirementScope().retire([
      ...(!committed && !staged ? [
        { name: 'candidate-runtime', run: () => candidateRetirement.retire([{ name: 'world-resources', run: () => lanes ? lanes.stop() : retireProcgenWorldResources({ world: candidate, terrain, assets }) }]) },
        { name: 'candidate-budget', run: () => afterProcgenRetirement([candidateRetirement.getReceipt()], () => { if (candidateBudgetToken) procgenResourceBudget.release({ token: candidateBudgetToken, owner: candidateBudgetOwner }); }) }
      ] : []),
      { name: 'preparation-provider-lease', run: () => afterProcgenRetirement([candidateRetirement.getReceipt()], () => resourceLease?.release()) },
      { name: 'preparation-resources', run: () => afterProcgenRetirement([candidateRetirement.getReceipt()], () => resources?.dispose?.()) },
      { name: 'late-preparation-resources', run: () => afterProcgenRetirement([candidateRetirement.getReceipt()], () => { if (!resources) return resourcePromise?.then(prepared => prepared.dispose?.(), () => {}); }) },
      { name: 'preparation-provider', run: () => afterProcgenRetirement([candidateRetirement.getReceipt()], () => { if (fileProvider?.acquireLease) return fileProvider.dispose(); }) }
    ]);
    await retirement.completion;
    if (retirement.outcome !== 'complete') {
      const error = preparationError || Object.assign(new Error('World preparation could not confirm retirement of every resource.'), { retirement });
      error.retirement = retirement;
      if (stagedOwner) { const candidateRetirement = stagedOwner.retire(); await candidateRetirement.completion; error.candidateRetirement = candidateRetirement; }
      if (!preparationError) throw error;
    }
  }
};

const init = async (options = {}) => {
  if (startupPending && options.startupOwner !== startupController?.signal || startupBlocked) throw startupBlocked || new Error('Wait for the startup plan to finish preparing.');
  if (procgenStudio) return initWorkstation(options);
  disposeProcgenRuntime();
  analytics = createAnalyticsService({
    window,
    document,
    navigator: window?.navigator || null,
    location: window?.location || null,
    localStorage: window?.localStorage || null,
    profile: 'perf',
    surface: 'procgen'
  });
  analytics.installWindowApi(window);
  analytics.trackPageView({
    surface: 'procgen',
    profile: 'perf',
    embedMode: false
  });
  const runtime = {
    view: null,
    game: null,
    controller: null,
    stageAdapter: null,
    focusBlurCleanup: null,
    fileProvider: null,
    providerLease: null,
    resources: null
  };
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  activeProcgenRuntime = runtime;
  try {
    const params = new URLSearchParams(window.location.search);
    const procgenSeed = procgenUi?.settings.seed ?? resolveProcgenSeed(params);
    const styleRng = createSeededRandom(deriveSeed(procgenSeed, 'style'));
    const terrainRng = createSeededRandom(deriveSeed(procgenSeed, 'terrain'));
    window.procgenSeed = procgenSeed;
    try {
      window.localStorage?.setItem(PROCGEN_SEED_STORAGE_KEY, String(procgenSeed));
    } catch {
      // ignore storage failures
    }
    const aiDebugOverlay = params.has('aiDebug');
    await import('./bootstrap.js');
    const [{ GameView }, { loadEditorLevel }] = await Promise.all([import('../game/GameView.js'), import('../editor/EditorLevelLoader.js')]);
    if (activeProcgenRuntime !== runtime) return;
    const view = new GameView();
    runtime.view = view;
    runtime.fileProvider = view.gameFactory.fileProvider;
    runtime.fileProvider?.setBudgetAdapter?.(procgenResourceBudget);
    runtime.providerLease = runtime.fileProvider?.acquireLease?.() || null;
    const gameType = procgenUi?.settings.pack || PROCGEN_GAME_TYPE;
    view.gameType = gameType;
    view.levelGroupIndex = 0;
    view.levelIndex = 0;
    view.midiEnabled = false;
    view.includeSavedLevels = false;
    view.endless = true;
    view.gameCanvas = canvas;
    view.gameSpeedFactor = procgenUi?.settings.speed || 3;
    if (view.stage) {
      view.stage.setGuiEnabled(false);
      view.stage.setCursorSprite(null);
      view.stage.hudMargin = 0;
    }

    const config = await view.gameFactory.getConfig(gameType);
    const resources = await view.gameFactory.getGameResources(gameType);
    runtime.resources = resources;
    view.gameResources = resources;

    const styleName = await pickProcgenStyle(
      view.gameFactory.fileProvider,
      config,
      styleRng
    );
    const themeContract = buildProcgenThemeContract(styleName, config);
    window.procgenSelectedTheme = themeContract.selectedTheme;
    window.procgenThemeContract = themeContract;
    if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
    const laneCount = procgenUi?.settings.laneCount || 8;
    if (procgenUi) {
      const assets = new ProcgenAssetManager({ styleName, config, fileProvider: view.gameFactory.fileProvider, random: terrainRng });
      await assets.load();
      assets.decorationPack = getDecorationPack(procgenUi.settings.decoration);
      const book = await loadTerrainRecipeBook(view.gameFactory.fileProvider);
      const terrain = await loadProcgenPackTerrain({ styleNames: getCompatibleProcgenStyleNames(config), config, fileProvider: view.gameFactory.fileProvider, book, initialAssets: assets, random: terrainRng });
      if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
      const palette = assets.assets?.gadgetImages?.find(image => image?.palette)?.palette || assets.groundPieces[0]?.image?.palette;
      const [sprites, masks, hudSprites] = await Promise.all([resources.getLemmingsSprite(palette), resources.getMasks(), resources.getSkillPanelSprite(palette)]);
      if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
      const lanes = createProcgenLaneRuntime({ canvas, resources, resourceLease: runtime.providerLease, renderBudget, sprites, masks, assets, laneCount, seed: procgenSeed,
        speed: procgenUi.settings.speed, laneHeight: procgenUi.settings.laneHeight, terrain, previousDistances: readProcgenDistances(), workerLimits: procgenUi?.settings.workerLimits, populationPolicy: procgenUi.settings.populationPolicy, onMetrics: state => procgenUi?.syncMetrics(state), onActiveCount: count => procgenUi?.syncActiveCount(count), windowRef: window });
      runtime.lanes = lanes;
      runtime.providerLease = null;
      lanes.renderer.hud = new ProcgenBitmapHud({ canvas, sprites: hudSprites });
      resources.dispose?.(); runtime.resources = null;
      view.dispose();
      runtime.fileProvider.dispose?.(); runtime.fileProvider = null;
      runtime.lanes = lanes; runtime.world = lanes.world; runtime.view = lanes.view; runtime.game = lanes.game;
      runtime.stageAdapter = { updateStageSize: () => lanes.resize() };
      window.procgenDebugState = () => lanes.getDebugState();
      if (params.has('e2e')) window.__PROCGEN_LANES__ = { world: lanes.world, renderer: lanes.renderer, getState: lanes.getDebugState, pause: lanes.pause, resume: lanes.resume, step: lanes.step };
      procgenUi?.sync();
      registerServiceWorker({ profile: 'perf' });
      return;
    }
    const { level: editorLevel, entranceX, entranceY } = buildProcgenEditorLevel(styleName);
    const level = await loadEditorLevel(
      editorLevel,
      config,
      view.gameFactory.fileProvider,
      {
        styleName,
        levelGroupIndex: 0,
        levelIndex: 0
      }
    );
    if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
    if (!level) {
      disposeProcgenRuntime();
      return;
    }

    const game = await view.gameFactory.getGame(gameType, resources);
    if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
    runtime.game = game;
    await game.loadCustomLevel(level, { levelGroupIndex: 0, levelIndex: 0 });
    if (activeProcgenRuntime !== runtime) { game.stop(); view.dispose(); return; }
    game.setGameDisplay(view.stage.getGameDisplay());
    view.game = game;
    view.applyLevelViewport(level);
    view.stage.updateStageSize();
    game.start();
    game.getGameTimer().speedFactor = view.gameSpeedFactor;
    runtime.focusBlurCleanup = bindCanvasFocusBlur(canvas);

    const assetManager = new ProcgenAssetManager({
      styleName,
      config,
      fileProvider: view.gameFactory.fileProvider,
      random: terrainRng
    });
    await assetManager.load();
    if (activeProcgenRuntime !== runtime) { game.stop(); view.dispose(); return; }
    const stamper = new ProcgenTerrainStamper(level);

    const controller = new ProcgenController({
      view,
      game,
      level,
      assets: assetManager,
      stamper,
      options: buildProcgenControllerOptions(params, {
        groundHeight: PROCGEN_GROUND_HEIGHT,
        initialGroundWidth: PROCGEN_INITIAL_GROUND_WIDTH,
        entranceX,
        entranceY,
        entranceClearance: PROCGEN_ENTRANCE_CLEARANCE,
        aiDebugOverlay,
        rng: terrainRng,
        rngSeed: procgenSeed,
        selectedTheme: themeContract.selectedTheme,
        themeContract
      })
    });
    controller.start();
    runtime.controller = controller;
    view.procgenController = controller;
    window.procgenDebugState = () => controller.getDebugState();

    const stageAdapter = new ProcgenStageAdapter({
      view,
      controller,
      canvas
    });
    stageAdapter.install();
    runtime.stageAdapter = stageAdapter;
    stageAdapter.updateStageSize();

    procgenUi?.sync();
    if (new URLSearchParams(window.location.search).has('e2e')) {
      const { installE2EHarness } = await import('./e2eHarness.js');
      if (activeProcgenRuntime !== runtime) return;
      installE2EHarness({ view, procgenController: controller });
    }
    registerServiceWorker({ profile: 'perf' });
  } catch (err) {
    runtime.lanes?.stop();
    analytics?.track?.(ANALYTICS_EVENT_TYPES.RUNTIME_BOOT_ERROR, {
      code: 'resource_error',
      surface: 'procgen',
      profile: 'perf',
      embedMode: false
    });
    if (activeProcgenRuntime === runtime) {
      activeProcgenRuntime = null;
    }
    runtime?.controller?.stop?.();
    if (runtime?.view && runtime.view.procgenController === runtime?.controller) {
      runtime.view.procgenController = null;
    }
    runtime?.stageAdapter?.dispose?.();
    runtime?.game?.stop?.();
    runtime?.resources?.dispose?.();
    runtime?.view?.dispose?.();
    runtime?.providerLease?.release?.();
    runtime?.fileProvider?.dispose?.();
    runFocusBlurCleanup(runtime);
    throw err;
  } finally {
    if (activeProcgenRuntime !== runtime) runtime.resources?.dispose?.();
  }
};

const resizeCanvas = (runtime = activeProcgenRuntime) => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const dprValue = Number(window?.devicePixelRatio);
  const dpr = Number.isFinite(dprValue) && dprValue > 0 ? Math.min(2, dprValue) : 1;
  const widthValue = Number(window?.innerWidth);
  const heightValue = Number(window?.innerHeight);
  const fallbackWidth = Number(canvas?.clientWidth);
  const fallbackHeight = Number(canvas?.clientHeight);
  const studioStage = document.getElementById('procgenStudioStage');
  const width = studioStage?.clientWidth > 0 ? studioStage.clientWidth : Number.isFinite(widthValue) && widthValue > 0
    ? widthValue
    : (Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 1);
  const barHeight = document.getElementById('procgenTopbar')?.getBoundingClientRect?.().height || 0;
  const height = studioStage?.clientHeight > 0 ? studioStage.clientHeight : Number.isFinite(heightValue) && heightValue > 0
    ? Math.max(1, heightValue - barHeight)
    : (Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : 1);
  const surfaceWidth = Math.max(1, Math.floor(width * dpr)), surfaceHeight = Math.max(1, Math.floor(height * dpr));
  const renderer = runtime?.lanes?.renderer;
  if (renderer?.canvas === canvas && typeof renderer.resize === 'function') renderer.resize({ width: surfaceWidth, height: surfaceHeight });
  else {
    if (canvas.width !== surfaceWidth) canvas.width = surfaceWidth;
    if (canvas.height !== surfaceHeight) canvas.height = surfaceHeight;
  }
  document.body?.style?.setProperty?.('--procgen-bar-height', `${barHeight}px`);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (runtime?.stageAdapter?.updateStageSize) {
    runtime.stageAdapter.updateStageSize();
  } else {
    runtime?.view?.stage?.updateStageSize?.();
  }
};

const shouldAutoBoot = () => (
  typeof window !== 'undefined' &&
  globalThis?.__LEMMINGS_PROCGEN_NO_AUTO_BOOT__ !== true
);

if (shouldAutoBoot()) {
  installProcgenBootListeners();
}

export {
  getProcgenGroundSets,
  getCompatibleProcgenStyleNames,
  buildProcgenThemeContract,
  pickProcgenStyle,
  resolveProcgenSeed,
  buildProcgenControllerOptions,
  buildProcgenEditorLevel,
  init,
  resizeCanvas,
  disposeProcgenRuntime,
  installProcgenBootListeners,
  disposeProcgenBootListeners,
  setActiveProcgenRuntimeForTest,
  getProcgenResourceBudgetState
};
