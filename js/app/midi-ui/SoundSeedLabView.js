import { createResonatorMorphView } from './ResonatorMorphView.js';
import { createTextureBodyTravelBinding } from '../../midi/content/TextureBodyGraftRecipe.js';
import { createMotionBodyTraversalBinding } from '../../midi/content/InstrumentGraft.js';
import { planSoundSeedRebuild } from '../../midi/content/SoundSeedRebuildPlan.js';
import { createSoundSeedRebuildOwner } from './SoundSeedRebuildOwner.js';
import { createSoundSeedDerivedOwner } from './SoundSeedDerivedOwner.js';
import { createSoundSeedAnalysisOwner } from './SoundSeedAnalysisOwner.js';
import { createSoundSeedInstrumentOwner } from './SoundSeedInstrumentOwner.js';
import { createInstrumentDisplayScheduler } from '../resources/InstrumentDisplayScheduler.js';
import { deliverArtifactToAnchor } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createSoundSeedLabView({ document, window, audio, getPlayback = () => null, resourceBudget, jobs, displayScheduler, onApply, getTargetIdentity = () => null, getTravelMappings = () => [], onStatus = () => {} } = {}) {
  const listeners = [], modeListeners = [], retirement = createProcgenRetirementScope();
  const scheduler = displayScheduler || createInstrumentDisplayScheduler({ document, window, resourceBudget });
  let analysis, instrument, derived, composition, compositionDraft = -1, compositionRevision = 0, preparedCompositionRevision = -1, modal, rebuild, surface, offeredSource = null, offeredSerial = 0, rebuildPlan = null, branchDrawn = null, modalSelection = null, modalRevision = 0, preparedModalRevision = -1, modalDraft = -1, modalDrawn = null, modalParentSelection = null, editableModes = [], selectedModes = new Set(), derivedSelection = null, derivedDraft = -1, derivedDrawn = null, disposed = false, active = null, draft = 0, candidateDraft = -1, recipeDraft = 0, compiledDraft = -1, drawn = null, sourceSelection = 0;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const listen = (element, event, handler) => { element.addEventListener(event, handler); listeners.push(() => element.removeEventListener(event, handler)); };
  const root = node('section'); root.className = 'studio-seed-lab'; root.hidden = true; root.setAttribute('aria-label', 'Sound seed laboratory');
  const title = node('h2', 'Sound seed'), sourceText = node('p'), scope = node('p', 'Local retained browser audio only. Separate-device cue is excluded from master capture; live-output rehearsal is included. This action uses no microphone, system capture or upload.');
  const ruler = node('output'), canvas = node('canvas'); canvas.width = 960; canvas.height = 160; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Actual stereo min/max waveform; exact trim frames are in the controls below');
  const plot = node('div'); plot.className = 'studio-seed-plot'; plot.append(ruler, canvas);
  const fields = node('div'); fields.className = 'studio-seed-fields';
  const field = (name, element) => { const label = node('label', name); label.className = 'studio-field'; element.setAttribute('aria-label', name); label.append(element); fields.append(label); return element; };
  const numeric = (name, value, min = 0, max = Number.MAX_SAFE_INTEGER) => { const input = node('input'); input.type = 'number'; input.step = '1'; input.min = String(min); input.max = String(max); input.value = String(value); return field(name, input); };
  const select = (name, choices) => { const input = node('select'); for (const [value, text] of choices) { const option = node('option', text); option.value = value; input.append(option); } return field(name, input); };
  const first = numeric('Trim in · parent frame', 0), end = numeric('Trim out · exclusive parent frame', 1, 1), fadeIn = numeric('Fade in · frames', 64, 0, 4096), fadeOut = numeric('Fade out · frames', 64, 0, 4096);
  const trimIn = node('input'), trimOut = node('input'); for (const input of [trimIn, trimOut]) { input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '1'; } field('Trim in handle', trimIn); field('Trim out handle', trimOut);
  const law = select('Fade law', [['linear', 'Linear'], ['equal-power', 'Equal power']]);
  const transform = select('Seed recipe', [['hammer-seed', 'Hammer seed · new contact'], ['ice-dust', 'Ice dust · granular tail'], ['route-relic', 'Route relic · recorded phrase']]);
  { const option = node('option', 'Found body · fitted modal approximation'); option.value = 'modal-body'; transform.append(option); }
  { const option = node('option', 'Finite sample → modal body graft'); option.value = 'feedforward-graft'; transform.append(option); }
  { const option = node('option', 'Observed travel audio → modal body'); option.value = 'motion-body-graft'; transform.append(option); }
  { const option = node('option', 'Spatial texture → modal body'); option.value = 'texture-body-graft'; transform.append(option); }
  const textureKind = select('Spatial texture exciter', [['sand-drag', 'Sand drag'], ['cloth-rub', 'Cloth rub'], ['crackle-skin', 'Crackle skin'], ['foam-air', 'Foam air']]);
  const graftBody = select('Graft body component', [['tin', 'Original tin modal body · 6 modes'], ['wood', 'Original dry wood modal body · 4 modes'], ['fitted', 'Current reviewed fitted body']]);
  const travelMapping = select('Committed local travel mapping', []), travelScale = numeric('Source frames per world pixel', 100, 0.000001, 1000000); travelScale.step = '0.1';
  const refreshTravelChoices = () => { const old = travelMapping.value; travelMapping.replaceChildren(); const mappings = getTravelMappings().slice(0, 512); for (const mapping of mappings) { const option = node('option', mapping.id + ' · ' + mapping.articulation.orientation); option.value = mapping.id; travelMapping.append(option); } if (!mappings.length) { const option = node('option', 'No supported committed local journey mapping'); option.value = ''; travelMapping.append(option); } else if (mappings.some(mapping => mapping.id === old)) travelMapping.value = old; };
  const currentTraversalBinding = () => transform.value === 'texture-body-graft' ? createTextureBodyTravelBinding(getTravelMappings().find(mapping => mapping.id === travelMapping.value)) : transform.value === 'motion-body-graft' ? createMotionBodyTraversalBinding(getTravelMappings().find(mapping => mapping.id === travelMapping.value), { framesPerWorldPixel: Number(travelScale.value) }) : null; refreshTravelChoices();
  const pitch = select('Pitch declaration', [['unpitched', 'Unpitched · fixed source rate'], ['pitched', 'Declared root · varispeed']]), rootPitch = numeric('Declared root · MIDI cents', 6000, 2400, 9600);
  const zoom = select('Waveform zoom', [['1', 'Whole prepared window'], ['2', '2×'], ['4', '4×'], ['8', '8×']]), viewFirst = numeric('Waveform first local frame', 0);
  const auditionMode = select('Audition repeat', [['1', 'Once'], ['3', 'Explicit loop · 3 passes, up to 8s per sample pass']]);
  const crossing = node('output'); crossing.setAttribute('aria-label', 'Zero crossing suggestions');
  const status = node('output'), readiness = node('output'), warnings = node('p'), cause = node('details'), causeTitle = node('summary', 'Baked ancestry · separate from the next actor onset'), causeList = node('ol'); cause.append(causeTitle, causeList);
  status.setAttribute('role', 'status'); readiness.setAttribute('aria-label', 'Independent seed readiness');
  const advanced = node('details'), advancedTitle = node('summary', 'COMPONENTS · estimates with aligned original phase'), componentInfo = node('output'), componentStrips = node('div');
  advanced.className = 'studio-seed-components'; advanced.append(advancedTitle, node('p', 'Transient-like, sustained-like and residual estimates share one stereo mask. Neutral reconstruction error measures PCM summation, not perceptual isolation. Selecting a strip uses its material for a separate recipe.'), componentInfo, componentStrips);
  const compositionInfo = node('output'), compositionFields = node('div'); compositionFields.className = 'studio-seed-fields';
  const compositionInputs = {};
  for (const [key, label, value, minimum, maximum, step] of [
    ['transientGain', 'Transient gain · 0 mutes', 1, 0, 2, 0.05], ['sustainedGain', 'Sustained gain · 0 mutes', 1, 0, 2, 0.05], ['residualGain', 'Residual gain · 0 mutes', 1, 0, 2, 0.05],
    ['outputGain', 'Printed output gain', 1, 0, 1, 0.05], ['transientDrive', 'Transient drive · 1 bypasses', 1, 1, 4, 0.1], ['sustainedLowpassHz', 'Sustained lowpass Hz · 0 bypasses', 0, 0, 12000, 1], ['residualHighpassHz', 'Residual highpass Hz · 0 bypasses', 0, 0, 6000, 1]
  ]) { const input = numeric(label, value, minimum, maximum); input.step = String(step); compositionInputs[key] = input; compositionFields.append(input.parentNode); }
  const compositionSolo = select('Printed branch solo', [['all', 'All branches'], ['transient-like', 'Transient only'], ['sustained-like', 'Sustained only'], ['residual', 'Residual only']]); compositionFields.append(compositionSolo.parentNode);
  advanced.append(node('p', 'Print explicit branch gains, solo, transient drive and sustained/residual filters into one new asset. Neutral summation error stays separate from creative differences. Filters start at zero and are cropped at the exact frozen end; no implicit tail padding, normalization or limiter.'), compositionFields, compositionInfo);
  const bodyPage = node('details'), bodyTitle = node('summary', 'BODY FIT · editable damped-sinusoid approximation'), bodyInfo = node('output'), bodyModes = node('div'), bodySpectrum = node('canvas'); bodySpectrum.width = 960; bodySpectrum.height = 120; bodySpectrum.setAttribute('role', 'img'); bodySpectrum.setAttribute('aria-label', 'Actual linked stereo source spectrum with estimated mode marks');
  const observation = numeric('Body observation · original frames', 4096, 512, 65536), padding = select('Body FFT size', [['512', '512'], ['1024', '1024'], ['2048', '2048'], ['4096', '4096'], ['8192', '8192'], ['16384', '16384'], ['32768', '32768'], ['65536', '65536']]); padding.value = '8192';
  bodyPage.className = 'studio-seed-body'; bodyModes.className = 'studio-seed-mode-list';
  bodyPage.append(bodyTitle, node('p', 'Modes are estimates with amplitude T60, phase and residual evidence. The declared root is independent. A new modal instrument uses new excitation; it does not reproduce original phase or establish a physical material.'), observation.parentNode, padding.parentNode, bodyInfo, bodySpectrum, bodyModes);
  const rebuildPage = node('details'), rebuildTitle = node('summary', 'REVOICE BRANCH · keep frozen material or rebuild selected descendants'), rebuildInfo = node('output'), branchCanvas = node('canvas'); branchCanvas.width = 960; branchCanvas.height = 96;
  rebuildPage.className = 'studio-seed-rebuild'; branchCanvas.setAttribute('role', 'img'); branchCanvas.setAttribute('aria-label', 'Prepared rebuilt material waveform; original frozen seed remains unchanged');
  rebuildPage.append(rebuildTitle, node('p', 'Revoicing creates new material. Existing seeds and other project references retain their original PCM. Only a matching immutable take, rate, tap and complete selected interval can rebuild this closure.'), rebuildInfo, branchCanvas);
  const anatomy = node('div'); anatomy.className = 'studio-graft-anatomy'; anatomy.setAttribute('aria-label', 'Typed sound anatomy'); const exciterSlot = node('span'), bodySlot = node('span'), pickupSlot = node('span'); anatomy.append(exciterSlot, node('span', '→'), bodySlot, node('span', '→'), pickupSlot, node('p', 'EXCITE multiplies calibrated body input; MIX independently retains dry excitation. BODY sets amplitude T60. DAMP multiplies T60 by (1 − 0.9 × DAMP). MIX blends the dry exciter and body observation. Spatial grafts retain frozen audio only as body ancestry and use an explicit four-second release envelope. Existing voices keep their prepared components. Observed travel gates the cursor input; rest leaves the existing body to decay. A committed local signed-axis journey mapping is required for the travel template.'));
  const actions = node('div'); actions.className = 'studio-sound-actions';
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const refresh = () => surface?.invalidate();
  const run = action => () => {
    if (disposed || active) return;
    let work; try { work = action(); } catch (error) { say(error.message); return; }
    active = Promise.resolve(work).catch(error => say(error.message)).finally(() => { active = null; refresh(); }); refresh();
  };
  const button = (text, action) => { const element = node('button', text); element.type = 'button'; listen(element, 'click', action); actions.append(element); return element; };
  const derivedCandidate = selection => selection === 'component-composition' ? composition.component(selection) : selection ? derived.component(selection) : analysis.candidate();
  const compositionCurrent = () => compositionDraft === draft && preparedCompositionRevision === compositionRevision;
  const chosenCandidate = () => modalSelection ? modal.component(modalSelection) : derivedCandidate(derivedSelection);
  const invalidateModal = () => { modalRevision++; compiledDraft = -1; rebuildPlan = null; rebuild.stop(); modal.cancel(); instrument.stop(); refresh(); };
  const invalidateTrim = () => { rebuildPlan = null; rebuild.stop(); modalSelection = null; modalDraft = -1; modal.cancel(); derivedSelection = null; derivedDraft = -1; derived.cancel(); composition.cancel(); compositionDraft = -1; draft++; compiledDraft = -1; analysis.cancel(); instrument.stop(); drawn = null; refresh(); };
  const invalidateRecipe = () => { rebuildPlan = null; rebuild.stop(); recipeDraft++; compiledDraft = -1; instrument.stop(); refresh(); };
  const refreshTravelButton = button('Refresh committed travel mappings', () => { refreshTravelChoices(); invalidateRecipe(); });
  listen(transform, 'change', refreshTravelChoices);
  const nudge = (input, amount) => () => { input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) + amount))); trimIn.value = first.value; trimOut.value = end.value; invalidateTrim(); };
  button('In −1 frame', nudge(first, -1)); button('In +1 frame', nudge(first, 1)); button('Out −1 frame', nudge(end, -1)); button('Out +1 frame', nudge(end, 1));
  const prepare = button('Freeze selected region', run(async () => {
    const revision = draft; await instrument.clear(); await modal.clear(); modalSelection = null; modalDraft = -1; await composition.clear(); compositionDraft = -1; await derived.clear(); derivedSelection = null; derivedDraft = -1;
    const result = await analysis.prepare({ firstFrame: Number(first.value), endFrame: Number(end.value), fades: { inFrames: Number(fadeIn.value), outFrames: Number(fadeOut.value), law: law.value }, isCurrent: () => revision === draft });
    editableModes = []; selectedModes.clear(); renderModes(); modalDrawn = null; bodySpectrum.getContext('2d')?.clearRect(0, 0, 960, 120);
    candidateDraft = revision; viewFirst.value = '0'; drawn = null; renderAncestry(result); say('Region frozen in memory. Inspect the original frame range, then compile its recipe.');
  }));
  const compile = button('Compile seed instrument', run(async () => {
    if (candidateDraft !== draft || derivedSelection === 'component-composition' && !compositionCurrent() || modalSelection && (modalDraft !== draft || preparedModalRevision !== modalRevision)) throw new Error('Freeze or refit the edited material before compiling.');
    const revision = draft, recipeRevision = recipeDraft, fitRevision = modalRevision;
    await instrument.prepare(chosenCandidate(), { modalFit: (transform.value === 'modal-body' || ['feedforward-graft', 'motion-body-graft', 'texture-body-graft'].includes(transform.value) && graftBody.value === 'fitted') && modalDraft === draft && preparedModalRevision === modalRevision ? modal.state().analysis : null, transform: transform.value, graftBody: graftBody.value, textureKind: textureKind.value, traversalBinding: currentTraversalBinding(), pitch: pitch.value === 'pitched' ? { mode: 'pitched', rootCents: Number(rootPitch.value) } : { mode: 'unpitched' },
      isCurrent: () => revision === draft && recipeRevision === recipeDraft && fitRevision === modalRevision });
    compiledDraft = recipeRevision; say('Instrument compiled. Audition this exact revision before saving and applying it.');
  }));
  const audition = button('Audition seed controls', run(() => instrument.audition({ repeatCount: Number(auditionMode.value) }))), save = button('Save playable seed locally', run(() => instrument.install())), apply = button('Apply to selected lane', run(() => instrument.apply()));
  const useCrossings = button('Use suggested edge crossings', () => {
    const candidate = chosenCandidate(); if (active || !candidate?.metadata().assetReady || candidateDraft !== draft) return;
    candidate.withWaveform(wave => {
      const suggested = wave.zeroCrossings; if (suggested.inLocalFrame == null && suggested.outLocalFrame == null) return;
      if (suggested.inLocalFrame != null) first.value = String(wave.firstParentFrame + suggested.inLocalFrame);
      if (suggested.outLocalFrame != null) end.value = String(wave.firstParentFrame + suggested.outLocalFrame);
    }); trimIn.value = first.value; trimOut.value = end.value; invalidateTrim();
  });
  button('Stop / cancel', () => { analysis.cancel(); derived.cancel(); composition.cancel(); modal.cancel(); rebuild.stop(); instrument.stop(); });
  const download = button('Export frozen WAV', () => { const candidate = chosenCandidate(); if (!candidate?.metadata().assetReady) return;
    const receipt = deliverArtifactToAnchor(candidate.artifact, { document, windowRef: window }); say(receipt.state === 'delivery-requested' ? 'WAV download requested. Browser completion is unacknowledged; the in-memory seed remains available.' : 'WAV delivery ' + receipt.state + '.'); });
  const decompose = button('Analyze seed components', run(async () => {
    if (candidateDraft !== draft) throw new Error('Freeze the current range before component analysis.');
    const revision = draft; await instrument.clear(); await modal.clear(); modalSelection = null; modalDraft = -1; await composition.clear(); compositionDraft = -1; derivedSelection = null;
    await derived.prepare(analysis.candidate(), { isCurrent: () => revision === draft }); derivedDraft = revision; derivedDrawn = null; compiledDraft = -1;
    say('Components prepared in memory. Their source phase, frame alignment and measured neutral reconstruction receipt are retained.');
  }));
  const printComposition = button('Prepare printed component composition', run(async () => {
    if (candidateDraft !== draft || derivedDraft !== draft) throw new Error('Analyze all three components of the current frozen range first.');
    const revision = draft, edit = compositionRevision; await instrument.clear(); await modal.clear(); modalSelection = null; modalDraft = -1;
    await composition.prepare(analysis.candidate(), { options: { ...Object.fromEntries(Object.entries(compositionInputs).map(([key, input]) => [key, Number(input.value)])), solo: compositionSolo.value },
      componentCandidates: ['transient-like', 'sustained-like', 'residual'].map(kind => derived.component(kind)), isCurrent: () => revision === draft && edit === compositionRevision });
    compositionDraft = revision; preparedCompositionRevision = edit; compiledDraft = -1; drawn = null;
    say('Composition printed into a separate immutable asset. Select it explicitly before compiling, fitting or saving.');
  }));
  const useComposition = button('Use printed composition material', () => { if (active || !compositionCurrent() || !composition.component('component-composition')?.metadata().assetReady) return; modalSelection = null; derivedSelection = 'component-composition'; invalidateRecipe(); drawn = null; renderAncestry(chosenCandidate()); });
  for (const input of [...Object.values(compositionInputs), compositionSolo]) listen(input, 'change', () => {
    compositionRevision++; composition.cancel(); if (modalParentSelection === 'component-composition') invalidateModal(); invalidateRecipe();
  });
  const compare = button('Compare selected dry material · up to 8s', run(() => instrument.audition({ comparison: true })));
  const recombined = button('Use neutral recombined material', () => { if (active || derivedDraft !== draft || !derived.component('neutral-recombined')?.metadata().assetReady) return; modalSelection = null; derivedSelection = 'neutral-recombined'; invalidateRecipe(); drawn = null; renderAncestry(chosenCandidate()); });
  const original = button('Use original frozen seed', () => { if (active) return; modalSelection = null; derivedSelection = null; invalidateRecipe(); const candidate = chosenCandidate(); if (candidate) renderAncestry(candidate); drawn = null; });
  for (const kind of ['transient-like', 'sustained-like', 'residual']) {
    const strip = node('div'), label = node('button', 'Use ' + kind), stripCanvas = node('canvas'); label.type = 'button'; stripCanvas.width = 960; stripCanvas.height = 48;
    stripCanvas.setAttribute('role', 'img'); stripCanvas.setAttribute('aria-label', kind + ' stereo waveform with shared seed frame ruler');
    listen(label, 'click', () => { if (active || derivedDraft !== draft || !derived.component(kind)?.metadata().assetReady) return; modalSelection = null; derivedSelection = kind; invalidateRecipe(); drawn = null; renderAncestry(chosenCandidate()); });
    strip.append(label, stripCanvas); componentStrips.append(strip);
  }
  const performFit = manual => run(async () => {
    const selection = manual ? modalParentSelection : derivedSelection, candidate = derivedCandidate(selection);
    if (!candidate?.metadata().assetReady || candidateDraft !== draft || selection === 'component-composition' && !compositionCurrent()) throw new Error('Freeze the current source range before fitting.');
    const revision = draft, fitRevision = modalRevision; await instrument.clear();
    const options = { observationFrames: Number(observation.value), fftSize: Number(padding.value), ...(manual ? { manualModes: editableModes.map(({ id, frequencyHz, t60Seconds, pinned }) => ({ id, frequencyHz, t60Seconds, pinned })) } : { pinnedModes: (modal.state().analysis?.parentAssetHash === candidate.metadata().assetHash ? editableModes : []).filter(mode => mode.pinned).map(({ id, frequencyHz, t60Seconds, pinned }) => ({ id, frequencyHz, t60Seconds, pinned })) }) };
    await modal.prepare(candidate, { options, isCurrent: () => revision === draft && fitRevision === modalRevision });
    modalParentSelection = selection; modalSelection = null; modalDraft = revision; preparedModalRevision = fitRevision; modalDrawn = null; compiledDraft = -1; drawn = null;
    say('Modal analysis completed. Review confidence and residual before selecting a new-excitation body recipe.');
  });
  const fit = button('Estimate body modes', performFit(false)), refit = button('Refit edited mode selection', performFit(true));
  const mergeModes = button('Merge selected modes', () => {
    if (active || selectedModes.size < 2) return;
    const merged = editableModes.filter(mode => selectedModes.has(mode.id)), total = merged.reduce((sum, mode) => sum + (mode.sourceAmplitude || 1), 0);
    editableModes = [...editableModes.filter(mode => !selectedModes.has(mode.id)), { id: 'merged-' + (++modalRevision), frequencyHz: merged.reduce((sum, mode) => sum + mode.frequencyHz * (mode.sourceAmplitude || 1), 0) / total,
      t60Seconds: merged.reduce((sum, mode) => sum + mode.t60Seconds * (mode.sourceAmplitude || 1), 0) / total, pinned: true }]; selectedModes.clear(); renderModes(); invalidateModal();
  });
  for (const [kind, label] of [['modal-reconstruction', 'Use fitted reconstruction material'], ['modal-residual', 'Use true modal residual material']]) button(label, () => {
    if (active || modalDraft !== draft || preparedModalRevision !== modalRevision || !modal.component(kind)?.metadata().assetReady) return; modalSelection = kind; invalidateRecipe(); drawn = null; renderAncestry(chosenCandidate());
  });
  button('Return to fitted source', () => { if (active) return; modalSelection = null; derivedSelection = modalParentSelection; invalidateRecipe(); drawn = null; const candidate = chosenCandidate(); if (candidate) renderAncestry(candidate); });
  function renderModes() {
    for (const remove of modeListeners.splice(0)) remove(); bodyModes.replaceChildren();
    const bind = (element, event, callback) => { element.addEventListener(event, callback); modeListeners.push(() => element.removeEventListener(event, callback)); };
    for (const mode of editableModes) {
      const row = node('div'), selectMode = node('input'), pin = node('input'), hz = node('input'), t60 = node('input'), remove = node('button', 'Remove');
      selectMode.type = pin.type = 'checkbox'; selectMode.checked = selectedModes.has(mode.id); pin.checked = mode.pinned; selectMode.setAttribute('aria-label', 'Select ' + mode.id + ' for merge'); pin.setAttribute('aria-label', 'Pin ' + mode.id);
      for (const input of [hz, t60]) { input.type = 'number'; input.step = 'any'; } hz.value = String(mode.frequencyHz); hz.min = '20'; hz.max = '20000'; hz.setAttribute('aria-label', mode.id + ' frequency Hz');
      t60.value = String(mode.t60Seconds); t60.min = '0.03'; t60.max = '8'; t60.setAttribute('aria-label', mode.id + ' amplitude T60 seconds'); remove.type = 'button';
      bind(selectMode, 'change', () => { if (selectMode.checked) selectedModes.add(mode.id); else selectedModes.delete(mode.id); refresh(); });
      bind(pin, 'change', () => { mode.pinned = pin.checked; invalidateModal(); }); bind(hz, 'change', () => { mode.frequencyHz = Number(hz.value); invalidateModal(); }); bind(t60, 'change', () => { mode.t60Seconds = Number(t60.value); invalidateModal(); });
      bind(remove, 'click', () => { if (active) return; editableModes = editableModes.filter(entry => entry.id !== mode.id); selectedModes.delete(mode.id); renderModes(); invalidateModal(); });
      row.append(selectMode, node('span', mode.id + ' · ' + (mode.confidence || 'manual selection') + ' · Hz / T60 s / Pin'), hz, t60, pin, remove); bodyModes.append(row);
    }
  }
  const nested = button('Use frozen seed as next source', run(async () => { const candidate = chosenCandidate(); if (!candidate?.metadata().assetReady || derivedSelection || modalSelection) return;
    await instrument.clear(); await modal.clear(); modalDraft = -1; await composition.clear(); compositionDraft = -1; await derived.clear(); derivedDraft = -1; await analysis.selectSource({ artifact: candidate.artifact, manifest: candidate.manifest }); resetRange(); say('Frozen material selected as the next immutable parent. Its original ancestry and gap evidence remain attached.'); }));
  button('Keep recorded material', () => { offeredSerial++; offeredSource = null; rebuildPlan = null; rebuild.stop(); say('Original frozen material kept. Revoicing has not changed its PCM or any project reference.'); refresh(); });
  const harvestNew = button('Harvest offered file independently', run(async () => { if (!offeredSource) return; const source = offeredSource; offeredSource = null; offeredSerial++; await loadSource(source); }));
  const planBranch = button('Plan selected derived rebuild', run(async () => {
    if (!offeredSource || !analysis.candidate()?.metadata().assetReady) throw new Error('Offer a completed revoice file while retaining the original frozen seed.');
    const selectedSerial = offeredSerial;
    const plan = await planSoundSeedRebuild({ seed: analysis.candidate(), replacement: offeredSource, components: derivedDraft === draft ? derived.state().analysis : null, composition: compositionCurrent() ? composition.state().analysis : null,
      modal: modalDraft === draft && preparedModalRevision === modalRevision ? modal.state().analysis : null, selectedMaterial: modalSelection || derivedSelection || 'original',
      transform: transform.value, graftBody: graftBody.value, textureKind: textureKind.value, traversalBinding: currentTraversalBinding(), pitch: pitch.value === 'pitched' ? { mode: 'pitched', rootCents: Number(rootPitch.value) } : { mode: 'unpitched' } });
    if (selectedSerial !== offeredSerial) return; rebuildPlan = plan; refresh();
  }));
  const buildBranch = button('Prepare selected derived branch', run(async () => {
    if (!rebuildPlan || !offeredSource) return; const serial = offeredSerial, plan = rebuildPlan;
    await rebuild.prepare({ plan, replacement: offeredSource, isCurrent: () => serial === offeredSerial && rebuildPlan === plan }); branchDrawn = null; say('New derived branch prepared. The original seed and current lane remain intact. Audition and save before explicit Apply.');
  }));
  const auditionBranch = button('Audition derived branch', run(() => rebuild.audition())), saveBranch = button('Save derived branch locally', run(() => rebuild.install())), applyBranch = button('Apply derived branch to selected lane', run(() => rebuild.apply()));
  const discardBranch = button('Discard candidate branch', run(() => rebuild.clear()));
  const close = () => { sourceSelection++; analysis.cancel(); derived.cancel(); composition.cancel(); modal.cancel(); rebuild.stop(); instrument.stop(); root.hidden = true; };
  button('Close seed dock', close);
  function resetRange() {
    const source = analysis.state().source; first.value = '0'; end.value = String(Math.min(source.sourceFrames, Math.floor(source.sampleRate * 1.5), Math.floor(15 * 1048576 / 8)));
    for (const input of [first, end, trimIn, trimOut]) input.max = String(source.sourceFrames); trimIn.value = first.value; trimOut.value = end.value;
    const edge = Math.min(64, Math.floor(Number(end.value) / 2)); fadeIn.value = fadeOut.value = String(edge); candidateDraft = -1; compiledDraft = -1; draft++; drawn = null; causeList.replaceChildren(); editableModes = []; selectedModes.clear(); renderModes(); modalDrawn = null; modalParentSelection = null; preparedModalRevision = -1; bodySpectrum.getContext('2d')?.clearRect(0, 0, 960, 120); refresh();
  }
  function renderAncestry(candidate) {
    causeList.replaceChildren();
    for (const entry of candidate.manifest.ancestry) causeList.append(node('li', '○ ' + entry.originKind + ' · ' + entry.sourceTap + ' · [' + entry.firstFrame + ', ' + entry.endFrame + ') at ' + entry.parentSampleRate + ' Hz · ' + (entry.takeId || entry.immutableSourceRef) + ' · ' + entry.bakedEffects));
  }
  function draw(candidate) {
    if (!candidate?.metadata().assetReady) return;
    const key = candidate.metadata().assetHash + ':' + zoom.value + ':' + viewFirst.value + ':' + draft; if (drawn === key) return; drawn = key;
    candidate.withWaveform(wave => {
      const context = canvas.getContext('2d'); if (!context) return;
      const frames = candidate.manifest.frames, span = Math.max(1, Math.ceil(frames / Number(zoom.value))), from = Math.max(0, Math.min(frames - span, Math.floor(Number(viewFirst.value) || 0))), to = Math.min(frames, from + span);
      viewFirst.max = String(Math.max(0, frames - span));
      const desired = span / canvas.width, level = [...wave.levels].reverse().find(level => level.blockFrames <= desired) || wave.levels[0];
      context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#101d25'; context.fillRect(0, 0, canvas.width, canvas.height);
      for (let channel = 0; channel < 2; channel++) {
        const center = channel ? 120 : 40; context.strokeStyle = channel ? '#cda7f0' : '#69c8de'; context.beginPath();
        for (let x = 0; x < canvas.width; x++) {
          const a = Math.min(level.bins - 1, Math.floor((from + x * span / canvas.width) / level.blockFrames)), b = Math.min(level.bins - 1, Math.floor((from + (x + 1) * span / canvas.width) / level.blockFrames));
          let low = Infinity, high = -Infinity; for (let bin = a; bin <= b; bin++) { low = Math.min(low, level.minMax[bin * 4 + channel * 2]); high = Math.max(high, level.minMax[bin * 4 + channel * 2 + 1]); }
          context.moveTo(x + 0.5, center - Math.max(-1, Math.min(1, high)) * 35); context.lineTo(x + 0.5, center - Math.max(-1, Math.min(1, low)) * 35);
        }
        context.stroke();
      }
      const parentFirst = wave.firstParentFrame + from, parentEnd = wave.firstParentFrame + to, rate = candidate.manifest.sampleRate;
      const z = wave.zeroCrossings; crossing.textContent = 'Optional edge suggestions: in ' + (z.inLocalFrame == null ? 'none found' : '+' + z.inLocalFrame + ' frames') + ', out ' + (z.outLocalFrame == null ? 'none found' : String(z.outLocalFrame - frames) + ' frames') + '. A suggestion changes nothing until explicitly applied; freeze again after editing.';
      ruler.textContent = '[' + parentFirst + ', ' + parentEnd + ') parent frames · ' + (parentFirst / rate).toFixed(6) + '–' + (parentEnd / rate).toFixed(6) + ' s · ' + rate + ' Hz · ' + (wave.stage === 'derived-component-PCM' ? 'derived component PCM; parent is the frozen seed' : 'raw waveform before explicit fades') + (candidateDraft !== draft ? ' · STALE: edited range must be frozen again' : '');
    });
  }
  function paint() {
    if (disposed || !analysis || !instrument || !derived || !composition || !modal || !rebuild) return; const a = analysis.state(), i = instrument.state(), d = derived.state(), c = composition.state(), m = modal.state(), branch = rebuild.state(), candidate = chosenCandidate(), meta = candidate?.metadata(), validAsset = !!meta?.assetReady && candidateDraft === draft && (derivedSelection !== 'component-composition' || compositionCurrent()) && (!modalSelection || modalDraft === draft && preparedModalRevision === modalRevision), validPatch = validAsset && compiledDraft === recipeDraft && i.compiledPatchReady;
    sourceText.textContent = a.source ? a.source.originKind + ' · ' + a.source.sourceTap + ' · ' + a.source.sourceFrames.toLocaleString() + ' original frames at ' + a.source.sampleRate + ' Hz · ' + a.source.immutableSourceRef : 'No retained source selected.';
    readiness.textContent = 'ASSET ' + (validAsset ? 'ready in memory' : meta?.assetReady ? 'stale draft' : 'not frozen') + ' · PATCH ' + (validPatch ? 'compiled' : 'not prepared for draft') + ' · AUDITION ' + (validPatch && i.audibleAuditionReady ? 'completed' : 'not completed') + ' · STORAGE ' + (validPatch && i.durable ? 'committed locally' : 'not durable') + (i.targetCurrent === false ? ' · MOTION TARGET changed; prepare for this document and lane again' : '');
    if (a.active || i.active) status.textContent = a.active ? a.phase + (a.progress ? ' · ' + a.progress.completedUnits + '/' + a.progress.totalUnits : '') : i.phase;
    warnings.textContent = [a.error, i.error, ...(validPatch ? i.recipe.warnings : []), meta ? 'Coverage: ' + meta.coverage.status + ' · peak ' + meta.statistics.peak.toFixed(5) + ' · clipped samples ' + meta.statistics.clippedSamples + ' · stereo correlation ' + (meta.statistics.stereoCorrelation == null ? 'undefined for silent channel' : meta.statistics.stereoCorrelation.toFixed(4)) : '',
      pitch.value === 'unpitched' && ['modal-body', 'feedforward-graft', 'motion-body-graft', 'texture-body-graft'].includes(transform.value) ? transform.value === 'texture-body-graft' ? 'Declare body tuning; the original spatial exciter is unpitched and frozen audio remains ancestry.' : transform.value === 'motion-body-graft' ? 'Declare body tuning independently; source speed follows observed travel.' : 'Declare a body reference pitch; the finite graft exciter remains fixed-rate.' : pitch.value === 'unpitched' && transform.value === 'ice-dust' ? 'Ice dust requires a declared root for the current granular renderer. Choose a sampler recipe for Unpitched material.' : ''].filter(Boolean).join(' ');
    const busy = !!active || branch.active || branch.unknownRetirement || m.active || m.unknownRetirement || c.active || c.unknownRetirement || d.active || d.unknownRetirement || a.active || a.selectingSource || i.active || a.unknownRetirement || i.unknownRetirement;
    prepare.disabled = busy || !a.source; compile.disabled = busy || !validAsset; audition.disabled = busy || !validPatch; save.disabled = busy || !validPatch || !i.audibleAuditionReady;
    apply.disabled = busy || !validPatch || !i.audibleAuditionReady || !i.durable || i.targetCurrent === false; download.disabled = !meta?.assetReady; nested.disabled = busy || !validAsset || !!derivedSelection || !!modalSelection; decompose.disabled = busy || !validAsset; recombined.disabled = busy || derivedDraft !== draft || !d.analysis; compare.disabled = busy || !validPatch || ['modal-body', 'texture-body-graft'].includes(transform.value); useCrossings.disabled = busy || !validAsset || !!derivedSelection; original.disabled = busy || !derivedSelection; rootPitch.disabled = pitch.value !== 'pitched';
    printComposition.disabled = busy || derivedDraft !== draft || !d.analysis; useComposition.disabled = busy || !compositionCurrent() || !c.analysis;
    for (const input of [...Object.values(compositionInputs), compositionSolo]) input.disabled = busy;
    compositionInfo.textContent = c.active ? c.phase : c.error || (c.analysis ? (compositionCurrent() ? '' : 'STALE EDIT · ') + c.analysis.recipe.mode + ' · neutral max error ' + c.analysis.reconstruction.maximumAbsoluteError.toExponential(3) + ' · printed creative RMS difference ' + c.analysis.recipe.creativeDifference.rmsDifference.toExponential(3) + ' · one asset; no new semantic onsets' : 'No printed composition prepared. Gain/filter edits require explicit Prepare.');
    fit.disabled = busy || !validAsset; refit.disabled = busy || modalDraft !== draft || !editableModes.length; mergeModes.disabled = busy || selectedModes.size < 2;
    harvestNew.disabled = busy || !offeredSource; planBranch.disabled = busy || !offeredSource || !analysis.candidate()?.metadata().assetReady;
    buildBranch.disabled = busy || rebuildPlan?.state !== 'rebuildable' || !offeredSource; auditionBranch.disabled = busy || !branch.summary; saveBranch.disabled = busy || !branch.instrument?.audibleAuditionReady;
    applyBranch.disabled = busy || !branch.targetCurrent || !branch.instrument?.durable || !branch.instrument?.audibleAuditionReady; discardBranch.disabled = busy || !branch.summary;
    rebuildInfo.textContent = branch.active ? branch.phase : branch.error || (rebuildPlan?.blockers.length ? rebuildPlan.blockers.map(blocker => blocker.node + ': ' + blocker.state + ' · ' + blocker.reason).join(' ') : branch.summary ? 'Original ' + branch.summary.originalAssetHash.slice(0, 16) + ' → new region ' + branch.summary.newRegionAssetHash.slice(0, 16) + ' → selected material ' + branch.summary.newSelectedAssetHash.slice(0, 16) + ' · ' + branch.summary.patchIdentity + ' · ' + (branch.targetCurrent ? 'target current' : 'target changed; reprepare before Apply') + ' · original project references preserved.' : rebuildPlan ? 'Rebuildable closure: ' + rebuildPlan.nodes.map(node => node.id).join(' → ') + '. No material or project reference has changed.' : offeredSource ? 'A new source file is offered. Keep frozen material, harvest independently, or review its exact derived rebuild plan.' : 'Prepare another causal revoice and choose Harvest to offer it here.');
    if (branch.summary && branchDrawn !== branch.summary.generation) { branchDrawn = branch.summary.generation; const candidate = rebuild.candidate(), context = branchCanvas.getContext('2d');
      if (candidate && context) candidate.withWaveform(wave => { const level = wave.levels[0]; context.clearRect(0, 0, 960, 96); context.strokeStyle = '#326b80'; context.beginPath();
        for (let x = 0; x < 960; x++) { const bin = Math.min(level.bins - 1, Math.floor(x * level.bins / 960)); for (let channel = 0; channel < 2; channel++) { const at = bin * 4 + channel * 2, center = channel ? 72 : 24; context.moveTo(x, center - Math.max(-1, level.minMax[at]) * 22); context.lineTo(x, center - Math.min(1, level.minMax[at + 1]) * 22); } } context.stroke(); }); }
    const isGraft = ['feedforward-graft', 'motion-body-graft', 'texture-body-graft'].includes(transform.value), textureGraft = transform.value === 'texture-body-graft', motionGraft = textureGraft || transform.value === 'motion-body-graft'; textureKind.parentNode.hidden = !textureGraft; textureKind.disabled = !textureGraft || busy; anatomy.hidden = !isGraft; graftBody.disabled = !isGraft || busy; travelMapping.disabled = travelScale.disabled = !motionGraft || busy; travelMapping.parentNode.hidden = !motionGraft; travelScale.parentNode.hidden = !motionGraft || textureGraft; refreshTravelButton.hidden = !motionGraft; refreshTravelButton.disabled = busy;
    exciterSlot.textContent = (textureGraft ? 'EXCITER · observed spatial ' + textureKind.value + ' · body ancestry ' : motionGraft ? 'EXCITER · observed travel cursor · ' : 'EXCITER · fixed-rate frozen audio · ') + (meta?.assetHash.slice(0, 12) || 'missing material'); bodySlot.textContent = 'BODY · ' + (graftBody.value === 'fitted' ? m.analysis ? m.analysis.estimate.modes.length + ' reviewed modes · ' + m.analysis.recipe.algorithmRevision : 'fit a body first' : graftBody.value === 'tin' ? 'original tin v1 · 6 modes' : 'original dry wood v1 · 4 modes'); pickupSlot.textContent = 'PICKUP / MIX · authored signed A/B weights · private actor body · next-onset only';
    const modalSummary = m.analysis;
    bodyInfo.textContent = m.active ? m.phase : m.error || (modalSummary ? (modalDraft !== draft || preparedModalRevision !== modalRevision ? 'STALE · ' : '') + modalSummary.estimate.status + ' · observed ' + modalSummary.recipe.observationFrames + ' frames / FFT ' + modalSummary.recipe.fftSize + ' / padding ' + modalSummary.recipe.zeroPaddingFrames + ' · minimum resolvable separation ' + modalSummary.recipe.resolutionHz.toFixed(3) + ' Hz · model RMS error ' + modalSummary.estimate.modelRmsError.toExponential(3) + ' · ' + modalSummary.estimate.declined.length + ' declined tracks. Root pitch not inferred.' : 'Fit the original seed or a selected sustained component. Observation length bounds frequency separation; FFT padding alone adds no observed information.');
    if (modalSummary && modalDrawn !== modalSummary.generation) { modalDrawn = modalSummary.generation; editableModes = modalSummary.estimate.modes.map(mode => ({ id: mode.id, frequencyHz: mode.frequencyHz, t60Seconds: mode.t60Seconds, pinned: mode.pinned, sourceAmplitude: mode.amplitude, confidence: mode.confidence.level })); selectedModes.clear(); renderModes();
      const spectrum = modalSummary.estimate.spectrum, context = bodySpectrum.getContext('2d');
      if (context) { context.clearRect(0, 0, 960, 120); context.strokeStyle = '#326b80'; context.beginPath();
        for (let x = 0; x < 960; x++) { const bin = Math.min(spectrum.decibels.length - 1, Math.floor(x * spectrum.decibels.length / 960)), y = 112 - (Math.max(-100, Math.min(0, spectrum.decibels[bin])) + 100); if (x) context.lineTo(x, y); else context.moveTo(x, y); } context.stroke();
        context.strokeStyle = '#a43754'; for (const mode of modalSummary.estimate.modes) { const x = mode.frequencyHz / (spectrum.frequencyStepHz * spectrum.decibels.length) * 960; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 120); context.stroke(); }
      }
    }
    const summary = d.analysis;
    componentInfo.textContent = d.active ? d.phase : d.error || (summary ? (derivedDraft !== draft ? 'STALE · ' : '') + 'Selected ' + (derivedSelection || 'original frozen seed') + ' · ' + summary.recipe.fftSize + ' FFT / ' + summary.recipe.hopFrames + ' hop · ' + summary.recipe.observationFrames + ' observed frames · neutral max error ' + summary.reconstruction.maximumAbsoluteError.toExponential(3) + ' / RMS ' + summary.reconstruction.rmsError.toExponential(3) + ' · zero output delay, exact original-frame crop.' : 'Analyze a frozen seed to inspect its components.');
    if (summary && derivedDrawn !== summary.generation) {
      derivedDrawn = summary.generation;
      for (const [index, entry] of [...componentStrips.children].entries()) {
        const component = derived.component(summary.components[index].kind), plot = entry.querySelector('canvas'), context = plot.getContext('2d'); if (!context) continue;
        component.withWaveform(wave => { const level = wave.levels[0]; context.clearRect(0, 0, 960, 48); context.strokeStyle = '#326b80'; context.beginPath();
          for (let x = 0; x < 960; x++) { const bin = Math.min(level.bins - 1, Math.floor(x * level.bins / 960));
            for (let channel = 0; channel < 2; channel++) { const center = channel ? 36 : 12, at = bin * 4 + channel * 2; context.moveTo(x + 0.5, center - Math.max(-1, level.minMax[at]) * 10); context.lineTo(x + 0.5, center - Math.min(1, level.minMax[at + 1]) * 10); }
          } context.stroke(); });
      }
    }
    draw(candidate);
  }
  for (const input of [first, end, fadeIn, fadeOut, law]) listen(input, 'change', () => { trimIn.value = first.value; trimOut.value = end.value; invalidateTrim(); });
  for (const [input, target] of [[trimIn, first], [trimOut, end]]) listen(input, 'input', () => { target.value = input.value; invalidateTrim(); });
  for (const input of [observation, padding]) listen(input, 'change', invalidateModal);
  for (const input of [transform, pitch, rootPitch, graftBody, textureKind, travelMapping, travelScale]) listen(input, 'change', invalidateRecipe);
  for (const input of [zoom, viewFirst]) listen(input, 'change', refresh);
  listen(document, 'keydown', event => { if (event.key === 'Escape' && !root.hidden) { morphPane.suspend(); analysis.cancel(); derived.cancel(); composition.cancel(); modal.cancel(); rebuild.stop(); instrument.stop(); } });
  const morphPane = createResonatorMorphView({ document, window, audio, getPlayback, resourceBudget, jobs });
  root.append(title, sourceText, scope, plot, crossing, fields, readiness, status, warnings, anatomy, cause, advanced, bodyPage, morphPane.element, rebuildPage, actions);
  const stage = document.getElementById('procgenStudio'); if (stage) stage.after(root); else (document.getElementById('procgenPresentationRoot') || document.body).append(root);
  surface = scheduler.register({ id: 'sound-seed-lab', element: root, intervalMs: 100, write: paint, onError: message => say(String(message)) });
  analysis = createSoundSeedAnalysisOwner({ resourceBudget, jobs, onState: refresh });
  derived = createSoundSeedDerivedOwner({ resourceBudget, jobs, onState: refresh });
  composition = createSoundSeedDerivedOwner({ resourceBudget, jobs, kind: 'composition', onState: refresh });
  modal = createSoundSeedDerivedOwner({ resourceBudget, jobs, kind: 'body-fit', onState: refresh });
  instrument = createSoundSeedInstrumentOwner({ audio, resourceBudget, jobs, indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, getTargetIdentity, onApply, onState: refresh,
    onReveal: () => { if (!disposed) { root.hidden = false; refresh(); } } });
  rebuild = createSoundSeedRebuildOwner({ audio, resourceBudget, jobs, indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, onApply, onState: refresh,
    getTargetIdentity: () => ({ target: getTargetIdentity(), draft, recipeDraft, modalRevision, offeredSerial }), onReveal: () => { if (!disposed) { root.hidden = false; refresh(); } } });
  async function loadSource(source) {
    if (disposed) return; const selection = ++sourceSelection; root.hidden = false; analysis.cancel(); derived.cancel(); composition.cancel(); modal.cancel(); rebuild.stop(); instrument.stop();
    await instrument.clear(); await rebuild.clear(); rebuildPlan = null; await modal.clear(); modalSelection = null; modalDraft = -1; await composition.clear(); compositionDraft = -1; await derived.clear(); derivedSelection = null; derivedDraft = -1; if (selection !== sourceSelection || disposed) return;
    await analysis.selectSource(source); if (selection !== sourceSelection || disposed) return; resetRange(); root.scrollIntoView?.({ block: 'nearest' }); first.focus(); say('Choose an exact parent-frame range. The original source is retained by its capture or render owner.');
  }
  return Object.freeze({ async open(source) {
    if (disposed) return; refreshTravelChoices(); if (analysis.candidate()?.metadata().assetReady) { offeredSource = source; offeredSerial++; rebuild.stop(); rebuildPlan = null; root.hidden = false; rebuildPage.open = true; refresh(); say('New source offered. The current frozen material is unchanged.'); return; }
    await active?.catch(() => {}); await loadSource(source);
  }, state: () => Object.freeze({ morph: morphPane.state(), analysis: analysis.state(), derived: derived.state(), composition: composition.state(), modal: modal.state(), rebuild: rebuild.state(), rebuildPlan, offeredSource: !!offeredSource, derivedSelection, modalSelection, instrument: instrument.state(), draft, candidateDraft, recipeDraft, compiledDraft, visible: !root.hidden }),
  suspend() { morphPane.suspend(); analysis.cancel(); derived.cancel(); composition.cancel(); modal.cancel(); rebuild.stop(); instrument.stop(); },
  dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; sourceSelection++; analysis.cancel(); derived.cancel(); composition.cancel(); modal.cancel(); rebuild.stop(); instrument.stop();
    const retire = async owner => { const receipt = owner.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Seed material retains unresolved producers or readers.'); };
    const stopped = Promise.resolve(active).catch(() => {}), instrumentFinished = stopped.then(() => retire(instrument)), rebuildFinished = instrumentFinished.then(() => retire(rebuild)), modalFinished = rebuildFinished.then(() => retire(modal)), compositionFinished = modalFinished.then(() => retire(composition)), derivedFinished = compositionFinished.then(() => retire(derived)), analysisFinished = derivedFinished.then(() => retire(analysis));
    return retirement.retire([{ name: 'seed-instrument', run: () => instrumentFinished }, { name: 'seed-rebuild', run: () => rebuildFinished }, { name: 'seed-modal', run: () => modalFinished }, { name: 'seed-composition', run: () => compositionFinished }, { name: 'seed-derived', run: () => derivedFinished }, { name: 'seed-analysis', run: () => analysisFinished },
      { name: 'seed-morph-review', run: async () => { const receipt = morphPane.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Morph review retains unresolved producers or readers.'); } }, { name: 'seed-display', run: () => surface.dispose() }, { name: 'seed-scheduler', run: () => { if (!displayScheduler) return scheduler.dispose(); } },
      ...[...listeners.splice(0), ...modeListeners.splice(0)].map((remove, index) => ({ name: 'seed-listener-' + index, run: remove })), { name: 'seed-dock', run: () => root.remove() }]);
  } });
}
