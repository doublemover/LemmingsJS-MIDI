import { DEFAULT_CONFIG, mergeConfig } from '../midi-mapping/MidiMappingDomain.js';
import { cloneSafeObject, isPlainObject, safeObjectEntries } from '../../util/safeObject.js';

const MIDI_PROJECT_VERSION = 1;
const DEFAULT_TRACK_ID = 'track-1';
const DEFAULT_TEMPLATE_ID = 'midi-mapping';
const MIDI_PROJECT_EXPORT_KIND = 'lemmings.midi.project';
const MIDI_TEMPLATE_EXPORT_KIND = 'lemmings.midi.template';
const MIN_DURATION_TICKS = 1;
const MAX_DURATION_TICKS = 960;

const DIRECT_MAPPING_KEYS = Object.freeze([
  'note',
  'degree',
  'octave',
  'notes',
  'chord',
  'velocity',
  'durationTicks',
  'pan',
  'timbre',
  'pitchBend',
  'envelope',
  'arp'
]);

const SOURCE_KINDS = Object.freeze(['sfx', 'trigger', 'midiFlag', 'system', 'procgen']);
const CLIP_TYPES = Object.freeze(['stepPattern', 'chord', 'arp']);
const ARP_MODES = Object.freeze(['up', 'down', 'updown']);
const AUTOMATION_SCOPES = Object.freeze(['global', 'track']);
const AUTOMATION_AXES = Object.freeze(['x', 'y', 'xy']);
const AUTOMATION_AXIS_OPS = Object.freeze(['add', 'sub', 'mul', 'div']);
const AUTOMATION_TARGETS = Object.freeze([
  'note',
  'velocity',
  'pan',
  'duration',
  'timbre',
  'attack',
  'decay',
  'sustain',
  'release'
]);
const AUTOMATION_TARGET_DEFAULTS = Object.freeze({
  note: { min: -12, max: 12 },
  velocity: { min: 110, max: 20 },
  pan: { min: -127, max: 127 },
  duration: { min: 2, max: 24 },
  timbre: { min: 110, max: 20 },
  attack: { min: 0, max: 2 },
  decay: { min: 0, max: 2 },
  sustain: { min: 0, max: 2 },
  release: { min: 0, max: 2 }
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toInteger = (value, fallback) => Math.round(toFiniteNumber(value, fallback));

const sanitizeId = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const uniqueId = (base, used) => {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
};

const cloneObject = (value, fallback = {}) => {
  const cloned = cloneSafeObject(value);
  return isPlainObject(cloned) ? cloned : fallback;
};

const cloneArray = (value) => {
  const cloned = cloneSafeObject(value);
  return Array.isArray(cloned) ? cloned : [];
};

const sanitizeBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);

const sanitizeChannel = (value, fallback = 1) => clamp(toInteger(value, fallback), 1, 16);

const sanitizeInputChannel = (value) => {
  if (value === 'omni') return 'omni';
  if (value == null || value === '') return 'omni';
  return sanitizeChannel(value, 1);
};

const sanitizeNote = (value, fallback = 60) => clamp(toInteger(value, fallback), 0, 127);

const sanitizeVelocity = (value, fallback = 80) => clamp(toInteger(value, fallback), 1, 127);

const sanitizeDurationTicks = (value, fallback = 6) => (
  clamp(toInteger(value, fallback), MIN_DURATION_TICKS, MAX_DURATION_TICKS)
);

const sanitizeDensity = (density = {}, fallback = DEFAULT_CONFIG.density) => ({
  windowTicks: clamp(toInteger(density?.windowTicks, fallback.windowTicks ?? 24), 0, 960),
  velocityBoost: clamp(toFiniteNumber(density?.velocityBoost, fallback.velocityBoost ?? 0), 0, 4),
  durationScale: clamp(toFiniteNumber(density?.durationScale, fallback.durationScale ?? 0), 0, 1)
});

const sanitizePositionConfig = (position = {}, fallback = DEFAULT_CONFIG.position) => ({
  xNoteRange: sanitizeRange(position?.xNoteRange, fallback.xNoteRange ?? { min: -12, max: 12 }, -48, 48),
  timbreRange: sanitizeRange(position?.timbreRange, fallback.timbreRange ?? { min: 0, max: 127 }, 0, 127),
  viewPan: sanitizeBoolean(position?.viewPan, fallback.viewPan ?? false),
  panRange: sanitizeRange(position?.panRange, fallback.panRange ?? { min: -127, max: 127 }, -127, 127),
  panDeadZonePct: clamp(toFiniteNumber(position?.panDeadZonePct, fallback.panDeadZonePct ?? 0.02), 0, 0.5),
  panOnscreenWeight: clamp(toFiniteNumber(position?.panOnscreenWeight, fallback.panOnscreenWeight ?? 0.8), 0, 1),
  panOffscreenWeight: clamp(toFiniteNumber(position?.panOffscreenWeight, fallback.panOffscreenWeight ?? 0.2), 0, 1),
  panOffscreenRange: clamp(toFiniteNumber(position?.panOffscreenRange, fallback.panOffscreenRange ?? 1), 0, 4)
});

const createEmptyDirectMapping = () => ({
  note: null,
  degree: null,
  octave: 4,
  notes: null,
  chord: null,
  velocity: null,
  durationTicks: null,
  pan: null,
  timbre: null,
  pitchBend: null,
  envelope: null,
  arp: null
});

const createDefaultMidiStep = (index = 0, overrides = {}) => ({
  index,
  note: overrides.note ?? (index === 0 ? 60 : null),
  velocity: overrides.velocity ?? null,
  durationTicks: overrides.durationTicks ?? null,
  tie: overrides.tie ?? false,
  hold: overrides.hold ?? false,
  probability: overrides.probability ?? 1
});

const sanitizeArpPayload = (arp) => {
  if (!isPlainObject(arp)) return null;
  const clean = cloneObject(arp);
  return {
    ...clean,
    mode: ARP_MODES.includes(clean.mode) ? clean.mode : 'up',
    pattern: isPlainObject(clean.pattern) ? cloneObject(clean.pattern) : null
  };
};

const createDefaultMidiClip = (overrides = {}) => {
  const lengthSteps = clamp(toInteger(overrides.lengthSteps, 16), 1, 256);
  const steps = Array.isArray(overrides.steps) && overrides.steps.length
    ? overrides.steps
    : Array.from({ length: lengthSteps }, (_, index) => createDefaultMidiStep(index));
  return {
    id: overrides.id || 'clip-1',
    name: overrides.name || 'Clip 1',
    type: CLIP_TYPES.includes(overrides.type) ? overrides.type : 'stepPattern',
    lengthSteps,
    steps,
    arp: sanitizeArpPayload(overrides.arp)
  };
};

const automationDefaultsForTarget = (target) => AUTOMATION_TARGET_DEFAULTS[target] || AUTOMATION_TARGET_DEFAULTS.velocity;

const createDefaultMidiAutomation = (overrides = {}) => {
  const target = AUTOMATION_TARGETS.includes(overrides.target) ? overrides.target : 'velocity';
  const defaults = automationDefaultsForTarget(target);
  const axis = AUTOMATION_AXES.includes(overrides.axis) ? overrides.axis : 'y';
  return {
    id: overrides.id || `automation-${target}`,
    name: overrides.name || `${target} by ${axis.toUpperCase()}`,
    enabled: overrides.enabled ?? true,
    scope: AUTOMATION_SCOPES.includes(overrides.scope) ? overrides.scope : 'global',
    trackId: overrides.trackId ?? null,
    target,
    axis,
    axisOp: AUTOMATION_AXIS_OPS.includes(overrides.axisOp) ? overrides.axisOp : 'add',
    min: overrides.min ?? defaults.min,
    max: overrides.max ?? defaults.max,
    points: Array.isArray(overrides.points) ? overrides.points : []
  };
};

const createMidiAutomationFromPositionMapping = (mapping = {}, index = 0) => {
  const target = AUTOMATION_TARGETS.includes(mapping?.target) ? mapping.target : 'velocity';
  const axis = AUTOMATION_AXES.includes(mapping?.axis) ? mapping.axis : 'y';
  const defaults = automationDefaultsForTarget(target);
  return createDefaultMidiAutomation({
    id: `position-${target}-${index + 1}`,
    name: `${target} by ${axis.toUpperCase()}`,
    enabled: mapping?.enabled !== false,
    scope: 'global',
    target,
    axis,
    axisOp: mapping?.axisOp,
    min: mapping?.min ?? defaults.min,
    max: mapping?.max ?? defaults.max
  });
};

const cloneDirectMapping = (mapping = {}) => {
  const out = createEmptyDirectMapping();
  if (!isPlainObject(mapping)) return out;
  for (const key of DIRECT_MAPPING_KEYS) {
    const cloned = cloneSafeObject(mapping[key]);
    if (cloned !== undefined) out[key] = cloned;
  }
  return out;
};

const sanitizeEnvelope = (envelope) => {
  if (!isPlainObject(envelope)) return null;
  return {
    attack: clamp(toFiniteNumber(envelope.attack, 0), 0, 2),
    decay: clamp(toFiniteNumber(envelope.decay, 0), 0, 2),
    sustain: clamp(toFiniteNumber(envelope.sustain, 1), 0, 2),
    release: clamp(toFiniteNumber(envelope.release, 0), 0, 2)
  };
};

const sanitizeEnvelopeDefaults = (envelope = {}, fallback = DEFAULT_CONFIG.envelope) => ({
  attack: clamp(toFiniteNumber(envelope?.attack, fallback.attack ?? 1), 0, 2),
  decay: clamp(toFiniteNumber(envelope?.decay, fallback.decay ?? 0), 0, 2),
  sustain: clamp(toFiniteNumber(envelope?.sustain, fallback.sustain ?? 1), 0, 2),
  release: clamp(toFiniteNumber(envelope?.release, fallback.release ?? 1), 0, 2)
});

const sanitizeDirectMapping = (mapping = {}) => {
  const out = cloneDirectMapping(mapping);
  out.note = out.note == null ? null : sanitizeNote(out.note);
  out.degree = out.degree == null ? null : Math.max(0, toInteger(out.degree, 0));
  out.octave = clamp(toInteger(out.octave, 4), 0, 10);
  if (Array.isArray(out.notes)) {
    const notes = out.notes.map(note => sanitizeNote(note)).filter(Number.isFinite);
    out.notes = notes.length ? notes : null;
  } else {
    out.notes = null;
  }
  out.chord = isPlainObject(out.chord)
    ? {
      type: sanitizeId(out.chord.type, 'triad'),
      inversion: Math.max(0, toInteger(out.chord.inversion, 0))
    }
    : null;
  out.velocity = out.velocity == null ? null : sanitizeVelocity(out.velocity);
  out.durationTicks = out.durationTicks == null ? null : sanitizeDurationTicks(out.durationTicks);
  out.pan = out.pan == null ? null : clamp(toInteger(out.pan, 0), -127, 127);
  out.timbre = out.timbre == null ? null : clamp(toInteger(out.timbre, 0), 0, 127);
  out.pitchBend = out.pitchBend == null ? null : clamp(toFiniteNumber(out.pitchBend, 0), -1, 1);
  out.envelope = sanitizeEnvelope(out.envelope);
  out.arp = sanitizeArpPayload(out.arp);
  return out;
};

const sanitizeRange = (range, fallback, minLimit, maxLimit) => {
  const min = clamp(toInteger(range?.min, fallback.min), minLimit, maxLimit);
  const max = clamp(toInteger(range?.max, fallback.max), minLimit, maxLimit);
  return { min: Math.min(min, max), max: Math.max(min, max) };
};

const sanitizeVelocityRange = (range, fallback = DEFAULT_CONFIG.velocityRange) => {
  const base = sanitizeRange(range, fallback, 1, 127);
  const defaultVelocity = sanitizeVelocity(range?.default, fallback.default ?? base.max);
  return { ...base, default: clamp(defaultVelocity, base.min, base.max) };
};

const sanitizeDurationRange = (range, fallback = DEFAULT_CONFIG.durationTicks) => {
  const base = sanitizeRange(range, {
    min: fallback.min ?? MIN_DURATION_TICKS,
    max: fallback.max ?? MAX_DURATION_TICKS
  }, MIN_DURATION_TICKS, MAX_DURATION_TICKS);
  const defaultDuration = sanitizeDurationTicks(range?.default, fallback.default ?? base.min);
  return { ...base, default: clamp(defaultDuration, base.min, base.max) };
};

const sanitizeScale = (scale, fallback = DEFAULT_CONFIG.scale) => ({
  name: sanitizeId(scale?.name, fallback.name || 'chromatic-minor'),
  root: clamp(toInteger(scale?.root, fallback.root ?? 0), 0, 11),
  degrees: Array.isArray(scale?.degrees)
    ? scale.degrees
      .map(degree => clamp(toInteger(degree, 0), 0, 11))
      .filter((degree, index, list) => list.indexOf(degree) === index)
    : cloneSafeObject(fallback.degrees)
});

const sanitizeTransport = (transport = {}) => {
  const fallback = DEFAULT_CONFIG.timing;
  const signature = transport.timeSignature || fallback.timeSignature;
  return {
    bpmBase: clamp(toInteger(transport.bpmBase, fallback.bpmBase ?? 120), 20, 320),
    timeSignature: {
      beats: clamp(toInteger(signature?.beats, fallback.timeSignature?.beats ?? 4), 1, 16),
      unit: [1, 2, 4, 8, 16].includes(toInteger(signature?.unit, fallback.timeSignature?.unit ?? 4))
        ? toInteger(signature?.unit, fallback.timeSignature?.unit ?? 4)
        : 4
    },
    quantize: sanitizeId(transport.quantize, '1/16'),
    swing: clamp(toFiniteNumber(transport.swing, 0), 0, 1)
  };
};

const buildGlobalFromConfig = (config = {}) => {
  const merged = mergeConfig(DEFAULT_CONFIG, config || {});
  return {
    scale: sanitizeScale(merged.scale),
    noteRange: sanitizeRange(merged.noteRange, DEFAULT_CONFIG.noteRange, 0, 127),
    velocityRange: sanitizeVelocityRange(merged.velocityRange),
    durationTicks: sanitizeDurationRange(merged.durationTicks),
    density: sanitizeDensity(merged.density),
    envelope: sanitizeEnvelopeDefaults(merged.envelope),
    position: sanitizePositionConfig(merged.position),
    mpe: cloneObject(merged.mpe),
    limits: cloneObject(merged.limits),
    reverse: cloneObject(merged.reverse)
  };
};

const sanitizeGlobal = (global = {}) => {
  const defaults = buildGlobalFromConfig(DEFAULT_CONFIG);
  return {
    scale: sanitizeScale(global.scale, defaults.scale),
    noteRange: sanitizeRange(global.noteRange, defaults.noteRange, 0, 127),
    velocityRange: sanitizeVelocityRange(global.velocityRange, defaults.velocityRange),
    durationTicks: sanitizeDurationRange(global.durationTicks, defaults.durationTicks),
    density: sanitizeDensity(global.density, defaults.density),
    envelope: sanitizeEnvelopeDefaults(global.envelope, defaults.envelope),
    position: sanitizePositionConfig(global.position, defaults.position),
    mpe: cloneObject(global.mpe, defaults.mpe),
    limits: cloneObject(global.limits, defaults.limits),
    reverse: cloneObject(global.reverse, defaults.reverse)
  };
};

const createDefaultMidiTrack = (overrides = {}) => ({
  id: overrides.id || DEFAULT_TRACK_ID,
  name: overrides.name || 'Track 1',
  outputId: overrides.outputId ?? null,
  channel: overrides.channel ?? 1,
  instrumentLabel: overrides.instrumentLabel || 'General MIDI',
  mute: overrides.mute ?? overrides.muted ?? false,
  solo: overrides.solo ?? false,
  arm: overrides.arm ?? false,
  velocityScale: overrides.velocityScale ?? 1,
  priority: overrides.priority ?? 1,
  voiceBudget: overrides.voiceBudget ?? 32
});

const sanitizeTrack = (track, fallbackIndex, usedIds) => {
  const fallback = createDefaultMidiTrack({
    id: `track-${fallbackIndex + 1}`,
    name: `Track ${fallbackIndex + 1}`
  });
  const baseId = sanitizeId(track?.id, fallback.id);
  return {
    id: uniqueId(baseId, usedIds),
    name: sanitizeId(track?.name, fallback.name),
    outputId: track?.outputId == null ? null : String(track.outputId),
    channel: sanitizeChannel(track?.channel, fallback.channel),
    instrumentLabel: sanitizeId(track?.instrumentLabel, fallback.instrumentLabel),
    mute: sanitizeBoolean(track?.mute ?? track?.muted, false),
    solo: sanitizeBoolean(track?.solo, false),
    arm: sanitizeBoolean(track?.arm, false),
    velocityScale: clamp(toFiniteNumber(track?.velocityScale, 1), 0, 4),
    priority: Math.max(0, toInteger(track?.priority, 1)),
    voiceBudget: clamp(toInteger(track?.voiceBudget, 32), 1, 32)
  };
};

const normalizeKind = (value) => {
  const kind = String(value || 'sfx');
  return SOURCE_KINDS.includes(kind) ? kind : 'sfx';
};

const createMidiSourceFromMapping = (kind, sourceKey, mapping = {}, trackId = DEFAULT_TRACK_ID) => {
  const resolvedKind = normalizeKind(kind);
  return {
    id: `${resolvedKind}-${sourceKey}`,
    kind: resolvedKind,
    sourceKey: String(sourceKey),
    label: sanitizeId(mapping?.name, String(sourceKey)),
    enabled: mapping?.disabled !== true,
    trackId,
    mode: 'direct',
    mapping: sanitizeDirectMapping(mapping),
    clipId: null
  };
};

const sanitizeSource = (source, fallbackIndex, trackIds, clipIds, usedIds) => {
  const kind = normalizeKind(source?.kind ?? source?.type);
  const sourceKey = sanitizeId(source?.sourceKey ?? source?.key, String(fallbackIndex + 1));
  const fallbackId = `${kind}-${sourceKey}`;
  const fallbackTrackId = trackIds.has(source?.trackId) ? source.trackId : [...trackIds][0];
  const mode = source?.mode === 'clip' ? 'clip' : 'direct';
  const clipId = source?.clipId != null && clipIds.has(source.clipId) ? source.clipId : null;
  return {
    id: uniqueId(sanitizeId(source?.id, fallbackId), usedIds),
    kind,
    sourceKey,
    label: sanitizeId(source?.label ?? source?.name, sourceKey),
    enabled: sanitizeBoolean(source?.enabled, true),
    trackId: fallbackTrackId,
    mode,
    mapping: mode === 'direct' ? sanitizeDirectMapping(source?.mapping) : null,
    clipId: mode === 'clip' ? clipId : null
  };
};

const sanitizeStep = (step, fallbackIndex) => {
  if (!isPlainObject(step)) {
    return createDefaultMidiStep(fallbackIndex, { note: null });
  }
  return {
    ...cloneObject(step),
    index: Math.max(0, toInteger(step.index, fallbackIndex)),
    note: step.note == null ? null : sanitizeNote(step.note),
    velocity: step.velocity == null ? null : sanitizeVelocity(step.velocity),
    durationTicks: step.durationTicks == null ? null : sanitizeDurationTicks(step.durationTicks),
    tie: sanitizeBoolean(step.tie, false),
    hold: sanitizeBoolean(step.hold, false),
    probability: clamp(toFiniteNumber(step.probability, 1), 0, 1)
  };
};

const sanitizeClip = (clip, fallbackIndex, usedIds) => {
  if (!isPlainObject(clip)) return null;
  const type = CLIP_TYPES.includes(clip.type) ? clip.type : 'stepPattern';
  const lengthSteps = clamp(toInteger(clip.lengthSteps, 16), 1, 256);
  const steps = cloneArray(clip.steps)
    .slice(0, lengthSteps)
    .map((step, index) => sanitizeStep(step, index));
  while (steps.length < lengthSteps) {
    steps.push(createDefaultMidiStep(steps.length, { note: null }));
  }
  return {
    id: uniqueId(sanitizeId(clip.id, `clip-${fallbackIndex + 1}`), usedIds),
    name: sanitizeId(clip.name, `Clip ${fallbackIndex + 1}`),
    type,
    lengthSteps,
    steps,
    arp: sanitizeArpPayload(clip.arp)
  };
};

const sanitizeAutomationPoint = (point, fallbackIndex, fallbackValue) => {
  if (!isPlainObject(point)) {
    return { beat: fallbackIndex, value: fallbackValue };
  }
  return {
    beat: Math.max(0, toFiniteNumber(point.beat, fallbackIndex)),
    value: toFiniteNumber(point.value, fallbackValue)
  };
};

const sanitizeAutomation = (automation, fallbackIndex, usedIds, trackIds) => {
  if (!isPlainObject(automation)) return null;
  const target = AUTOMATION_TARGETS.includes(automation.target) ? automation.target : 'velocity';
  const defaults = automationDefaultsForTarget(target);
  const min = toFiniteNumber(automation.min, defaults.min);
  const max = toFiniteNumber(automation.max, defaults.max);
  const scope = AUTOMATION_SCOPES.includes(automation.scope) ? automation.scope : 'global';
  const trackId = scope === 'track' && trackIds.has(automation.trackId) ? automation.trackId : null;
  const points = cloneArray(automation.points)
    .map((point, index) => sanitizeAutomationPoint(point, index, min))
    .sort((a, b) => a.beat - b.beat);
  return {
    id: uniqueId(sanitizeId(automation.id, `automation-${fallbackIndex + 1}`), usedIds),
    name: sanitizeId(automation.name, `${target} modulation`),
    enabled: sanitizeBoolean(automation.enabled, true),
    scope,
    trackId,
    target,
    axis: AUTOMATION_AXES.includes(automation.axis) ? automation.axis : 'y',
    axisOp: AUTOMATION_AXIS_OPS.includes(automation.axisOp) ? automation.axisOp : 'add',
    min,
    max,
    points
  };
};

const buildProjectBase = (overrides = {}) => {
  const now = Number.isFinite(overrides.createdAt) ? overrides.createdAt : Date.now();
  return {
    version: MIDI_PROJECT_VERSION,
    id: sanitizeId(overrides.id, 'midi-project'),
    name: sanitizeId(overrides.name, 'MIDI Project'),
    templateId: overrides.templateId ?? null,
    createdAt: now,
    updatedAt: Number.isFinite(overrides.updatedAt) ? overrides.updatedAt : now,
    enabled: sanitizeBoolean(overrides.enabled, false),
    devices: {
      inputId: overrides.devices?.inputId ?? null,
      outputId: overrides.devices?.outputId ?? null,
      inputChannel: sanitizeInputChannel(overrides.devices?.inputChannel)
    },
    transport: sanitizeTransport(overrides.transport),
    global: sanitizeGlobal(overrides.global),
    tracks: Array.isArray(overrides.tracks) && overrides.tracks.length
      ? overrides.tracks
      : [createDefaultMidiTrack()],
    sources: Array.isArray(overrides.sources) ? overrides.sources : [],
    clips: Array.isArray(overrides.clips) ? overrides.clips : [],
    automation: Array.isArray(overrides.automation) ? cloneArray(overrides.automation) : [],
    ui: {
      selectedTrackId: overrides.ui?.selectedTrackId ?? DEFAULT_TRACK_ID,
      selectedSourceId: overrides.ui?.selectedSourceId ?? null,
      selectedClipId: overrides.ui?.selectedClipId ?? null,
      activeRegion: sanitizeId(overrides.ui?.activeRegion, 'setup')
    }
  };
};

const createMidiProject = (overrides = {}) => sanitizeMidiProject(buildProjectBase(overrides));

const createMidiProjectFromMidiConfig = (config = {}, options = {}) => {
  const merged = mergeConfig(DEFAULT_CONFIG, config || {});
  const sources = [];
  for (const [key, mapping] of safeObjectEntries(merged.sfx)) {
    sources.push(createMidiSourceFromMapping('sfx', key, mapping));
  }
  for (const [key, mapping] of safeObjectEntries(merged.triggers)) {
    sources.push(createMidiSourceFromMapping('trigger', key, mapping));
  }
  const automation = Array.isArray(merged.position?.mappings)
    ? merged.position.mappings.map((mapping, index) => createMidiAutomationFromPositionMapping(mapping, index))
    : [];
  return sanitizeMidiProject(buildProjectBase({
    id: options.id || 'factory-midi-project',
    name: options.name || 'Factory MIDI Project',
    templateId: options.templateId || DEFAULT_TEMPLATE_ID,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    enabled: sanitizeBoolean(merged.enabled, false),
    devices: {
      inputId: null,
      outputId: null,
      inputChannel: sanitizeInputChannel(merged.input?.channel)
    },
    transport: {
      bpmBase: merged.timing?.bpmBase,
      timeSignature: merged.timing?.timeSignature,
      quantize: '1/16',
      swing: 0
    },
    global: buildGlobalFromConfig(merged),
    tracks: [createDefaultMidiTrack()],
    sources,
    clips: [],
    automation,
    ui: {
      selectedTrackId: DEFAULT_TRACK_ID,
      selectedSourceId: sources[0]?.id ?? null,
      selectedClipId: null,
      activeRegion: 'setup'
    }
  }));
};

function sanitizeMidiProject(project = {}) {
  const source = {
    ...buildProjectBase(project),
    ...cloneObject(project)
  };
  const trackIdSet = new Set();
  const tracks = cloneArray(source.tracks)
    .map((track, index) => sanitizeTrack(track, index, trackIdSet));
  if (!tracks.length) tracks.push(createDefaultMidiTrack());

  const trackIds = new Set(tracks.map(track => track.id));
  const clipIdSet = new Set();
  const clips = cloneArray(source.clips)
    .map((clip, index) => sanitizeClip(clip, index, clipIdSet))
    .filter(Boolean);
  const clipIds = new Set(clips.map(clip => clip.id));

  const sourceIdSet = new Set();
  const sources = cloneArray(source.sources)
    .map((entry, index) => sanitizeSource(entry, index, trackIds, clipIds, sourceIdSet));
  const sourceIds = new Set(sources.map(entry => entry.id));
  const automationIdSet = new Set();
  const automation = cloneArray(source.automation)
    .map((entry, index) => sanitizeAutomation(entry, index, automationIdSet, trackIds))
    .filter(Boolean);

  const selectedTrackId = trackIds.has(source.ui?.selectedTrackId)
    ? source.ui.selectedTrackId
    : tracks[0].id;
  const selectedSourceId = sourceIds.has(source.ui?.selectedSourceId)
    ? source.ui.selectedSourceId
    : sources[0]?.id ?? null;
  const selectedClipId = clipIds.has(source.ui?.selectedClipId)
    ? source.ui.selectedClipId
    : null;

  return {
    version: MIDI_PROJECT_VERSION,
    id: sanitizeId(source.id, 'midi-project'),
    name: sanitizeId(source.name, 'MIDI Project'),
    templateId: source.templateId == null ? null : String(source.templateId),
    createdAt: Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
    enabled: sanitizeBoolean(source.enabled, false),
    devices: {
      inputId: source.devices?.inputId == null ? null : String(source.devices.inputId),
      outputId: source.devices?.outputId == null ? null : String(source.devices.outputId),
      inputChannel: sanitizeInputChannel(source.devices?.inputChannel)
    },
    transport: sanitizeTransport(source.transport),
    global: sanitizeGlobal(source.global),
    tracks,
    sources,
    clips,
    automation,
    ui: {
      ...cloneObject(source.ui),
      selectedTrackId,
      selectedSourceId,
      selectedClipId,
      activeRegion: sanitizeId(source.ui?.activeRegion, 'setup')
    }
  };
}

const parseMidiProjectPayload = (payload) => {
  if (typeof payload !== 'string') return cloneSafeObject(payload);
  try {
    return JSON.parse(payload);
  } catch (e) {
    throw new Error('MIDI project import is not valid JSON.');
  }
};

const createMidiProjectTemplate = (project = {}, options = {}) => {
  const clean = sanitizeMidiProject(project);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const id = sanitizeId(
    options.id,
    clean.templateId && clean.templateId !== DEFAULT_TEMPLATE_ID
      ? clean.templateId
      : `user-template-${now}`
  );
  const name = sanitizeId(options.name, `${clean.name} Template`);
  const templateProject = sanitizeMidiProject({
    ...clean,
    name,
    templateId: id,
    enabled: false,
    devices: {
      inputId: null,
      outputId: null,
      inputChannel: clean.devices.inputChannel
    },
    ui: {
      ...clean.ui,
      activeRegion: 'setup'
    }
  });
  return {
    version: MIDI_PROJECT_VERSION,
    id,
    name,
    createdAt: Number.isFinite(options.createdAt) ? options.createdAt : now,
    updatedAt: Number.isFinite(options.updatedAt) ? options.updatedAt : now,
    project: templateProject
  };
};

const createMidiProjectExportPayload = (project = {}, options = {}) => {
  const exportedAt = Number.isFinite(options.exportedAt) ? options.exportedAt : Date.now();
  if (options.asTemplate) {
    return {
      kind: MIDI_TEMPLATE_EXPORT_KIND,
      version: MIDI_PROJECT_VERSION,
      exportedAt,
      template: createMidiProjectTemplate(project, options)
    };
  }
  return {
    kind: MIDI_PROJECT_EXPORT_KIND,
    version: MIDI_PROJECT_VERSION,
    exportedAt,
    project: sanitizeMidiProject(project)
  };
};

const stringifyMidiProjectExport = (project = {}, options = {}) => (
  `${JSON.stringify(createMidiProjectExportPayload(project, options), null, 2)}\n`
);

const importMidiProjectPayload = (payload) => {
  const parsed = parseMidiProjectPayload(payload);
  if (!isPlainObject(parsed)) {
    throw new Error('MIDI project import did not contain a project.');
  }
  let projectPayload = null;
  let templateId = null;
  if (parsed.kind === MIDI_TEMPLATE_EXPORT_KIND) {
    projectPayload = parsed.template?.project ?? parsed.project;
    templateId = parsed.template?.id ?? parsed.templateId ?? projectPayload?.templateId ?? null;
  } else if (parsed.kind === MIDI_PROJECT_EXPORT_KIND) {
    projectPayload = parsed.project;
  } else if (isPlainObject(parsed.project)) {
    projectPayload = parsed.project;
    templateId = parsed.templateId ?? parsed.project.templateId ?? null;
  } else {
    projectPayload = parsed;
  }
  if (!isPlainObject(projectPayload)) {
    throw new Error('MIDI project import did not contain a project.');
  }
  return sanitizeMidiProject({
    ...projectPayload,
    templateId: templateId ?? projectPayload.templateId ?? null
  });
};

const touchProject = (project) => ({
  ...project,
  updatedAt: Date.now()
});

const updateById = (items, id, patch) => items.map(item => (
  item.id === id ? { ...item, ...cloneObject(patch) } : item
));

const updatePatch = (patch) => {
  const clean = cloneObject(patch);
  delete clean.id;
  return clean;
};

const updateSourceMapping = (items, id, patch) => items.map(item => (
  item.id === id ? { ...item, mapping: { ...createEmptyDirectMapping(), ...item.mapping, ...cloneObject(patch) } } : item
));

const addTrack = (project, track = {}) => {
  const existing = new Set(project.tracks.map(item => item.id));
  const id = uniqueId(sanitizeId(track.id, `track-${project.tracks.length + 1}`), existing);
  return {
    ...project,
    tracks: [...project.tracks, { ...createDefaultMidiTrack({ id, name: `Track ${project.tracks.length + 1}` }), ...cloneObject(track), id }],
    ui: { ...project.ui, selectedTrackId: id, activeRegion: 'tracks' }
  };
};

const addClip = (project, clip = {}) => {
  const existing = new Set(project.clips.map(item => item.id));
  const id = uniqueId(sanitizeId(clip.id, `clip-${project.clips.length + 1}`), existing);
  const name = sanitizeId(clip.name, `Clip ${project.clips.length + 1}`);
  return {
    ...project,
    clips: [...project.clips, createDefaultMidiClip({ ...cloneObject(clip), id, name })],
    ui: { ...project.ui, selectedClipId: id, activeRegion: 'clips' }
  };
};

const addAutomation = (project, automation = {}) => {
  const existing = new Set(project.automation.map(item => item.id));
  const target = AUTOMATION_TARGETS.includes(automation.target) ? automation.target : 'velocity';
  const id = uniqueId(sanitizeId(automation.id, `automation-${project.automation.length + 1}`), existing);
  return {
    ...project,
    automation: [...project.automation, createDefaultMidiAutomation({ ...cloneObject(automation), id, target })],
    ui: { ...project.ui, activeRegion: 'automation' }
  };
};

const removeById = (items, id) => items.filter(item => item.id !== id);

const updateClipStep = (clips, clipId, stepIndex, patch) => clips.map(clip => {
  if (clip.id !== clipId) return clip;
  const index = clamp(toInteger(stepIndex, 0), 0, Math.max(clip.lengthSteps - 1, 0));
  const steps = clip.steps.slice();
  while (steps.length < clip.lengthSteps) {
    steps.push(createDefaultMidiStep(steps.length, { note: null }));
  }
  steps[index] = {
    ...createDefaultMidiStep(index, { note: null }),
    ...steps[index],
    ...cloneObject(patch),
    index
  };
  return { ...clip, steps };
});

const updateAutomationPoint = (automation, automationId, pointIndex, patch) => automation.map(lane => {
  if (lane.id !== automationId) return lane;
  const index = Math.max(0, toInteger(pointIndex, 0));
  const points = lane.points.slice();
  while (points.length <= index) {
    points.push({ beat: points.length, value: lane.min });
  }
  points[index] = { ...points[index], ...cloneObject(patch) };
  return { ...lane, points };
});

const updateAutomationLane = (automation, automationId, patch, tracks) => {
  const trackIds = new Set(tracks.map(track => track.id));
  return automation.map(lane => {
    if (lane.id !== automationId) return lane;
    const cleanPatch = updatePatch(patch);
    if (cleanPatch.trackId != null) {
      const trackId = String(cleanPatch.trackId);
      if (trackIds.has(trackId)) {
        cleanPatch.trackId = trackId;
      } else {
        delete cleanPatch.trackId;
      }
    }
    if (cleanPatch.scope === 'global') cleanPatch.trackId = null;
    return { ...lane, ...cleanPatch };
  });
};

function reduceMidiProject(project, intent = {}) {
  const current = sanitizeMidiProject(project);
  let next = current;
  switch (intent?.type) {
  case 'project.set':
    return sanitizeMidiProject(intent.project);
  case 'project.reset':
    return createMidiProjectFromMidiConfig(intent.factoryConfig);
  case 'enabled.set':
    next = { ...current, enabled: Boolean(intent.enabled) };
    break;
  case 'devices.set':
    next = { ...current, devices: { ...current.devices, ...cloneObject(intent.devices) } };
    break;
  case 'transport.set':
    next = { ...current, transport: { ...current.transport, ...cloneObject(intent.transport) } };
    break;
  case 'global.update':
    next = { ...current, global: { ...current.global, ...cloneObject(intent.patch ?? intent.global) } };
    break;
  case 'track.add':
    next = addTrack(current, intent.track);
    break;
  case 'track.update':
    next = { ...current, tracks: updateById(current.tracks, intent.trackId, updatePatch(intent.patch)) };
    break;
  case 'track.select':
    next = { ...current, ui: { ...current.ui, selectedTrackId: intent.trackId, activeRegion: 'tracks' } };
    break;
  case 'source.select':
    next = { ...current, ui: { ...current.ui, selectedSourceId: intent.sourceId, activeRegion: 'sources' } };
    break;
  case 'source.update':
    next = { ...current, sources: updateById(current.sources, intent.sourceId, updatePatch(intent.patch)) };
    break;
  case 'source.assignTrack': {
    const trackId = intent.trackId == null ? null : String(intent.trackId);
    next = current.tracks.some(track => track.id === trackId)
      ? { ...current, sources: updateById(current.sources, intent.sourceId, { trackId }) }
      : current;
    break;
  }
  case 'source.mode.set':
    next = { ...current, sources: current.sources.map(source => (
      source.id === intent.sourceId
        ? {
          ...source,
          mode: intent.mode === 'clip' ? 'clip' : 'direct',
          clipId: intent.mode === 'clip' ? intent.clipId ?? current.ui.selectedClipId : null,
          mapping: intent.mode === 'clip' ? null : source.mapping || createEmptyDirectMapping()
        }
        : source
    )) };
    break;
  case 'source.clip.assign':
    next = { ...current, sources: updateById(current.sources, intent.sourceId, {
      mode: 'clip',
      clipId: intent.clipId
    }) };
    break;
  case 'source.mapping.update':
    next = { ...current, sources: updateSourceMapping(current.sources, intent.sourceId, intent.patch) };
    break;
  case 'clip.add':
    next = addClip(current, intent.clip);
    break;
  case 'clip.update':
    next = { ...current, clips: updateById(current.clips, intent.clipId, updatePatch(intent.patch)) };
    break;
  case 'clip.step.update':
    next = { ...current, clips: updateClipStep(current.clips, intent.clipId, intent.stepIndex, intent.patch) };
    break;
  case 'clip.select':
    next = { ...current, ui: { ...current.ui, selectedClipId: intent.clipId, activeRegion: 'clips' } };
    break;
  case 'automation.add':
    next = addAutomation(current, intent.automation);
    break;
  case 'automation.update':
    next = { ...current, automation: updateAutomationLane(current.automation, intent.automationId, intent.patch, current.tracks) };
    break;
  case 'automation.point.update':
    next = { ...current, automation: updateAutomationPoint(current.automation, intent.automationId, intent.pointIndex, intent.patch) };
    break;
  case 'automation.remove':
    next = { ...current, automation: removeById(current.automation, intent.automationId) };
    break;
  case 'ui.set':
    next = { ...current, ui: { ...current.ui, ...cloneObject(intent.ui) } };
    break;
  default:
    return current;
  }
  return sanitizeMidiProject(touchProject(next));
}

const isTrackAudible = (track, hasSolo) => {
  if (!track || track.mute) return false;
  if (hasSolo && !track.solo) return false;
  return true;
};

const buildRuntimeMapping = (source, track, hiddenByTrack, globalVelocityDefault) => {
  const mapping = sanitizeDirectMapping(source.mapping);
  const out = {};
  for (const key of DIRECT_MAPPING_KEYS) {
    const value = mapping[key];
    if (value != null) out[key] = cloneSafeObject(value);
  }
  out.name = source.label;
  out.channel = track.channel;
  out.priority = track.priority;
  out.voiceBudget = track.voiceBudget;
  out.trackId = track.id;
  out.outputId = track.outputId;
  if (track.velocityScale !== 1) {
    const velocity = Number.isFinite(out.velocity) ? out.velocity : globalVelocityDefault;
    out.velocity = sanitizeVelocity(Math.round(velocity * track.velocityScale));
  }
  if (!source.enabled || hiddenByTrack) out.disabled = true;
  return out;
};

const activeClipSteps = (clip) => (
  Array.isArray(clip?.steps)
    ? clip.steps
      .filter(step => Number.isFinite(step?.note) && (step.probability ?? 1) > 0 && !step.tie)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : []
);

const automationToPositionMappings = (automation = []) => automation
  .filter(lane => lane.enabled && lane.scope === 'global')
  .map(lane => ({
    axis: lane.axis,
    axisOp: lane.axisOp,
    target: lane.target,
    min: lane.min,
    max: lane.max,
    enabled: true
  }));

const runtimeBucketForSource = (source) => {
  const kind = normalizeKind(source?.kind);
  if (kind === 'sfx') return 'sfx';
  if (kind === 'trigger' || kind === 'midiFlag') return 'triggers';
  return null;
};

const isValidChannelValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && Math.round(number) === number && number >= 1 && number <= 16;
};

const isValidInputChannelValue = (value) => (
  value === 'omni' || value == null || value === '' || isValidChannelValue(value)
);

const issueId = (issue, index) => [
  issue.code,
  issue.sourceId || issue.trackId || issue.clipId || issue.runtimeKey || 'project',
  index
].join(':');

const buildConflictReport = (issues) => {
  const summary = { errors: 0, warnings: 0, infos: 0 };
  const bySourceId = {};
  const byTrackId = {};
  const byClipId = {};
  const addIndexedIssue = (index, issue) => ({
    severity: issue.severity || 'warning',
    id: issue.id || issueId(issue, index),
    ...issue
  });
  const indexed = issues.map((issue, index) => addIndexedIssue(index, issue));
  for (const issue of indexed) {
    if (issue.severity === 'error') summary.errors += 1;
    else if (issue.severity === 'info') summary.infos += 1;
    else summary.warnings += 1;
    if (issue.sourceId) {
      if (!bySourceId[issue.sourceId]) bySourceId[issue.sourceId] = [];
      bySourceId[issue.sourceId].push(issue);
    }
    if (issue.trackId) {
      if (!byTrackId[issue.trackId]) byTrackId[issue.trackId] = [];
      byTrackId[issue.trackId].push(issue);
    }
    if (issue.clipId) {
      if (!byClipId[issue.clipId]) byClipId[issue.clipId] = [];
      byClipId[issue.clipId].push(issue);
    }
  }
  return {
    ok: summary.errors === 0,
    issues: indexed,
    items: indexed,
    summary,
    bySourceId,
    byTrackId,
    byClipId
  };
};

const mappingHasExplicitNote = (mapping = {}) => (
  Number.isFinite(mapping.note) ||
  Number.isFinite(mapping.degree) ||
  (Array.isArray(mapping.notes) && mapping.notes.some(Number.isFinite)) ||
  mapping.chord != null ||
  mapping.arp != null
);

const collectMappingNotes = (mapping = {}) => {
  if (Array.isArray(mapping.notes) && mapping.notes.length) {
    return mapping.notes.filter(Number.isFinite);
  }
  return Number.isFinite(mapping.note) ? [mapping.note] : [];
};

const collectClipNotes = (clip) => activeClipSteps(clip).map(step => step.note).filter(Number.isFinite);

const noteRangeIssues = ({ notes, range, source, clip, path }) => {
  const issues = [];
  const outOfRange = notes.filter(note => note < range.min || note > range.max);
  if (outOfRange.length) {
    issues.push({
      severity: 'warning',
      code: 'note_out_of_range',
      sourceId: source?.id ?? null,
      trackId: source?.trackId ?? null,
      clipId: clip?.id ?? null,
      path,
      message: `Notes ${outOfRange.join(', ')} are outside the project note range ${range.min}-${range.max}.`
    });
  }
  if (notes.length > 1) {
    const clamped = notes.map(note => clamp(note, range.min, range.max));
    const uniqueOriginal = new Set(notes).size;
    const uniqueClamped = new Set(clamped).size;
    if (uniqueClamped < uniqueOriginal) {
      issues.push({
        severity: 'warning',
        code: 'note_range_collapse',
        sourceId: source?.id ?? null,
        trackId: source?.trackId ?? null,
        clipId: clip?.id ?? null,
        path,
        message: `Project note range ${range.min}-${range.max} collapses multiple notes to the same output.`
      });
    }
  }
  return issues;
};

function detectMidiProjectConflicts(project = {}, options = {}) {
  const clean = sanitizeMidiProject(project);
  const raw = isPlainObject(project) ? project : {};
  const rawTracks = cloneArray(raw.tracks);
  const rawSources = cloneArray(raw.sources);
  const rawClips = cloneArray(raw.clips);
  const rawAutomation = cloneArray(raw.automation);
  const issues = [];
  const tracksById = new Map(clean.tracks.map(track => [track.id, track]));
  const clipsById = new Map(clean.clips.map(clip => [clip.id, clip]));
  const trackIds = new Set(clean.tracks.map(track => track.id));
  const rawClipIds = new Set(rawClips
    .map(clip => (clip?.id == null ? null : String(clip.id)))
    .filter(Boolean));
  const availableOutputIds = Array.isArray(options.availableOutputIds)
    ? new Set(options.availableOutputIds.map(id => String(id)))
    : null;

  if (!isValidInputChannelValue(raw.devices?.inputChannel)) {
    issues.push({
      severity: 'warning',
      code: 'invalid_input_channel',
      path: ['devices', 'inputChannel'],
      message: `Input channel ${raw.devices?.inputChannel} will be clamped to ${clean.devices.inputChannel}.`
    });
  }
  if (options.requireOutput === true && clean.enabled && !clean.devices.outputId) {
    issues.push({
      severity: 'warning',
      code: 'missing_project_output',
      path: ['devices', 'outputId'],
      message: 'MIDI is enabled but no project output is selected.'
    });
  }
  if (availableOutputIds && clean.devices.outputId && !availableOutputIds.has(clean.devices.outputId)) {
    issues.push({
      severity: 'error',
      code: 'invalid_project_output',
      path: ['devices', 'outputId'],
      message: `Project output ${clean.devices.outputId} is not available.`
    });
  }

  clean.tracks.forEach((track, index) => {
    const rawTrack = rawTracks[index];
    if (isPlainObject(rawTrack) && rawTrack.channel != null && !isValidChannelValue(rawTrack.channel)) {
      issues.push({
        severity: 'warning',
        code: 'invalid_track_channel',
        trackId: track.id,
        path: ['tracks', index, 'channel'],
        message: `Track ${track.name} channel ${rawTrack.channel} will be clamped to ${track.channel}.`
      });
    }
    if (track.outputId && availableOutputIds && !availableOutputIds.has(track.outputId)) {
      issues.push({
        severity: 'warning',
        code: 'invalid_track_output',
        trackId: track.id,
        path: ['tracks', index, 'outputId'],
        message: `Track output ${track.outputId} is not available.`
      });
    }
  });

  rawAutomation.forEach((automation, index) => {
    if (!isPlainObject(automation) || automation.scope !== 'track' || automation.trackId == null) return;
    const rawTrackId = String(automation.trackId);
    if (trackIds.has(rawTrackId)) return;
    const cleanLane = clean.automation[index] || null;
    issues.push({
      severity: 'warning',
      code: 'missing_automation_track',
      automationId: cleanLane?.id ?? sanitizeId(automation.id, `automation-${index + 1}`),
      trackId: rawTrackId,
      path: ['automation', index, 'trackId'],
      message: `${cleanLane?.name || 'Automation lane'} references missing track ${rawTrackId}.`
    });
  });

  const runtimeSources = new Map();
  const hasSolo = clean.tracks.some(track => track.solo && !track.mute);
  const noteRange = clean.global.noteRange;

  clean.sources.forEach((source, index) => {
    const rawSource = rawSources[index];
    const rawTrackId = rawSource?.trackId == null ? null : String(rawSource.trackId);
    const track = tracksById.get(source.trackId);
    const bucket = runtimeBucketForSource(source);
    if (bucket) {
      const runtimeKey = `${bucket}:${source.sourceKey}`;
      if (!runtimeSources.has(runtimeKey)) runtimeSources.set(runtimeKey, []);
      runtimeSources.get(runtimeKey).push({ source, index });
    }
    if (rawTrackId && !trackIds.has(rawTrackId)) {
      issues.push({
        severity: 'error',
        code: 'missing_track',
        sourceId: source.id,
        trackId: rawTrackId,
        path: ['sources', index, 'trackId'],
        message: `${source.label} references missing track ${rawTrackId}.`
      });
    }
    if (!source.enabled) {
      issues.push({
        severity: 'info',
        code: 'disabled_source',
        sourceId: source.id,
        trackId: source.trackId,
        path: ['sources', index, 'enabled'],
        message: `${source.label} is disabled.`
      });
    }
    if (source.enabled && track?.mute) {
      issues.push({
        severity: 'warning',
        code: 'track_muted',
        sourceId: source.id,
        trackId: track.id,
        path: ['tracks', clean.tracks.indexOf(track), 'mute'],
        message: `${source.label} is routed to muted track ${track.name}.`
      });
    } else if (source.enabled && hasSolo && track && !track.solo) {
      issues.push({
        severity: 'warning',
        code: 'track_solo_hidden',
        sourceId: source.id,
        trackId: track.id,
        path: ['tracks', clean.tracks.indexOf(track), 'solo'],
        message: `${source.label} is hidden while another track is soloed.`
      });
    }

    if (source.mode === 'clip') {
      const clip = clipsById.get(source.clipId);
      const rawClipId = rawSource?.clipId == null ? null : String(rawSource.clipId);
      if (!source.clipId || !clip) {
        issues.push({
          severity: 'error',
          code: 'missing_clip',
          sourceId: source.id,
          trackId: source.trackId,
          clipId: rawClipId || source.clipId || null,
          path: ['sources', index, 'clipId'],
          message: `${source.label} is in clip mode without an assigned clip.`
        });
      } else if (rawClipId && rawClipIds.size && !rawClipIds.has(rawClipId)) {
        issues.push({
          severity: 'error',
          code: 'missing_clip',
          sourceId: source.id,
          trackId: source.trackId,
          clipId: rawClipId,
          path: ['sources', index, 'clipId'],
          message: `${source.label} references missing clip ${rawClipId}.`
        });
      } else {
        const notes = collectClipNotes(clip);
        if (!notes.length) {
          issues.push({
            severity: 'warning',
            code: 'silent_clip',
            sourceId: source.id,
            trackId: source.trackId,
            clipId: clip.id,
            path: ['clips', clean.clips.indexOf(clip), 'steps'],
            message: `${source.label} uses clip ${clip.name}, but it has no playable steps.`
          });
        }
        issues.push(...noteRangeIssues({
          notes,
          range: noteRange,
          source,
          clip,
          path: ['clips', clean.clips.indexOf(clip), 'steps']
        }));
      }
    } else {
      const mapping = source.mapping || createEmptyDirectMapping();
      if (!mappingHasExplicitNote(mapping)) {
        issues.push({
          severity: 'warning',
          code: 'implicit_default_mapping',
          sourceId: source.id,
          trackId: source.trackId,
          path: ['sources', index, 'mapping'],
          message: `${source.label} has no explicit note, degree, chord, or arp mapping.`
        });
      }
      issues.push(...noteRangeIssues({
        notes: collectMappingNotes(mapping),
        range: noteRange,
        source,
        clip: null,
        path: ['sources', index, 'mapping']
      }));
    }
  });

  for (const [runtimeKey, entries] of runtimeSources) {
    if (entries.length <= 1) continue;
    for (const { source, index } of entries) {
      issues.push({
        severity: 'error',
        code: 'duplicate_source_key',
        sourceId: source.id,
        trackId: source.trackId,
        runtimeKey,
        path: ['sources', index, 'sourceKey'],
        message: `Duplicate runtime key ${runtimeKey} will overwrite another source.`
      });
    }
  }

  return buildConflictReport(issues);
}

const buildRuntimeClipMapping = (source, track, clip, hiddenByTrack, globalVelocityDefault, globalDurationDefault) => {
  const steps = activeClipSteps(clip);
  const first = steps[0] || null;
  const notes = steps.map(step => sanitizeNote(step.note));
  const out = {
    name: source.label,
    channel: track.channel,
    priority: track.priority,
    voiceBudget: track.voiceBudget,
    trackId: track.id,
    outputId: track.outputId,
    clipId: clip?.id ?? source.clipId,
    clipType: clip?.type || 'stepPattern',
    note: notes[0] ?? null,
    velocity: first?.velocity ?? globalVelocityDefault,
    durationTicks: first?.durationTicks ?? globalDurationDefault
  };
  if (notes.length > 1) out.notes = notes;
  if (clip?.type === 'arp' && notes.length) {
    out.arp = {
      enabled: true,
      mode: clip.arp?.mode || 'up',
      length: notes.length,
      pattern: isPlainObject(clip.arp?.pattern) ? cloneObject(clip.arp.pattern) : null
    };
  }
  if (track.velocityScale !== 1) {
    const velocity = Number.isFinite(out.velocity) ? out.velocity : globalVelocityDefault;
    out.velocity = sanitizeVelocity(Math.round(velocity * track.velocityScale));
  }
  if (!source.enabled || hiddenByTrack || !notes.length) out.disabled = true;
  return out;
};

function projectToMidiConfig(project, factoryConfig = {}) {
  const clean = sanitizeMidiProject(project);
  const base = mergeConfig(DEFAULT_CONFIG, factoryConfig || {});
  const positionMappings = automationToPositionMappings(clean.automation);
  const config = mergeConfig(base, {
    enabled: clean.enabled,
    timing: {
      bpmBase: clean.transport.bpmBase,
      timeSignature: clean.transport.timeSignature,
      quantize: clean.transport.quantize,
      swing: clean.transport.swing,
      scheduleAheadMs: base.timing?.scheduleAheadMs ?? 0
    },
    scale: clean.global.scale,
    noteRange: clean.global.noteRange,
    velocityRange: clean.global.velocityRange,
    durationTicks: clean.global.durationTicks,
    density: clean.global.density,
    envelope: clean.global.envelope,
    position: {
      ...clean.global.position,
      mappings: positionMappings
    },
    mpe: clean.global.mpe,
    limits: clean.global.limits,
    reverse: clean.global.reverse,
    input: {
      ...(base.input || {}),
      channel: clean.devices.inputChannel,
      enabled: clean.enabled
    }
  });
  config.sfx = {};
  config.triggers = {};

  const tracksById = new Map(clean.tracks.map(track => [track.id, track]));
  const clipsById = new Map(clean.clips.map(clip => [clip.id, clip]));
  const hasSolo = clean.tracks.some(track => track.solo && !track.mute);
  const defaultVelocity = clean.global.velocityRange.default ?? DEFAULT_CONFIG.velocityRange.default;
  const defaultDuration = clean.global.durationTicks.default ?? DEFAULT_CONFIG.durationTicks.default;
  for (const source of clean.sources) {
    const track = tracksById.get(source.trackId) || clean.tracks[0];
    const hiddenByTrack = !isTrackAudible(track, hasSolo);
    const mapping = source.mode === 'clip'
      ? buildRuntimeClipMapping(source, track, clipsById.get(source.clipId), hiddenByTrack, defaultVelocity, defaultDuration)
      : buildRuntimeMapping(source, track, hiddenByTrack, defaultVelocity);
    if (source.kind === 'trigger' || source.kind === 'midiFlag') {
      config.triggers[source.sourceKey] = mapping;
    } else if (source.kind === 'sfx') {
      config.sfx[source.sourceKey] = mapping;
    }
  }
  return config;
}

export {
  AUTOMATION_AXES,
  AUTOMATION_TARGETS,
  ARP_MODES,
  DIRECT_MAPPING_KEYS,
  MAX_DURATION_TICKS,
  MIDI_PROJECT_EXPORT_KIND,
  MIDI_PROJECT_VERSION,
  MIDI_TEMPLATE_EXPORT_KIND,
  MIN_DURATION_TICKS,
  createDefaultMidiAutomation,
  createDefaultMidiClip,
  createDefaultMidiStep,
  createDefaultMidiTrack,
  createEmptyDirectMapping,
  createMidiProjectExportPayload,
  createMidiProjectTemplate,
  detectMidiProjectConflicts,
  createMidiProject,
  createMidiProjectFromMidiConfig,
  createMidiSourceFromMapping,
  importMidiProjectPayload,
  projectToMidiConfig,
  reduceMidiProject,
  sanitizeMidiProject,
  stringifyMidiProjectExport
};
