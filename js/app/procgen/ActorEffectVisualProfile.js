const CHANNELS = Object.freeze(['x', 'y', 'scale', 'inner', 'outer', 'trail']);
const QUANTITIES = Object.freeze({ x: ['pitch-modulation', 'x-modulation'], y: ['y-modulation'], scale: ['amplitude-envelope', 'onset-envelope', 'rms', 'peak'], inner: ['drive-amount', 'pitch-modulation'], outer: ['filter-amount', 'wet-tail-envelope'], trail: ['delay-tap-envelope'] });
const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : null;
const normalizeActorEffectVisualProfile = source => {
  if (!source || source.version !== 1) throw new TypeError('Actor effect visual profile version 1 is required.');
  const bindings = [];
  for (const binding of (Array.isArray(source.bindings) ? source.bindings : []).slice(0, 6)) {
    if (!CHANNELS.includes(binding.channel) || !text(binding.effectId) || !QUANTITIES[binding.channel].includes(binding.quantity)) continue;
    bindings.push(Object.freeze({ effectId: binding.effectId, quantity: binding.quantity, channel: binding.channel,
      gain: finite(binding.gain, 1, 0, 4), invert: !!binding.invert, curve: ['linear', 'square', 'sqrt'].includes(binding.curve) ? binding.curve : 'linear',
      inputMin: finite(binding.inputMin, ['x', 'y'].includes(binding.channel) ? -1 : 0, -16, 15), inputMax: finite(binding.inputMax, 1, -15, 16),
      priority: Math.round(finite(binding.priority, 0, -10, 10)), cap: finite(binding.cap, binding.channel === 'x' || binding.channel === 'y' ? 3 : 1, 0, binding.channel === 'x' || binding.channel === 'y' ? 3 : 1) }));
  }
  bindings.sort((a, b) => b.priority - a.priority);
  return Object.freeze({ version: 1, name: text(source.name) || 'Effect look', enabled: source.enabled === true, intensity: finite(source.intensity, 0.5, 0, 1),
    smoothingMs: finite(source.smoothingMs, 50, 0, 500), holdMs: finite(source.holdMs, 100, 0, 250), decayMs: finite(source.decayMs, 180, 16, 1000), bindings: Object.freeze(bindings) });
};
const createActorEffectVisualPreset = (name, effectId) => {
  const presets = {
    'pitch-shimmer': [{ channel: 'x', quantity: 'pitch-modulation' }, { channel: 'inner', quantity: 'pitch-modulation' }],
    'breathing-body': [{ channel: 'scale', quantity: 'amplitude-envelope' }],
    'dub-wake': [{ channel: 'trail', quantity: 'delay-tap-envelope' }, { channel: 'outer', quantity: 'wet-tail-envelope' }],
    'resonant-shell': [{ channel: 'outer', quantity: 'filter-amount' }]
  };
  return normalizeActorEffectVisualProfile({ version: 1, name, enabled: true, bindings: (presets[name] || []).map(binding => ({ ...binding, effectId })) });
};
export { CHANNELS as ACTOR_EFFECT_VISUAL_CHANNELS, normalizeActorEffectVisualProfile, createActorEffectVisualPreset };
