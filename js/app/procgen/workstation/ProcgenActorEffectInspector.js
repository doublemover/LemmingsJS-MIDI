import { createActorEffectVisualPreset, normalizeActorEffectVisualProfile } from '../ActorEffectVisualProfile.js';

export function createProcgenActorEffectInspector({ renderer, document, parent }) {
  const manager = renderer.actorEffects; if (!manager) return null;
  const listeners = [], element = (tag, text) => { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; };
  const on = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener?.(type, handler)); };
  const section = element('details'); section.className = 'studio-effect-look'; section.append(element('summary', 'EFFECT LOOK'));
  const status = element('p', 'Select an actor to inspect effect evidence.'), evidence = element('div'), controls = element('div'); controls.className = 'studio-effect-look-controls';
  const enabled = element('input'); enabled.type = 'checkbox'; enabled.setAttribute('aria-label', 'Enable actor effect visuals');
  const intensity = element('input'); intensity.type = 'range'; intensity.min = '0'; intensity.max = '1'; intensity.step = '0.05'; intensity.setAttribute('aria-label', 'Actor effect visual intensity');
  const source = element('select'); source.setAttribute('aria-label', 'Effect visual source');
  const preset = element('select'); preset.setAttribute('aria-label', 'Actor effect visual preset');
  for (const [id, label] of [['pitch-shimmer', 'Pitch shimmer'], ['breathing-body', 'Breathing body'], ['dub-wake', 'Dub wake'], ['resonant-shell', 'Resonant shell']]) { const option = element('option', label); option.value = id; preset.append(option); }
  const bindingIndex = element('select'); bindingIndex.setAttribute('aria-label', 'Visual binding');
  const gain = element('input'); gain.type = 'number'; gain.min = '0'; gain.max = '4'; gain.step = '0.01'; gain.setAttribute('aria-label', 'Visual binding gain');
  const cap = element('input'); cap.type = 'number'; cap.min = '0'; cap.max = '3'; cap.step = '0.05'; cap.setAttribute('aria-label', 'Visual binding amplitude cap');
  const inputMin = element('input'); inputMin.type = 'number'; inputMin.min = '-16'; inputMin.max = '15'; inputMin.step = '0.01'; inputMin.setAttribute('aria-label', 'Visual source minimum');
  const inputMax = element('input'); inputMax.type = 'number'; inputMax.min = '-15'; inputMax.max = '16'; inputMax.step = '0.01'; inputMax.setAttribute('aria-label', 'Visual source maximum');
  const invert = element('input'); invert.type = 'checkbox'; invert.setAttribute('aria-label', 'Invert visual binding');
  const linked = element('input'); linked.type = 'checkbox'; linked.setAttribute('aria-label', 'Link qualified modulation axes');
  const apply = element('button', 'Apply look'); apply.type = 'button'; const reset = element('button', 'Reset look'); reset.type = 'button';
  const label = (text, control) => { const node = element('label', text); node.append(control); controls.append(node); };
  label('Visuals', enabled); label('Intensity', intensity); label('Source', source); label('Preset', preset); label('Binding', bindingIndex); label('Exact gain', gain); label('Amplitude cap', cap); label('Source minimum', inputMin); label('Source maximum', inputMax); label('Invert', invert); label('Link X/Y', linked); controls.append(apply, reset);
  const bindings = element('p'), policy = element('p', 'Presentation only. Live motion requires actor-owned applied samples; shared mix energy is not an actor measurement. Reduced motion keeps static accents.');
  section.append(status, evidence, controls, bindings, policy); parent.append(section);
  let selected = null, sourcesKey = '', evidenceKey = '', bindingKey = '', disposed = false;
  const selectedProfile = () => manager.getProfile(selected?.actorId);
  const save = patch => { if (!selected || selected.actorId == null) return; manager.setProfile({ ...selectedProfile(), ...patch }, { actorId: selected.actorId }); renderer.render(false); refresh(selected); };
  const editBinding = patch => { const profile = selectedProfile(), index = Number(bindingIndex.value) || 0; if (!profile.bindings[index]) return; save({ bindings: profile.bindings.map((binding, position) => position === index ? { ...binding, ...patch } : binding) }); };
  on(bindingIndex, 'change', () => refresh(selected)); on(gain, 'change', () => editBinding({ gain: Number(gain.value) })); on(cap, 'change', () => editBinding({ cap: Number(cap.value) })); on(inputMin, 'change', () => editBinding({ inputMin: Number(inputMin.value) })); on(inputMax, 'change', () => editBinding({ inputMax: Number(inputMax.value) })); on(invert, 'change', () => editBinding({ invert: invert.checked }));
  on(linked, 'change', () => { const profile = selectedProfile(), x = profile.bindings.find(binding => binding.channel === 'x'); if (!x) return; save({ bindings: linked.checked ? [...profile.bindings.filter(binding => binding.channel !== 'y'), { ...x, channel: 'y', quantity: 'y-modulation' }].slice(0, 6) : profile.bindings.filter(binding => binding.channel !== 'y') }); });
  on(enabled, 'change', () => save({ enabled: enabled.checked })); on(intensity, 'input', () => save({ intensity: Number(intensity.value) }));
  on(apply, 'click', () => { if (!selected || !source.value) return; let profile = createActorEffectVisualPreset(preset.value, source.value);
    if (preset.value === 'breathing-body') { const measured = [...(manager.mailboxes.get(selected.actorId)?.sources.values() || [])].find(record => record.effectId === source.value && ['rms', 'peak'].includes(record.quantity)); if (measured) profile = { ...profile, bindings: profile.bindings.map(binding => ({ ...binding, quantity: measured.quantity })) }; }
    save({ ...profile, enabled: enabled.checked, intensity: Number(intensity.value) }); });
  on(reset, 'click', () => save(normalizeActorEffectVisualProfile({ version: 1 })));
  const refresh = selection => {
    if (disposed) return; selected = selection?.kind === 'actor' ? selection : null;
    manager.setInspectedActor(selected?.actorId ?? null);
    const box = selected && manager.mailboxes.get(selected.actorId), records = box ? [...box.sources.values()] : [], identities = [...new Set(records.map(record => record.effectId))];
    const sourceKey = identities.join('|');
    if (sourceKey !== sourcesKey) { sourcesKey = sourceKey; while (source.firstChild) source.removeChild(source.firstChild); for (const id of identities) { const option = element('option', id); option.value = id; source.append(option); } }
    if (!identities.length) source.value = '';
    const profile = selected ? selectedProfile() : manager.profile;
    enabled.checked = !!selected && profile.enabled; if (document.activeElement !== intensity) intensity.value = String(profile.intensity);
    for (const control of [enabled, intensity, source, preset, apply, reset]) control.disabled = !selected || !identities.length;
    const now = renderer._effectPresentationMs ?? renderer.window.performance?.now?.() ?? 0, state = selected ? manager.evaluate(selected.actorId, now, { reducedMotion: true }) : null;
    const described = state?.sources.length ? state.sources : records.map(record => ({ ...record, state: record.rejected ? 'rejected' : record.pending ? 'pending' : record.muted ? 'muted' : record.bypassed && !record.tail ? 'bypassed' : now > record.validUntilMs || now > record.presentationMs + profile.holdMs + profile.decayMs ? 'stale' : record.evidenceClass === 'configured-parameter' ? 'configured' : 'received; no active visual binding' }));
    const key = JSON.stringify(described.map(record => [record.effectId, record.quantity, record.value, record.units, record.evidenceClass, record.state]));
    if (key !== evidenceKey) {
      evidenceKey = key; while (evidence.firstChild) evidence.removeChild(evidence.firstChild);
      for (const record of described) evidence.append(element('p', `${record.effectId} · ${record.quantity}: ${record.value} ${record.units} · ${record.evidenceClass} · ${record.state}`));
    }
    status.textContent = !selected ? 'Select an actor to inspect effect evidence.' : !manager.epoch || !manager.subscription ? 'Live effect telemetry is unavailable. No actor motion is inferred.' : !records.length ? 'No actor-owned effect samples. Configured output does not prove an audible effect.' : `${records.length} actor-owned source samples · ${state?.state || 'unknown'} · no acoustic receipt`;
    const nextBindingKey = profile.bindings.map(binding => `${binding.effectId}/${binding.quantity}:${binding.channel}`).join('|');
    if (bindingKey !== nextBindingKey) { bindingKey = nextBindingKey; while (bindingIndex.firstChild) bindingIndex.removeChild(bindingIndex.firstChild); profile.bindings.forEach((binding, index) => { const option = element('option', `${binding.channel} · ${binding.quantity}`); option.value = String(index); bindingIndex.append(option); }); }
    const currentBinding = profile.bindings[Number(bindingIndex.value) || 0];
    for (const control of [bindingIndex, gain, cap, inputMin, inputMax, invert]) control.disabled = !selected || !currentBinding || !identities.length;
    if (currentBinding) { if (document.activeElement !== gain) gain.value = String(currentBinding.gain); if (document.activeElement !== cap) cap.value = String(currentBinding.cap); if (document.activeElement !== inputMin) inputMin.value = String(currentBinding.inputMin); if (document.activeElement !== inputMax) inputMax.value = String(currentBinding.inputMax); invert.checked = currentBinding.invert; cap.max = ['x', 'y'].includes(currentBinding.channel) ? '3' : '1'; }
    const x = profile.bindings.find(binding => binding.channel === 'x'); linked.disabled = !selected || !x || !records.some(record => record.effectId === x.effectId && record.quantity === 'y-modulation' && ['measured', 'kernel-state'].includes(record.evidenceClass)); linked.checked = !!x && profile.bindings.some(binding => binding.channel === 'y' && binding.effectId === x.effectId);
    bindings.textContent = profile.bindings.length ? profile.bindings.map(binding => `${binding.effectId}/${binding.quantity} → ${binding.channel} (gain ${binding.gain}${binding.invert ? ', inverted' : ''})`).join('; ') : 'No visual bindings. Global defaults, patch defaults and deliberate actor overrides are supported by the profile API.';
  };
  return { refresh, dispose() { if (disposed) return; disposed = true; manager.setInspectedActor(null); for (const stop of listeners) stop(); listeners.length = 0; section.remove?.(); if (section.parentNode) section.parentNode.removeChild(section); else section.parent?.removeChild(section); } };
}
