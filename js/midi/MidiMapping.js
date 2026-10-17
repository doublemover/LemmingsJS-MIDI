import { applyMidiAutomationSpanValues } from './midi-mapping/MidiAutomationSpanValues.js';
import { applyMidiEnsembleToSpec } from './project/MidiEnsemble.js';
import { resolveMidiLaneScheme, laneSchemeSource } from './midi-mapping/MidiLaneSchemes.js';
import { sanitizeMidiLaneMusic } from './project/MidiLaneMusic.js';
import { positionCurveValue } from './midi-mapping/PositionCurve.js';
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
    if (this.config.laneMusic) this.config.laneMusic = sanitizeMidiLaneMusic(this.config.laneMusic);
    this.laneSchemes = new Map();
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

  applySpanValues(spec, values) { return applyMidiAutomationSpanValues(spec, values, this.config); }

  eventConfig(event) { return resolveMidiLaneScheme(this.config, event, this.laneSchemes); }

  getTriggerConfig(event) {
    const key = String(event?.triggerType), original = this.config.triggers?.[key], resolved = this.eventConfig(event);
    return resolved === this.config ? original : laneSchemeSource(original, resolved.triggers?.[key]);
  }

  getSfxConfig(sfxId, event = null) {
    if (sfxId == null) return null;
    const original = this.config.sfx?.[String(sfxId)], resolved = this.eventConfig(event);
    const configured = resolved === this.config ? original : laneSchemeSource(original, resolved.sfx?.[String(sfxId)]);
    if (configured != null) return configured;
    if (sfxId === 26 || sfxId === 27 || sfxId === 28) {
      return { note: sfxId === 27 ? 67 : 60, durationTicks: 2, velocity: 72 };
    }
    return null;
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
   *   spatialPan:boolean,
   *   pitchBend:number,
   *   frequencyHz:number,
   *   channel:number|null,
   *   voiceBudget:number|null,
   *   arp:object|null
   * }|null}
   */
  mapEvent(event, context = {}, density = 0, overrideSfx = null) {
    if (!this.config.enabled || !event) return null;
    const sfx = overrideSfx || this.getSfxConfig(event.sfxId, event) || {};
    const cfg = sfx.clipSequence ? this.config : this.eventConfig(event), percussion = sfx.percussion === true;
    if (sfx.disabled) return null;

    const noteRange = percussion ? { min: 0, max: 127 } : cfg.noteRange || DEFAULT_CONFIG.noteRange;
    const velocityRange = cfg.velocityRange || DEFAULT_CONFIG.velocityRange;
    const durationCfg = cfg.durationTicks || DEFAULT_CONFIG.durationTicks;
    const densityCfg = cfg.density || DEFAULT_CONFIG.density;
    const positionCfg = cfg.position || DEFAULT_CONFIG.position;
    const scale = resolveScale(percussion ? { name: 'chromatic', root: 0 } : cfg.scale);
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
        noteOffset = (noteOffset ?? 0) + positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'velocity':
        range = resolveRange(entry, velMin, velMax);
        velocityOverride = positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'timbre':
        range = resolveRange(entry, tMin, tMax);
        timbreOverride = positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'pan':
        range = resolveRange(entry, pMin, pMax);
        panOverride = positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'duration':
        range = resolveRange(entry, durationCfg.min ?? 1, durationCfg.max ?? 24);
        durationOverride = positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'pitchBend':
        range = resolveRange(entry, -1, 1);
        pitchBendOverride = positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'attack':
      case 'decay':
      case 'release':
        range = resolveRange(entry, 0, 2);
        envelopeOverrides[target] = positionCurveValue(entry, axisValue, range.min, range.max);
        return;
      case 'sustain':
        range = resolveRange(entry, 0.25, 2);
        envelopeOverrides[target] = positionCurveValue(entry, axisValue, range.min, range.max);
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
    let pitchBend = Number.isFinite(sfx.pitchBend) ? clamp(sfx.pitchBend, -1, 1) : 0;

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

    if (pitchBendOverride != null && !Number.isFinite(sfx.pitchBend) && !(Number.isFinite(sfx.frequencyHz) && sfx.frequencyHz > 0)) {
      pitchBend = clamp(pitchBendOverride, -1, 1);
    }

    const transposeAbsolute = cfg.laneMusic && cfg.laneMusic.pitchEnabled !== false && !percussion && !Number.isFinite(sfx.frequencyHz);
    const reference = cfg.laneReferenceRoot ?? cfg.laneMusic?.referenceRoot ?? scale.root;
    const transpose = transposeAbsolute ? ((scale.root - reference + 18) % 12) - 6 : 0;
    const tune = pitch => clampNoteToRange(quantizeToScale(pitch + transpose, scale), noteRange);
    let notes = null;
    if (Array.isArray(sfx.notes) && sfx.notes.length) {
      notes = sfx.notes.map(n => transposeAbsolute ? tune(n) : clampNoteToRange(n, noteRange));
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
      note = quantizeToScale(note + transpose, scale);
      note = clampNoteToRange(note, noteRange);
    }
    if (!percussion && Number.isFinite(noteOffset) && noteOffset !== 0) {
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

    let timbre = Number.isFinite(sfx.timbre) ? Math.round(clamp(sfx.timbre, 0, 127)) : null;
    if (timbre == null && timbreOverride != null) {
      const tMin = positionCfg.timbreRange?.min ?? 0;
      const tMax = positionCfg.timbreRange?.max ?? 127;
      const tLow = Math.min(tMin, tMax);
      const tHigh = Math.max(tMin, tMax);
      timbre = Math.round(clamp(timbreOverride, tLow, tHigh));
    }

    let pan = Number.isFinite(sfx.pan) ? Math.round(clamp(sfx.pan, -127, 127)) : null;
    if (pan == null && panOverride != null) {
      const pMin = positionCfg.panRange?.min ?? -127;
      const pMax = positionCfg.panRange?.max ?? 127;
      const pLow = Math.min(pMin, pMax);
      const pHigh = Math.max(pMin, pMax);
      pan = Math.round(clamp(panOverride, pLow, pHigh));
    } else if (pan == null && positionCfg.viewPan && Number.isFinite(event.x)) {
      const viewRect = positionCfg.panMode === 'level' ? null : context.viewRect;
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
          const offNorm = offRange > 0 ? Math.min(offDist / (viewWidth * offRange), 1) : (offDist > 0 ? 1 : 0);
          const panPercent = positionCfg.panMode === 'level' ? Math.min(absDx / halfW, 1)
            : Math.min((onScale * onNorm) + (offScale * offNorm), 1);
          const pMin = positionCfg.panRange?.min ?? -127;
          const pMax = positionCfg.panRange?.max ?? 127;
          const panMax = Math.max(Math.abs(pMin), Math.abs(pMax)) || 127;
          pan = Math.round(sign * panPercent * panMax);
        }
      }
    }

    if (!percussion && event.type === 'bomber-countdown' && Number.isInteger(event.countdownNumber)) {
      note = clamp(quantizeToScale(note + (clamp(event.countdownNumber, 1, 5) - 1) * 3, scale),
        Math.max(0, noteRange.min), Math.min(127, noteRange.max));
      notes = null;
    }
    const frequencyHz = sfx.frequencyHz ?? noteToFrequency(note);

    if (percussion) {
      const variation = cfg.laneMusic?.variation || 'balanced';
      const phase = Math.abs(Math.trunc(event.tick || 0) + Math.trunc(event.laneIndex || 0) * 3 + Math.trunc(event.lemmingId || 0)) % 8;
      if (variation === 'steady') notes = null;
      else velocity = clamp(Math.round(velocity * (phase === 0 ? 1.15 : phase % 2 ? variation === 'animated' ? 0.62 : 0.82 : 1)), 1, 127);
    }
    const result = applyMidiEnsembleToSpec({
      note,
      notes,
      velocity,
      durationTicks,
      releaseVelocity,
      timbre: percussion ? null : timbre,
      pan,
      spatialPan: pan != null && !Number.isFinite(sfx.pan),
      ...(Number.isFinite(sfx.pan) || panOverride != null || positionCfg.viewPan && Number.isFinite(pan) ? { explicitPan: true } : {}),
      pitchBend: percussion ? null : pitchBend,
      frequencyHz,
      channel: percussion ? 10 : sfx.channel ?? null,
      ...(percussion ? { percussion: true, program: null } : Number.isInteger(sfx.program) ? { program: sfx.program } : {}),
      voiceBudget: sfx.voiceBudget ?? null,
      outputId: sfx.outputId ?? null,
      trackId: sfx.trackId ?? null,
      arp: sfx.arp ?? null,
      phrase: sfx.phrase ?? null
    }, event, percussion ? { ...cfg, ensemble: null } : cfg, sfx);
    if (result && cfg !== this.config && sfx.outputId != null) result.outputId = sfx.outputId;
    if (result && !result.percussion && cfg.laneMusic?.spread && Number.isInteger(event.laneIndex) && event.laneCount > 1) {
      const position = Math.max(0, Math.min(1, event.laneIndex / (event.laneCount - 1))) - 0.5;
      const offset = Math.round(position * cfg.laneMusic.spread), spread = pitch => clampNoteToRange(quantizeToScale(pitch + offset, scale), noteRange);
      result.note = spread(result.note); if (result.notes) result.notes = result.notes.map(spread);
      result.frequencyHz = noteToFrequency(result.note);
    }
    return result;
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
