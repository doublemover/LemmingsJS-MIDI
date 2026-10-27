import { freezeData } from '../../core/CanonicalData.js';

export const CIRCUIT_WORKSHOP_REVISION = 'original-circuit-workshop-prepared-strikes-v1';
export const CIRCUIT_WORKSHOP_VARIANTS = freezeData({
  clean: { name: 'Clean', bodyScale: 1, noiseScale: 1, frequencyScale: 1, decayScale: 1, lowpassHz: 18000, roomTaps: [] },
  dusty: { name: 'Dusty', bodyScale: 0.98, noiseScale: 0.8, frequencyScale: 0.97, decayScale: 0.82, lowpassHz: 6200, roomTaps: [] },
  'small-room-print': { name: 'Small room · printed finite taps', bodyScale: 1, noiseScale: 1, frequencyScale: 1, decayScale: 1, lowpassHz: 15000, roomTaps: [{ seconds: 0.011, gain: 0.08 }, { seconds: 0.019, gain: 0.05 }, { seconds: 0.029, gain: 0.03 }] },
  industrial: { name: 'Industrial', bodyScale: 1.04, noiseScale: 1.1, frequencyScale: 1.06, decayScale: 1.1, lowpassHz: 19000, roomTaps: [] }
});
export const CIRCUIT_WORKSHOP_VOICES = freezeData([
  { id: 'deep-kick', name: 'Deep kick', gmNote: 36, kind: 'kick', hz: 48, startHz: 150, settleSeconds: 0.065, t60: 0.32, components: 2 },
  { id: 'short-kick', name: 'Short kick', gmNote: 35, kind: 'kick', hz: 58, startHz: 110, settleSeconds: 0.04, t60: 0.14, components: 2 },
  { id: 'snare', name: 'Body and band-noise snare', gmNote: 38, kind: 'snare', hz: 180, t60: 0.13, components: 3 },
  { id: 'short-snare', name: 'Short bright snare', gmNote: 40, kind: 'snare', hz: 210, t60: 0.105, components: 3 },
  { id: 'rim', name: 'Bounded electronic rim', gmNote: 37, kind: 'rim', hz: 880, t60: 0.04, components: 3 },
  { id: 'clap', name: 'Four-lobe composite clap', gmNote: 39, kind: 'clap', hz: 0, t60: 0.1, components: 5 },
  ...[[41, 80, 0.4], [43, 90, 0.36], [45, 110, 0.32], [47, 135, 0.27], [48, 165, 0.22], [50, 200, 0.18]].map(([gmNote, hz, t60]) => ({ id: 'tom-' + gmNote, name: 'Resonant tom ' + hz + ' Hz', gmNote, kind: 'tom', hz, t60, components: 2 })),
  { id: 'closed-hat', name: 'Closed metal hat', gmNote: 42, kind: 'hat', hz: 0, t60: 0.045, components: 7, chokeGroup: 'hats' },
  { id: 'pedal-hat', name: 'Short pedal hat', gmNote: 44, kind: 'hat', hz: 0, t60: 0.03, components: 7, chokeGroup: 'hats' },
  { id: 'open-hat', name: 'Open metal hat', gmNote: 46, kind: 'hat', hz: 0, t60: 0.4, components: 7, chokeGroup: 'hats' },
  { id: 'crash', name: 'Inharmonic noise crash', gmNote: 49, kind: 'crash', hz: 0, t60: 0.75, components: 7 }
]);
