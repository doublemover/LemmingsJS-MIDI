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
export { MAX_PROCGEN_LANES, createProcgenLane, createProcgenPattern, createProcgenWorkstationProject, sanitizeProcgenStep, sanitizeProcgenWorkstation, sanitizeProcgenCcAutomation, reduceProcgenWorkstationProject };
