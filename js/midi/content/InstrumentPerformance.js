import { applyInstrumentVariation, validateInstrumentVariation } from './InstrumentIdentityVariation.js';
import { validateActorTimbreLocks, MAX_ACTOR_PATCH_LOCKS } from './InstrumentActorLocks.js';
const object = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const finite = (value, minimum, maximum) => Number.isFinite(value) && value >= minimum && value <= maximum;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const fail = message => { throw new TypeError('Instrument performance: ' + message); };

export function validateInstrumentMacros(input, parameters) {
  if (!Array.isArray(input) || input.length > 4 || !Array.isArray(parameters)) fail('invalid macro inventory');
  const schema = new Map(parameters.map(parameter => [parameter.id, parameter])), ids = new Set(), replacements = new Set();
  return Object.freeze(input.map(macro => {
    if (!object(macro) || !id(macro.id) || ids.has(macro.id) || typeof macro.name !== 'string' || !macro.name || macro.name.length > 80 ||
        !['onset-only', 'continuous'].includes(macro.mode) || macro.bipolar != null && typeof macro.bipolar !== 'boolean' || macro.momentary != null && typeof macro.momentary !== 'boolean' || !finite(macro.default01, 0, 1) || !finite(macro.smoothingMs, 0, 60000) ||
        typeof macro.perceptualDirection !== 'string' || !macro.perceptualDirection || macro.perceptualDirection.length > 256 ||
        !Array.isArray(macro.targets) || !macro.targets.length || macro.targets.length > 16 || macro.mode === 'onset-only' && macro.smoothingMs !== 0) fail('macro requires typed curves, defaults and timing');
    ids.add(macro.id); const targets = new Set();
    const mappings = macro.targets.map(mapping => {
      const parameter = object(mapping) && schema.get(mapping.parameter);
      if (!parameter || targets.has(mapping.parameter) || macro.mode === 'continuous' && !parameter.liveSafe ||
          !['replace', 'add', 'scale'].includes(mapping.composition) || !['linear', 'logarithmic', 'step'].includes(mapping.curve) || mapping.clamp !== true ||
          mapping.unit !== (mapping.composition === 'scale' ? 'ratio' : parameter.unit) || !finite(mapping.minimum, -1000000, 1000000) ||
          !finite(mapping.maximum, -1000000, 1000000) || mapping.minimum === mapping.maximum ||
          mapping.curve === 'logarithmic' && Math.min(mapping.minimum, mapping.maximum) <= 0 ||
          parameter.discrete && (mapping.curve !== 'step' || !Number.isInteger(mapping.minimum) || !Number.isInteger(mapping.maximum))) fail('invalid typed macro target');
      if (mapping.composition === 'replace' && (!finite(mapping.minimum, parameter.min, parameter.max) || !finite(mapping.maximum, parameter.min, parameter.max) || replacements.has(mapping.parameter)))
        fail('replacement domain or ownership conflict');
      if (mapping.composition === 'replace') replacements.add(mapping.parameter);
      targets.add(mapping.parameter);
      return Object.freeze({ parameter: mapping.parameter, minimum: mapping.minimum, maximum: mapping.maximum, unit: mapping.unit,
        curve: mapping.curve, composition: mapping.composition, clamp: true });
    });
    return Object.freeze({ id: macro.id, name: macro.name, ...(macro.bipolar != null ? { bipolar: macro.bipolar } : {}), ...(macro.momentary != null ? { momentary: macro.momentary } : {}), mode: macro.mode, default01: macro.default01, smoothingMs: macro.smoothingMs,
      perceptualDirection: macro.perceptualDirection, targets: Object.freeze(mappings) });
  }).sort(order));
}

export function validateInstrumentControls(input = {}) {
  if (!object(input) || Object.keys(input).some(key => !['macros', 'variationAmount01', 'variationSeed', 'actorTimbreLocks'].includes(key)) || !object(input.macros || {}) || Object.keys(input.macros || {}).length > 4 ||
      input.variationAmount01 != null && !finite(input.variationAmount01, 0, 1) || input.variationSeed != null && (!Number.isSafeInteger(input.variationSeed) || !finite(input.variationSeed, -2147483648, 2147483647))) fail('invalid performer controls');
  const macros = Object.create(null);
  for (const [key, value] of Object.entries(input.macros || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!id(key) || !finite(value, 0, 1)) fail('macro overrides require normalized finite values'); macros[key] = value;
  }
  return Object.freeze({ macros: Object.freeze({ ...macros }), ...(input.variationAmount01 != null ? { variationAmount01: input.variationAmount01 } : {}),
    ...(input.variationSeed != null ? { variationSeed: input.variationSeed } : {}),
    ...(Object.hasOwn(input, 'actorTimbreLocks') ? { actorTimbreLocks: validateActorTimbreLocks(input.actorTimbreLocks, MAX_ACTOR_PATCH_LOCKS) } : {}) });
}

const physicalInputs = Object.freeze({ TerrainWorkCommitted: Object.freeze({ attemptedCells: 'cells', changedSolidCells: 'cells', changedAppearanceCells: 'cells' }),
  MotionCommitted: Object.freeze({ displacementPixels: 'world-pixel', positionXWorldPixels: 'world-pixel', positionYWorldPixels: 'world-pixel', displacementXWorldPixels: 'world-pixel', displacementYWorldPixels: 'world-pixel' }), ContactResolved: Object.freeze({ stepHeightPixels: 'world-pixel' }) });
export const INSTRUMENT_PHYSICAL_SOURCE_KINDS = Object.freeze(Object.keys(physicalInputs));
export const INSTRUMENT_PHYSICAL_QUANTITIES = Object.freeze(Object.entries(physicalInputs).flatMap(([sourceKind, fields]) => Object.entries(fields).map(([payloadField, unit]) =>
  Object.freeze({ id: sourceKind + '.' + payloadField, sourceKind, payloadField, unit, evidence: 'completed-world-fact',
    group: sourceKind === 'TerrainWorkCommitted' ? 'action' : sourceKind === 'ContactResolved' ? 'contact' : 'actor',
    scope: 'causal-voice-owner', coordinate: payloadField.startsWith('position') ? 'world-coordinate' : payloadField.startsWith('displacement') ? 'observed-displacement;not-route-distance' : 'completed-physical-quantity' }))));

const validateBindingScope = raw => {
  if (raw === undefined) return undefined;
  if (!object(raw) || !['voice-owner', 'actor'].includes(raw.kind) || Object.keys(raw).some(key => !(raw.kind === 'actor' ? ['kind', 'worldId', 'generation', 'actorId'] : ['kind']).includes(key)) ||
      raw.kind === 'actor' && (typeof raw.worldId !== 'string' || !raw.worldId || raw.worldId.length > 160 ||
        !Number.isSafeInteger(raw.generation) || raw.generation < 0 || !Number.isSafeInteger(raw.actorId) || raw.actorId < 0)) fail('invalid physical mapping scope');
  return Object.freeze({ ...raw });
};
export function evaluateInstrumentBinding(binding, sourceValue, output = null) {
  if (!finite(sourceValue, -1000000000, 1000000000)) fail('invalid physical mapping input');
  const normalizedInput = clamp((sourceValue - binding.inputMin) / (binding.inputMax - binding.inputMin), 0, 1), deadZone = binding.deadZone01 || 0;
  let transformedInput = normalizedInput;
  if (deadZone) {
    const distance = normalizedInput - 0.5;
    transformedInput = Math.abs(distance) <= deadZone ? 0.5 : 0.5 + Math.sign(distance) * (Math.abs(distance) - deadZone) / (0.5 - deadZone) * 0.5;
  }
  const mappedValue = binding.curve === 'step' ? transformedInput < 0.5 ? binding.outputMin : binding.outputMax : binding.curve === 'logarithmic' ?
    binding.outputMin * (binding.outputMax / binding.outputMin) ** transformedInput : binding.outputMin + (binding.outputMax - binding.outputMin) * transformedInput;
  const result = output || {};
  result.normalizedInput = normalizedInput; result.transformedInput = transformedInput; result.mappedValue = mappedValue;
  result.inputClamped = sourceValue < binding.inputMin || sourceValue > binding.inputMax;
  return output ? result : Object.freeze(result);
}

export function captureInstrumentCause(fact) {
  if (!Object.hasOwn(physicalInputs, fact?.kind)) return null;
  const values = {};
  for (const [field, unit] of Object.entries(physicalInputs[fact.kind])) { const value = fact.physicalPayload?.[field];
    if (fact.kind === 'MotionCommitted' && ['positionXWorldPixels', 'positionYWorldPixels', 'displacementXWorldPixels', 'displacementYWorldPixels'].includes(field)) continue;
    if (finite(value, -1000000000, 1000000000)) values[field] = Object.freeze({ value, unit }); }
  if (fact.kind === 'MotionCommitted' && finite(fact.positionAfter?.x, -1000000000, 1000000000)) values.positionXWorldPixels = Object.freeze({ value: fact.positionAfter.x, unit: 'world-pixel' });
  if (fact.kind === 'MotionCommitted' && finite(fact.positionAfter?.y, -1000000000, 1000000000)) values.positionYWorldPixels = Object.freeze({ value: fact.positionAfter.y, unit: 'world-pixel' });
  if (fact.kind === 'MotionCommitted') for (const [axis, field] of [['x', 'displacementXWorldPixels'], ['y', 'displacementYWorldPixels']]) if (finite(fact.positionBefore?.[axis], -1000000000, 1000000000) && finite(fact.positionAfter?.[axis], -1000000000, 1000000000)) values[field] = Object.freeze({ value: fact.positionAfter[axis] - fact.positionBefore[axis], unit: 'world-pixel' });
  return Object.freeze({ sourceKind: fact.kind, eventId: fact.eventId, evidence: 'completed-world-fact', values: Object.freeze(values) });
}

export function retainInstrumentCause(input) {
  if (!object(input) || !Object.hasOwn(physicalInputs, input.sourceKind) || input.evidence !== 'completed-world-fact' ||
      typeof input.eventId !== 'string' || !input.eventId || input.eventId.length > 512 || !object(input.values)) fail('invalid completed control observation');
  const values = {};
  for (const [field, unit] of Object.entries(physicalInputs[input.sourceKind])) {
    const source = input.values[field]; if (source == null) continue;
    if (!object(source) || source.unit !== unit || !finite(source.value, -1000000000, 1000000000)) fail('invalid completed control measurement');
    values[field] = Object.freeze({ value: source.value, unit });
  }
  return Object.freeze({ sourceKind: input.sourceKind, eventId: input.eventId, evidence: 'completed-world-fact', values: Object.freeze(values) });
}

export function validateInstrumentBindings(input, parameters) {
  if (!Array.isArray(input) || input.length > 64) fail('invalid physical binding inventory');
  const schema = new Map(parameters.map(parameter => [parameter.id, parameter])), ids = new Set();
  return Object.freeze(input.map(binding => {
    const parameter = object(binding) && schema.get(binding.target);
    if (!parameter || parameter.discrete || !id(binding.id) || ids.has(binding.id) || !Object.hasOwn(physicalInputs, binding.sourceKind) || !id(binding.payloadField) ||
        typeof binding.unit !== 'string' || physicalInputs[binding.sourceKind]?.[binding.payloadField] !== binding.unit ||
        !finite(binding.inputMin, -1000000000, 1000000000) || !finite(binding.inputMax, -1000000000, 1000000000) || binding.inputMin >= binding.inputMax ||
        !['linear', 'logarithmic', 'step'].includes(binding.curve) || !['replace', 'add', 'scale'].includes(binding.composition) || !['onset-only', 'continuous'].includes(binding.mode) ||
        !finite(binding.smoothingMs, 0, 60000) || (binding.mode === 'onset-only' ? binding.smoothingMs !== 0 : parameter.causalLiveSafe !== true) ||
        binding.outputUnit !== (binding.composition === 'scale' ? 'ratio' : parameter.unit) || !finite(binding.outputMin, -1000000, 1000000) || !finite(binding.outputMax, -1000000, 1000000) ||
        binding.outputMin === binding.outputMax || binding.curve === 'logarithmic' && Math.min(binding.outputMin, binding.outputMax) <= 0 ||
        binding.enabled !== undefined && typeof binding.enabled !== 'boolean' || binding.deadZone01 !== undefined && !finite(binding.deadZone01, 0, 0.49) ||
        binding.composition === 'replace' && (!finite(binding.outputMin, parameter.min, parameter.max) || !finite(binding.outputMax, parameter.min, parameter.max))) fail('invalid typed completed-fact binding');
    ids.add(binding.id);
    return Object.freeze({ id: binding.id, sourceKind: binding.sourceKind, payloadField: binding.payloadField, target: binding.target, unit: binding.unit,
      inputMin: binding.inputMin, inputMax: binding.inputMax, outputMin: binding.outputMin, outputMax: binding.outputMax, outputUnit: binding.outputUnit,
      curve: binding.curve, composition: binding.composition, mode: binding.mode, smoothingMs: binding.smoothingMs,
      ...(binding.enabled === undefined ? {} : { enabled: binding.enabled }), ...(binding.deadZone01 === undefined ? {} : { deadZone01: binding.deadZone01 }),
      ...(binding.sourceScope === undefined ? {} : { sourceScope: validateBindingScope(binding.sourceScope) }) });
  }).sort(order));
}

export function compileInstrumentPerformance(patch, parameters) {
  const macros = validateInstrumentMacros(patch.macros || [], parameters);
  const variation = validateInstrumentVariation(patch.variation, parameters), bindings = validateInstrumentBindings(patch.causalBindings || [], parameters);
  const base = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.default]));
  for (const [key, value] of Object.entries(patch.parameters)) {
    const parameter = parameters.find(entry => entry.id === key);
    if (!parameter || !finite(value, parameter.min, parameter.max) || parameter.discrete && !Number.isInteger(value)) fail('invalid base value'); base[key] = value;
  }
  const macroIds = new Set(macros.map(macro => macro.id)), schema = new Map(parameters.map(parameter => [parameter.id, parameter]));
  const mappings = macros.flatMap(macro => macro.targets.map(target => ({ macro, target })));
  // Replacements establish the authored value before stable-ID additions/scales.
  mappings.sort((a, b) => Number(b.target.composition === 'replace') - Number(a.target.composition === 'replace') || order(a.macro, b.macro));
  const transformedBinding = { normalizedInput: 0, transformedInput: 0, mappedValue: 0, inputClamped: false };
  const applyBindings = (selected, causes, values, deltas, applyFrame, identity = null) => {
    const outcomes = [];
    for (const binding of selected) {
      if (binding.enabled === false) { outcomes.push(Object.freeze({ id: binding.id, state: 'disabled' })); continue; }
      const scope = binding.sourceScope;
      if (scope?.kind === 'actor' && (!identity || scope.worldId !== identity.worldId || scope.generation !== identity.generation || scope.actorId !== identity.actorId)) {
        outcomes.push(Object.freeze({ id: binding.id, state: identity ? 'outside-named-actor-scope' : 'actor-scope-unavailable' })); continue;
      }
      const cause = causes.find(item => item?.sourceKind === binding.sourceKind && item.evidence === 'completed-world-fact'), source = cause?.values?.[binding.payloadField];
      if (!source || source.unit !== binding.unit || !finite(source.value, -1000000000, 1000000000)) { outcomes.push(Object.freeze({ id: binding.id, state: 'no-qualified-source' })); continue; }
      const transformed = evaluateInstrumentBinding(binding, source.value, transformedBinding), mapped = transformed.mappedValue;
      const previous = values[binding.target], requested = binding.composition === 'replace' ? mapped : binding.composition === 'add' ? previous + mapped : previous * mapped;
      values[binding.target] = requested; outcomes.push(Object.freeze({ id: binding.id, state: 'applied', sourceEventId: cause.eventId, sourceValue: source.value, sourceUnit: source.unit,
        normalizedInput: transformed.normalizedInput, transformedInput: transformed.transformedInput, mappedContribution: mapped, inputClamped: transformed.inputClamped }));
      deltas.push({ parameterId: binding.target, unit: schema.get(binding.target).unit, requestedValue: requested, origin: 'physical', bindingId: binding.id,
        composition: binding.composition, applyFrame, interpolation: binding.mode === 'continuous' ? 'bounded-causal-slew' : 'onset-only', smoothingMs: binding.smoothingMs });
    }
    return outcomes;
  };
  const finalize = (values, deltas) => {
    const requested = { ...values };
    for (const parameter of parameters) { if (!Number.isFinite(values[parameter.id])) fail('composition exceeds finite effective controls');
      const value = clamp(values[parameter.id], parameter.min, parameter.max); values[parameter.id] = parameter.discrete ? Math.round(value) : value; }
    return { values: Object.freeze(values), deltas: Object.freeze(deltas.map(delta => Object.freeze({ ...delta,
      effectiveValue: values[delta.parameterId], clamped: requested[delta.parameterId] !== values[delta.parameterId] }))) };
  };
  const continuous = bindings.filter(binding => binding.mode === 'continuous'), onset = bindings.filter(binding => binding.mode === 'onset-only');
  const heldMacros = macros.filter(macro => macro.mode === 'continuous'), heldIds = new Set(heldMacros.flatMap(macro => macro.targets.map(target => target.parameter)));
  const plan = { continuousMacroIds: Object.freeze(heldMacros.map(macro => macro.id)), continuousParameterIds: Object.freeze([...heldIds].sort()),
    continuousSourceKinds: Object.freeze([...new Set(continuous.filter(binding => binding.enabled !== false).map(binding => binding.sourceKind))]),
    resolveHeld(onset, input, identity, causes, applyFrame) {
      if (!object(onset?.controls) || !Array.isArray(causes)) fail('held controls require the admitted onset');
      const requested = validateInstrumentControls(input), merged = { ...onset.controls.macros };
      if (Object.keys(requested.macros).some(key => !macroIds.has(key))) fail('unknown held macro');
      for (const macro of heldMacros) merged[macro.id] = requested.macros[macro.id] ?? macro.default01;
      const next = plan.resolve({ ...onset.controls, macros: merged }, applyFrame, identity), physical = plan.resolveContinuous(next.continuousBase, causes, applyFrame, identity);
      const deltas = [...next.deltas.filter(delta => heldIds.has(delta.parameterId) && delta.origin !== 'physical'), ...physical.deltas];
      return Object.freeze({ ...next, revision: 'typed-held-controls-v1', values: physical.values, deltas: Object.freeze(deltas.map(delta => Object.freeze({ ...delta, effectiveValue: physical.values[delta.parameterId] }))),
        bindingOutcomes: physical.bindingOutcomes, smoothingMs: Math.max(physical.smoothingMs, ...heldMacros.map(macro => macro.smoothingMs), 0),
        parameterIds: Object.freeze([...new Set([...heldIds, ...physical.deltas.map(delta => delta.parameterId)])].sort()) });
    },
    resolveContinuous(baseline, causes, applyFrame, identity = null) {
      if (!object(baseline) || !Array.isArray(causes) || causes.length > Object.keys(physicalInputs).length || !Number.isSafeInteger(applyFrame) || applyFrame < 0 ||
          new Set(causes.map(cause => cause?.sourceKind)).size !== causes.length || causes.some(cause => !Object.hasOwn(physicalInputs, cause?.sourceKind))) fail('invalid continuous control source');
      const values = { ...baseline }, deltas = [], bindingOutcomes = applyBindings(continuous, causes, values, deltas, applyFrame, identity);
      const result = finalize(values, deltas);
      return Object.freeze({ revision: 'typed-continuous-bindings-v1', ...result, bindingOutcomes: Object.freeze(bindingOutcomes),
        smoothingMs: deltas.reduce((maximum, delta) => Math.max(maximum, delta.smoothingMs), 0) });
    }, resolve(input, applyFrame, identity = null) {
      const controls = validateInstrumentControls(input);
      if (!Number.isSafeInteger(applyFrame) || applyFrame < 0 || Object.keys(controls.macros).some(key => !macroIds.has(key))) fail('unknown macro or frame');
      const values = { ...base }, deltas = [];
      for (const { macro, target } of mappings) {
        const amount = controls.macros[macro.id] ?? macro.default01;
        const requested = target.curve === 'step' ? amount < 0.5 ? target.minimum : target.maximum : target.curve === 'logarithmic' ?
          target.minimum * (target.maximum / target.minimum) ** amount : target.minimum + (target.maximum - target.minimum) * amount;
        const parameter = schema.get(target.parameter), previous = values[target.parameter];
        const combined = target.composition === 'replace' ? requested : target.composition === 'add' ? previous + requested : previous * requested;
        values[target.parameter] = combined;
        deltas.push({ parameterId: target.parameter, unit: parameter.unit, normalizedAuthorValue: amount, requestedValue: combined,
          origin: 'macro', macroId: macro.id, composition: target.composition, applyFrame, interpolation: macro.mode === 'continuous' ? 'bounded-causal-slew' : 'onset-only', smoothingMs: macro.smoothingMs });
      }
      const variationReceipt = applyInstrumentVariation(variation, patch, values, controls, identity, deltas, applyFrame), causes = identity?.performanceCause ? [identity.performanceCause] : [];
      const bindingOutcomes = applyBindings(onset, causes, values, deltas, applyFrame, identity), continuousBase = Object.freeze({ ...values });
      bindingOutcomes.push(...applyBindings(continuous, causes, values, deltas, applyFrame, identity));
      return Object.freeze({ revision: 'typed-onset-controls-v3', ...finalize(values, deltas), continuousBase, controls,
        variation: variationReceipt, bindingOutcomes: Object.freeze(bindingOutcomes) });
    } };
  return Object.freeze(plan);
}

export function captureInstrumentPerformanceIdentity(input) {
  return Object.freeze({ worldId: input?.worldId, generation: input?.generation, actorId: input?.actorId, onsetId: input?.onsetId,
    ...(input?.performanceCause ? { performanceCause: retainInstrumentCause(input.performanceCause) } : {}) });
}
