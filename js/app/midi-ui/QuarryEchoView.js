import { createQuarryEcho, validateOwnerEffectRack } from '../../midi/content/DubQuarryRack.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createQuarryEchoView({ document, window, getPlayback, getSavedRack, saveRack, onStatus = () => {} } = {}) {
  if (!document?.createElement || typeof getPlayback !== 'function' || typeof getSavedRack !== 'function' || typeof saveRack !== 'function') throw new TypeError('Quarry Echo needs the physical owner and saved project settings.');
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, held = null, revision = 0;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', 'quarryEchoTitle');
  const title = node('h2', 'Quarry Echo · physical owner'); title.id = 'quarryEchoTitle';
  const description = node('p', 'Enable browser audio, then prepare the echo. Hold THROW to send the running physical voices into its bounded return. Release stops new input and leaves the stored tail.');
  const qualification = node('p', 'Experimental original delay design. Control requests use native scheduling; browser, PCM and listening qualification is pending. Live effect gestures are not stored in causal takes; master audio capture can retain the played output.');
  const fields = node('div'), actions = node('div'), status = node('output', 'No echo prepared.'); status.setAttribute('role', 'status');
  const say = value => { if (!disposed) { status.textContent = value; try { onStatus(value); } catch { /* Status cannot alter the rack. */ } } };
  const live = (id, values, expected) => { const playback = getPlayback(); if (!playback?.updateEffectGraph) throw new Error('The physical owner is unavailable.'); return playback.updateEffectGraph(id, values, undefined, expected); };
  const slider = (name, min, max, step, initial, update) => {
    const label = node('label', name), input = node('input'), amount = node('output', String(initial)); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = initial; input.setAttribute('aria-label', name);
    label.append(input, amount); fields.append(label);
    listen(input, 'input', () => { amount.textContent = input.value; try { update?.(Number(input.value)); } catch (error) { say(error.message); } });
    return { input, set(value) { input.value = value; amount.textContent = input.value; }, value: () => Number(input.value) };
  };
  const time = slider('TIME · milliseconds', 70, 750, 1, 240, value => live('echo', { delaySeconds: value / 1000 }));
  const feedback = slider('FEEDBACK', 0, 0.7, 0.01, 0.3, value => live('echo', { feedback: value }));
  const level = slider('RETURN', 0, 0.35, 0.01, 0.2, value => live('return', { gain01: value }));
  const amount = slider('THROW amount', 0, 0.65, 0.01, 0.35);
  const mode = node('select'); mode.setAttribute('aria-label', 'Delay time transition');
  for (const [value, text] of [['glide', 'Tape glide · changes pitch'], ['jump', 'Two-tap jump crossfade']]) { const option = node('option', text); option.value = value; mode.append(option); } fields.append(mode);
  const model = () => { revision = Math.max(revision + 1, (getSavedRack()?.graph.revision || 0) + 1); return createQuarryEcho({ revision, delaySeconds: time.value() / 1000, feedback: feedback.value(), return01: level.value(), send01: 0, mode: mode.value }); };
  const release = () => {
    const previous = held; held = null; if (!previous) return;
    try { live('send', { gain01: 0 }, previous.receipt); say('THROW released; the admitted echo tail can decay.'); }
    catch (error) { if (error.code !== 'stale-effect-control') say(error.message); }
  };
  const throwButton = node('button', 'Hold THROW'); throwButton.type = 'button'; throwButton.setAttribute('aria-label', 'Hold to send physical voices into Quarry Echo'); actions.append(throwButton);
  const press = source => { if (disposed || pending || held) return; try { held = { source, receipt: live('send', { gain01: amount.value() }) }; say('Sending physical owner audio into Quarry Echo.'); } catch (error) { say(error.message); } };
  listen(throwButton, 'pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); throwButton.focus(); press('pointer'); if (held) throwButton.setPointerCapture?.(event.pointerId); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(throwButton, event, release);
  listen(throwButton, 'keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) press('keyboard'); } });
  listen(throwButton, 'keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); } });
  listen(window, 'blur', release);
  const run = action => async () => { if (pending || disposed) return; try { await action(); } catch (error) { say(error.message); } };
  const button = (label, callback) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', callback); actions.append(value); return value; };
  const prepare = button('Prepare echo', run(async () => {
    release(); const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('The physical owner is unavailable.');
    const controller = new AbortController(), operation = { controller, promise: null }; pending = operation; prepare.disabled = true;
    operation.promise = playback.prepareEffectGraph(model(), { signal: controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
    try { const state = await operation.promise; if (!disposed && pending === operation) say('Quarry Echo prepared at owner route ' + state.revision + '. Hold THROW when physical voices are playing.'); }
    finally { if (pending === operation) pending = null; prepare.disabled = false; }
  }));
  button('Save defaults', run(async () => { const rack = validateOwnerEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph: model(), bypass: 'active' }); await saveRack(rack); say('Quarry Echo defaults saved in this project. Live gestures remain separate from saved defaults.'); }));
  const load = () => {
    const rack = getSavedRack(); if (!rack) return;
    if (rack.graph.id !== 'dub-quarry.echo') { say('The saved owner rack uses another graph.'); return; }
    const echo = rack.graph.nodes.find(entry => entry.id === 'echo'), output = rack.graph.nodes.find(entry => entry.id === 'return');
    if (!echo || !output) { say('The saved Quarry Echo topology is unavailable.'); return; }
    time.set(echo.parameters.delaySeconds * 1000); feedback.set(echo.parameters.feedback); level.set(output.parameters.gain01); mode.value = echo.parameters.mode; revision = Math.max(revision, rack.graph.revision);
  };
  button('Load saved defaults', load);
  for (const [value, label] of [['neutral', 'Neutral dry'], ['tail', 'Bypass with tail'], ['mute', 'Mute owner rack'], ['panic', 'Clear echo tails']]) button(label, run(() => { release(); const result = getPlayback()?.setEffectBypass?.(value); if (!result) throw new Error('Prepare an owner rack before changing its bypass state.'); say(label + ' requested for the physical owner.'); }));
  const close = () => { release(); pending?.controller.abort(new Error('Echo preparation canceled.')); if (dialog.open) dialog.close(); };
  button('Close', close); listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  dialog.append(title, description, qualification, fields, actions, status); (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (!disposed) { load(); if (!dialog.open) dialog.showModal(); } }, suspend: close,
    dispose() { return retirement.retire([{ name: 'quarry-echo-view', run: async () => { disposed = true; release(); const operation = pending; operation?.controller.abort(new Error('Echo view retired.')); await operation?.promise?.catch(() => {}); for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
