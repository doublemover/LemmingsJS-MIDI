import { compileSoundRealizationGroups } from './SoundRealizationProfiles.js';
import { cloneData, freezeData, hashData, canonicalDataText } from '../../core/CanonicalData.js';
import { prepareSoundContentPack, planSoundContentSelection, SOUND_CONTENT_SCHEMA } from './SoundContentPack.js';
import { validateEngineDescriptor, validateInstrumentPatchV2 } from './InstrumentPatchV2.js';
import { validateInstrumentMacros } from './InstrumentPerformance.js';
import { sampleMapRenderIdentity } from './SampleInstrumentMap.js';

export const SOUND_RECIPE_SCHEMA = 'lemmings-sound-recipes/v1';
export const SOUND_COMPILER_REVISION = 'typed-recipes-v12';
export const SOUND_REALIZATION_COMPILER_REVISION = 'typed-recipes-v13';
const limits = { maxBytes: 8 * 1048576, maxNodes: 200000, domain: 'Sound recipes' };
const units = new Set(['Hz', 'cents', 'ratio', 'dimensionless', 's', 'ms', 'amplitude-linear', 'dB', 'normalized', 'enum', 'world-pixel', 'octaves', 'cycles', 'count', 'inverse-world-pixel']);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const finite = value => Number.isFinite(value) && Math.abs(value) <= 1000000000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (path, message) => { throw Object.assign(new Error(path + ': ' + message), { name: 'SoundContentCompileError', code: 'invalid-recipe', path }); };
const requireValue = (condition, path, message) => { if (!condition) fail(path, message); };
const before = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function convertSoundQuantity(quantity, targetUnit, path = 'quantity') {
  requireValue(object(quantity) && finite(quantity.value) && units.has(quantity.unit) && units.has(targetUnit), path, 'expected a finite typed quantity');
  requireValue(Object.keys(quantity).every(key => ['value', 'unit', 'conversion'].includes(key)), path, 'unknown typed-quantity field');
  if (quantity.unit === targetUnit) { requireValue(quantity.conversion == null, path, 'same-unit values cannot hide a conversion'); return quantity.value; }
  const conversion = quantity.conversion; requireValue(object(conversion) && conversion.to === targetUnit, path, 'explicit conversion required from ' + quantity.unit + ' to ' + targetUnit);
  requireValue(Object.keys(conversion).every(key => ['kind', 'to', 'inputMin', 'inputMax', 'outputMin', 'outputMax'].includes(key)), path, 'unknown conversion field');
  let result;
  if (conversion.kind === 'db-amplitude' && quantity.unit === 'dB' && targetUnit === 'amplitude-linear') result = 10 ** (quantity.value / 20);
  else if (conversion.kind === 'amplitude-db' && quantity.unit === 'amplitude-linear' && targetUnit === 'dB' && quantity.value > 0) result = 20 * Math.log10(quantity.value);
  else if (conversion.kind === 'period-reciprocal' && ((quantity.unit === 'Hz' && targetUnit === 's') || (quantity.unit === 's' && targetUnit === 'Hz')) && quantity.value > 0) result = 1 / quantity.value;
  else if (conversion.kind === 'cents-ratio' && quantity.unit === 'cents' && targetUnit === 'ratio') result = 2 ** (quantity.value / 1200);
  else if (conversion.kind === 'ratio-cents' && quantity.unit === 'ratio' && targetUnit === 'cents' && quantity.value > 0) result = 1200 * Math.log2(quantity.value);
  else if (conversion.kind === 'milliseconds-seconds' && quantity.unit === 'ms' && targetUnit === 's') result = quantity.value / 1000;
  else if (conversion.kind === 'linear-calibration' && quantity.unit === 'world-pixel' && targetUnit === 'normalized' &&
      [conversion.inputMin, conversion.inputMax, conversion.outputMin, conversion.outputMax].every(finite) && conversion.inputMax > conversion.inputMin &&
      quantity.value >= conversion.inputMin && quantity.value <= conversion.inputMax)
    result = conversion.outputMin + (quantity.value - conversion.inputMin) / (conversion.inputMax - conversion.inputMin) * (conversion.outputMax - conversion.outputMin);
  else fail(path, 'unsupported conversion from ' + quantity.unit + ' to ' + targetUnit);
  requireValue(finite(result), path, 'conversion exceeds the finite parameter domain'); return result;
}

const nativeComponents = descriptor => {
  const roles = descriptor.engineId === 'worklet-wind' ? { exciter: ['windKind', 'airPressure01', 'bite01', 'breathLeak01'], resonator: ['acousticLengthRatio', 'bellOpening01', ...descriptor.parameters.map(spec => spec.id).filter(id => id.startsWith('graft'))], envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01'] } : descriptor.engineId === 'worklet-friction' ? { exciter: ['frictionKind', 'frictionDragSlope', 'frictionPressure01', 'frictionScope', 'frictionAxis', 'frictionRequireSegments'], resonator: ['frictionContact01', 'frictionBodyMix01', ...descriptor.parameters.map(spec => spec.id).filter(id => id.startsWith('graft'))], envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01'] } : descriptor.engineId === 'worklet-texture' ? { exciter: ['textureKind', 'roughnessPerPixel', 'dragSlope', 'shade01', 'textureScope', 'textureAxis', 'textureRequireSegments'], resonator: ['textureBodySeconds', ...descriptor.parameters.map(spec => spec.id).filter(id => id.startsWith('graft'))], envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01'] } : descriptor.engineId === 'worklet-sample' ? {
    exciter: ['sampleLowpassHz', 'sampleVelocityTone01', 'graftExcitationMode', 'graftEnergyBudget', 'graftSupportSeconds', 'graftExcite01'], resonator: descriptor.parameters.map(spec => spec.id).filter(id => id.startsWith('graft') && !['graftExcitationMode', 'graftEnergyBudget', 'graftSupportSeconds', 'graftExcite01'].includes(id)), envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'worklet-seed-layers' ? {
    exciter: ['pitchRatio', 'rootHz', 'reverse', 'transientGain01', 'residualGain01', 'residualT60Seconds'], resonator: ['sustainedGain01', 'position01', 'densityHz', 'grainMilliseconds', 'spread01', 'activity01', 'tone01', 'freezePosition'], envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'worklet-granular' ? {
    exciter: ['pitchRatio', 'regionStart01', 'regionEnd01', 'motionRequired', 'reverse', 'rootHz'],
    resonator: ['position01', 'densityHz', 'grainMilliseconds', 'spread01', 'activity01', 'tone01', 'freezePosition'],
    envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'worklet-spectrum' ? {
    exciter: descriptor.parameters.map(parameter => parameter.id).filter(name => /^partial\d|^partialCount$|^partialDecaySeconds$|^sourceMode$|^circular/.test(name)),
    resonator: ['scan01', 'body01', 'edge01'], envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'worklet-choir' ? {
    exciter: ['breath01', 'chorusCents', 'vibratoCents'], resonator: ['vowel01', 'sizeRatio', 'vowelStep', 'bandwidthScale'],
    envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'worklet-pluck' ? {
    exciter: ['pluckPosition01', 'excitationBrightness01'], resonator: ['stringT60Seconds', 'bodyMix01', 'bodyT60Seconds', 'damping01'],
    envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'native-modal' ? {
    exciter: ['strikePosition01', 'maxBendCents'], resonator: descriptor.parameters.map(parameter => parameter.id).filter(name => /^mode\d|^modeCount$|^bodyT60Seconds$|^bodySizeRatio$/.test(name)),
    envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01']
  } : descriptor.engineId === 'native-fm' ? {
    exciter: ['carrierRatio', 'modulatorRatio', 'dualPair', 'secondaryCarrierRatio', 'secondaryModulatorRatio', 'pitchSettleCents', 'pitchSettleSeconds', 'maxBendCents'],
    modulation: ['indexStart', 'indexEnd', 'indexSeconds', 'secondaryIndexStart', 'secondaryIndexEnd'],
    envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01', 'secondaryMix01']
  } : { exciter: ['waveform'], envelope: ['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds'], output: ['gain01', 'pan01'] };
  if (!['native-oscillator', 'native-fm', 'native-modal', 'native-sample', 'worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers', 'worklet-texture', 'worklet-friction', 'worklet-wind'].includes(descriptor.engineId)) return null;
  return Object.entries(roles).map(([role, parameters]) => ({ id: role, role, parameters: parameters.filter(name => descriptor.parameters.some(spec => spec.id === name)) }));
};

export async function compileSoundContent(raw, { targets = [], signal } = {}) {
  signal?.throwIfAborted(); const source = cloneData(raw, limits);
  requireValue(source.schema === SOUND_RECIPE_SCHEMA && object(source.pack) && Array.isArray(source.recipes) && source.recipes.length > 0 && source.recipes.length <= 256 &&
    Array.isArray(source.files) && source.files.length <= 512 && Array.isArray(targets) && targets.length <= 256, 'recipes', 'unsupported recipe inventory');
  const targetMap = new Map();
  for (const target of targets) {
    const descriptor = validateEngineDescriptor(target.descriptor), key = descriptor.engineId + '@' + descriptor.engineVersion;
    requireValue(!targetMap.has(key), 'targets', 'duplicate allowlisted engine');
    const components = target.components || nativeComponents(descriptor);
    requireValue(Array.isArray(components) && components.length > 0 && components.length <= 32 && components.every(component => id(component.id) &&
      ['exciter', 'resonator', 'envelope', 'modulation', 'effect-send', 'output'].includes(component.role) && Array.isArray(component.parameters) &&
      component.parameters.every(name => descriptor.parameters.some(parameter => parameter.id === name))), 'targets.' + key, 'invalid allowlisted component template');
    targetMap.set(key, { descriptor, components: cloneData(components, limits) });
  }
  const recipes = new Map(), resolved = new Map(), visiting = new Set();
  for (const recipe of source.recipes) {
    requireValue(object(recipe) && id(recipe.id) && !recipes.has(recipe.id) && Number.isSafeInteger(recipe.revision) && recipe.revision > 0 && recipe.revision <= 2147483647 &&
      (recipe.extends == null || id(recipe.extends)), 'recipes', 'invalid or duplicate recipe identity'); recipes.set(recipe.id, recipe);
  }
  const resolve = (recipeId, depth = 0) => {
    if (resolved.has(recipeId)) return resolved.get(recipeId);
    const input = recipes.get(recipeId); requireValue(input && !visiting.has(recipeId) && depth <= 32, 'recipes.' + recipeId, 'inheritance cycle, missing parent or excessive depth'); visiting.add(recipeId);
    const parent = input.extends ? resolve(input.extends, depth + 1) : null;
    const components = new Map((parent?.recipe.components || []).map(component => [component.id, component]));
    requireValue(input.components == null || Array.isArray(input.components) && input.components.length <= 32 && input.components.every(object) && new Set(input.components.map(component => component.id)).size === input.components.length,
      'recipes.' + recipeId + '.components', 'invalid component overrides');
    const overrides = [];
    for (const component of input.components || []) {
      requireValue(object(component) && id(component.id) && object(component.parameters), 'recipes.' + recipeId + '.components', 'invalid component');
      const previous = components.get(component.id);
      for (const parameter of Object.keys(component.parameters)) if (previous && Object.hasOwn(previous.parameters, parameter)) overrides.push(component.id + '.' + parameter);
      components.set(component.id, { ...previous, ...component, parameters: { ...previous?.parameters, ...component.parameters } });
    }
    const recipe = { ...parent?.recipe, ...input, abstract: input.abstract === true,
      components: [...components.values()].sort((left, right) => before(left.id, right.id)) };
    const value = { recipe, inheritance: [...(parent?.inheritance || []), recipeId], overrides };
    visiting.delete(recipeId); resolved.set(recipeId, value); return value;
  };
  const patches = [], artifacts = [];
  for (const recipeId of [...recipes.keys()].sort()) {
    signal?.throwIfAborted(); const { recipe, inheritance, overrides } = resolve(recipeId), path = 'recipes.' + recipeId;
    if (recipe.abstract) continue;
    requireValue(object(recipe.engine) && id(recipe.engine.id) && Number.isSafeInteger(recipe.engine.version), path + '.engine', 'missing engine requirement');
    const target = targetMap.get(recipe.engine.id + '@' + recipe.engine.version); requireValue(target, path + '.engine', 'engine is not an allowlisted compilation target');
    const { descriptor } = target, schema = new Map(descriptor.parameters.map(spec => [spec.id, spec])), parameters = {}, docs = [];
    for (const component of recipe.components) {
      const template = target.components.find(candidate => candidate.id === component.id && candidate.role === component.role);
      requireValue(template, path + '.components.' + component.id, 'component is not supplied by this renderer target');
      for (const [name, quantity] of Object.entries(component.parameters)) {
        const field = path + '.components.' + component.id + '.' + name, spec = schema.get(name);
        requireValue(spec && template.parameters.includes(name) && !Object.hasOwn(parameters, name), field, 'unknown, duplicated or wrong-component parameter');
        const value = convertSoundQuantity(quantity, spec.unit, field);
        requireValue(value >= spec.min && value <= spec.max && (!spec.discrete || Number.isInteger(value)) && (!spec.capability || descriptor.capabilities[spec.capability]), field, 'value exceeds engine domain or capability');
        parameters[name] = value; docs.push({ component: component.id, parameter: name, authored: quantity, effectiveValue: value, unit: spec.unit,
          minimum: spec.min, maximum: spec.max, default: spec.default, liveSafe: spec.liveSafe });
      }
    }
    requireValue(recipe.connections == null || Array.isArray(recipe.connections) && recipe.connections.length === 0, path + '.connections', 'signal rewiring needs a separately qualified typed kernel template');
    const macros = recipe.macros || [], explanations = [];
    requireValue(Array.isArray(macros) && macros.length <= 4 && (!macros.length || descriptor.capabilities.macroPerformance), path + '.macros', 'renderer does not realize these performance macros');
    for (const macro of macros) {
      requireValue(object(macro) && id(macro.id) && typeof macro.name === 'string' && macro.name.length <= 80 && ['onset-only', 'continuous'].includes(macro.mode) &&
        typeof macro.perceptualDirection === 'string' && macro.perceptualDirection.length > 0 && macro.perceptualDirection.length <= 256 && Array.isArray(macro.targets) && macro.targets.length > 0 && macro.targets.length <= 16,
      path + '.macros', 'macro needs typed targets, perceptual direction and application timing');
      const mappings = macro.targets.map(mapping => {
        const spec = schema.get(mapping.parameter), field = path + '.macros.' + macro.id;
        requireValue(spec && (macro.mode !== 'continuous' || spec.liveSafe) && typeof mapping.clamp === 'boolean', field, 'unsupported target or unsafe continuous macro');
        const unit = mapping.composition === 'scale' ? 'ratio' : spec.unit;
        const low = convertSoundQuantity(mapping.minimum, unit, field + '.minimum'), high = convertSoundQuantity(mapping.maximum, unit, field + '.maximum');
        requireValue(['replace', 'add', 'scale'].includes(mapping.composition) && ['linear', 'logarithmic', 'step'].includes(mapping.curve) && low !== high &&
          (mapping.composition !== 'replace' || low >= spec.min && low <= spec.max && high >= spec.min && high <= spec.max), field, 'macro range exceeds its effective parameter domain');
        return { parameter: mapping.parameter, minimum: low, maximum: high, unit, curve: mapping.curve, composition: mapping.composition,
          conversion: { minimum: mapping.minimum.conversion || null, maximum: mapping.maximum.conversion || null }, clamp: mapping.clamp };
      });
      explanations.push({ id: macro.id, name: macro.name, ...(macro.bipolar != null ? { bipolar: macro.bipolar } : {}), ...(macro.momentary != null ? { momentary: macro.momentary } : {}), mode: macro.mode, default01: macro.default01, smoothingMs: macro.smoothingMs, perceptualDirection: macro.perceptualDirection, mappings });
    }
    const authoredModulations = recipe.modulations || [], causalBindings = recipe.causalBindings || [];
    requireValue(Array.isArray(authoredModulations) && authoredModulations.length <= 64 && (!authoredModulations.length || descriptor.capabilities.modulationGraph) && Array.isArray(causalBindings) &&
      (!causalBindings.length || descriptor.capabilities.causalBindings), path, 'renderer does not realize the declared modulation/binding graph');
    const modulations = authoredModulations.map(modulation => {
      requireValue(object(modulation), path + '.modulations', 'expected a bounded modulation record');
      const spec = schema.get(modulation.target); requireValue(spec && units.has(modulation.sourceUnit) && object(modulation.bounds) && finite(modulation.bounds.minimum) && finite(modulation.bounds.maximum) &&
        modulation.bounds.unit === spec.unit && modulation.bounds.minimum >= spec.min && modulation.bounds.maximum <= spec.max && modulation.bounds.maximum >= modulation.bounds.minimum &&
        ['linear', 'logarithmic', 'step'].includes(modulation.curve) && finite(modulation.smoothingMs) && modulation.smoothingMs >= 0, path + '.modulations', 'modulation requires bounded engine-unit output and smoothing');
      return { ...modulation, amount: convertSoundQuantity(modulation.amount, spec.unit, path + '.modulations.' + modulation.id + '.amount') };
    });
    requireValue(recipe.voicePolicy && (!descriptor.maximumVoices || recipe.voicePolicy.maxVoices <= descriptor.maximumVoices) &&
      (!descriptor.voicePolicies || descriptor.voicePolicies.includes(recipe.voicePolicy.steal)), path + '.voicePolicy', 'voice capacity or stealing policy is not realized by this engine');
    let effectiveMacros;
    try { effectiveMacros = validateInstrumentMacros(explanations.map(({ mappings, ...macro }) => ({ ...macro, targets: mappings.map(({ conversion, ...mapping }) => mapping) })), descriptor.parameters); }
    catch (error) { fail(path + '.macros', error.message); }
    let definition;
    try { definition = validateInstrumentPatchV2({ schemaVersion: 2, id: recipe.id, revision: recipe.revision, name: recipe.name, author: recipe.author, tags: recipe.tags || [],
      engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, parameters, modulations, causalBindings,
      ...(recipe.variation ? { variation: recipe.variation } : {}),
      ...(recipe.sampleMap ? { sampleMap: recipe.sampleMap } : {}), ...(recipe.seedLayers ? { seedLayers: recipe.seedLayers } : {}),
      macros: effectiveMacros,
      sampleRefs: recipe.sampleRefs || [], voicePolicy: recipe.voicePolicy, mix: recipe.mix, midiFallback: recipe.midiFallback }, descriptor); }
    catch (error) { fail(path + '.definition', error.message); }
    requireValue(!nativeComponents(descriptor) || definition.voicePolicy.maxVoices <= 64, path + '.voicePolicy', 'native renderer supports at most 64 owned voices');
    const engineRequirement = { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash };
    const dependencies = recipe.dependencies || []; requireValue(Array.isArray(dependencies) && dependencies.length <= 512, path + '.dependencies', 'invalid asset dependency closure');
    const effective = { engineRequirement, parameters: definition.parameters, modulations, causalBindings: definition.causalBindings, sampleRefs: definition.sampleRefs, sampleMap: sampleMapRenderIdentity(definition.sampleMap), ...(definition.seedLayers ? { seedLayers: definition.seedLayers } : {}), dependencies: [...dependencies].sort(),
      macros: definition.macros.map(({ name, perceptualDirection, ...macro }) => macro), variation: definition.variation || null, voicePolicy: definition.voicePolicy, mix: definition.mix };
    const reachable = new Set(dependencies), fileMap = new Map(source.files.map(file => [file.sha256, file]));
    for (const dependency of reachable) { requireValue(reachable.size <= 512, path + '.dependencies', 'asset ancestry exceeds its bounds');
      for (const parent of fileMap.get(dependency)?.parents || []) reachable.add(parent); }
    const renderKey = await hashData(effective, limits), rightsHash = await hashData({ recipe: recipe.rights, sampleMapRightsRef: definition.sampleMap?.rightsRef || null,
      files: [...reachable].sort().map(sha256 => ({ sha256, rights: fileMap.get(sha256)?.rights || null })) }, limits);
    const cost = { maxVoices: definition.voicePolicy.maxVoices, componentCount: recipe.components.length, assetCount: new Set(dependencies).size,
      modulationEdges: modulations.length, sampleZones: definition.sampleMap?.zones.length || 0, estimateClass: 'declared-structure-not-measured-cpu' };
    artifacts.push({ id: recipe.id, revision: recipe.revision, display: { name: recipe.name, author: recipe.author, tags: recipe.tags || [],
      ...(definition.sampleMap ? { sampleMap: { articulations: definition.sampleMap.articulations, normalizationRef: definition.sampleMap.normalizationRef } } : {}) },
    renderKey, rightsHash, engineRequirement, inheritance, overrides, parameters: docs,
    macros: explanations, modulationBounds: modulations.map(modulation => ({ id: modulation.id, sourceUnit: modulation.sourceUnit, bounds: modulation.bounds })),
    cost, audition: { kind: 'real-causal-take-required', effectivePatchHash: renderKey, renderEvidence: 'not-produced' } });
    patches.push({ definition, engineRequirement, dependencies, rights: recipe.rights });
  }
  requireValue(patches.length > 0, 'recipes', 'no concrete instrument recipes');
  let realizationGroups = null;
  if (Object.hasOwn(source, 'realizationGroups')) { try { realizationGroups = await compileSoundRealizationGroups(source.realizationGroups, patches.map(entry => ({ ...entry, artifact: artifacts.find(artifact => artifact.id === entry.definition.id) }))); } catch (error) { fail('realizationGroups', error.message); } }
  const compilerRevision = realizationGroups === null ? SOUND_COMPILER_REVISION : SOUND_REALIZATION_COMPILER_REVISION;
  const normalized = { ...source, recipes: [...source.recipes].sort((left, right) => before(left.id, right.id)), files: [...source.files].sort((left, right) => before(left.path, right.path)) };
  const sourceHash = await hashData(normalized, limits);
  const prepared = await prepareSoundContentPack({ ...source.pack, schema: SOUND_CONTENT_SCHEMA, files: source.files, patches,
    compilation: { compilerRevision, sourceHash, schemaRevision: SOUND_RECIPE_SCHEMA, artifacts, ...(realizationGroups === null ? {} : { realizationGroups }) } }, { engineDescriptors: [...targetMap.values()].map(target => target.descriptor), signal });
  const plan = planSoundContentSelection(prepared, prepared.patches.map(patch => patch.identity));
  requireValue(!plan.missingReferences.length, 'recipes.dependencies', 'required immutable assets or ancestors are missing from the content inventory');
  return freezeData({ schema: 'lemmings-compiled-sound/v1', compilerRevision, sourceHash, prepared, artifacts, ...(realizationGroups === null ? {} : { realizationGroups }),
    qualification: 'compiled-data-not-render-qualified' });
}

export function reviewSoundContentChanges(previous, next) {
  const left = new Map((previous?.artifacts || []).map(artifact => [artifact.id, artifact])), right = new Map(next.artifacts.map(artifact => [artifact.id, artifact]));
  const realizationContracts = output => new Map((output?.realizationGroups || output?.prepared?.pack.compilation?.realizationGroups || []).flatMap(group => group.profiles.map(profile => [profile.patchIdentity, group])));
  const priorRealizations = realizationContracts(previous), nextRealizations = realizationContracts(next);
  return freezeData([...new Set([...left.keys(), ...right.keys()])].sort().map(id => {
    const before = left.get(id), after = right.get(id);
    return { id, state: !before ? 'added' : !after ? 'removed' : before.renderKey !== after.renderKey ? 'effective-render-change' : 'render-equivalent',
      realizationChanged: !!before && !!after && canonicalDataText(priorRealizations.get(id + '@' + before.revision) ?? null).text !== canonicalDataText(nextRealizations.get(id + '@' + after.revision) ?? null).text,
      rightsChanged: !!before && !!after && before.rightsHash !== after.rightsHash,
      metadataChanged: !!before && !!after && JSON.stringify(before.display) !== JSON.stringify(after.display),
      engineChanged: !!before && !!after && JSON.stringify(before.engineRequirement) !== JSON.stringify(after.engineRequirement),
      costChanged: !!before && !!after && JSON.stringify(before.cost) !== JSON.stringify(after.cost), renderKey: after?.renderKey || null };
  }));
}
