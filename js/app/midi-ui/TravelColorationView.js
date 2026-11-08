import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createTravelColorationView({ document, getPlayback, saveRack, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, sources = [], revision = 0, committed = null;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'), title = node('h2', 'Travel color'), fields = node('div'), actions = node('div'), status = node('output');
  title.id = 'travelColorationTitle'; dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', title.id); status.setAttribute('role', 'status');
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const select = label => { const wrapper = node('label', label), input = node('select'); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const option = (input, value, text) => { const item = node('option', text); item.value = value; input.append(item); };
  const source = select('Existing signed-distance voice'), recipe = select('Color'), transition = select('Delay transition'), polarity = select('Processed polarity');
  option(recipe, 'rail-comb', 'Rail comb · 0.8–6 milliseconds'); option(recipe, 'return-flange', 'Return flange · 0.4–8 milliseconds'); option(recipe, 'through-zero', 'Through-zero flange · delayed 4.2 ms reference'); option(recipe, 'hollow-steps', 'Hollow Steps · four moving notches');
  option(transition, 'glide', 'Tape glide · intentional pitch motion'); option(transition, 'jump', 'Two-tap crossfade · coalesce the latest jump');
  option(polarity, 'normal', 'Normal'); option(polarity, 'inverted', 'Invert processed branch');
  const slider = (label, min, max, step, initial) => { const wrapper = node('label', label), input = node('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = initial; input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const travel = slider('TRAVEL · world pixels per sweep', 128, 512, 1, 256), depth = slider('DEPTH · travel excursion', 0, 1, 0.01, 0.75), hollow = slider('HOLLOW · feedback', 0, 0.35, 0.01, 0.2), mix = slider('MIX · processed branch', 0, 0.45, 0.01, 0.3);
  listen(recipe, 'change', () => { const notch = recipe.value === 'hollow-steps'; hollow.max = notch ? 0.25 : 0.35; mix.max = notch ? 0.5 : 0.45; if (Number(hollow.value) > Number(hollow.max)) hollow.value = hollow.max; if (Number(mix.value) > Number(mix.max)) mix.value = mix.max; transition.hidden = notch; if (notch) transition.value = 'glide'; });
  const controls = [source, recipe, transition, polarity, travel, depth, hollow, mix];
  const refresh = () => {
    sources = getPlayback()?.travelEffectSources?.() || []; source.replaceChildren();
    for (let index = 0; index < sources.length; index++) option(source, String(index), 'Actor ' + sources[index].actorId + ' · ' + sources[index].instrumentId + ' · lane ' + sources[index].laneId);
    say(sources.length ? 'Choose a current travel voice, then prepare. Control begins at its next committed movement.' : 'No sustained signed-distance voice is active. Author a signed travel mapping and move its actor first; this tool will not create notes for you.');
  };
  const button = (label, action, allowBusy = false) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', async () => { if (disposed || pending && !allowBusy) return; try { await action(); } catch (error) { say(error.message); } }); actions.append(value); };
  button('Refresh physical voices', refresh);
  button('Prepare and follow selected actor', async () => {
    const selected = sources[Number(source.value)], playback = getPlayback(); if (!selected || !playback?.prepareTravelEffect) throw new Error('Choose an active physical travel voice.');
    const operation = { controller: new AbortController(), promise: null }; pending = operation; for (const input of controls) input.disabled = true;
    try {
      operation.promise = playback.prepareTravelEffect({ voiceId: selected.voiceId, generation: selected.generation, recipe: recipe.value, travelPixels: Number(travel.value),
        depth01: Number(depth.value), feedback: Number(hollow.value), mix01: Number(mix.value), transition: transition.value, invert: polarity.value === 'inverted', revision: ++revision },
      { signal: operation.controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const result = await operation.promise; if (!disposed && pending === operation) { committed = result.model.graph; say('Following actor ' + selected.actorId + '. Rest holds the coordinate. Source end disarms motion and retains the last timbre until bypass or rebind.'); }
    } finally { if (pending === operation) pending = null; for (const input of controls) input.disabled = false; }
  });
  button('Save prepared defaults', () => { if (!committed) throw new Error('Prepare a color before saving its static defaults.'); saveRack({ schema: 'lemmings-owner-effect-rack/v1', graph: committed, bypass: 'active' }); say('Static effect defaults saved. Actor ownership and live motion are not silently restored from parameter values.'); });
  button('Neutral owner rack', () => { getPlayback()?.clearTravelEffect?.(); getPlayback()?.setEffectBypass?.('neutral'); committed = null; say('Motion disarmed; the owner dry path is restored.'); });
  const suspend = () => { pending?.controller.abort(); committed = null; if (dialog.open) { dialog.close?.(); dialog.open = false; } };
  button('Close', suspend, true); listen(dialog, 'cancel', () => pending?.controller.abort());
  dialog.append(title, node('p', 'Actual signed world travel moves a smooth spatial curve. Rest and camera motion add no progress. This colors existing voices; there is no oscillator driving the control and no added note clock.'),
    node('p', 'Experimental original delay and notch color. Changes apply through Prepare. Tape glide changes pitch; jump mode keeps two read taps and one pending target. Hollow Steps moves allpass frequencies directly; it adds no internal modulation oscillator. Through-zero flange deliberately delays the dry reference by 4.2 ms. Master capture can retain the live result; captured-command revoice can replay one unchanged owned graph. Static revoice uses authored defaults.'), fields, actions, status);
  (document.body || document.documentElement).append(dialog);
  return Object.freeze({ open() { if (disposed) return; refresh(); if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.open = true; }, suspend,
    dispose() { return retirement.retire([{ name: 'cancel-preparation', run: () => { disposed = true; pending?.controller.abort(); } },
      { name: 'preparation-settlement', run: async () => { try { await pending?.promise; } catch {} } },
      { name: 'surface', run: () => { for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
