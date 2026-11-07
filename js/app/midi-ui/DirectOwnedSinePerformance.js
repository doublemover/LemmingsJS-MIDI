import { validateCausalPerformanceState } from '../procgen/workstation/CausalPerformanceState.js';
export function validateDirectOwnedSinePerformance(value) {
  const state = validateCausalPerformanceState(value);
  if (state.lanes.some(lane => lane.materialPalette || Object.keys(lane.controls.macros).length || lane.controls.variationAmount01 || lane.controls.actorTimbreLocks?.length || lane.percussion || lane.orchestral || lane.piano || lane.organ) || state.actorTimbreLocks?.length) throw new Error('The explicit reference sine cannot realize material palettes, authored macros, timbral variation or device-profile controls. Choose an output-off candidate or a supported source.');
  return state;
}
