import { SYMPATHETIC_MAP_RECIPES, createSympatheticMapRecipe } from '../../midi/content/SympatheticMapRecipes.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createSympatheticMapView({ document, getPlayback, getLanes, saveRack, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, committed = null, expected = null, revision = 0;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'), title = node('h2', 'Shared bodies'), fields = node('div'), actions = node('div'), status = node('output');
  title.id = 'sympatheticMapTitle'; dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', title.id); status.setAttribute('role', 'status');
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const select = label => { const wrapper = node('label', label), input = node('select'); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const option = (input, value, text) => { const entry = node('option', text); entry.value = String(value); input.append(entry); };
  const source = select('Actual excitation bus'), recipe = select('Body map'), touch = select('TOUCH · prepared excitation body'), audition = select('Pickup audition');
  for (const value of SYMPATHETIC_MAP_RECIPES) option(recipe, value, value.replaceAll('-', ' '));
  option(audition, 'all', 'All body pickups'); option(audition, 'direct', 'Directly excited body only'); option(audition, 'sympathetic', 'Unexcited body pickups only');
  const refreshBodies = () => { const old = touch.value, count = recipe.value === 'felt-bridge' ? 1 : recipe.value === 'string-trellis' ? 4 : recipe.value === 'metal-constellation' ? 6 : 3; touch.replaceChildren(); for (let index = 0; index < count; index++) option(touch, index, 'Body ' + (index + 1)); if (old !== '' && Number(old) < count) touch.value = old; if (recipe.value === 'felt-bridge') audition.value = 'all'; };
  listen(recipe, 'change', refreshBodies); refreshBodies();
  const live = (key, value) => { if (!expected) return; try { getPlayback().updateEffectGraph('bodies', { [key]: value }, undefined, expected); } catch (error) { say(error.message); } };
  const slider = (label, min, max, step, value, update) => { const wrapper = node('label', label), input = node('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value; input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); if (update) listen(input, 'input', () => update(Number(input.value))); return input; };
  const couple = slider('COUPLE', 0, 1, 0.01, 0.65, value => live('couple01', value)), damp = slider('DAMP', 0, 1, 0.01, 0.3, value => live('damp01', value)), tune = slider('TUNE · prepared ratio', 0.5, 2, 0.01, 1), mix = slider('Return level · prepare to apply', 0, 0.35, 0.01, 0.2);
  const lossInputs = [0, 1].map(index => slider('Authored felt mode mask ' + (index + 1) + ' · positive loss', 0, 1, 0.01, 0, value => live('modeLoss' + index + 'Amount01', value)));
  const syncLossInputs = () => { for (let index = 0; index < lossInputs.length; index++) lossInputs[index].disabled = !!pending || !committed?.lossMaskIds?.[index]; }; syncLossInputs();
  const controls = [source, recipe, touch, audition, couple, damp, tune, mix, ...lossInputs];
  const button = (label, action, busy = false) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', async () => { if (disposed || pending && !busy) return; try { await action(); } catch (error) { say(error.message); } }); actions.append(value); };
  button('Prepare body map', async () => {
    const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('Physical audio is unavailable.');
    const model = createSympatheticMapRecipe({ recipe: recipe.value, sourceBusId: source.value, touchBody: Number(touch.value), audition: audition.value,
      couple01: Number(couple.value), damp01: Number(damp.value), tuneRatio: Number(tune.value), wet01: Number(mix.value), revision: ++revision });
    const operation = { controller: new AbortController(), promise: null }; pending = operation; for (const control of controls) control.disabled = true;
    try { operation.promise = playback.prepareEffectGraph(model.graph, { signal: operation.controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const state = await operation.promise; if (!disposed && pending === operation) { expected = { ownerRouteRevision: state.revision, graphDefinitionHash: state.activeGraph.hash }; committed = model; for (const input of lossInputs) input.value = '0'; say('Prepared ' + model.bodyIds.length + ' persistent bodies. Actual source audio excites them; actor end leaves only the admitted body tail.' + (model.lossMaskIds.length ? ' Felt controls are authored selected-mode loss, not point damping.' : '')); }
    } finally { if (pending === operation) pending = null; for (const control of controls) control.disabled = false; syncLossInputs(); }
  });
  button('Inspect body energy', () => { const graph = getPlayback()?.inspectEffectGraph?.({ requestHealth: true })?.activeGraph; if (!expected || graph?.hash !== expected.graphDefinitionHash) throw new Error('The prepared body route is no longer active.');
    const health = graph.processors.find(entry => entry.nodeId === 'bodies')?.health; say(!health ? 'Awaiting the audio renderer summary; inspect again after the next block.' : health.muted ? 'Body network quarantined.' : health.bodies.map(body => body.bodyId + ': ' + body.energy.toExponential(2)).join(' · ') + ' · modeled audio energy'); });
  button('Save prepared defaults', () => { if (!committed) throw new Error('Prepare a body map before saving.'); saveRack({ schema: 'lemmings-owner-effect-rack/v1', graph: committed.graph, bypass: 'active' }); say('Prepared topology defaults saved. Live macro gestures and ringing state remain separate.'); });
  button('Neutral dry with body tail', () => { if (expected) getPlayback()?.setEffectBypass?.('tail', expected); expected = null; say('Source removed from the old network; its admitted body tail can decay.'); });
  button('Panic and clear bodies', () => { if (expected) getPlayback()?.setEffectBypass?.('panic', expected); expected = null; say('Owned body state cleared.'); });
  const suspend = () => { pending?.controller.abort(); if (dialog.open) dialog.close(); }; button('Close', suspend, true); listen(dialog, 'cancel', event => { event.preventDefault(); suspend(); });
  dialog.append(title, node('p', 'Original sparse modal networks. COUPLE and DAMP perform the prepared bodies; TUNE, TOUCH, pickup and source changes require Prepare. A replaced network keeps its bounded tail. These are audio bodies, not simulated forces or calibrated terrain materials.'),
    node('p', 'Experimental calibration: compare pickups at restrained levels. Felt Bridge has six authored modes with open amplitude T60 2 / 1.6 / 1.1 / 0.8 / 0.5 / 0.3 seconds at DAMP=0 and released masks. Its two manual felt controls apply different nonnegative mode-loss masks; releasing one changes future decay and restores no dissipated energy. These masks are authored, not spatially exact fingers. Cost and listening qualification are pending; terrain-contact preparation slots are not assigned by this surface.'), fields, actions, status);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (disposed) return; const old = source.value; source.replaceChildren(); option(source, 'owner', 'Physical owner · pre-fader'); for (const lane of getLanes()) option(source, 'lane:' + lane.id, lane.name || lane.id); if (Array.from(source.options || []).some(entry => entry.value === old)) source.value = old; if (!dialog.open) dialog.showModal(); }, suspend,
    dispose() { return retirement.retire([{ name: 'body-map-surface', run: async () => { suspend(); disposed = true; await pending?.promise?.catch(() => {}); for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
