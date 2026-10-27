import { createMidiProject, sanitizeMidiProject } from '../../../midi/project/MidiProject.js';
import { applyProcgenGameEventMidiPreset, PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../../../midi/project/ProcgenMidiDefaults.js';
import { normalizeSeed } from '../../../core/seededRandom.js';
import { DEFAULT_LANE_HEIGHT, normalizeLaneCount, normalizeLaneHeight, normalizePopulationPolicy } from '../ProcgenLaneWorld.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { DECORATION_CHOICES } from '../../../decorations/ProcgenDecorationPacks.js';
import { procgenMusicDefaults } from '../ProcgenMusicProject.js';
import { createProcgenWorkstationProject } from './ProcgenWorkstationProject.js';
import { validateProcgenSession } from './ProcgenSessionStorage.js';
import { cloneJournalData } from './CausalJournalCanonical.js';
import { hashSurveyValue } from '../survey/ProcgenSurveyCanonical.js';

const RECIPE_KEYS = ['recipe', 'seed', 'lanes', 'speed', 'pack', 'laneHeight', 'preset', 'musicPreset', 'musicMode', 'phrases', 'decoration'];
const STARTUP_KEYS = ['startup', 'document', 'documentRevision', ...RECIPE_KEYS];
const startupModes = ['fresh', 'recipe', 'document', 'recovery', 'previous-setup'];
const recipeDefaults = () => ({ laneCount: 8, laneHeight: DEFAULT_LANE_HEIGHT, pack: 1, speed: 3, preset: 'game-iron-ensemble', mode: 'steps', decoration: 'none',
  workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy() });
export const parseProcgenStartupIntent = (search = '') => {
  const params = new URLSearchParams(search);
  if (params.toString().length > 8192) throw new Error('Startup URL exceeds the supported size');
  if (['scene', 'sceneId', 'sceneRevision'].some(key => params.has(key))) throw new Error('Authored scene recipe links are unsupported by this build. Use its project or take artifact to verify the required scene assets.');
  for (const key of STARTUP_KEYS) if (params.getAll(key).length > 1) throw new Error('Duplicate startup field: ' + key);
  const explicit = params.get('startup'), hasRecipe = RECIPE_KEYS.some(key => params.has(key));
  if (explicit != null && !startupModes.includes(explicit)) throw new Error('Unsupported startup mode');
  const mode = explicit || (params.has('document') ? 'document' : hasRecipe ? 'recipe' : null);
  if (mode === 'recipe' && params.toString().length > 2048) throw new Error('Recipe URL exceeds the supported size');
  if (mode && mode !== 'recipe' && hasRecipe) throw new Error('Startup mode conflicts with physical recipe overrides');
  if (mode !== 'document' && (params.has('document') || params.has('documentRevision'))) throw new Error('Document identity requires document startup mode');
  const documentId = mode === 'document' ? params.get('document') : null;
  if (mode === 'document' && (!documentId || documentId.length > 256 || /[\x00-\x1f\x7f]/.test(documentId))) throw new Error('Invalid startup document identity');
  const revision = params.has('documentRevision') ? Number(params.get('documentRevision')) : null;
  if (params.has('documentRevision') && (!params.get('documentRevision')?.trim() || !Number.isSafeInteger(revision) || revision < 1)) throw new Error('Invalid startup document revision');
  return cloneJournalData({ schemaVersion: 1, mode, explicit: explicit != null, documentId, documentRevision: revision,
    recipe: Object.fromEntries(RECIPE_KEYS.filter(key => params.has(key)).map(key => [key, params.get(key)])),
    presence: Object.fromEntries(STARTUP_KEYS.map(key => [key, params.has(key) ? 'explicit' : 'absent'])) });
};
export async function loadProcgenStartupSource(intent, { storage, signal, timeoutMs = 20000 } = {}) {
  signal?.throwIfAborted();
  if (!['document', 'recovery'].includes(intent?.mode)) return { session: null, documentIdentity: null };
  if (!storage || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid startup source owner');
  const controller = new AbortController();
  let timer, rejectInterrupted, handedOff = false;
  const interrupted = new Promise((_resolve, reject) => { rejectInterrupted = reject; });
  const abort = () => controller.abort(signal.reason || new Error('Startup source loading canceled'));
  controller.signal.addEventListener('abort', () => rejectInterrupted(controller.signal.reason), { once: true });
  signal?.addEventListener('abort', abort, { once: true });
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
  timer = setTimeout(() => controller.abort(new Error('Startup source loading deadline exceeded')), timeoutMs);
  const work = Promise.resolve().then(async () => {
    controller.signal.throwIfAborted(); let owner = null;
    try {
      if (intent.mode === 'document') {
        owner = storage.loadDocumentOwned ? await storage.loadDocumentOwned(intent.documentId, { signal: controller.signal }) : await storage.loadDocument(intent.documentId);
      } else if (storage.loadRecoveryOwned) owner = await storage.loadRecoveryOwned({ requireVerified: true, signal: controller.signal });
      else { const session = await storage.loadRecovery({ requireVerified: true, signal: controller.signal }); owner = session && { session }; }
      if (!owner) throw new Error('No verified recovery is available');
      controller.signal.throwIfAborted();
      let captured = owner; owner = null;
      const ownedSignal = captured.signal, ownerAborted = () => controller.abort(ownedSignal.reason);
      ownedSignal?.addEventListener('abort', ownerAborted, { once: true }); if (ownedSignal?.aborted) ownerAborted();
      return { get session() { controller.signal.throwIfAborted(); if (!captured) throw new Error('Startup source was released'); return captured.session; }, signal: controller.signal,
        documentIdentity: intent.mode === 'document' ? { id: captured.id, revision: captured.revision } : null,
        release() { if (!captured) return; const previous = captured; captured = null; ownedSignal?.removeEventListener('abort', ownerAborted); try { previous.release?.(); } finally { cleanup(); } } };
    } finally { owner?.release?.(); }
  });
  work.then(source => { if (controller.signal.aborted) source.release(); }, () => {});
  try {
    const source = await Promise.race([work, interrupted]);
    controller.signal.throwIfAborted(); handedOff = true; clearTimeout(timer); return source;
  } finally { if (!handedOff) { controller.abort(new Error('Startup source owner retired')); cleanup(); } }
}
const boundedNumber = (params, key, min, max, integer = false) => {
  if (!params.has(key)) return null;
  const raw = params.get(key)?.trim(), value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`Invalid recipe ${key}`);
  return value;
};
const resolveProcgenStartupIntent = ({ search = '', intent = parseProcgenStartupIntent(search), seed, legacyProject, legacySettings = {}, saved = null,
  session = null, documentIdentity = null } = {}) => {
  if (intent.schemaVersion !== 1 || intent.mode != null && !startupModes.includes(intent.mode)) throw new Error('Unsupported startup intent');
  const params = new URLSearchParams(intent.recipe);
  const legacySaved = saved?.project?.procgen && saved.project.procgen.version !== 2;
  const mode = intent.mode || (saved?.project && !legacySaved ? 'previous-setup' : 'fresh');
  const baseSeed = normalizeSeed(seed ?? legacySettings.seed ?? 777);
  const provenance = {}, diagnostics = [];
  if (legacySaved) diagnostics.push('legacy-project-requires-explicit-physical-conversion');
  let project, worldOptions, transport, sourceIdentity = null;
  if (mode === 'document' || mode === 'recovery') {
    const artifact = validateProcgenSession(session);
    if (artifact.project.procgen?.version !== 2) throw new Error('Startup document requires explicit legacy conversion before reopening');
    const snapshot = cloneJournalData({ project: artifact.project, settings: artifact.settings, transport: artifact.transport }, { maxBytes: 8 * 1048576, maxNodes: 300000 });
    project = createProcgenWorkstationProject(sanitizeMidiProject(snapshot.project));
    if (project.procgen.lanes.length !== artifact.world.laneCount || project.procgen.seed !== artifact.world.seed) throw new Error('Startup document and checkpoint dimensions or seed differ');
    if (mode === 'document' && (documentIdentity?.id !== intent.documentId || !Number.isSafeInteger(documentIdentity.revision) ||
        intent.documentRevision != null && documentIdentity.revision !== intent.documentRevision)) throw new Error('Startup document identity or revision changed');
    worldOptions = { ...snapshot.settings, seed: artifact.world.seed, laneCount: artifact.world.laneCount, laneHeight: artifact.world.laneHeight };
    for (const key of ['output', 'outputId', 'inputId', 'clockOutputId', 'recording', 'thru', 'soundFont']) delete worldOptions[key];
    transport = { ...snapshot.transport, playing: false };
    sourceIdentity = mode === 'document' ? { id: documentIdentity.id, revision: documentIdentity.revision } : { kind: 'verified-recovery', savedAt: artifact.savedAt || null };
    for (const key of Object.keys(worldOptions)) provenance[key] = mode + '-artifact';
  } else if (mode === 'recipe') {
    if (params.has('recipe') && params.get('recipe') !== '1') throw new Error('Unsupported recipe version');
    if (params.has('recipe') && !params.has('seed')) throw new Error('Invalid recipe: a shared starting recipe requires its seed');
    if (params.has('preset') && params.has('musicPreset') && params.get('preset') !== params.get('musicPreset'))
      throw new Error('Invalid recipe: conflicting music presets');
    if (params.has('phrases') && !['0', '1', 'false', 'true'].includes(params.get('phrases')))
      throw new Error('Invalid recipe phrases');
    const laneCount = boundedNumber(params, 'lanes', 1, 1024, true) ?? 8;
    const speed = boundedNumber(params, 'speed', 0.1, 1000) ?? 3;
    const pack = boundedNumber(params, 'pack', 1, 6, true) ?? 1;
    const laneHeight = params.has('laneHeight') ? normalizeLaneHeight(boundedNumber(params, 'laneHeight', 96, 256, true), DEFAULT_LANE_HEIGHT) : DEFAULT_LANE_HEIGHT;
    if (params.has('seed') && !params.get('seed')?.trim()) throw new Error('Invalid recipe seed');
    const recipeSeed = params.has('seed') ? normalizeSeed(params.get('seed')) : baseSeed;
    if (!params.has('seed')) diagnostics.push('recipe-seed-generated');
    const preset = params.get('preset') || params.get('musicPreset') || 'game-iron-ensemble';
    const musicMode = params.get('musicMode') || (['1', 'true'].includes(params.get('phrases')) ? 'phrase' : 'steps');
    if (!PROCGEN_GAME_EVENT_MIDI_PRESETS.some(item => item.id === preset)) throw new Error('Invalid recipe preset');
    if (!['steps', 'phrase'].includes(musicMode)) throw new Error('Invalid recipe music mode');
    if (params.has('decoration') && !DECORATION_CHOICES.some(item => item.id === params.get('decoration'))) throw new Error('Invalid recipe decoration');
    const base = applyProcgenGameEventMidiPreset(createMidiProject(), preset, { mode: musicMode });
    const musical = sanitizeMidiProject({ ...base, global: { ...base.global,
      laneMusic: procgenMusicDefaults(base, { laneCount, preset, mode: musicMode }) } });
    project = createProcgenWorkstationProject(musical, { seed: recipeSeed, lanes: Array.from({ length: laneCount }, () => ({})) });
    worldOptions = { ...recipeDefaults(), seed: recipeSeed, laneCount, laneHeight, pack, speed, preset, mode: musicMode, decoration: params.get('decoration') || 'none' };
    transport = { bpm: 120, gameSpeed: speed, speedMode: 'game', linked: true, clockSource: 'internal' };
    const keys = { laneCount: 'lanes', preset: params.has('preset') ? 'preset' : 'musicPreset', mode: params.has('musicMode') ? 'musicMode' : 'phrases' };
    for (const key of Object.keys(worldOptions)) provenance[key] = params.has(keys[key] || key) ? 'recipe-url' : key === 'seed' ? 'generated' : 'recipe-v1-default';
  } else if (mode === 'previous-setup') {
    if (!saved?.project || legacySaved) throw new Error('No compatible previous setup is available');
    project = createProcgenWorkstationProject(sanitizeMidiProject(saved.project), { seed: baseSeed });
    const previousSpeed = saved.transport?.gameSpeed ?? legacySettings.speed ?? 3;
    worldOptions = { seed: baseSeed, laneCount: project.procgen.lanes.length, laneHeight: legacySettings.laneHeight ?? DEFAULT_LANE_HEIGHT,
      pack: legacySettings.pack ?? 1, speed: previousSpeed };
    transport = { bpm: 120, speedMode: 'bpm', ...(saved.transport || {}), gameSpeed: previousSpeed };
    provenance.seed = 'fresh-seed'; provenance.laneCount = 'previous-setup'; provenance.speed = 'previous-setup';
  } else {
    const defaults = intent.explicit ? recipeDefaults() : legacySettings;
    const laneCount = normalizeLaneCount(defaults.laneCount ?? 8);
    const source = intent.explicit ? createMidiProject() : legacyProject?.procgen?.version === 2 ? legacyProject : { ...(legacyProject || createMidiProject()), procgen: undefined };
    project = createProcgenWorkstationProject(sanitizeMidiProject(source),
      { seed: baseSeed, lanes: Array.from({ length: laneCount }, (_, index) => source.procgen?.lanes?.[index] || {}) });
    worldOptions = { ...recipeDefaults(), ...defaults, seed: baseSeed, laneCount, laneHeight: defaults.laneHeight ?? DEFAULT_LANE_HEIGHT,
      pack: defaults.pack ?? 1, speed: defaults.speed ?? 3 };
    transport = { bpm: 120, gameSpeed: worldOptions.speed, speedMode: 'game' };
    provenance.seed = 'fresh-seed'; provenance.laneCount = 'preference-or-default'; provenance.speed = 'preference-or-default';
  }
  const identity = hashSurveyValue({ mode, sourceIdentity, worldOptions, transport, lanes: project.procgen.lanes.map(lane => [lane.family, lane.role, lane.patch]) });
  return cloneJournalData({ schemaVersion: 1, intentId: `startup-v1:${mode}:${identity}`, presence: intent.presence,
    mode, sourceRevision: sourceIdentity?.revision ?? 1, sourceIdentity, project, worldOptions, transport, provenance, diagnostics }, { maxBytes: 8 * 1048576, maxNodes: 300000 });
};
export { resolveProcgenStartupIntent };
