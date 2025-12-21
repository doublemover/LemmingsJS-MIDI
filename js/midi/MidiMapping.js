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
  noteRange: { min: 36, max: 84 },
  velocityRange: { min: 20, max: 110, default: 80 },
  durationTicks: { default: 6, min: 2, max: 24 },
  limits: {
    windowMs: 1000,
    maxEventsPerTick: 32,
    hardMaxEventsPerTick: 128,
    maxEventsPerSecond: 250,
    hardMaxEventsPerSecond: 250,
    overloadCooldownMs: 500,
    maxActiveNotes: 32,
    prioritySfx: [2, 3, 16]
  },
  density: { windowTicks: 24, velocityBoost: 0.4, durationScale: 0.5 },
  position: {
    xToNote: true,
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

  getSfxConfig(sfxId) {
    if (sfxId == null) return null;
    return this.config.sfx?.[String(sfxId)] ?? null;
  }

  mapEvent(event, context = {}, density = 0) {
    const cfg = this.config;
    if (!cfg.enabled || !event) return null;
    const sfx = this.getSfxConfig(event.sfxId) || {};
    if (sfx.disabled) return null;

    const noteRange = cfg.noteRange || DEFAULT_CONFIG.noteRange;
    const velocityRange = cfg.velocityRange || DEFAULT_CONFIG.velocityRange;
    const durationCfg = cfg.durationTicks || DEFAULT_CONFIG.durationTicks;
    const densityCfg = cfg.density || DEFAULT_CONFIG.density;
    const positionCfg = cfg.position || DEFAULT_CONFIG.position;

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

    if (positionCfg.xToNote && context.levelWidth && event.x != null) {
      const xNorm = clamp(event.x / context.levelWidth, 0, 1);
      const xRange = positionCfg.xNoteRange || { min: 0, max: 0 };
      const offset = lerp(xRange.min, xRange.max, xNorm);
      note = note + offset;
    }

    note = quantizeToScale(note, cfg.scale);
    note = clamp(note, 0, 127);

    const velMin = velocityRange.min ?? 1;
    const velMax = velocityRange.max ?? 127;
    let velocity = sfx.velocity ?? velocityRange.default ?? velMax;

    if (positionCfg.yToVelocity && context.levelHeight && event.y != null && sfx.velocity == null) {
      const yNorm = clamp(event.y / context.levelHeight, 0, 1);
      velocity = Math.round(lerp(velMax, velMin, yNorm));
    }

    if (density > 0 && densityCfg.velocityBoost) {
      velocity = Math.round(velocity * (1 + density * densityCfg.velocityBoost));
    }
    velocity = clamp(velocity, velMin, velMax);

    let durationTicks = sfx.durationTicks ?? durationCfg.default ?? 6;
    if (density > 0 && densityCfg.durationScale) {
      durationTicks = Math.round(durationTicks * (1 - density * densityCfg.durationScale));
    }
    durationTicks = clamp(durationTicks, durationCfg.min ?? 1, durationCfg.max ?? 999);

    let timbre = null;
    if (positionCfg.yToTimbre && context.levelHeight && event.y != null) {
      const yNorm = clamp(event.y / context.levelHeight, 0, 1);
      const tMin = positionCfg.timbreRange?.min ?? 0;
      const tMax = positionCfg.timbreRange?.max ?? 127;
      timbre = Math.round(lerp(tMax, tMin, yNorm));
    }

    let pan = null;
    if (positionCfg.viewPan && Number.isFinite(event.x)) {
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
      velocity,
      durationTicks,
      timbre,
      pan,
      pitchBend,
      frequencyHz,
      channel: sfx.channel ?? null
    };
  }
}

export { MidiMapping };
