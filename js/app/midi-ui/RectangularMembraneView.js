import { createRectangularMembraneRecipe } from '../../midi/content/RectangularMembraneRecipe.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createRectangularMembraneView({ document, getPlayback, getLanes, saveRack, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, expected = null, committed = null, revision = 0;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'), title = node('h2', 'Rectangular skin'), fields = node('div'), actions = node('div'), status = node('output'), state = node('pre');
  title.id = 'rectangularMembraneTitle'; dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', title.id); status.setAttribute('role', 'status');
  state.setAttribute('aria-label', 'Modeled audio displacement, decimated to eight by eight');
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const field = (label, input) => { const wrapper = node('label', label); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const option = (input, value, text) => { const entry = node('option', text); entry.value = String(value); input.append(entry); };
  const source = field('Actual excitation bus', node('select')), grid = field('Prepared grid · experimental', node('select')), surface = field('Observed preparation map', node('select'));
  option(grid, 8, '8 × 8 interior sites'); option(grid, 16, '16 × 16 interior sites');
  const live = (key, value) => { if (!expected || pending) return; try { getPlayback().updateEffectGraph('skin', { [key]: value }, undefined, expected); } catch (error) { say(error.message); } };
  const number = (label, min, max, step, value, key = null) => {
    const input = field(label, node('input')); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    if (key) listen(input, 'change', () => { if (input.checkValidity()) live(key, Number(input.value)); }); return input;
  };
  const tune = number('Prepared fundamental · Hz', 40, 1000, 1, 180), decay = number('Prepared amplitude T60 · seconds', 0.05, 4, 0.05, 1.8), wet = number('Prepared return level', 0, 0.5, 0.01, 0.25);
  const controls = [['strikeX01', 'Strike X', 0.5], ['strikeY01', 'Strike Y', 0.5], ['pickupLeftX01', 'Left pickup X', 0.31], ['pickupLeftY01', 'Left pickup Y', 0.43],
    ['pickupRightX01', 'Right pickup X', 0.69], ['pickupRightY01', 'Right pickup Y', 0.43], ['damp01', 'DAMP · positive loss', 0]].map(([key, label, value]) => [key, number(label + ' · normalized', 0, 1, 0.01, value, key)]);
  const touchInputs = [];
  for (let index = 0; index < 2; index++) {
    const slot = 'touch' + index; touchInputs.push(number('Authored touch ' + (index + 1) + ' X · normalized', 0, 1, 0.01, 0.5, slot + 'X01'),
      number('Authored touch ' + (index + 1) + ' Y · normalized', 0, 1, 0.01, 0.5, slot + 'Y01'), number('Authored touch ' + (index + 1) + ' radius', 0.08, 0.18, 0.01, 0.12, slot + 'Radius01'),
      number('Authored touch ' + (index + 1) + ' loss · zero releases', 0, 1, 0.01, 0, slot + 'Amount01'));
  }
  const inputs = [source, grid, surface, tune, decay, wet, ...controls.map(([, input]) => input), ...touchInputs];
  const button = (label, action, duringPrepare = false) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', async () => { if (disposed || pending && !duringPrepare) return; try { await action(); } catch (error) { say(error.message); } }); actions.append(value); };
  button('Prepare skin', async () => {
    if (inputs.some(input => typeof input.checkValidity === 'function' && !input.checkValidity())) throw new Error('Resolve the invalid surface controls before preparing.');
    const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('Physical audio is unavailable.');
    const model = createRectangularMembraneRecipe({ sourceBusId: source.value, gridSize: Number(grid.value), fundamentalHz: Number(tune.value), decaySeconds: Number(decay.value), wet01: Number(wet.value),
      ...Object.fromEntries(controls.map(([key, input]) => [key, Number(input.value)])), revision: ++revision });
    const operation = { controller: new AbortController(), promise: null }; pending = operation; for (const input of inputs) input.disabled = true;
    try {
      operation.promise = playback.prepareEffectGraph(model.graph, { signal: operation.controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const receipt = await operation.promise;
      if (!disposed && pending === operation) { for (let index = 0; index < touchInputs.length; index++) touchInputs[index].value = String([0.5, 0.5, 0.12, 0][index % 4]);
        committed = model; expected = { ownerRouteRevision: receipt.revision, graphDefinitionHash: receipt.activeGraph.hash }; state.textContent = ''; say('Prepared one persistent ' + grid.value + ' × ' + grid.value + ' skin. Authored touch slots reset to released; actual bus audio drives the body.'); }
    } finally { if (pending === operation) pending = null; for (const input of inputs) input.disabled = false; }
  });
  button('Bind observed contact map', async () => {
    if (!expected || !surface.value) throw new Error('Prepare a skin and select a saved physical surface map first.');
    if (touchInputs.some((input, index) => index % 4 === 3 && Number(input.value) !== 0)) throw new Error('Release the authored manual touch slots before assigning physical contact owners.');
    const playback = getPlayback(), identity = await playback.bindPreparedSurface({ surfaceId: surface.value, nodeId: 'skin', expected });
    if (disposed || getPlayback() !== playback) return; for (const input of touchInputs) input.disabled = true;
    say('Bound body ' + identity.bodyInstanceId.slice(0, 12) + ' to map ' + identity.surfaceMap.id + ' revision ' + identity.surfaceMap.revision + '. Existing contacts keep their exact old tail; new observed contacts use this body.');
  });
  button('Inspect contact bindings', () => { const value = getPlayback()?.preparedSurfaceBodies(); state.textContent = value ? value.bodies.map(body => (body.active ? 'CURRENT ' : 'RETAINED TAIL ') + body.bodyInstanceId.slice(0, 12) + ' · map ' + body.surfaceMap.id + '/r' + body.surfaceMap.revision).concat(value.bindings.map(binding => binding.contactSpanId + ' → ' + binding.bodyInstanceId.slice(0, 12) + ' · ' + binding.kind + ' slot ' + binding.slot)).join('\n') : 'No prepared contact body is bound.'; });
  button('Inspect modeled state', () => {
    const graph = getPlayback()?.inspectEffectGraph?.({ requestHealth: true })?.activeGraph;
    if (!expected || graph?.hash !== expected.graphDefinitionHash) throw new Error('This prepared skin is no longer the active graph.');
    const health = graph.processors.find(entry => entry.nodeId === 'skin')?.health;
    if (!health) { say('Awaiting the audio renderer summary; inspect after the next block.'); return; }
    if (health.muted) { say('This skin cleared its state and is quarantined. Prepare a new body to resume.'); return; }
    say('Discrete audio energy ' + health.energy.toExponential(3) + ' · excitation caps ' + health.excitationCaps + ' · renderer frame ' + health.frame + ' · held touch slots ' + health.touches.filter(touch => touch.amount01 > 0).length + ' · finite exciters ' + (health.strikes?.activeExciters ?? 0) + ' · queued ' + (health.strikes?.queued ?? 0));
    state.textContent = Array.from({ length: 8 }, (_, row) => health.displacement.slice(row * 8, row * 8 + 8).map(value => value.toExponential(1)).join(' ')).join('\n');
  });
  button('Save prepared defaults', () => { if (!committed) throw new Error('Prepare a skin before saving.'); saveRack({ schema: 'lemmings-owner-effect-rack/v1', graph: committed.graph, bypass: 'active' }); say('Prepared defaults saved. Live gestures and ringing state remain in their own performance receipts.'); });
  button('Dry with skin tail', () => { if (expected) getPlayback()?.setEffectBypass?.('tail', expected); expected = null; say('Excitation disconnected; the admitted old body tail can decay.'); });
  button('Panic skin', () => { if (expected) getPlayback()?.setEffectBypass?.('panic', expected); expected = null; state.textContent = ''; say('Owned body energy cleared.'); });
  const suspend = () => { pending?.controller.abort(); if (dialog.open) dialog.close(); }; button('Close', suspend, true); listen(dialog, 'cancel', event => { event.preventDefault(); suspend(); });
  dialog.append(title, node('p', 'Original five-point wave model with fixed boundaries. Strike and stereo pickup positions are independent normalized interior-grid coordinates. Stereo excitation is (L + R) / 2; opposite polarity cancels. Grid and tuning changes prepare a new body while the old tail retains its own state.'),
    node('p', 'Experimental audio model: numerical dispersion, listening and device deadlines await qualification. Two authored touch slots change localized positive loss and release independently; they are manual audio controls, not observed contacts. A patch with no grid support is declined. A saved physical surface map can bind observed contacts to this body. Stage a shared-body strike in the physical scene editor to turn actual contact begins into finite forces at their mapped positions. The prepared body owns tuning; note pitch does not retune it. Up to four finite exciters share one ringing wave field. Ending one semantic source leaves the other actors and stored body energy intact. Held contacts stay on their exact retiring body; future contacts use a replacement only after it is explicitly bound. This rectangle does not infer acoustic geometry from terrain.'), fields, actions, status, state);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (disposed) return; const old = source.value, oldSurface = surface.value; surface.replaceChildren(); option(surface, '', 'Choose a saved contact map'); for (const entry of getPlayback()?.preparedSurfaceDefinitions?.() || []) option(surface, entry.id, entry.id + ' · map r' + entry.surfaceMap.revision); if (Array.from(surface.options || []).some(entry => entry.value === oldSurface)) surface.value = oldSurface; source.replaceChildren(); option(source, 'owner', 'Physical owner · pre-fader'); for (const lane of getLanes()) option(source, 'lane:' + lane.id, lane.name || lane.id); if (Array.from(source.options || []).some(entry => entry.value === old)) source.value = old; if (!dialog.open) dialog.showModal(); }, suspend,
    dispose() { return retirement.retire([{ name: 'membrane-authoring-view', run: async () => { suspend(); disposed = true; await pending?.promise?.catch(() => {}); for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
