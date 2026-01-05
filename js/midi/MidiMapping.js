const DEFAULT_SCALES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'chromatic-minor': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
});

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  mpe: {
    enabled: true,
    masterChannel: 1,
    memberChannels: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    pitchBendRange: { semitones: 24, cents: 0 },
    timbreCc: 74
  },
  scale: {
    name: 'chromatic-minor',
    root: 0,
    degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  },
  timing: {
    bpmBase: 120,
    scheduleAheadMs: 0,
    timeSignature: { beats: 4, unit: 4 }
  },
  reverse: {
    allNotesOffOnToggle: false
  },
  noteDefaults: {
    octave: 4,
    degree: 0,
    chord: 'triad'
  },
  noteRange: { min: 36, max: 84 },
  velocityRange: { min: 20, max: 110, default: 80 },
  durationTicks: { default: 6, min: 2, max: 24 },
  envelope: {
    attack: 1,
    decay: 0,
    sustain: 1,
    release: 1
  },
  limits: {
    windowMs: 1000,
    maxEventsPerTick: 32,
    hardMaxEventsPerTick: 128,
    maxEventsPerSecond: 900,
    hardMaxEventsPerSecond: 1000,
    maxBytesPerSecond: 3906,
    overloadCooldownMs: 500,
    maxActiveNotes: 32,
    prioritySfx: [2, 3, 16]
  },
  density: { windowTicks: 24, velocityBoost: 0.4, durationScale: 0.5 },
  repeat: {
    maxRepeats: 0,
    windowBeats: 4,
    spacingTicks: 2,
    target: 'velocity',
    amount: 0.15,
    velocityBoost: 0,
    durationBoost: 0
  },
  position: {
    xToNote: false,
    xNoteRange: { min: -12, max: 12 },
    yToVelocity: true,
    yToTimbre: true,
    timbreRange: { min: 20, max: 110 },
    viewPan: false,
    panRange: { min: -127, max: 127 },
    panDeadZonePct: 0.02,
    panOnscreenWeight: 0.8,
    panOffscreenWeight: 0.2,
    panOffscreenRange: 1
  },
  input: {
    enabled: true,
    channel: 'omni',
    transport: {
      start: 'restart',
      stop: 'pause',
      continue: 'resume'
    },
    notes: {
      skillBase: 60,
      skillOrder: [
        'CLIMBER',
        'FLOATER',
        'BOMBER',
        'BLOCKER',
        'BUILDER',
        'BASHER',
        'MINER',
        'DIGGER'
      ],
      actions: {
        pause: 36,
        resume: 38,
        restart: 40,
        speedDown: 41,
        speedUp: 43,
        speedReset: 45,
        toggleMidi: 47,
        toggleViewPan: 49
      }
    },
    cc: {
      speed: { cc: 1, min: 0.1, max: 8 },
      bpmBase: { cc: 74, min: 60, max: 200 },
      intensity: { cc: 7, min: 10, max: 127 },
      accent: { cc: 11, min: 0, max: 1 },
      keyRoot: { cc: 16, min: 0, max: 11, round: true, target: 'scale.root' },
      scaleName: {
        cc: 17,
        target: 'scale.name',
        values: ['chromatic-minor', 'major', 'minor', 'dorian', 'mixolydian', 'pentatonic', 'chromatic']
      },
      xToNote: { cc: 18, toggle: true, target: 'position.xToNote' },
      yToVelocity: { cc: 19, toggle: true, target: 'position.yToVelocity' },
      yToTimbre: { cc: 20, toggle: true, target: 'position.yToTimbre' },
      viewPan: { cc: 21, toggle: true, target: 'position.viewPan' },
      repeatCount: { cc: 22, min: 0, max: 32, round: true, target: 'repeat.maxRepeats' },
      repeatSpacing: { cc: 23, min: 1, max: 8, round: true, target: 'repeat.windowBeats' },
      envAttack: { cc: 24, min: 0, max: 2, target: 'envelope.attack' },
      envDecay: { cc: 25, min: 0, max: 2, target: 'envelope.decay' },
      envSustain: { cc: 26, min: 0, max: 1, target: 'envelope.sustain' },
      envRelease: { cc: 27, min: 0, max: 2, target: 'envelope.release' },
      chordType: {
        cc: 28,
        target: 'noteDefaults.chord',
        values: ['triad', 'seventh', 'sixth', 'ninth', 'power', 'sus2', 'sus4', 'octave']
      },
      chordOctave: { cc: 29, min: 1, max: 8, round: true, target: 'noteDefaults.octave' },
      chordDegree: { cc: 30, min: 0, max: 6, round: true, target: 'noteDefaults.degree' },
      duration: { cc: 31, min: 1, max: 24, round: true, target: 'durationTicks.default' },
      timeSignatureBeats: { cc: 80, min: 1, max: 12, round: true, target: 'timing.timeSignature.beats' },
      timeSignatureUnit: { cc: 81, values: [1, 2, 4, 8, 16], target: 'timing.timeSignature.unit' }
    }
  },
  triggers: {},
  sfx: {}
});

const isPlainObject = (val) => val && typeof val === 'object' && !Array.isArray(val);

const mergeConfig = (base, override) => {
  if (!override) return { ...base };
  const out = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (isPlainObject(val) && isPlainObject(base[key])) {
      out[key] = mergeConfig(base[key], val);
    } else {
      out[key] = val;
    }
  }
  return out;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

const resolvePositionMappings = (positionCfg, velocityRange) => {
  if (Array.isArray(positionCfg?.mappings)) return positionCfg.mappings;
  const mappings = [];
  if (positionCfg?.xToNote) {
    const xRange = positionCfg.xNoteRange || {};
    mappings.push({
      axis: 'x',
      target: 'note',
      min: xRange.min ?? 0,
      max: xRange.max ?? 0,
      enabled: true
    });
  }
  if (positionCfg?.yToVelocity) {
    const velMin = velocityRange?.min ?? 1;
    const velMax = velocityRange?.max ?? 127;
    mappings.push({
      axis: 'y',
      target: 'velocity',
      min: velMax,
      max: velMin,
      enabled: true
    });
  }
  if (positionCfg?.yToTimbre) {
    const tMin = positionCfg.timbreRange?.min ?? 0;
    const tMax = positionCfg.timbreRange?.max ?? 127;
    mappings.push({
      axis: 'y',
      target: 'timbre',
      min: tMax,
      max: tMin,
      enabled: true
    });
  }
  return mappings;
};

const resolveAxisValues = (event, context) => {
  const xNorm = context.levelWidth && event?.x != null
    ? clamp(event.x / context.levelWidth, 0, 1)
    : null;
  const yNorm = context.levelHeight && event?.y != null
    ? clamp(event.y / context.levelHeight, 0, 1)
    : null;
  const xyNorm = (xNorm != null && yNorm != null)
    ? clamp((xNorm + yNorm) / 2, 0, 1)
    : null;
  return { x: xNorm, y: yNorm, xy: xyNorm };
};

const resolveAxisValue = (entry, axisValues) => {
  const axisX = typeof entry?.axisX === 'boolean' ? entry.axisX : null;
  const axisY = typeof entry?.axisY === 'boolean' ? entry.axisY : null;
  if (axisX != null || axisY != null) {
    if (axisX && axisY) {
      const xVal = axisValues.x;
      const yVal = axisValues.y;
      if (xVal == null || yVal == null) return null;
      const op = entry?.axisOp || 'add';
      switch (op) {
      case 'sub':
        return clamp((xVal - yVal + 1) / 2, 0, 1);
      case 'mul':
        return clamp(xVal * yVal, 0, 1);
      case 'div':
        if (yVal === 0) return 1;
        return clamp(xVal / yVal, 0, 1);
      case 'add':
      default:
        return clamp((xVal + yVal) / 2, 0, 1);
      }
    }
    if (axisX) return axisValues.x;
    if (axisY) return axisValues.y;
    return null;
  }
  const axis = entry?.axis || 'x';
  if (axis === 'xy') {
    const xVal = axisValues.x;
    const yVal = axisValues.y;
    if (xVal == null || yVal == null) return axisValues.xy;
    const op = entry?.axisOp || 'add';
    switch (op) {
    case 'sub':
      return clamp((xVal - yVal + 1) / 2, 0, 1);
    case 'mul':
      return clamp(xVal * yVal, 0, 1);
    case 'div':
      if (yVal === 0) return 1;
      return clamp(xVal / yVal, 0, 1);
    case 'add':
    default:
      return clamp((xVal + yVal) / 2, 0, 1);
    }
  }
  return axisValues[axis] ?? null;
};

const resolveScale = (scale) => {
  const name = scale?.name || DEFAULT_CONFIG.scale.name;
  if (Array.isArray(scale?.degrees) && scale.degrees.length) {
    return { name, root: scale?.root ?? 0, degrees: scale.degrees };
  }
  if (DEFAULT_SCALES[name]) {
    return { name, root: scale?.root ?? 0, degrees: DEFAULT_SCALES[name] };
  }
  return {
    name: DEFAULT_CONFIG.scale.name,
    root: DEFAULT_CONFIG.scale.root,
    degrees: DEFAULT_CONFIG.scale.degrees
  };
};

const CHORD_TYPES = Object.freeze({
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  sixth: [0, 2, 4, 5],
  ninth: [0, 2, 4, 6, 8],
  power: [0, 4],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  octave: [0, 7]
});

const quantizeToScale = (note, scale) => {
  const degrees = scale?.degrees ?? DEFAULT_CONFIG.scale.degrees;
  const root = scale?.root ?? 0;
  if (!degrees.length) return Math.round(note);
  const rounded = Math.round(note);
  const pitchClass = ((rounded - root) % 12 + 12) % 12;
  if (degrees.includes(pitchClass)) return rounded;
  for (let step = 1; step <= 6; step++) {
    const up = (pitchClass + step) % 12;
    const down = (pitchClass - step + 12) % 12;
    if (degrees.includes(up)) return rounded + step;
    if (degrees.includes(down)) return rounded - step;
  }
  return rounded;
};

const noteFromFrequency = (frequency) => 69 + 12 * Math.log2(frequency / 440);

const noteToFrequency = (note) => 440 * Math.pow(2, (note - 69) / 12);

const clampNoteToRange = (note, range) => {
  let out = Math.round(note);
  if (!range) return clamp(out, 0, 127);
  const min = range.min ?? 0;
  const max = range.max ?? 127;
  while (out < min) out += 12;
  while (out > max) out -= 12;
  return clamp(out, 0, 127);
};

const buildScaleNote = (degree, scale, octave) => {
  const degrees = scale.degrees || DEFAULT_CONFIG.scale.degrees;
  const root = scale.root ?? 0;
  const index = Math.max(0, degree | 0);
  const octaveOffset = Math.floor(index / degrees.length);
  const step = degrees[index % degrees.length];
  return root + step + (octave + octaveOffset) * 12;
};

const buildChordNotes = (baseDegree, scale, octave, chordType, inversion = 0) => {
  const degrees = scale.degrees || DEFAULT_CONFIG.scale.degrees;
  const offsets = CHORD_TYPES[chordType] || CHORD_TYPES.triad;
  const rawNotes = offsets.map(offset => {
    const idx = (baseDegree | 0) + offset;
    const oct = octave + Math.floor(idx / degrees.length);
    return buildScaleNote(idx % degrees.length, scale, oct);
  });
  const inverted = rawNotes.slice();
  let inv = inversion | 0;
  while (inv > 0 && inverted.length > 1) {
    const note = inverted.shift();
    inverted.push(note + 12);
    inv -= 1;
  }
  return inverted;
};

class MidiMapping {
  constructor(config = {}) {
    this.config = mergeConfig(DEFAULT_CONFIG, config);
  }

  static fromJson(json) {
    if (!json) return new MidiMapping();
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      return new MidiMapping(parsed);
    } catch (e) {
      return new MidiMapping();
    }
  }

  static mergeConfigs(base, override) {
    return mergeConfig(base || DEFAULT_CONFIG, override || {});
  }

  getSfxConfig(sfxId) {
    if (sfxId == null) return null;
    return this.config.sfx?.[String(sfxId)] ?? null;
  }

  mapEvent(event, context = {}, density = 0, overrideSfx = null) {
    const cfg = this.config;
    if (!cfg.enabled || !event) return null;
    const sfx = overrideSfx || this.getSfxConfig(event.sfxId) || {};
    if (sfx.disabled) return null;

    const noteRange = cfg.noteRange || DEFAULT_CONFIG.noteRange;
    const velocityRange = cfg.velocityRange || DEFAULT_CONFIG.velocityRange;
    const durationCfg = cfg.durationTicks || DEFAULT_CONFIG.durationTicks;
    const densityCfg = cfg.density || DEFAULT_CONFIG.density;
    const positionCfg = cfg.position || DEFAULT_CONFIG.position;
    const scale = resolveScale(cfg.scale);
    const noteDefaults = cfg.noteDefaults || DEFAULT_CONFIG.noteDefaults;
    const positionMappings = resolvePositionMappings(positionCfg, velocityRange);
    const axisValues = resolveAxisValues(event, context);
    const envelopeOverrides = {};
    let noteOffset = null;
    let velocityOverride = null;
    let durationOverride = null;
    let timbreOverride = null;
    let panOverride = null;
    let pitchBendOverride = null;

    const resolveRange = (entry, fallbackMin, fallbackMax) => {
      const min = Number.isFinite(entry?.min) ? entry.min : fallbackMin;
      const max = Number.isFinite(entry?.max) ? entry.max : fallbackMax;
      return { min, max };
    };

    const applyPositionMapping = (entry) => {
      if (!entry || entry.enabled === false) return;
      const axisValue = resolveAxisValue(entry, axisValues);
      if (axisValue == null) return;
      const target = entry.target || 'velocity';
      const velMin = velocityRange.min ?? 1;
      const velMax = velocityRange.max ?? 127;
      const tMin = positionCfg.timbreRange?.min ?? 0;
      const tMax = positionCfg.timbreRange?.max ?? 127;
      const pMin = positionCfg.panRange?.min ?? -127;
      const pMax = positionCfg.panRange?.max ?? 127;
      let range = null;
      switch (target) {
      case 'note':
        range = resolveRange(entry, positionCfg.xNoteRange?.min ?? 0, positionCfg.xNoteRange?.max ?? 0);
        noteOffset = (noteOffset ?? 0) + lerp(range.min, range.max, axisValue);
        return;
      case 'velocity':
        range = resolveRange(entry, velMin, velMax);
        velocityOverride = lerp(range.min, range.max, axisValue);
        return;
      case 'timbre':
        range = resolveRange(entry, tMin, tMax);
        timbreOverride = lerp(range.min, range.max, axisValue);
        return;
      case 'pan':
        range = resolveRange(entry, pMin, pMax);
        panOverride = lerp(range.min, range.max, axisValue);
        return;
      case 'duration':
        range = resolveRange(entry, durationCfg.min ?? 1, durationCfg.max ?? 24);
        durationOverride = lerp(range.min, range.max, axisValue);
        return;
      case 'pitchBend':
        range = resolveRange(entry, -1, 1);
        pitchBendOverride = lerp(range.min, range.max, axisValue);
        return;
      case 'attack':
      case 'decay':
      case 'release':
        range = resolveRange(entry, 0, 2);
        envelopeOverrides[target] = lerp(range.min, range.max, axisValue);
        return;
      case 'sustain':
        range = resolveRange(entry, 0.25, 2);
        envelopeOverrides[target] = lerp(range.min, range.max, axisValue);
        return;
      default:
        return;
      }
    };

    for (const entry of positionMappings) {
      applyPositionMapping(entry);
    }

    const defaultNote = Math.round((noteRange.min + noteRange.max) / 2);
    let note = sfx.note ?? defaultNote;
    let pitchBend = 0;

    if (Number.isFinite(sfx.frequencyHz) && sfx.frequencyHz > 0) {
      const floatNote = noteFromFrequency(sfx.frequencyHz);
      const baseNote = Math.round(floatNote);
      const bendRange = cfg.mpe?.pitchBendRange?.semitones ?? 2;
      const offset = floatNote - baseNote;
      pitchBend = clamp(offset / bendRange, -1, 1);
      note = baseNote;
    }

    if (pitchBendOverride != null && !Number.isFinite(sfx.frequencyHz)) {
      pitchBend = clamp(pitchBendOverride, -1, 1);
    }

    let notes = null;
    if (Array.isArray(sfx.notes) && sfx.notes.length) {
      notes = sfx.notes.map(n => clampNoteToRange(n, noteRange));
      note = notes[0];
    } else if (sfx.chord && (sfx.degree != null || sfx.note == null)) {
      const degree = sfx.degree ?? noteDefaults.degree ?? 0;
      const octave = sfx.octave ?? noteDefaults.octave ?? 4;
      const chordType = sfx.chord?.type || noteDefaults.chord || 'triad';
      const inversion = sfx.chord?.inversion ?? 0;
      notes = buildChordNotes(degree, scale, octave, chordType, inversion)
        .map(n => clampNoteToRange(n, noteRange));
      note = notes[0];
    } else if (sfx.degree != null) {
      const degree = sfx.degree;
      const octave = sfx.octave ?? noteDefaults.octave ?? 4;
      note = buildScaleNote(degree, scale, octave);
      note = clampNoteToRange(note, noteRange);
    } else {
      note = quantizeToScale(note, scale);
      note = clampNoteToRange(note, noteRange);
    }
    if (Number.isFinite(noteOffset) && noteOffset !== 0) {
      const offset = Math.round(noteOffset);
      if (Array.isArray(notes) && notes.length) {
        notes = notes.map(n => clampNoteToRange(n + offset, noteRange));
        note = notes[0];
      } else {
        note = clampNoteToRange(note + offset, noteRange);
      }
    }

    const velMin = velocityRange.min ?? 1;
    const velMax = velocityRange.max ?? 127;
    let velocity = sfx.velocity ?? velocityRange.default ?? velMax;
    if (velocityOverride != null && sfx.velocity == null) {
      velocity = Math.round(velocityOverride);
    }

    if (density > 0 && densityCfg.velocityBoost) {
      velocity = Math.round(velocity * (1 + density * densityCfg.velocityBoost));
    }
    if (Number.isFinite(event?.intensity)) {
      const intensity = clamp(event.intensity, 0.1, 2);
      velocity = Math.round(velocity * intensity);
    }
    velocity = clamp(velocity, velMin, velMax);

    let durationTicks = sfx.durationTicks ?? durationCfg.default ?? 6;
    if (durationOverride != null && sfx.durationTicks == null) {
      durationTicks = Math.round(durationOverride);
    }
    if (density > 0 && densityCfg.durationScale) {
      durationTicks = Math.round(durationTicks * (1 - density * densityCfg.durationScale));
    }
    durationTicks = clamp(durationTicks, durationCfg.min ?? 1, durationCfg.max ?? 999);

    const baseEnvelope = cfg.envelope || DEFAULT_CONFIG.envelope;
    const envelope = isPlainObject(sfx.envelope)
      ? { ...baseEnvelope, ...sfx.envelope, ...envelopeOverrides }
      : { ...baseEnvelope, ...envelopeOverrides };
    const attack = Number.isFinite(envelope.attack) ? envelope.attack : 1;
    const decay = Number.isFinite(envelope.decay) ? envelope.decay : 0;
    const sustain = Number.isFinite(envelope.sustain) ? envelope.sustain : 1;
    const release = Number.isFinite(envelope.release) ? envelope.release : 1;
    const attackScale = clamp(attack, 0, 2);
    const decayScale = clamp(1 - decay * 0.25, 0.1, 1);
    velocity = clamp(Math.round(velocity * attackScale * decayScale), velMin, velMax);
    durationTicks = clamp(Math.round(durationTicks * clamp(sustain, 0.25, 2)), durationCfg.min ?? 1, durationCfg.max ?? 999);
    const releaseVelocity = clamp(Math.round(velocity * clamp(release, 0, 2)), 1, 127);

    let timbre = null;
    if (timbreOverride != null) {
      const tMin = positionCfg.timbreRange?.min ?? 0;
      const tMax = positionCfg.timbreRange?.max ?? 127;
      const tLow = Math.min(tMin, tMax);
      const tHigh = Math.max(tMin, tMax);
      timbre = Math.round(clamp(timbreOverride, tLow, tHigh));
    }

    let pan = null;
    if (panOverride != null) {
      const pMin = positionCfg.panRange?.min ?? -127;
      const pMax = positionCfg.panRange?.max ?? 127;
      const pLow = Math.min(pMin, pMax);
      const pHigh = Math.max(pMin, pMax);
      pan = Math.round(clamp(panOverride, pLow, pHigh));
    } else if (positionCfg.viewPan && Number.isFinite(event.x)) {
      const viewRect = context.viewRect;
      const viewWidth = viewRect?.w ?? context.levelWidth ?? null;
      if (Number.isFinite(viewWidth) && viewWidth > 0) {
        const viewX = viewRect?.x ?? 0;
        const viewCenter = viewRect ? (viewX + viewWidth / 2) : (viewWidth / 2);
        const halfW = viewWidth / 2;
        const deadZonePct = positionCfg.panDeadZonePct ?? 0.02;
        const deadZoneHalf = (viewWidth * deadZonePct) / 2;
        const onWeight = positionCfg.panOnscreenWeight ?? 0.8;
        const offWeight = positionCfg.panOffscreenWeight ?? 0.2;
        const offRange = positionCfg.panOffscreenRange ?? 1;
        const weightSum = onWeight + offWeight || 1;
        const onScale = onWeight / weightSum;
        const offScale = offWeight / weightSum;
        const dx = event.x - viewCenter;
        const absDx = Math.abs(dx);
        const sign = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
        if (absDx <= deadZoneHalf || halfW <= 0) {
          pan = 0;
        } else {
          const onExtent = Math.max(halfW - deadZoneHalf, 0);
          const onNorm = onExtent > 0 ? Math.min((absDx - deadZoneHalf) / onExtent, 1) : 1;
          const offDist = Math.max(0, absDx - halfW);
          const offNorm = Math.min(offDist / (viewWidth * offRange), 1);
          const panPercent = Math.min((onScale * onNorm) + (offScale * offNorm), 1);
          const pMin = positionCfg.panRange?.min ?? -127;
          const pMax = positionCfg.panRange?.max ?? 127;
          const panMax = Math.max(Math.abs(pMin), Math.abs(pMax)) || 127;
          pan = Math.round(sign * panPercent * panMax);
        }
      }
    }

    const frequencyHz = sfx.frequencyHz ?? noteToFrequency(note);

    return {
      note,
      notes,
      velocity,
      durationTicks,
      releaseVelocity,
      timbre,
      pan,
      pitchBend,
      frequencyHz,
      channel: sfx.channel ?? null,
      arp: sfx.arp ?? null
    };
  }
}

const ScaleLibrary = DEFAULT_SCALES;
const __test__ = {
  isPlainObject,
  mergeConfig,
  resolvePositionMappings,
  resolveAxisValues,
  resolveAxisValue,
  resolveScale,
  quantizeToScale,
  clampNoteToRange,
  buildScaleNote,
  buildChordNotes,
  noteFromFrequency,
  noteToFrequency
};

export { MidiMapping, ScaleLibrary, __test__ };
