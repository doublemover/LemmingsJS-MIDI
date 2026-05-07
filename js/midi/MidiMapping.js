import { cloneSafeObject, isPlainObject } from '../util/safeObject.js';
import {
  CHORD_TYPES,
  DEFAULT_CONFIG,
  DEFAULT_SCALES,
  buildChordNotes,
  buildScaleNote,
  clamp,
  clampNoteToRange,
  lerp,
  mergeConfig,
  noteFromFrequency,
  noteToFrequency,
  quantizeToScale,
  resolveAxisValue,
  resolveAxisValues,
  resolvePositionMappings,
  resolveScale
} from './midi-mapping/MidiMappingDomain.js';

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

  /**
   * Resolve a gameplay event into a MIDI-ready note payload.
   * @param {object} event - Source event (position, sfx id, trigger metadata).
   * @param {object} [context={}] - Runtime context (view rect, level dimensions, etc.).
   * @param {number} [density=0] - Normalized density scalar used by density mappings.
   * @param {object|null} [overrideSfx=null] - Optional per-event SFX mapping override.
   * @returns {{
   *   note:number,
   *   notes:number[]|null,
   *   velocity:number,
   *   durationTicks:number,
   *   releaseVelocity:number|null,
   *   timbre:number|null,
   *   pan:number|null,
   *   pitchBend:number,
   *   frequencyHz:number,
   *   channel:number|null,
   *   voiceBudget:number|null,
   *   arp:object|null
   * }|null}
   */
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
    const positionMappings = resolvePositionMappings(positionCfg);
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
      const configuredBendRange = cfg.mpe?.pitchBendRange?.semitones;
      const bendRange = Number.isFinite(configuredBendRange) && configuredBendRange > 0
        ? configuredBendRange
        : 2;
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
      voiceBudget: sfx.voiceBudget ?? null,
      outputId: sfx.outputId ?? null,
      trackId: sfx.trackId ?? null,
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
