import { FRICTION_PRESSURE_DOMAINS } from './FrictionModel.js';
import { WIND_PRESSURE_DOMAINS } from './WindModel.js';

const common = [['level', 'LEVEL', 'gain01', 0, 0.8, 'The source amplitude changes; physical events, lane emphasis and shared return tails remain independent.'],
  ['attack', 'ATTACK', 'attackSeconds', 0.001, 0.12, 'Longer source attack on the next actual onset; no earlier physical time or extra gate is invented.'],
  ['release', 'RELEASE', 'releaseSeconds', 0.002, 0.8, 'Longer release after the next source end; the action/contact lifetime remains physical.'],
  ['balance', 'BALANCE', 'pan01', -1, 1, 'Source stereo balance on the next onset; world listener and camera coordinates remain separate.']];
const profiles = {
  'native-fm': [['ratio', 'RATIO', 'modulatorRatio', 0.5, 8, 'Changes the next source’s FM ratio and sideband pattern, preserving its actual onset and carrier pitch.'], ['color', 'COLOR', 'indexStart', 0, 2, 'Changes the initial modulation index of the next source.'], ...common],
  'native-modal': [['strike', 'STRIKE', 'strikePosition01', 0, 1, 'Interpolates the two authored strike responses on the next body; this does not move the actor or measured contact.'], ['size', 'SIZE', 'bodySizeRatio', 0.5, 2, 'Changes the authored modal size/tuning scale of the next body, independently of terrain geometry.'], ...common],
  'worklet-pluck': [['pick', 'PICK', 'pluckPosition01', 0.1, 0.45, 'Changes the next excitation position on the authored string.'], ['damping', 'DAMPING', 'damping01', 0, 1, 'Adds positive loss to the next string source; it does not restore already lost energy.'], ['body', 'BODY', 'bodyMix01', 0, 0.5, 'Changes the next source’s existing body readout mix.'], ...common],
  'worklet-choir': [['vowel', 'VOWEL', 'vowel01', 0, 1, 'Changes the next source’s authored vowel interpolation, independently of fundamental pitch.'], ['size', 'SIZE', 'sizeRatio', 0.8, 1.4, 'Moves the next source’s formant size ratio without changing actor size.'], ['width', 'WIDTH', 'chorusCents', 0, 8, 'Changes bounded internal detuning on the next choir source; this is separate from actor identity variation.'], ...common],
  'worklet-spectrum': [['scan', 'SCAN', 'scan01', 0, 1, 'Selects the next source’s prepared neighboring spectral frames without constructing tables during playback.'], ['body', 'BODY', 'body01', 0, 1, 'Changes the next source’s existing fundamental/partial emphasis.'], ['edge', 'EDGE', 'edge01', 0, 1, 'Changes the next source’s existing bounded edge/filter color.'], ...common],
  'worklet-friction': [['press', 'PRESS', 'frictionPressure01', null, null, 'Changes the next intact friction source’s normalized pressure within its exact model domain.'], ['drag', 'DRAG', 'frictionDragSlope', 0, 1, 'Changes the next model’s friction-response slope; actual movement still supplies all bow work.'], ['contact', 'CONTACT', 'frictionContact01', 0.1, 0.45, 'Changes the authored contact point of the next friction body, not the observed actor coordinate.'], ['body', 'BODY', 'frictionBodyMix01', 0, 1, 'Changes the next source’s declared body observation mix.'], ...common],
  'worklet-wind': [['air', 'AIR', 'airPressure01', null, null, 'Changes the next intact wind source’s normalized pressure within its exact model domain.'], ['bite', 'BITE', 'bite01', 0.35, 0.65, 'Changes the next wind model’s nonlinear exciter response.'], ['length', 'LENGTH', 'acousticLengthRatio', 0.75, 1.25, 'Changes the next authored acoustic length/tuning ratio, independently of route distance.'], ['leak', 'LEAK', 'breathLeak01', 0, 1, 'Changes the next wind model’s declared loss/leak parameter.'], ...common],
  'worklet-texture': [['roughness', 'ROUGHNESS', 'roughnessPerPixel', 0.2, 0.8, 'Changes the next texture’s spatial roughness; actual travel remains the only excitation coordinate.'], ['drag', 'DRAG', 'dragSlope', 0, 1, 'Changes the next spatial excitation’s drag law.'], ['shade', 'SHADE', 'shade01', 0, 1, 'Changes the next texture source’s authored shade.'], ['body', 'BODY', 'textureBodySeconds', 0.02, 0.25, 'Changes the next source’s declared texture-body duration.'], ...common],
  'worklet-granular': [['scan', 'SCAN', 'position01', 0, 1, 'Selects the next source’s normalized prepared sample position.'], ['density', 'DENSITY', 'densityHz', 0, 24, 'Changes the next observed source’s admitted grain density; no actor source is invented.'], ['grain', 'GRAIN', 'grainMilliseconds', 20, 140, 'Changes the next source’s grain window duration in milliseconds.'], ['tone', 'TONE', 'tone01', 0, 1, 'Changes the next prepared grain source’s declared filter color.'], ...common]
};

export function authorScenePerformanceMacros(definition, descriptor) {
  const macros = [...(definition.macros || [])]; if (macros.length >= 4 || descriptor.capabilities?.macroPerformance !== true) return definition;
  const ids = new Set(macros.map(macro => macro.id)), targets = new Set(macros.flatMap(macro => macro.targets.map(target => target.parameter))), parameters = definition.parameters || {};
  for (const [id, name, parameter, minimum, maximum, direction] of profiles[definition.engineId] || common) {
    if (macros.length >= 4) break;
    const spec = descriptor.parameters.find(spec => spec.id === parameter); if (!spec || spec.discrete || ids.has(id) || targets.has(parameter)) continue;
    const base = parameters[parameter] ?? spec.default, domain = parameter === 'airPressure01' ? WIND_PRESSURE_DOMAINS[parameters.windKind ?? 0] : parameter === 'frictionPressure01' ? FRICTION_PRESSURE_DOMAINS[parameters.frictionKind ?? 0] : null,
      low = Math.max(spec.min, domain?.[0] ?? Math.min(minimum, base)), high = Math.min(spec.max, domain?.[1] ?? Math.max(maximum, base));
    if (!Number.isFinite(base) || !Number.isFinite(low) || !Number.isFinite(high) || low >= high || base < low || base > high) continue;
    macros.push({ id, name, mode: 'onset-only', default01: (base - low) / (high - low), smoothingMs: 0, perceptualDirection: direction,
      targets: [{ parameter, unit: spec.unit, minimum: low, maximum: high, curve: 'linear', composition: 'replace', clamp: true }] }); ids.add(id); targets.add(parameter);
  }
  return { ...definition, macros };
}
