import { createGlassHoldRecipe } from '../../midi/content/SpectralFreezeRecipes.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createSpectralFreezeView({ document, window, getPlayback, getLanes, saveRack, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, expected = null, committed = null, held = false, latched = false, revision = 0;
  const node = (tag, text) => { const result = document.createElement(tag); if (text != null) result.textContent = text; return result; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'), title = node('h2', 'Glass Hold'), fields = node('div'), actions = node('div'), status = node('output');
  title.id = 'spectralFreezeTitle'; dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', title.id); status.setAttribute('role', 'status');
  const say = value => { if (!disposed) { status.textContent = value; try { onStatus(value); } catch {} } };
  const select = label => { const wrapper = node('label', label), input = node('select'); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const option = (input, value, text) => { const entry = node('option', text); entry.value = String(value); input.append(entry); };
  const source = select('Digital source'), size = select('Analysis window'), audition = select('Audition');
  for (const n of [512, 1024, 2048]) option(size, n, n + ' frames'); size.value = '1024'; option(audition, 'blend', 'Immediate dry plus spectral return'); option(audition, 'wet', 'Spectral return only');
  const slider = (label, min, max, step, initial) => { const wrapper = node('label', label), input = node('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = initial; input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const blur = slider('BLUR', 0, 1, 0.01, 0.15), pitch = slider('Pitch ratio · prepare to apply', 0.5, 2, 0.01, 1), thaw = slider('THAW · seconds', 0.02, 2, 0.01, 0.25), mix = slider('Return level', 0, 0.25, 0.01, 0.15);
  const controls = [source, size, audition, blur, pitch, thaw, mix];
  const update = value => { if (!expected) throw new Error('Prepare Glass Hold first.'); return getPlayback().updateEffectGraph('freeze', { hold01: value }, undefined, expected); };
  const release = (all = false) => { if (!held && !(all && latched)) return; held = false; if (all) latched = false; if (latched) return; try { update(0); say('Thaw requested; the existing overlap and bounded spectral tail finish.'); } catch (error) { if (error.code !== 'stale-effect-control') say(error.message); } };
  const button = (label, callback, busy = false) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', async () => { if (disposed || pending && !busy) return; try { await callback(); } catch (error) { say(error.message); } }); actions.append(value); return value; };
  button('Prepare Glass Hold', async () => {
    release(true); const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('The physical audio owner is unavailable.');
    const model = createGlassHoldRecipe({ sourceBusId: source.value, fftSize: Number(size.value), blur01: Number(blur.value), pitchRatio: Number(pitch.value), thawSeconds: Number(thaw.value), wet01: Number(mix.value), wetOnly: audition.value === 'wet', revision: ++revision });
    const operation = { controller: new AbortController(), promise: null }; pending = operation; for (const input of controls) input.disabled = true;
    try { operation.promise = playback.prepareEffectGraph(model.graph, { signal: operation.controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const state = await operation.promise; if (!disposed && pending === operation) { expected = { ownerRouteRevision: state.revision, graphDefinitionHash: state.activeGraph.hash }; committed = model; say('Warming the real source window. HOLD captures the next complete analysis window; inspect its receipt for the actual interval.'); }
    } finally { if (pending === operation) pending = null; for (const input of controls) input.disabled = false; }
  });
  const hold = node('button', 'Hold current window'); hold.type = 'button'; actions.append(hold);
  const press = () => { if (disposed || pending || held || latched) return; try { update(1); held = true; say('Capture requested for the current digital source window.'); } catch (error) { say(error.message); } };
  listen(hold, 'pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); hold.focus(); press(); if (held) hold.setPointerCapture?.(event.pointerId); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(hold, event, () => release());
  listen(hold, 'keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) press(); } });
  listen(hold, 'keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); } }); listen(window, 'blur', () => release());
  const latch = button('Latch current window', () => { if (latched) { release(true); latch.setAttribute('aria-pressed', 'false'); return; } update(1); held = false; latched = true; latch.setAttribute('aria-pressed', 'true'); say('Latch owns the captured spectral state for up to twelve seconds. Thaw, closing or Panic releases it.'); }); latch.setAttribute('aria-pressed', 'false');
  button('Thaw', () => { release(true); latch.setAttribute('aria-pressed', 'false'); });
  button('Inspect capture', () => {
    const graph = getPlayback()?.inspectEffectGraph?.({ requestHealth: true })?.activeGraph;
    if (!expected || graph?.hash !== expected.graphDefinitionHash) throw new Error('The prepared freeze route is no longer active.');
    const receipt = graph.processors.find(entry => entry.nodeId === 'freeze')?.health;
    say(!receipt ? 'Awaiting the renderer receipt; inspect again after the next audio block.' : receipt.captureSerial ? receipt.state + ' · digital frames ' + receipt.captureStartFrame + '–' + receipt.captureEndFrame + (receipt.capturedSilence ? ' · captured silence' : '') + ' · transient material, not saved in the project' : receipt.state + ' · no window captured');
  });
  button('Save static defaults', () => { if (!committed) throw new Error('Prepare the recipe before saving.'); saveRack({ schema: 'lemmings-owner-effect-rack/v1', graph: committed.graph, bypass: 'active' }); say('Recipe defaults saved. The transient captured spectrum is unavailable after reload; use master capture to retain the performed output.'); });
  button('Panic and neutral dry', () => { release(true); if (expected) getPlayback()?.setEffectBypass?.('panic', expected); expected = committed = null; say('Owned spectral history cleared and the dry path restored.'); });
  const suspend = () => { release(true); latch.setAttribute('aria-pressed', 'false'); pending?.controller.abort(); if (dialog.open) dialog.close(); };
  button('Close', suspend, true); listen(dialog, 'cancel', event => { event.preventDefault(); suspend(); });
  dialog.append(title, node('p', 'Freeze the selected local digital bus. The spectral return has a fixed analysis delay; the dry attacks remain immediate. Silence can be captured, and a missing source stays unavailable. No microphone or external MIDI audio is captured.'),
    node('p', 'Experimental original resynthesis. Window size, blur, pitch and thaw changes require Prepare. Frozen spectra are transient and are not embedded by Save defaults.'), fields, actions, status);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (disposed) return; const previous = source.value; source.replaceChildren(); option(source, 'owner', 'Physical owner · pre-fader'); for (const lane of getLanes()) option(source, 'lane:' + lane.id, lane.name || lane.id); if (Array.from(source.options || []).some(entry => entry.value === previous)) source.value = previous; if (!dialog.open) dialog.showModal(); }, suspend,
    dispose() { return retirement.retire([{ name: 'freeze-surface', run: async () => { suspend(); disposed = true; const operation = pending; await operation?.promise?.catch(() => {}); for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
