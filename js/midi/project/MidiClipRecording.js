import { getMidiClipVoices, MAX_CLIP_CELL_VOICES } from './MidiClipTransforms.js';

const MAX_MIDI_CLIP_CAPTURE_NOTES = 1024;
// Quantize from the first onset. Monophonic Replace retains the saved last-onset rule.
// Overdub touches captured cells only; same-pitch incoming voices replace that cell's prior pitch.
const buildMidiClipRecording = (notes, { length, tickMs = 60, spacingTicks = 2, minDuration = 1, maxDuration = 960,
  polyphonic = false, mode = 'replace', existingSteps = [] }) => {
  const bounded = notes.slice(0, MAX_MIDI_CLIP_CAPTURE_NOTES);
  const ordered = bounded.filter(note => Number.isFinite(note.onsetMs) && Number.isFinite(note.note))
    .sort((a, b) => a.onsetMs - b.onsetMs || (a.order || 0) - (b.order || 0));
  const steps = Array.from({ length: Math.max(1, Math.min(16, length)) }, (_, index) => mode === 'overdub' && existingSteps[index]
    ? { ...existingSteps[index], ...(existingSteps[index].voices ? { voices: existingSteps[index].voices.map(voice => ({ ...voice })) } : {}), index }
    : { index, note: null, velocity: null, durationTicks: null, probability: 1, hold: false, tie: false });
  let updated = 0, added = 0, collisions = 0, outside = 0, overflow = Math.max(0, notes.length - bounded.length);
  const origin = ordered[0]?.onsetMs || 0, captured = new Map();
  const tick = Math.max(1, Number(tickMs) || 60), spacing = Math.max(1, Number(spacingTicks) || 2);
  for (const note of ordered) {
    const index = Math.round((note.onsetMs - origin) / (tick * spacing));
    if (index < 0 || index >= steps.length) { outside++; continue; }
    const voice = { note: Math.max(0, Math.min(127, Math.round(note.note))),
      velocity: Math.max(1, Math.min(127, Math.round(Number(note.velocity) || 80))),
      durationTicks: Math.max(minDuration, Math.min(maxDuration, Math.max(1, Math.round((Number(note.durationMs) || tick) / tick)))) };
    let voices = captured.get(index);
    if (!voices) { voices = []; captured.set(index, voices); }
    const same = voices.findIndex(old => old.note === voice.note);
    if (!polyphonic) { if (voices.length) collisions++; voices[0] = voice; }
    else if (same >= 0) { collisions++; voices[same] = voice; }
    else if (voices.length < MAX_CLIP_CELL_VOICES) voices.push(voice);
    else overflow++;
  }
  for (const [index, incoming] of captured) {
    const old = steps[index], voices = mode === 'overdub' ? getMidiClipVoices(old).map(voice => ({ ...voice })) : [];
    for (const voice of incoming) {
      const same = voices.findIndex(previous => previous.note === voice.note);
      if (same >= 0) { voices[same] = voice; updated++; }
      else if (voices.length < MAX_CLIP_CELL_VOICES) { voices.push(voice); added++; }
      else overflow++;
    }
    steps[index] = { ...old, ...voices[0], probability: old.probability ?? 1, hold: mode === 'overdub' && !!old.hold, tie: mode === 'overdub' && !!old.tie,
      ...(polyphonic || mode === 'overdub' && (old.voices || voices.length > 1) ? { voices } : {}) };
  }
  return { steps, updated, added, collisions, outside, overflow, cells: captured.size,
    retained: steps.reduce((total, step) => total + getMidiClipVoices(step).length, 0) };
};
export { buildMidiClipRecording, MAX_MIDI_CLIP_CAPTURE_NOTES };
