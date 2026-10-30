import { CROSS_EXCITATION_RECIPES, createCrossExcitationRecipe } from '../../midi/content/CrossExcitationRecipes.js';
import { validateOwnerEffectRack } from '../../midi/content/DubQuarryRack.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createCrossExcitationView({ document, getPlayback, getLanes, saveRack, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, revision = 0, committed = null, lease = null;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'), title = node('h2', 'Interlocking lanes'), fields = node('div'), actions = node('div'), status = node('output');
  dialog.className = 'studio-dialog studio-echo-rack'; title.id = 'crossExcitationTitle'; dialog.setAttribute('aria-labelledby', title.id); status.setAttribute('role', 'status');
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const select = label => { const wrapper = node('label', label), input = node('select'); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const recipe = select('Interaction'), donor = select('WHO SPEAKS · donor'), carrier = select('WHO SPEAKS · carrier'), tap = select('Lane fader tap');
  const option = (input, value, text) => { const element = node('option', text); element.value = value; input.append(element); };
  for (const entry of CROSS_EXCITATION_RECIPES) option(recipe, entry.id, entry.name);
  option(tap, 'post-fader', 'After lane level, mute and solo'); option(tap, 'pre-fader', 'Before lane level, mute and solo');
  const slider = (label, maximum, initial) => { const wrapper = node('label', label), input = node('input'); input.type = 'range'; input.min = 0; input.max = maximum; input.step = 0.01; input.value = initial; input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const bite = slider('BITE · tone / envelope release on next Prepare', 1, 0.5), merge = slider('MERGE · carrier return', 0.35, 0.25), air = slider('AIR · carrier floor on next Prepare', 0.3, 0.1);
  const controls = [recipe, donor, carrier, tap, bite, merge, air];
  listen(merge, 'input', () => {
    if (!committed || pending) return;
    try { lease = getPlayback().updateEffectGraph('return', { gain01: Number(merge.value) }, undefined, lease); committed = { ...committed,
      nodes: committed.nodes.map(entry => entry.id === 'return' ? { ...entry, parameters: { ...entry.parameters, gain01: Number(merge.value) } } : entry) }; }
    catch (error) { say(error.message); }
  });
  const button = (label, action, allowBusy = false) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', async () => { if (disposed || pending && !allowBusy) return; try { await action(); } catch (error) { say(error.message); } }); actions.append(value); return value; };
  const prepare = async () => {
    const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('Enable the physical browser instrument before preparing this interaction.');
    const model = createCrossExcitationRecipe({ recipe: recipe.value, donorLaneId: donor.value, carrierLaneId: carrier.value, tap: tap.value,
      bite01: Number(bite.value), merge01: Number(merge.value), air01: Number(air.value), revision: ++revision });
    const operation = { controller: new AbortController(), promise: null }; pending = operation; for (const control of controls) control.disabled = true;
    try {
      operation.promise = playback.prepareEffectGraph(model.graph, { signal: operation.controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const state = await operation.promise;
      if (!disposed && pending === operation) { committed = model.graph; lease = { graphDefinitionHash: state.activeGraph.hash, ownerRouteRevision: state.revision }; say(model.name + ' prepared: ' + donor.value + ' shapes ' + carrier.value + '. Dry physical attacks remain owned by their original voices.'); }
    } finally { if (pending === operation) pending = null; for (const control of controls) control.disabled = false; }
  };
  button('Prepare interaction', prepare);
  button('Swap speaker and carrier', async () => { const previous = donor.value; donor.value = carrier.value; carrier.value = previous; await prepare(); });
  button('Inspect source activity', () => {
    const graph = getPlayback()?.inspectEffectGraph?.({ requestHealth: true })?.activeGraph;
    if (!graph) { say('No prepared interaction is active.'); return; }
    const sources = (graph.sidechains || []).map(source => source.sourceBusId + ': ' + source.status).join('; ');
    const health = (graph.processors || []).filter(processor => processor.health).map(processor => ({ id: processor.nodeId, ...processor.health }));
    say(sources + (health.length ? ' · latest DSP receipts: ' + health.map(value => value.id + ' frame ' + value.frame + ' · donor ' + (value.donorAvailable === false ? 'missing' : value.donorPeak === 0 ? 'silent' : value.donorPeak ?? value.output ?? 'observed') + ' · carrier ' + (value.carrierAvailable === false ? 'missing' : value.carrierPeak === 0 ? 'silent' : value.carrierPeak ?? 'not measured')).join('; ') : ' · request sent; inspect again for the latest processed frame.'));
  });
  button('Save prepared defaults', () => { if (!committed) throw new Error('Prepare the interaction before saving its defaults.'); saveRack(validateOwnerEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph: committed, bypass: 'active' })); say('Prepared route and effect defaults saved.'); });
  for (const [label, mode] of [['Neutral bypass', 'neutral'], ['Clear tails', 'panic']]) button(label, () => { getPlayback()?.setEffectBypass?.(mode); committed = lease = null; say(label + '.'); });
  const suspend = () => { pending?.controller.abort(); committed = lease = null; if (dialog.open) { dialog.close?.(); dialog.open = false; } };
  button('Close', suspend, true); listen(dialog, 'cancel', () => pending?.controller.abort());
  dialog.append(title, node('p', 'Choose two different physical lanes. The donor shapes an already sounding carrier; it adds no notes and never controls the world. Route, BITE and AIR changes apply through Prepare. MERGE performs the prepared return.'),
    node('p', 'Experimental original effects. Spectral, listening and device qualification is pending. Saved defaults are separate from live gestures; record master audio to retain the exact live output.'), fields, actions, status);
  (document.body || document.documentElement).append(dialog);
  return Object.freeze({ open() {
    if (disposed) return; const lanes = getLanes(); donor.replaceChildren(); carrier.replaceChildren();
    for (const lane of lanes) { option(donor, lane.id, lane.name || lane.id); option(carrier, lane.id, lane.name || lane.id); }
    if (lanes.length > 1) carrier.value = lanes[1].id;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.open = true;
  }, suspend, dispose() { return retirement.retire([{ name: 'cancel-preparation', run: () => { disposed = true; pending?.controller.abort(); } },
    { name: 'preparation-settlement', run: async () => { try { await pending?.promise; } catch {} } },
    { name: 'surface', run: () => { for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
