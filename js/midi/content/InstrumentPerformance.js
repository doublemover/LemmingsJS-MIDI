const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
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
        !['onset-only', 'continuous'].includes(macro.mode) || !finite(macro.default01, 0, 1) || !finite(macro.smoothingMs, 0, 60000) ||
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
    return Object.freeze({ id: macro.id, name: macro.name, mode: macro.mode, default01: macro.default01, smoothingMs: macro.smoothingMs,
      perceptualDirection: macro.perceptualDirection, targets: Object.freeze(mappings) });
  }).sort(order));
}

export function validateInstrumentControls(input = {}) {
  if (!object(input) || Object.keys(input).some(key => key !== 'macros') || !object(input.macros || {}) || Object.keys(input.macros || {}).length > 4) fail('invalid performer controls');
  const macros = Object.create(null);
  for (const [key, value] of Object.entries(input.macros || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!id(key) || !finite(value, 0, 1)) fail('macro overrides require normalized finite values'); macros[key] = value;
  }
  return Object.freeze({ macros: Object.freeze({ ...macros }) });
}

export function compileInstrumentPerformance(patch, parameters) {
  const macros = validateInstrumentMacros(patch.macros || [], parameters);
  if (macros.some(macro => macro.mode !== 'onset-only')) fail('this renderer supports onset-sampled macros only');
  const base = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.default]));
  for (const [key, value] of Object.entries(patch.parameters)) {
    const parameter = parameters.find(entry => entry.id === key);
    if (!parameter || !finite(value, parameter.min, parameter.max) || parameter.discrete && !Number.isInteger(value)) fail('invalid base value'); base[key] = value;
  }
  const macroIds = new Set(macros.map(macro => macro.id)), schema = new Map(parameters.map(parameter => [parameter.id, parameter]));
  const mappings = macros.flatMap(macro => macro.targets.map(target => ({ macro, target })));
  // Replacements establish the authored value before stable-ID additions/scales.
  mappings.sort((a, b) => Number(b.target.composition === 'replace') - Number(a.target.composition === 'replace') || order(a.macro, b.macro));
  return Object.freeze({ resolve(input, applyFrame) {
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
        origin: 'macro', macroId: macro.id, composition: target.composition, applyFrame, interpolation: 'onset-only', smoothingMs: 0 });
    }
    const requestedValues = { ...values };
    for (const parameter of parameters) { const value = clamp(values[parameter.id], parameter.min, parameter.max);
      values[parameter.id] = parameter.discrete ? Math.round(value) : value; }
    return Object.freeze({ revision: 'typed-onset-controls-v1', values: Object.freeze(values), controls,
      deltas: Object.freeze(deltas.map(delta => Object.freeze({ ...delta, effectiveValue: values[delta.parameterId], clamped: requestedValues[delta.parameterId] !== values[delta.parameterId] }))) });
  } });
}
