import { createQuarryEcho, createQuarryTape, createQuarryBody, validateOwnerEffectRack } from '../../midi/content/DubQuarryRack.js';
import { ORIGINAL_IMPULSE_PRESETS } from '../../midi/content/ProceduralImpulseMaterial.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createQuarryEchoView({ document, window, getPlayback, getSavedRack, saveRack, onStatus = () => {} } = {}) {
  if (!document?.createElement || typeof getPlayback !== 'function' || typeof getSavedRack !== 'function' || typeof saveRack !== 'function') throw new TypeError('Quarry Echo needs the physical owner and saved project settings.');
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, held = null, revision = 0;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', 'quarryEchoTitle');
  const title = node('h2', 'Quarry Echo · physical owner'); title.id = 'quarryEchoTitle';
  const description = node('p', 'Enable browser audio, choose a delay or original reflection body, then prepare it. Hold THROW to send the running physical voices into its bounded return. Release stops new input and leaves the stored tail.');
  const qualification = node('p', 'Experimental original effects. Body normalization and conservative gain bounds are checked before activation; native convolution latency is unmeasured. Browser, PCM and listening qualification is pending. Live effect gestures are not stored in causal takes; master audio capture can retain the played output.');
  const fields = node('div'), actions = node('div'), status = node('output', 'No echo prepared.'); status.setAttribute('role', 'status');
  const say = value => { if (!disposed) { status.textContent = value; try { onStatus(value); } catch { /* Status cannot alter the rack. */ } } };
  const live = (id, values, expected) => { const playback = getPlayback(); if (!playback?.updateEffectGraph) throw new Error('The physical owner is unavailable.'); return playback.updateEffectGraph(id, values, undefined, expected); };
  const slider = (name, min, max, step, initial, update) => {
    const label = node('label', name), input = node('input'), amount = node('output', String(initial)); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = initial; input.setAttribute('aria-label', name);
    label.append(input, amount); fields.append(label);
    listen(input, 'input', () => { amount.textContent = input.value; try { update?.(Number(input.value)); } catch (error) { say(error.message); } });
    return { input, label, set(value) { input.value = value; amount.textContent = input.value; }, value: () => Number(input.value) };
  };
  const time = slider('TIME · milliseconds', 70, 750, 1, 240, value => live('echo', { delaySeconds: value / 1000 }));
  const feedback = slider('FEEDBACK', 0, 0.7, 0.01, 0.3, value => live('echo', { feedback: value }));
  const age = slider('AGE · drive and feedback damping', 0, 1, 0.01, 0.35, value => { const receipt = live('preamp', { driveDb: 2 + value * 10 }); live('echo', { feedbackLowpassHz: 7000 - value * 5500 }, receipt); });
  const level = slider('SPACE · return', 0, 0.35, 0.01, 0.2, value => live('return', { gain01: value }));
  const amount = slider('THROW amount', 0, 0.65, 0.01, 0.35);
  const mode = node('select'); mode.setAttribute('aria-label', 'Delay time transition');
  for (const [value, text] of [['glide', 'Tape glide · changes pitch'], ['jump', 'Two-tap jump crossfade']]) { const option = node('option', text); option.value = value; mode.append(option); } fields.append(mode);
  const preset = node('select'); preset.setAttribute('aria-label', 'Quarry effect recipe');
  for (const [value, text] of [['echo', 'Quarry Echo · bounded delay'], ['tape', 'Quarry Tape · original cubic preamp and darkening echo'], ...ORIGINAL_IMPULSE_PRESETS.map(entry => [entry.id, entry.name + ' · ' + entry.layout + ' · ' + entry.durationSeconds + ' s'])]) {
    const option = node('option', text); option.value = value; preset.append(option);
  }
  fields.prepend(preset);
  const bodyDetails = node('p'); fields.append(bodyDetails);
  const showPreset = () => {
    const body = ORIGINAL_IMPULSE_PRESETS.find(entry => entry.id === preset.value);
    time.label.hidden = feedback.label.hidden = mode.hidden = Boolean(body);
    age.label.hidden = preset.value !== 'tape'; time.input.min = preset.value === 'tape' ? 160 : 70; if (time.value() < Number(time.input.min)) time.set(Number(time.input.min));
    level.input.max = body ? 0.3 : 0.35; if (level.value() > Number(level.input.max)) level.set(Number(level.input.max));
    bodyDetails.textContent = body ? 'Fixed original ' + body.durationSeconds + ' s body; explicit native RMS normalization and authored reference gain. Algorithm latency is unknown. Preparing a replacement crossfades input and retains the old bounded tail.' : preset.value === 'tape' ? 'Original 2× cubic preamp with first-order ADAA, 100 Hz input highpass and 20 Hz DC block. AGE adds drive and darkens the feedback filter. Filter/ADAA delay is declared; spectral and level matching qualification is pending. This is not a hardware emulation.' : 'TIME is an audio delay in milliseconds. It does not represent an actor journey.';
  };
  const model = () => { revision = Math.max(revision + 1, (getSavedRack()?.graph.revision || 0) + 1);
    return ['echo', 'tape'].includes(preset.value) ? (preset.value === 'tape' ? createQuarryTape : createQuarryEcho)({ revision, delaySeconds: time.value() / 1000, feedback: feedback.value(), return01: level.value(), send01: 0, mode: mode.value, ...(preset.value === 'tape' ? { age01: age.value() } : {}) }) :
      createQuarryBody({ revision, bodyId: preset.value, return01: level.value(), send01: 0 });
  };
  const release = () => {
    const previous = held; held = null; if (!previous) return;
    try { live('send', { gain01: 0 }, previous.receipt); say('THROW released; the admitted echo tail can decay.'); }
    catch (error) { if (error.code !== 'stale-effect-control') say(error.message); }
  };
  const throwButton = node('button', 'Hold THROW'); throwButton.type = 'button'; throwButton.setAttribute('aria-label', 'Hold to send physical voices into the Quarry return'); actions.append(throwButton);
  const press = source => { if (disposed || pending || held) return; try { held = { source, receipt: live('send', { gain01: amount.value() }) }; say('Sending physical owner audio into Quarry Echo.'); } catch (error) { say(error.message); } };
  listen(throwButton, 'pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); throwButton.focus(); press('pointer'); if (held) throwButton.setPointerCapture?.(event.pointerId); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(throwButton, event, release);
  listen(throwButton, 'keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) press('keyboard'); } });
  listen(throwButton, 'keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); } });
  listen(window, 'blur', release);
  const run = action => async () => { if (pending || disposed) return; try { await action(); } catch (error) { say(error.message); } };
  const button = (label, callback) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', callback); actions.append(value); return value; };
  const prepare = button('Prepare effect', run(async () => {
    release(); const playback = getPlayback(); if (!playback?.prepareEffectGraph) throw new Error('The physical owner is unavailable.');
    const controller = new AbortController(), operation = { controller, promise: null }; pending = operation; prepare.disabled = true;
    const controls = [preset, mode, time.input, feedback.input, age.input, level.input, amount.input]; for (const control of controls) control.disabled = true;
    try { operation.promise = playback.prepareEffectGraph(model(), { signal: controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const state = await operation.promise; if (!disposed && pending === operation) say('Quarry effect prepared at owner route ' + state.revision + '. Hold THROW when physical voices are playing.'); }
    finally { if (pending === operation) pending = null; prepare.disabled = false; for (const control of controls) control.disabled = false; }
  }));
  button('Save defaults', run(async () => { const rack = validateOwnerEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph: model(), bypass: 'active' }); await saveRack(rack); say('Quarry Echo defaults saved in this project. Live gestures remain separate from saved defaults.'); }));
  const load = () => {
    const rack = getSavedRack(); if (!rack) return;
    const body = ORIGINAL_IMPULSE_PRESETS.find(entry => rack.graph.id === 'dub-quarry.body.' + entry.id);
    const tape = rack.graph.id === 'dub-quarry.tape';
    if (rack.graph.id !== 'dub-quarry.echo' && !tape && !body) { say('The saved owner rack uses another graph.'); return; }
    const echo = rack.graph.nodes.find(entry => entry.id === 'echo'), output = rack.graph.nodes.find(entry => entry.id === 'return');
    if (!output || !body && !echo) { say('The saved Quarry topology is unavailable.'); return; }
    const preamp = rack.graph.nodes.find(entry => entry.id === 'preamp'); if (tape && !preamp) { say('The saved Quarry Tape preamp is unavailable.'); return; }
    preset.value = body?.id || (tape ? 'tape' : 'echo'); showPreset(); level.set(output.parameters.gain01); if (tape) age.set((preamp.parameters.driveDb - 2) / 10);
    if (echo) { time.set(echo.parameters.delaySeconds * 1000); feedback.set(echo.parameters.feedback); mode.value = echo.parameters.mode; }
    revision = Math.max(revision, rack.graph.revision);
  };
  button('Load saved defaults', load);
  for (const [value, label] of [['neutral', 'Neutral dry'], ['tail', 'Bypass with tail'], ['mute', 'Mute owner rack'], ['panic', 'Clear echo tails']]) button(label, run(() => { release(); const result = getPlayback()?.setEffectBypass?.(value); if (!result) throw new Error('Prepare an owner rack before changing its bypass state.'); say(label + ' requested for the physical owner.'); }));
  const close = () => { release(); pending?.controller.abort(new Error('Echo preparation canceled.')); if (dialog.open) dialog.close(); };
  listen(preset, 'change', () => { release(); showPreset(); say('Recipe selected. Prepare effect to replace the running graph.'); }); showPreset();
  button('Close', close); listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  dialog.append(title, description, qualification, fields, actions, status); (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (!disposed) { load(); if (!dialog.open) dialog.showModal(); } }, suspend: close,
    dispose() { return retirement.retire([{ name: 'quarry-echo-view', run: async () => { disposed = true; release(); const operation = pending; operation?.controller.abort(new Error('Echo view retired.')); await operation?.promise?.catch(() => {}); for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
