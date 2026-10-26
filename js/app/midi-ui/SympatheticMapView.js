import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { SYMPATHETIC_MAP_RECIPES, createSympatheticMapRecipe } from '../../midi/content/SympatheticMapRecipes.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createSympatheticMapView({ document, getPlayback, getLanes, saveRack, resourceBudget, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(), unknownOffers = new Set(); let disposed = false, pending = null, committed = null, expected = null, revision = 0, offered = null, offeredStorage = null;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'), title = node('h2', 'Shared bodies'), fields = node('div'), actions = node('div'), status = node('output');
  title.id = 'sympatheticMapTitle'; dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', title.id); status.setAttribute('role', 'status');
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const select = label => { const wrapper = node('label', label), input = node('select'); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const option = (input, value, text) => { const entry = node('option', text); entry.value = String(value); input.append(entry); };
  const source = select('Actual excitation bus'), recipe = select('Body map'), touch = select('TOUCH · prepared excitation body'), audition = select('Pickup audition'), surface = select('Observed authored mode-loss map');
  for (const value of SYMPATHETIC_MAP_RECIPES) option(recipe, value, value.replaceAll('-', ' '));
  option(audition, 'all', 'All body pickups'); option(audition, 'direct', 'Directly excited body only'); option(audition, 'sympathetic', 'Unexcited body pickups only');
  const refreshBodies = () => { const old = touch.value, count = ['felt-bridge', 'foundry-edge', 'foundry-surface'].includes(recipe.value) ? 1 : recipe.value === 'string-trellis' ? 4 : recipe.value === 'metal-constellation' ? 6 : 3; touch.replaceChildren(); for (let index = 0; index < count; index++) option(touch, index, 'Body ' + (index + 1)); if (old !== '' && Number(old) < count) touch.value = old; if (recipe.value === 'felt-bridge') audition.value = 'all'; };
  listen(recipe, 'change', () => { refreshBodies(); syncLossInputs(); }); refreshBodies();
  const live = (key, value) => { if (!expected) return; try { getPlayback().updateEffectGraph('bodies', { [key]: value }, undefined, expected); } catch (error) { say(error.message); } };
  const slider = (label, min, max, step, value, update) => { const wrapper = node('label', label), input = node('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value; input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); if (update) listen(input, 'input', () => update(Number(input.value))); return input; };
  const couple = slider('COUPLE', 0, 1, 0.01, 0.65, value => live('couple01', value)), damp = slider('DAMP', 0, 1, 0.01, 0.3, value => live('damp01', value)), tune = slider('TUNE · prepared ratio', 0.5, 2, 0.01, 1), mix = slider('Return level · prepare to apply', 0, 0.35, 0.01, 0.2);
  const lossInputs = [0, 1, 2].map(index => slider('Prepared positive mode mask ' + (index + 1) + ' · positive loss', 0, 1, 0.01, 0, value => live('modeLoss' + index + 'Amount01', value)));
  const pickupInputs = ['Left', 'Right'].map((side, index) => slider(side + ' observation position · prepared x field', 0, 1, 0.01, index ? 0.85 : 0.15, value => live('pickup' + side + 'X01', value)));
  const syncLossInputs = () => { const solved = ['foundry-edge', 'foundry-surface'].includes(recipe.value); for (const input of [couple, tune, touch, audition]) input.disabled = !!pending || solved; const bound = getPlayback()?.preparedSurfaceBodies?.()?.bodies.some(body => body.active && body.nodeId === 'bodies' && body.graphDefinitionHash === expected?.graphDefinitionHash && body.ownerRouteRevision === expected?.ownerRouteRevision); for (let index = 0; index < lossInputs.length; index++) lossInputs[index].disabled = !!pending || !expected || bound || !committed?.lossMaskIds?.[index]; for (const input of pickupInputs) input.disabled = !!pending || !expected || bound || !committed?.pickupGridId; }; syncLossInputs();
  const controls = [source, recipe, touch, audition, surface, couple, damp, tune, mix, ...lossInputs, ...pickupInputs];
  const button = (label, action, busy = false) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', async () => { if (disposed || pending && !busy) return; try { await action(); } catch (error) { say(error.message); } }); actions.append(value); };
  button('Prepare body map', async () => {
    const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('Physical audio is unavailable.');
    let model;
    if (['foundry-edge', 'foundry-surface'].includes(recipe.value)) {
      if (!offered) throw new Error('Offer a prepared original bar boundary from the shape foundry first.');
      const graph = JSON.parse(canonicalDataText(offered.graph, { maxBytes: 262144, maxNodes: 16384 }).text);
      graph.revision = ++revision; graph.nodes.find(node => node.id === 'excitation').parameters.sourceBusId = source.value;
      graph.nodes.find(node => node.id === 'dry').parameters.gain01 = 1 - Number(mix.value); graph.nodes.find(node => node.id === 'return').parameters.gain01 = Number(mix.value);
      graph.nodes.find(node => node.id === 'bodies').parameters.damp01 = Number(damp.value);
      model = freezeData({ ...offered, graph, sourceBusId: source.value });
    } else model = createSympatheticMapRecipe({ recipe: recipe.value, sourceBusId: source.value, touchBody: Number(touch.value), audition: audition.value,
      couple01: Number(couple.value), damp01: Number(damp.value), tuneRatio: Number(tune.value), wet01: Number(mix.value), revision: ++revision });
    const operation = { controller: new AbortController(), promise: null }; pending = operation; for (const control of controls) control.disabled = true;
    try { operation.promise = playback.prepareEffectGraph(model.graph, { signal: operation.controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const state = await operation.promise; if (!disposed && pending === operation) { expected = { ownerRouteRevision: state.revision, graphDefinitionHash: state.activeGraph.hash }; committed = model; for (const input of lossInputs) input.value = '0'; if (model.pickupPositions) { pickupInputs[0].value = model.pickupPositions.left.x01; pickupInputs[1].value = model.pickupPositions.right.x01; } say('Prepared ' + model.bodyIds.length + ' persistent bodies. Actual source audio excites them; actor end leaves only the admitted body tail.' + (model.lossMaskIds.length ? ' Prepared loss controls are positive diagonal mode approximations, not exact point damping.' : '')); }
    } finally { if (pending === operation) pending = null; for (const control of controls) control.disabled = false; syncLossInputs(); }
  });
  button('Bind observed body map', async () => {
    if (!expected || !committed?.lossMaskIds.length || !surface.value) throw new Error('Prepare a body with named loss masks and choose a matching saved preparation map first.');
    if (lossInputs.some(input => Number(input.value) !== 0)) throw new Error('Release all prepared manual masks before binding observed contacts.');
    const playback = getPlayback(), identity = await playback.bindPreparedSurface({ surfaceId: surface.value, nodeId: 'bodies', expected });
    if (disposed || getPlayback() !== playback) return; syncLossInputs(); say('Bound authored masks on body ' + identity.bodyInstanceId.slice(0, 12) + '. Actual supported contacts own separate amounts; releasing one preserves other contacts on the exact retained body.');
  });
  button('Inspect observed loss owners', () => { const value = getPlayback()?.preparedSurfaceBodies(); say(value ? value.bindings.filter(binding => binding.kind === 'mode-loss').map(binding => binding.contactSpanId + ' → ' + binding.bodyInstanceId.slice(0, 12) + ' / ' + binding.lossMaskId + ' amount ' + binding.amount01).join(' · ') || 'No observed mode-loss contributions are held.' : 'No prepared contact body is bound.'); });
  button('Inspect body energy', () => { const graph = getPlayback()?.inspectEffectGraph?.({ requestHealth: true })?.activeGraph; if (!expected || graph?.hash !== expected.graphDefinitionHash) throw new Error('The prepared body route is no longer active.');
    const health = graph.processors.find(entry => entry.nodeId === 'bodies')?.health; say(!health ? 'Awaiting the audio renderer summary; inspect again after the next block.' : health.muted ? 'Body network quarantined.' : health.bodies.map(body => body.bodyId + ': ' + body.energy.toExponential(2)).join(' · ') + ' · modeled audio energy'); });
  button('Inspect actual pickup positions', () => { const graph = getPlayback()?.inspectEffectGraph?.({ requestHealth: true })?.activeGraph; if (!expected || graph?.hash !== expected.graphDefinitionHash) throw new Error('The prepared body route is no longer active.'); const state = graph.processors.find(entry => entry.nodeId === 'bodies')?.health?.pickups; say(state ? state.gridId + ' · renderer left (' + state.left.x01.toFixed(3) + ', ' + state.left.y01.toFixed(3) + ') / right (' + state.right.x01.toFixed(3) + ', ' + state.right.y01.toFixed(3) + ') · observation only; no excitation receipt' : 'Awaiting an actual renderer pickup summary.'); });
  button('Save prepared defaults', () => { if (!committed) throw new Error('Prepare a body map before saving.'); saveRack({ schema: 'lemmings-owner-effect-rack/v1', graph: committed.graph, bypass: 'active' }); say('Prepared topology defaults saved. Live macro gestures and ringing state remain separate.'); });
  button('Neutral dry with body tail', () => { if (expected) getPlayback()?.setEffectBypass?.('tail', expected); expected = null; syncLossInputs(); say('Source removed from the old network; its admitted body tail can decay.'); });
  button('Panic and clear bodies', () => { if (expected) getPlayback()?.setEffectBypass?.('panic', expected); expected = null; syncLossInputs(); say('Owned body state cleared.'); });
  const offerFoundry = model => {
    if (disposed || pending || unknownOffers.size) throw new Error('Finish or cancel the current shared-body preparation before offering another field.');
    if (model?.schema !== 'lemmings-sympathetic-map/v1' || !['foundry-edge', 'foundry-surface'].includes(model.recipe) || !/^[a-f0-9]{64}$/.test(model.fieldHash) || !resourceBudget) throw new Error('Choose a retained solved bar-boundary map from the foundry.');
    const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'shared-body-offered-foundry-field', kind: 'bounded-owned-field-copy', category: 'candidate', bytes: 4 * 1048576 });
    let copy;
    const releaseCopy = () => { try { reservation.release(); } catch (error) { unknownOffers.add({ reservation, copy }); throw error; } };
    try { const encoded = canonicalDataText(model, { maxBytes: 262144, maxNodes: 16384 }); copy = freezeData(JSON.parse(encoded.text)); reservation.resize(Math.max(4096, encoded.bytes.length * 8 + 262144)); }
    catch (error) { releaseCopy(); throw error; }
    try { offeredStorage?.release(); } catch (error) { unknownOffers.add({ reservation: offeredStorage, copy: offered }); releaseCopy(); throw error; }
    offeredStorage = reservation; offered = copy; committed = expected = null;
    if (!Array.from(recipe.options).some(entry => entry.value === copy.recipe)) option(recipe, copy.recipe, 'Solved original bar ' + (copy.recipe === 'foundry-surface' ? 'top face' : 'edge') + ' · offered strike site');
    recipe.value = copy.recipe; couple.value = '0'; damp.value = '0'; tune.value = '1'; audition.value = 'all'; refreshBodies();
    for (const input of lossInputs) input.value = '0';
    say('Offered solved bar edge at strike ' + model.siteId + ' · field ' + model.fieldHash.slice(0, 12) + '. Choose the actual source bus and Prepare. One eight-mode body retains its state while pickups move; y is invariant along this edge. Mesh, listening and device qualification remain pending.');
  };
  const suspend = () => { pending?.controller.abort(); if (dialog.open) dialog.close(); }; button('Close', suspend, true); listen(dialog, 'cancel', event => { event.preventDefault(); suspend(); });
  dialog.append(title, node('p', 'Original sparse modal networks. COUPLE and DAMP perform the prepared bodies; TUNE, excitation-body and source changes require Prepare. Felt Bridge pickup positions read its prepared authored response field without a new strike. A replaced network keeps its bounded tail. These are audio bodies, not simulated forces or calibrated terrain materials.'),
    node('p', 'Experimental calibration: compare pickups at restrained levels. Felt Bridge has six authored modes with open amplitude T60 2 / 1.6 / 1.1 / 0.8 / 0.5 / 0.3 seconds at DAMP=0 and released masks. Its two manual felt controls apply different nonnegative mode-loss masks; releasing one changes future decay and restores no dissipated energy. A saved mode-loss map can assign actual supported contacts after manual controls are released. Contributions on the same named mask aggregate by maximum; contacts retain their exact old body through replacement. These masks are authored, not spatially exact fingers. Its two signed pickup response vectors vary along the normalized x field; y is intentionally invariant in this authored example. Observation movement does not change internal energy, excitation or loss. These are authored weights, not solved geometric mode shapes. Cost and listening qualification remain pending.'), fields, actions, status);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open(foundryModel = null) { if (disposed) return; if (foundryModel) offerFoundry(foundryModel); const old = source.value, oldSurface = surface.value; surface.replaceChildren(); option(surface, '', 'Choose a saved body-preparation map'); for (const entry of getPlayback()?.preparedSurfaceDefinitions?.() || []) if (entry.preparations.every(preparation => ['mode-loss', 'pickup-left', 'pickup-right'].includes(preparation.kind))) option(surface, entry.id, entry.id + ' · map r' + entry.surfaceMap.revision); if (Array.from(surface.options || []).some(entry => entry.value === oldSurface)) surface.value = oldSurface; source.replaceChildren(); option(source, 'owner', 'Physical owner · pre-fader'); for (const lane of getLanes()) option(source, 'lane:' + lane.id, lane.name || lane.id); if (Array.from(source.options || []).some(entry => entry.value === old)) source.value = old; syncLossInputs(); if (!dialog.open) dialog.showModal(); }, suspend,
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); suspend(); disposed = true;
      const producerFinished = Promise.resolve(pending?.promise).catch(() => {});
      return retirement.retire([{ name: 'body-map-producer', run: () => producerFinished },
        { name: 'body-map-owned-field', run: async () => { await producerFinished; offeredStorage?.release(); if (unknownOffers.size) throw new Error('An offered foundry field retains unresolved resource ownership.'); offeredStorage = committed = offered = null; } },
        { name: 'body-map-surface', run: () => { for (const remove of listeners) remove(); dialog.remove(); } }]);
    } });
}
