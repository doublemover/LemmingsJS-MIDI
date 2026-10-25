import { scopeQuarryThrowToVoices, createQuarryEcho, createQuarryDuck, createQuarryTape, createQuarryTapeSpring, createQuarryBody, validateOwnerEffectRack } from '../../midi/content/DubQuarryRack.js';
import { ORIGINAL_IMPULSE_PRESETS } from '../../midi/content/ProceduralImpulseMaterial.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createQuarryEchoView({ document, window, getPlayback, getSavedRack, saveRack, onCrossExcitation = null, onTravelColoration = null, onSpectralFreeze = null, onSympatheticMap = null, onRectangularMembrane = null, onStatus = () => {} } = {}) {
  if (!document?.createElement || typeof getPlayback !== 'function' || typeof getSavedRack !== 'function' || typeof saveRack !== 'function') throw new TypeError('Quarry Echo needs the physical owner and saved project settings.');
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, pending = null, held = null, revision = 0, springBlend01 = 0.15, inspectionTimer = null, preparedToken = null, preparedVoices = null, selectableVoices = [];
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-labelledby', 'quarryEchoTitle');
  const title = node('h2', 'Quarry Echo · physical owner'); title.id = 'quarryEchoTitle';
  const description = node('p', 'Enable browser audio, choose a delay or original reflection body, then prepare it. Hold THROW to send the running physical voices into its bounded return. Release stops new input and leaves the stored tail.');
  const qualification = node('p', 'Experimental original effects. Body normalization and conservative gain bounds are checked before activation; native convolution latency is unmeasured. Browser, PCM and listening qualification is pending. Causal takes can store effect API commands. The captured-command revoice mode supports one unchanged owned graph with cleared initial memory; master capture retains the actual digital output.');
  const fields = node('div'), actions = node('div'), status = node('output', 'No echo prepared.'); status.setAttribute('role', 'status');
  const say = value => { if (!disposed) { status.textContent = value; try { onStatus(value); } catch { /* Status cannot alter the rack. */ } } };
  const live = (id, values, expected) => { const playback = getPlayback(); if (!playback?.updateEffectGraph) throw new Error('The physical owner is unavailable.'); const token = expected || preparedToken; if (!token) return null; return playback.updateEffectGraph(id, values, undefined, token); };
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
  for (const [value, text] of [['echo', 'Quarry Echo · bounded delay'], ['duck', 'Quarry Duck · source-shaped echo return'], ['tape', 'Quarry Tape · original cubic preamp and darkening echo'], ['tape-spring', 'Quarry Tape + Spring · one shared echo and body'], ...ORIGINAL_IMPULSE_PRESETS.map(entry => [entry.id, entry.name + ' · ' + entry.layout + ' · ' + entry.durationSeconds + ' s'])]) {
    const option = node('option', text); option.value = value; preset.append(option);
  }
  fields.prepend(preset);
  const scope = node('select'); scope.setAttribute('aria-label', 'THROW source scope');
  for (const [value, text] of [['owner', 'Physical owner sum'], ['voices', 'Selected admitted causal voices']]) { const option = node('option', text); option.value = value; scope.append(option); }
  const voicePicker = node('select'); voicePicker.multiple = true; voicePicker.size = 4; voicePicker.setAttribute('aria-label', 'Actual source voices for the throw');
  const tap = node('select'); tap.setAttribute('aria-label', 'Selected voice lane tap');
  for (const [value, text] of [['post-fader', 'After lane fader, pan, mute and solo'], ['pre-fader', 'Before lane fader · includes muted source audio']]) { const option = node('option', text); option.value = value; tap.append(option); }
  const refreshVoices = node('button', 'Refresh admitted voices'); refreshVoices.type = 'button';
  const refreshVoiceList = () => {
    const old = new Set(Array.from(voicePicker.options || voicePicker.children).filter(option => option.selected).map(option => selectableVoices[Number(option.value)]).filter(Boolean).map(voice => voice.generation + ':' + voice.voiceId));
    selectableVoices = getPlayback()?.effectSourceVoices?.() || []; voicePicker.replaceChildren();
    for (let index = 0; index < selectableVoices.length; index++) { const voice = selectableVoices[index], option = node('option', 'Actor ' + voice.actorId + ' · ' + voice.instrumentId + ' · lane ' + voice.laneId); option.value = String(index); option.selected = old.has(voice.generation + ':' + voice.voiceId); voicePicker.append(option); }
  };
  listen(refreshVoices, 'click', refreshVoiceList); fields.append(scope, voicePicker, tap, refreshVoices);
  const selectedVoices = () => { const members = Array.from(voicePicker.options || voicePicker.children).filter(option => option.selected).map(option => selectableVoices[Number(option.value)]).filter(Boolean).map(voice => ({ voiceId: voice.voiceId, generation: voice.generation })); if (!members.length) throw new Error('Select admitted causal voices and Prepare. Owner sum is a separate explicit scope.'); return members; };
  const bodyDetails = node('p'); fields.append(bodyDetails);
  const showPreset = () => {
    const body = ORIGINAL_IMPULSE_PRESETS.find(entry => entry.id === preset.value);
    time.label.hidden = feedback.label.hidden = mode.hidden = Boolean(body);
    age.label.hidden = !['tape', 'tape-spring'].includes(preset.value); time.input.min = ['tape', 'tape-spring'].includes(preset.value) ? 160 : 70; if (time.value() < Number(time.input.min)) time.set(Number(time.input.min));
    level.input.max = body ? 0.3 : 0.35; if (level.value() > Number(level.input.max)) level.set(Number(level.input.max));
    bodyDetails.textContent = body ? 'Fixed original ' + body.durationSeconds + ' s body; explicit native RMS normalization and authored reference gain. Algorithm latency is unknown. Preparing a replacement crossfades input and retains the old bounded tail.' : preset.value === 'tape-spring' ? 'Original cubic preamp and dark echo feeding a shared Hollow Spring blend. Native body latency is unknown; its authored predelay is retained.' : preset.value === 'tape' ? 'Original 2× cubic preamp with first-order ADAA, 100 Hz input highpass and 20 Hz DC block. AGE adds drive and darkens the feedback filter. Filter/ADAA delay is declared; spectral and level matching qualification is pending. This is not a hardware emulation.' : preset.value === 'duck' ? 'The physical owner controls only the echo return: 3 ms attack, 150 ms release, fixed reference 0.25 and a 0.25 gain floor. Reactive detector with no lookahead; the dry attack stays independent.' : 'TIME is an audio delay in milliseconds. It does not represent an actor journey.';
  };
  const model = () => { revision = Math.max(revision + 1, (getSavedRack()?.graph.revision || 0) + 1);
    return ['echo', 'duck', 'tape', 'tape-spring'].includes(preset.value) ? (preset.value === 'tape-spring' ? createQuarryTapeSpring : preset.value === 'tape' ? createQuarryTape : preset.value === 'duck' ? createQuarryDuck : createQuarryEcho)({ revision, delaySeconds: time.value() / 1000, feedback: feedback.value(), return01: level.value(), send01: 0, mode: mode.value, ...(['tape', 'tape-spring'].includes(preset.value) ? { age01: age.value() } : {}), ...(preset.value === 'tape-spring' ? { springBlend01 } : {}) }) :
      createQuarryBody({ revision, bodyId: preset.value, return01: level.value(), send01: 0 });
  };
  const release = () => {
    const previous = held; held = null; if (!previous) return;
    try { live('send', { gain01: 0 }, previous.receipt); say('THROW released; the admitted echo tail can decay.'); }
    catch (error) { if (error.code !== 'stale-effect-control') say(error.message); }
  };
  const throwButton = node('button', 'Hold THROW'); throwButton.type = 'button'; throwButton.setAttribute('aria-label', 'Hold to send physical voices into the Quarry return'); actions.append(throwButton);
  const press = source => { if (disposed || pending || held) return; try { if (!preparedToken) throw new Error('Prepare this Quarry rack before performing a throw.'); if (preparedVoices && !preparedVoices.some(member => getPlayback()?.isEffectSourceVoiceAvailable?.(member))) throw new Error('The selected voices ended. Refresh and prepare a new selection.'); held = { source, receipt: live('send', { gain01: amount.value() }) }; say(preparedVoices ? 'Sending only the prepared causal voice selection into Quarry Echo.' : 'Sending physical owner audio into Quarry Echo.'); } catch (error) { say(error.message); } };
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
    const controls = [preset, mode, time.input, feedback.input, age.input, level.input, amount.input, scope, voicePicker, tap, refreshVoices]; for (const control of controls) control.disabled = true;
    try { const members = scope.value === 'voices' ? selectedVoices() : null, graph = members ? scopeQuarryThrowToVoices(model(), members, tap.value) : model();
      operation.promise = playback.prepareEffectGraph(graph, { signal: controller.signal, isCurrent: () => !disposed && pending === operation && getPlayback() === playback });
      const state = await operation.promise; if (!disposed && pending === operation) { preparedToken = { graphDefinitionHash: state.activeGraph.hash, ownerRouteRevision: state.revision }; preparedVoices = members; say('Quarry effect prepared at owner route ' + state.revision + (members ? ' for ' + members.length + ' selected causal voices.' : ' for the physical owner sum.')); } }
    finally { if (pending === operation) pending = null; prepare.disabled = false; for (const control of controls) control.disabled = false; }
  }));
  if (typeof onRectangularMembrane === 'function') button('Rectangular skin', () => { release(); onRectangularMembrane(); });
  if (typeof onSympatheticMap === 'function') button('Shared bodies', () => { release(); onSympatheticMap(); });
  if (typeof onSpectralFreeze === 'function') button('Glass Hold', () => { release(); onSpectralFreeze(); });
  if (typeof onTravelColoration === 'function') button('Travel color', () => { release(); onTravelColoration(); });
  if (typeof onCrossExcitation === 'function') button('Interlocking lanes', () => { release(); onCrossExcitation(); });
  button('Save defaults', run(async () => { const rack = validateOwnerEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph: model(), bypass: 'active' }); await saveRack(rack); say('Quarry Echo defaults saved in this project. Voice selections and live gestures remain separate from saved owner-sum defaults.'); }));
  const load = () => {
    const rack = getSavedRack(); if (!rack) return;
    const body = ORIGINAL_IMPULSE_PRESETS.find(entry => rack.graph.id === 'dub-quarry.body.' + entry.id);
    const duck = rack.graph.id === 'dub-quarry.duck';
    const spring = rack.graph.id === 'dub-quarry.tape-spring', tape = spring || rack.graph.id === 'dub-quarry.tape';
    if (rack.graph.id !== 'dub-quarry.echo' && !tape && !body && !duck) { say('The saved owner rack uses another graph.'); return; }
    if (spring) { const edge = rack.graph.edges.find(edge => edge.from.nodeId === 'spring' && edge.to.nodeId === 'wet-sum');
      if (!edge || !Number.isFinite(edge.gain01) || edge.gain01 < 0 || edge.gain01 > 0.3) { say('The saved spring blend is unavailable.'); return; } springBlend01 = edge.gain01; }
    const echo = rack.graph.nodes.find(entry => entry.id === 'echo'), output = rack.graph.nodes.find(entry => entry.id === 'return');
    if (!output || !body && !echo) { say('The saved Quarry topology is unavailable.'); return; }
    const preamp = rack.graph.nodes.find(entry => entry.id === 'preamp'); if (tape && !preamp) { say('The saved Quarry Tape preamp is unavailable.'); return; }
    preset.value = body?.id || (spring ? 'tape-spring' : tape ? 'tape' : duck ? 'duck' : 'echo'); showPreset(); level.set(output.parameters.gain01); if (tape) age.set((preamp.parameters.driveDb - 2) / 10);
    if (echo) { time.set(echo.parameters.delaySeconds * 1000); feedback.set(echo.parameters.feedback); mode.value = echo.parameters.mode; }
    revision = Math.max(revision, rack.graph.revision);
  };
  button('Load saved defaults', load);
  for (const [value, label] of [['neutral', 'Neutral dry'], ['tail', 'Bypass with tail'], ['mute', 'Mute owner rack'], ['panic', 'Clear echo tails']]) button(label, run(() => { release(); const result = getPlayback()?.setEffectBypass?.(value); if (!result) throw new Error('Prepare an owner rack before changing its bypass state.'); preparedToken = null; preparedVoices = null; say(label + ' requested for the physical owner.'); }));
  const close = () => { if (inspectionTimer !== null) clearInterval(inspectionTimer); inspectionTimer = null; release(); pending?.controller.abort(new Error('Echo preparation canceled.')); if (dialog.open) dialog.close(); };
  listen(scope, 'change', () => { release(); voicePicker.hidden = tap.hidden = refreshVoices.hidden = scope.value !== 'voices'; if (scope.value === 'voices') refreshVoiceList(); }); voicePicker.hidden = tap.hidden = refreshVoices.hidden = true;
  listen(preset, 'change', () => { release(); springBlend01 = 0.15; showPreset(); say('Recipe selected. Prepare effect to replace the running graph.'); }); showPreset();
  button('Close', close); listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  const activity = node('output'); activity.setAttribute('aria-label', 'Focused detector activity');
  const inspect = () => {
    if (!dialog.open || document.hidden) return;
    const state = getPlayback()?.inspectEffectGraph?.({ requestHealth: true }), graph = state?.activeGraph;
    const detectors = graph?.processors?.filter(entry => entry.kind === 'envelope-detector') || [];
    activity.textContent = detectors.map(entry => entry.nodeId + ': ' + (!entry.health ? 'awaiting detector receipt' : entry.health.muted ? 'quarantined' : entry.health.sourceAvailable === false ? 'no donor input; releasing' : 'donor connected, envelope ' + entry.health.output.toFixed(3))).join(' · ');
    const banks = graph?.processors?.filter(entry => entry.kind === 'multiband-vocoder') || [];
    if (banks.length) activity.textContent += ' ' + banks.map(entry => { const health = entry.health; return entry.nodeId + ': ' + (!health ? 'awaiting bank receipt' : health.muted ? 'bank quarantined' : !health.donorAvailable ? 'no donor; releasing' : !health.carrierAvailable ? 'no carrier' : 'donor ' + health.donorPeak.toFixed(3) + ', carrier ' + health.carrierPeak.toFixed(3) + ', envelope ' + health.envelopePeak.toFixed(3)); }).join(' · ');
    const routes = graph?.sidechains || []; if (routes.length) activity.textContent += ' ' + routes.map(route => route.sourceBusId + ' ' + route.tap + ' → ' + route.id + ': ' + route.status).join(' · ');
  };
  dialog.append(title, description, qualification, fields, actions, activity, status); (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (!disposed) { load(); if (!dialog.open) dialog.showModal(); if (inspectionTimer === null) inspectionTimer = setInterval(inspect, 250); inspect(); } }, suspend: close,
    dispose() { return retirement.retire([{ name: 'quarry-echo-view', run: async () => { disposed = true; if (inspectionTimer !== null) clearInterval(inspectionTimer); inspectionTimer = null; release(); const operation = pending; operation?.controller.abort(new Error('Echo view retired.')); await operation?.promise?.catch(() => {}); for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
