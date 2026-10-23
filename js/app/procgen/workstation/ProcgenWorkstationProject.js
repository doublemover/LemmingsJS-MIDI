import { PROCGEN_ROLES, PROCGEN_SOUND_COLLECTIONS, PROCGEN_DEFAULT_PAIRS, resolveProcgenSound } from './ProcgenSoundCollections.js';

const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const integer = (value, fallback, min, max) => Math.round(number(value, fallback, min, max));
const string = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : fallback;
const MODES = ['game', 'pattern', 'hybrid'];
const CONDITIONS = ['event', 'pass', 'bar', 'terrain', 'action'];
const MAX_PROCGEN_LANES = 1024;
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
const createProcgenLane = (index = 0, overrides = {}) => {
  const pair = PROCGEN_DEFAULT_PAIRS[index % PROCGEN_DEFAULT_PAIRS.length];
  const family = PROCGEN_SOUND_COLLECTIONS.some(item => item.id === overrides.family) ? overrides.family : pair[0];
  const role = PROCGEN_ROLES.includes(overrides.role) ? overrides.role : pair[1];
  const sound = resolveProcgenSound(family, role, overrides.patch);
  const melodic = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
  return { id: string(overrides.id, `lane-${index + 1}`), name: string(overrides.name, `Lane ${index + 1}`), family, role, patch: sound.id,
    mode: MODES.includes(overrides.mode) ? overrides.mode : 'hybrid',
    channel: role === 'drums' ? 10 : melodic.includes(overrides.channel) ? overrides.channel : melodic[index % melodic.length],
    outputId: overrides.outputId == null ? null : String(overrides.outputId),
    bankMSB: overrides.bankMSB == null ? null : integer(overrides.bankMSB, 0, 0, 127),
    bankLSB: overrides.bankLSB == null ? null : integer(overrides.bankLSB, 0, 0, 127),
    eventMask: Object.fromEntries(Object.entries(overrides.eventMask || {}).filter(([key]) => /^[a-z][a-z-]{0,31}$/.test(key)).map(([key, value]) => [key, value !== false])),
    ccAutomation: sanitizeProcgenCcAutomation(overrides.ccAutomation),
    mute: overrides.mute === true, solo: overrides.solo === true, gain: number(overrides.gain, 1, 0, 2),
    eventAccent: number(overrides.eventAccent, 0.65, 0, 2), pan: number(overrides.pan, 0, -127, 127),
    activeSlot: integer(overrides.activeSlot, 0, 0, 3), queuedSlot: overrides.queuedSlot == null ? null : integer(overrides.queuedSlot, 0, 0, 3),
    launchSerial: integer(overrides.launchSerial, 0, 0, Number.MAX_SAFE_INTEGER),
    patterns: Array.from({ length: 4 }, (_, slot) => sanitizePattern(overrides.patterns?.[slot], family, role, slot)) };
};
const sanitizeProcgenWorkstation = (value = {}) => {
  const lanes = (Array.isArray(value?.lanes) && value.lanes.length ? value.lanes : Array.from({ length: 8 }, () => ({}))).slice(0, MAX_PROCGEN_LANES);
  const ids = new Set();
  return { version: 1, seed: integer(value?.seed, 777, 0, 0xffffffff), lanes: lanes.map((lane, index) => {
    const clean = createProcgenLane(index, lane || {});
    while (ids.has(clean.id)) clean.id += '-copy';
    ids.add(clean.id); return clean;
  }) };
};
const createProcgenWorkstationProject = (project = {}, overrides = {}) => ({ ...project,
  procgen: sanitizeProcgenWorkstation({ ...project.procgen, ...overrides }) });
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const reduceCanonicalProcgenProject = (project, action) => {
  const procgen = project.procgen, lanes = procgen.lanes;
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
    let changed = false;
    const updated = lanes.map(lane => {
      const slot = byLane.get(lane.id);
      if (!Number.isInteger(slot) || slot < 0 || slot >= lane.patterns.length ||
          lane.activeSlot === slot && lane.queuedSlot == null) return lane;
      changed = true;
      return { ...lane, activeSlot: slot, queuedSlot: null };
    });
    return changed ? { ...project, procgen: { ...procgen, lanes: updated } } : project;
  }
  const index = lanes.findIndex(lane => lane.id === action.laneId);
  if (index < 0) return project;
  if (action.type === 'procgen/removeLane') {
    return lanes.length <= 1 ? project : { ...project, procgen: { ...procgen, lanes: lanes.filter((_, at) => at !== index) } };
  }
  const lane = lanes[index]; let next = lane;
  if (action.type === 'procgen/lane') {
    if (!action.patch || typeof action.patch !== 'object') return project;
    next = createProcgenLane(index, { ...lane, ...action.patch, id: lane.id });
    if (action.patch.patterns === undefined) next.patterns = lane.patterns;
  } else if (action.type === 'procgen/palette') {
    next = createProcgenLane(index, { ...lane, family: action.family ?? lane.family, role: action.role ?? lane.role,
      patch: action.patch ?? null, patterns: action.resetPatterns ? undefined : lane.patterns });
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
  if (next === lane || sameValue(next, lane)) return project;
  const updated = lanes.slice(); updated[index] = next;
  return { ...project, procgen: { ...procgen, lanes: updated } };
};
const reduceProcgenWorkstationProject = (project, action = {}) => {
  const procgen = sanitizeProcgenWorkstation(project.procgen);
  let lanes = procgen.lanes;
  const target = lane => lane.id === action.laneId;
  if (action.type === 'procgen/lane') lanes = lanes.map(lane => target(lane) ? { ...lane, ...action.patch, id: lane.id } : lane);
  else if (action.type === 'procgen/palette') lanes = lanes.map(lane => target(lane) ? { ...lane, family: action.family ?? lane.family, role: action.role ?? lane.role, patch: action.patch ?? null,
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
export { MAX_PROCGEN_LANES, createProcgenLane, createProcgenPattern, createProcgenWorkstationProject, sanitizeProcgenStep, sanitizeProcgenWorkstation, sanitizeProcgenCcAutomation, reduceProcgenWorkstationProject, reduceCanonicalProcgenProject };
