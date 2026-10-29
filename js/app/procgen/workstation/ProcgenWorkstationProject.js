import { validatePerformanceSceneOrigin } from './PerformanceSceneRecipe.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { validateFragmentLibrary, validateFragmentInstances } from './PhysicalScoreFragment.js';
import { validateProjectJunctions } from './PhysicalJunctionProject.js';
import { procgenLaneIndex, inheritProcgenLaneIndex } from './ProcgenProjectIndex.js';
import { applySceneMacroAction } from './SceneMacroAction.js';
import { validateOwnerEffectRack } from '../../../midi/content/DubQuarryRack.js';
import { PROCGEN_ROLES, PROCGEN_SOUND_COLLECTIONS, PROCGEN_DEFAULT_PAIRS, resolveProcgenSound } from './ProcgenSoundCollections.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';
import { validateSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { validateInstrumentControls } from '../../../midi/content/InstrumentPerformance.js';

const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const integer = (value, fallback, min, max) => Math.round(number(value, fallback, min, max));
const string = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : fallback;
const MODES = ['physical', 'pattern'];
const PROCGEN_PROJECT_VERSION = 2;
const PROCGEN_PLAY_MODEL = 'physical-v1';
const CONDITIONS = ['event', 'pass', 'bar', 'terrain', 'action'];
const MAX_PROCGEN_LANES = 1024;
const createDefaultPhysicalGraph = (seed = 777) => validateCausalInstrumentGraph({ version: 1, revision: 1, seed,
  instruments: [
    { id: 'brick-work', sourceKind: 'TerrainWorkCommitted', operationKind: 'build', pitchCents: 6000, velocity01: 0.75, role: 'percussion', route: 'local' },
    { id: 'wall-contact', sourceKind: 'ContactResolved', causeKind: 'wall', pitchCents: 6700, velocity01: 0.65, role: 'percussion', route: 'local' },
    { id: 'first-crossing', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 7200, velocity01: 0.65, role: 'crossing', route: 'local' }
  ] });
const sanitizeProcgenCcAutomation = (value = []) => (Array.isArray(value) ? value : []).slice(0, 16).map((curve, index) => {
  const length = number(curve.length, 4, 0.25, 65536);
  return { id: string(curve.id, `cc-${index + 1}`), controller: integer(curve.controller, 74, 0, 127), enabled: curve.enabled !== false,
    axis: curve.axis === 'distance' ? 'distance' : 'beat', mode: curve.mode === 'step' ? 'step' : 'linear', length,
    points: (Array.isArray(curve.points) ? curve.points : [{ beat: 0, value: 64 }, { beat: length, value: 96 }]).slice(0, 128)
      .map(point => ({ beat: number(point.beat, 0, 0, length), value: integer(point.value, 64, 0, 127) })).sort((a, b) => a.beat - b.beat) };
});
const sanitizeProcgenStep = (step = {}) => ({
  enabled: step.enabled === true, degree: integer(step.degree, 0, -56, 56),
  note: step.note == null ? null : integer(step.note, 60, 0, 127),
  chord: step.chord && typeof step.chord === 'object' ? {
    degrees: (Array.isArray(step.chord.degrees) ? step.chord.degrees : [0, 2, 4]).slice(0, 8).map(value => integer(value, 0, -28, 28)),
    inversion: integer(step.chord.inversion, 0, -7, 7), spread: integer(step.chord.spread, 0, 0, 3)
  } : null,
  velocity: integer(step.velocity, 88, 1, 127), duration: number(step.duration, 0.22, 1 / 96, 32),
  probability: number(step.probability, 1, 0, 1), probabilityBasis: ['event', 'pass', 'bar'].includes(step.probabilityBasis) ? step.probabilityBasis : 'event',
  condition: CONDITIONS.includes(step.condition?.kind) ? { kind: step.condition.kind, value: string(step.condition.value, ''), every: integer(step.condition.every, 1, 1, 64), offset: integer(step.condition.offset, 0, 0, 63) } : null,
  tie: step.tie === true, hold: step.hold === true, repeats: integer(step.repeats, 1, 1, 8)
});
const createProcgenPattern = (family, role, slot = 0) => {
  const sound = resolveProcgenSound(family, role);
  return { id: `phrase-${slot + 1}`, name: `Phrase ${slot + 1}`, length: 16, rate: 1,
    steps: Array.from({ length: 16 }, (_, index) => {
      const hit = sound.rhythm.indexOf((index + slot * 2) % 16);
      const degree = sound.degrees[Math.max(0, hit) % sound.degrees.length];
      return sanitizeProcgenStep({ enabled: hit >= 0, degree: sound.percussion ? 0 : degree + (slot === 2 ? 2 : 0), note: sound.percussion ? degree : null,
        chord: role === 'chords' || role === 'texture' ? { degrees: [0, 2, 4], inversion: slot % 3, spread: role === 'texture' ? 1 : 0 } : null,
        velocity: sound.velocity, duration: sound.duration, probability: slot === 3 && index % 4 ? 0.72 : 1 });
    }) };
};
const sanitizePattern = (value, family, role, slot) => {
  const base = createProcgenPattern(family, role, slot);
  const length = integer(value?.length, 16, 1, 64);
  return { id: string(value?.id, base.id), name: string(value?.name, base.name), length, rate: number(value?.rate, 1, 0.125, 8),
    steps: Array.from({ length }, (_, index) => sanitizeProcgenStep(value?.steps?.[index] ?? base.steps[index % 16])) };
};
const createProcgenLane = (index = 0, overrides = {}, trusted = null) => {
  if (overrides.mode != null && !MODES.includes(overrides.mode)) throw new Error('Legacy Game/hybrid semantics require explicit physical conversion.');
  const mode = overrides.mode ?? 'physical';
  if (mode === 'pattern' && !(typeof overrides.patternPurpose === 'string' && overrides.patternPurpose.trim())) {
    throw new Error('A complementary pattern instrument needs an explicit physical purpose.');
  }
  if (mode === 'physical' && overrides.patterns?.length) throw new Error('Physical lanes do not contain pattern cells. Author a complementary pattern instrument explicitly.');
  const pair = PROCGEN_DEFAULT_PAIRS[index % PROCGEN_DEFAULT_PAIRS.length];
  const family = PROCGEN_SOUND_COLLECTIONS.some(item => item.id === overrides.family) ? overrides.family : pair[0];
  const role = PROCGEN_ROLES.includes(overrides.role) ? overrides.role : pair[1];
  const sound = resolveProcgenSound(family, role, overrides.patch);
  const worldThemeId = overrides.worldThemeId ?? family;
  if (!PROCGEN_SOUND_COLLECTIONS.some(item => item.id === worldThemeId)) throw new Error('Unknown physical world theme.');
  const instrumentRef = trusted && overrides.instrumentRef === trusted.instrumentRef ? trusted.instrumentRef : validateSoundContentReference(overrides.instrumentRef);
  if (instrumentRef && overrides.instrumentPatchId != null && overrides.instrumentPatchId !== instrumentRef.patchId) throw new Error('Lane sound identity differs from its pinned renderer definition.');
  if (overrides.soundChangePolicy != null && !['new-notes-only', 'crossfade-held'].includes(overrides.soundChangePolicy)) throw new Error('Unsupported patch transition policy.');
  const melodic = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
  return { id: string(overrides.id, `lane-${index + 1}`), revision: integer(overrides.revision, 0, 0, Number.MAX_SAFE_INTEGER), name: string(overrides.name, `Lane ${index + 1}`), family, role, patch: sound.id, worldThemeId,
    instrumentPatchId: instrumentRef?.patchId || string(overrides.instrumentPatchId, sound.id), performanceRecipeId: string(overrides.performanceRecipeId, sound.id),
    linkedThemePresetId: overrides.linkedThemePresetId === null ? null : string(overrides.linkedThemePresetId, family), soundChangePolicy: overrides.soundChangePolicy ?? 'new-notes-only',
    externalProgram: overrides.externalProgram === null ? null : integer(overrides.externalProgram, sound.program, 0, 127), externalPercussion: overrides.externalPercussion == null ? sound.percussion : overrides.externalPercussion === true,
    instrumentRef,
    instrumentControls: trusted && overrides.instrumentControls === trusted.instrumentControls ? trusted.instrumentControls : validateInstrumentControls(overrides.instrumentControls),
    mode, patternPurpose: mode === 'pattern' ? string(overrides.patternPurpose, '') : null,
    channel: Number.isInteger(overrides.channel) && overrides.channel >= 1 && overrides.channel <= 16 ? overrides.channel : role === 'drums' ? 10 : melodic[index % melodic.length],
    outputId: overrides.outputId == null ? null : String(overrides.outputId),
    bankMSB: overrides.bankMSB == null ? null : integer(overrides.bankMSB, 0, 0, 127),
    bankLSB: overrides.bankLSB == null ? null : integer(overrides.bankLSB, 0, 0, 127),
    eventMask: trusted && overrides.eventMask === trusted.eventMask ? trusted.eventMask : Object.fromEntries(Object.entries(overrides.eventMask || {}).filter(([key]) => /^[a-z][a-z-]{0,31}$/.test(key)).map(([key, value]) => [key, value !== false])),
    ccAutomation: trusted && overrides.ccAutomation === trusted.ccAutomation ? trusted.ccAutomation : sanitizeProcgenCcAutomation(overrides.ccAutomation),
    mute: overrides.mute === true, solo: overrides.solo === true, gain: number(overrides.gain, 1, 0, 2),
    eventAccent: number(overrides.eventAccent, 0.65, 0, 2), pan: number(overrides.pan, 0, -127, 127),
    activeSlot: integer(overrides.activeSlot, 0, 0, 3), queuedSlot: overrides.queuedSlot == null ? null : integer(overrides.queuedSlot, 0, 0, 3),
    launchSerial: integer(overrides.launchSerial, 0, 0, Number.MAX_SAFE_INTEGER),
    patterns: trusted && mode === trusted.mode && overrides.patterns === trusted.patterns ? trusted.patterns : mode === 'pattern' ? Array.from({ length: 4 }, (_, slot) => sanitizePattern(overrides.patterns?.[slot], family, role, slot)) : [] };
};
const sanitizeProcgenWorkstation = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid procgen project.');
  if (value?.version !== PROCGEN_PROJECT_VERSION && Object.keys(value || {}).length) {
    throw new Error('Legacy procgen project requires explicit physical conversion to version 2.');
  }
  if (value?.version === PROCGEN_PROJECT_VERSION && value.playModel !== PROCGEN_PLAY_MODEL) throw new Error('Unsupported procgen physical play model.');
  const lanes = (Array.isArray(value?.lanes) && value.lanes.length ? value.lanes : Array.from({ length: 8 }, () => ({}))).slice(0, MAX_PROCGEN_LANES);
  const ids = new Set();
  const seed = integer(value?.seed, 777, 0, 0xffffffff);
  const physicalGraph = value.physicalGraph == null ? createDefaultPhysicalGraph(seed) : validateCausalInstrumentGraph(value.physicalGraph);
  if (value.version === PROCGEN_PROJECT_VERSION && value.physicalGraph == null) throw new Error('A physical project requires its instrument graph.');
  const junctions = validateProjectJunctions(value.junctions), fragments = validateFragmentLibrary(value.fragments), fragmentInstances = validateFragmentInstances(value.fragmentInstances);
  return { version: PROCGEN_PROJECT_VERSION, ...(value.releaseGesture ? { releaseGesture: validateReleaseGesture(value.releaseGesture, lanes.length) } : {}), ...(junctions.length ? { junctions } : {}), ...(fragments.length ? { fragments } : {}), ...(fragmentInstances.length ? { fragmentInstances } : {}), ...(value.sceneOrigin == null ? {} : { sceneOrigin: validatePerformanceSceneOrigin(value.sceneOrigin) }), playModel: PROCGEN_PLAY_MODEL, revision: integer(value.revision, 0, 0, Number.MAX_SAFE_INTEGER), seed, physicalGraph, ...(value.effectRack == null ? {} : { effectRack: validateOwnerEffectRack(value.effectRack) }), lanes: lanes.map((lane, index) => {
    const clean = createProcgenLane(index, lane || {});
    while (ids.has(clean.id)) clean.id += '-copy';
    ids.add(clean.id); return clean;
  }) };
};
const createProcgenWorkstationProject = (project = {}, overrides = {}) => {
  const previous = project.procgen ? sanitizeProcgenWorkstation(project.procgen) : null;
  const seed = integer(overrides.seed ?? previous?.seed, 777, 0, 0xffffffff);
  return { ...project, procgen: sanitizeProcgenWorkstation({ version: PROCGEN_PROJECT_VERSION, playModel: PROCGEN_PLAY_MODEL,
    physicalGraph: createDefaultPhysicalGraph(seed), ...previous, ...overrides, seed }) };
};
const convertLegacyProcgenWorkstationProject = (project, { strategy } = {}) => {
  if (strategy !== 'physical-default' || !project?.procgen || ![undefined, 1].includes(project.procgen.version)) {
    throw new Error('Choose the explicit physical-default conversion for a legacy procgen project.');
  }
  const old = project.procgen, lanes = (Array.isArray(old.lanes) && old.lanes.length ? old.lanes : [{}]).slice(0, MAX_PROCGEN_LANES);
  const discardedEnabledSteps = lanes.reduce((sum, lane) => sum + (Array.isArray(lane.patterns) ? lane.patterns.slice(0, 4) : [])
    .reduce((count, pattern) => count + (Array.isArray(pattern.steps) ? pattern.steps.slice(0, 64) : []).filter(step => step.enabled === true).length, 0), 0);
  const converted = createProcgenWorkstationProject({ ...project, procgen: undefined }, { seed: old.seed,
    lanes: lanes.map(lane => ({ ...lane, mode: 'physical', patterns: [], patternPurpose: null })) });
  return Object.freeze({ project: converted, report: Object.freeze({ version: 1, strategy, fromVersion: old.version ?? 'unversioned',
    toVersion: PROCGEN_PROJECT_VERSION, discardedEnabledSteps, laneCount: converted.procgen.lanes.length,
    changes: Object.freeze(['Physical facts now generate intents directly.', 'Legacy event-advanced phrases were removed.',
      'Builder work, ordinary wall contacts and the x=40 gate use the declared default mapping.']) }) });
};
const sameValue = (left, right) => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
};
const reduceCanonicalProcgenProjectValue = (project, action) => {
  const procgen = project.procgen, lanes = procgen.lanes;
  if (action.type === 'procgen/sceneMacro') return applySceneMacroAction(project, action);
  if (action.type === 'procgen/releaseGesture') { const releaseGesture = validateReleaseGesture(action.gesture, procgen.lanes.length); if (sameValue(releaseGesture, procgen.releaseGesture)) return project; if (procgen.releaseGesture?.id === releaseGesture.id && releaseGesture.revision <= procgen.releaseGesture.revision) throw new Error('A saved release gesture change requires a newer revision.'); return { ...project, procgen: { ...procgen, releaseGesture } }; }
  if (action.type === 'procgen/fragments') {
    const fragments = validateFragmentLibrary(action.fragments);
    for (const fragment of fragments) { const prior = procgen.fragments?.find(value => value.id === fragment.id); if (prior && !sameValue(prior, fragment) && fragment.revision <= prior.revision) throw new Error('Fragment updates require an explicit newer source revision.'); }
    return sameValue(fragments, procgen.fragments || []) ? project : { ...project, procgen: { ...procgen, fragments } };
  }
  if (action.type === 'procgen/detachFragment') {
    const instances = procgen.fragmentInstances || []; if (!instances.some(value => value.id === action.instanceId && !value.detached)) return project;
    return { ...project, procgen: { ...procgen, fragmentInstances: validateFragmentInstances(instances.map(value => value.id === action.instanceId ? { ...value, detached: true } : value)) } };
  }
  if (action.type === 'procgen/junctions') {
    const junctions = validateProjectJunctions(action.junctions);
    if (sameValue(junctions, procgen.junctions || [])) return project;
    return { ...project, procgen: { ...procgen, junctions } };
  }
  if (action.type === 'procgen/effectRack') {
    const rack = validateOwnerEffectRack(action.rack);
    if (sameValue(rack, procgen.effectRack || null)) return project;
    if (rack && procgen.effectRack?.graph.id === rack.graph.id && rack.graph.revision <= procgen.effectRack.graph.revision) throw new Error('Effect defaults require a newer graph revision.');
    if (!rack) { const remaining = { ...procgen }; delete remaining.effectRack; return { ...project, procgen: remaining }; }
    return { ...project, procgen: { ...procgen, effectRack: rack } };
  }
  if (action.type === 'procgen/physicalGraph') {
    const graph = validateCausalInstrumentGraph(action.graph);
    if (sameValue(graph, procgen.physicalGraph)) return project;
    if (graph.revision <= procgen.physicalGraph.revision) throw new Error('Physical mapping changes require a newer graph revision.');
    return { ...project, procgen: { ...procgen, physicalGraph: graph } };
  }
  if (action.type === 'procgen/seed') {
    const seed = integer(action.seed, procgen.seed, 0, 0xffffffff);
    return seed === procgen.seed ? project : { ...project, procgen: { ...procgen, seed } };
  }
  if (action.type === 'procgen/addLane') {
    if (lanes.length >= MAX_PROCGEN_LANES) return project;
    let serial = lanes.length + 1; while (lanes.some(lane => lane.id === `lane-${serial}`)) serial++;
    return { ...project, procgen: { ...procgen, lanes: [...lanes, createProcgenLane(lanes.length, { ...action.lane, id: `lane-${serial}` })] } };
  }
  if (action.type === 'procgen/launchedBatch') {
    if (!Array.isArray(action.launches) || !action.launches.length) return project;
    const byLane = new Map(action.launches.map(launch => [launch.laneId, launch.slot]));
    let updated = null; const indices = procgenLaneIndex(lanes);
    for (const [id, slot] of byLane) {
      const index = indices.get(id); if (index == null) continue; const lane = lanes[index];
      if (!Number.isInteger(slot) || slot < 0 || slot >= lane.patterns.length ||
          lane.activeSlot === slot && lane.queuedSlot == null) continue;
      if (!Number.isSafeInteger((lane.revision || 0) + 1)) throw new Error('Lane revision exhausted.');
      updated ||= lanes.slice(); updated[index] = { ...lane, revision: (lane.revision || 0) + 1, activeSlot: slot, queuedSlot: null };
    }
    if (updated) inheritProcgenLaneIndex(lanes, updated);
    return updated ? { ...project, procgen: { ...procgen, lanes: updated } } : project;
  }
  const index = procgenLaneIndex(lanes).get(action.laneId);
  if (index == null) return project;
  if (action.type === 'procgen/removeLane') {
    return lanes.length <= 1 ? project : { ...project, procgen: { ...procgen, ...(procgen.releaseGesture ? { releaseGesture: releaseGestureAfterLaneRemoval(procgen.releaseGesture, index, lanes.length - 1) } : {}), lanes: lanes.filter((_, at) => at !== index) } };
  }
  const lane = lanes[index]; let next = lane;
  if (action.type === 'procgen/lane') {
    if (!action.patch || typeof action.patch !== 'object') return project;
    next = createProcgenLane(index, { ...lane, ...action.patch, ...(Object.hasOwn(action.patch, 'instrumentRef') ? { instrumentPatchId: action.patch.instrumentRef?.patchId ?? null } : {}), id: lane.id, revision: lane.revision }, lane);
    if (action.patch.patterns === undefined && next.mode === lane.mode) next.patterns = lane.patterns;
  } else if (action.type === 'procgen/worldTheme') {
    if (!PROCGEN_SOUND_COLLECTIONS.some(item => item.id === action.worldThemeId)) throw new Error('An explicit known physical world theme is required.');
    next = createProcgenLane(index, { ...lane, worldThemeId: action.worldThemeId }, lane);
  } else if (action.type === 'procgen/palette') {
    next = createProcgenLane(index, { ...lane, family: action.family ?? lane.family, role: action.role ?? lane.role,
      patch: action.patch ?? null, instrumentPatchId: null, performanceRecipeId: null, linkedThemePresetId: action.family ?? lane.family, instrumentRef: null, instrumentControls: { macros: {} }, patterns: action.resetPatterns ? undefined : lane.patterns });
    if (!action.resetPatterns) next.patterns = lane.patterns;
  } else if (action.type === 'procgen/step' || action.type === 'procgen/pattern') {
    const slot = action.slot ?? lane.activeSlot, pattern = lane.patterns[slot];
    if (!pattern || !action.patch || typeof action.patch !== 'object') return project;
    let changed;
    if (action.type === 'procgen/step') {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= pattern.length) return project;
      const step = sanitizeProcgenStep({ ...pattern.steps[action.index], ...action.patch });
      if (sameValue(step, pattern.steps[action.index])) return project;
      const steps = pattern.steps.slice(); steps[action.index] = step;
      changed = { ...pattern, steps };
    } else {
      changed = sanitizePattern({ ...pattern, ...action.patch }, lane.family, lane.role, slot);
      if (action.patch.steps === undefined && changed.length === pattern.length) changed.steps = pattern.steps;
      if (sameValue(changed, pattern)) return project;
    }
    const patterns = lane.patterns.slice(); patterns[slot] = changed;
    next = { ...lane, patterns };
  } else if (action.type === 'procgen/launch') {
    if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= lane.patterns.length) return project;
    next = { ...lane, queuedSlot: action.slot, launchSerial: lane.launchSerial + 1 };
  } else if (action.type === 'procgen/launched') {
    if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= lane.patterns.length ||
        lane.activeSlot === action.slot && lane.queuedSlot == null) return project;
    next = { ...lane, activeSlot: action.slot, queuedSlot: null };
  } else return project;
  if (next === lane || !['procgen/step', 'procgen/pattern'].includes(action.type) && Object.keys(next).every(key => next[key] === lane[key] || sameValue(next[key], lane[key]))) return project;
  if (!Number.isSafeInteger((lane.revision || 0) + 1)) throw new Error('Lane revision exhausted.');
  next = { ...next, revision: (lane.revision || 0) + 1 };
  const updated = lanes.slice(); updated[index] = next; inheritProcgenLaneIndex(lanes, updated);
  return { ...project, procgen: { ...procgen, lanes: updated } };
};
const releaseGestureAfterLaneRemoval = (gesture, index, laneCount) => gesture && validateReleaseGesture({ ...gesture, revision: gesture.revision + 1, lanePhase: gesture.lanePhase.filter(value => value.laneId !== index).map(value => ({ ...value, laneId: value.laneId > index ? value.laneId - 1 : value.laneId })) }, laneCount);
const reduceCanonicalProcgenProject = (project, action) => {
  const next = reduceCanonicalProcgenProjectValue(project, action);
  if (next === project) return project;
  if (!Number.isSafeInteger((project.procgen.revision || 0) + 1)) throw new Error('Project revision exhausted.');
  return { ...next, procgen: { ...next.procgen, revision: (project.procgen.revision || 0) + 1 } };
};
const reduceProcgenWorkstationProject = (project, action = {}) => {
  const procgen = sanitizeProcgenWorkstation(project.procgen);
  if (['procgen/sceneMacro', 'procgen/worldTheme', 'procgen/removeLane', 'procgen/releaseGesture', 'procgen/physicalGraph', 'procgen/effectRack', 'procgen/junctions', 'procgen/fragments', 'procgen/detachFragment'].includes(action.type)) return reduceCanonicalProcgenProject({ ...project, procgen }, action);
  let lanes = procgen.lanes;
  const target = lane => lane.id === action.laneId;
  if (action.type === 'procgen/lane') lanes = lanes.map(lane => target(lane) ? { ...lane, ...action.patch, ...(Object.hasOwn(action.patch || {}, 'instrumentRef') ? { instrumentPatchId: action.patch.instrumentRef?.patchId ?? null } : {}), id: lane.id } : lane);
  else if (action.type === 'procgen/palette') lanes = lanes.map(lane => target(lane) ? { ...lane, family: action.family ?? lane.family, role: action.role ?? lane.role, patch: action.patch ?? null, instrumentPatchId: null, performanceRecipeId: null, linkedThemePresetId: action.family ?? lane.family, instrumentRef: null, instrumentControls: { macros: {} },
    ...(action.resetPatterns ? { patterns: undefined } : {}) } : lane);
  else if (action.type === 'procgen/step' || action.type === 'procgen/pattern') lanes = lanes.map(lane => target(lane) ? { ...lane, patterns: lane.patterns.map((pattern, slot) => slot === (action.slot ?? lane.activeSlot) ?
    action.type === 'procgen/pattern' ? { ...pattern, ...action.patch } : { ...pattern, steps: pattern.steps.map((step, index) => index === action.index ? { ...step, ...action.patch } : step) } : pattern) } : lane);
  else if (action.type === 'procgen/launch') lanes = lanes.map(lane => target(lane) ? { ...lane, queuedSlot: action.slot, launchSerial: lane.launchSerial + 1 } : lane);
  else if (action.type === 'procgen/launched') lanes = lanes.map(lane => target(lane) ? { ...lane, activeSlot: action.slot, queuedSlot: null } : lane);
  else if (action.type === 'procgen/addLane' && lanes.length < MAX_PROCGEN_LANES) {
    let serial = lanes.length + 1; while (lanes.some(lane => lane.id === `lane-${serial}`)) serial++;
    lanes = [...lanes, createProcgenLane(lanes.length, { ...action.lane, id: `lane-${serial}` })];
  } else if (action.type === 'procgen/removeLane' && lanes.length > 1) lanes = lanes.filter(lane => !target(lane));
  if (action.type === 'procgen/global') return { ...project, global: { ...project.global, ...action.patch }, procgen };
  return { ...project, procgen: sanitizeProcgenWorkstation({ ...procgen, lanes, ...(action.type === 'procgen/seed' ? { seed: action.seed } : {}) }) };
};
export { MAX_PROCGEN_LANES, PROCGEN_PROJECT_VERSION, PROCGEN_PLAY_MODEL, createDefaultPhysicalGraph, convertLegacyProcgenWorkstationProject,
  createProcgenLane, createProcgenPattern, createProcgenWorkstationProject, sanitizeProcgenStep, sanitizeProcgenWorkstation,
  sanitizeProcgenCcAutomation, reduceProcgenWorkstationProject, reduceCanonicalProcgenProject };
