import { createSoundSeedDerivedOwner } from './SoundSeedDerivedOwner.js';
import { createSoundSeedAnalysisOwner } from './SoundSeedAnalysisOwner.js';
import { createSoundSeedInstrumentOwner } from './SoundSeedInstrumentOwner.js';
import { createInstrumentDisplayScheduler } from '../resources/InstrumentDisplayScheduler.js';
import { deliverArtifactToAnchor } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createSoundSeedLabView({ document, window, audio, resourceBudget, jobs, displayScheduler, onApply, onStatus = () => {} } = {}) {
  const listeners = [], retirement = createProcgenRetirementScope();
  const scheduler = displayScheduler || createInstrumentDisplayScheduler({ document, window, resourceBudget });
  let analysis, instrument, derived, surface, derivedSelection = null, derivedDraft = -1, derivedDrawn = null, disposed = false, active = null, draft = 0, candidateDraft = -1, recipeDraft = 0, compiledDraft = -1, drawn = null, sourceSelection = 0;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const listen = (element, event, handler) => { element.addEventListener(event, handler); listeners.push(() => element.removeEventListener(event, handler)); };
  const root = node('section'); root.className = 'studio-seed-lab'; root.hidden = true; root.setAttribute('aria-label', 'Sound seed laboratory');
  const title = node('h2', 'Sound seed'), sourceText = node('p'), scope = node('p', 'Local retained browser audio only. The isolated cue bus is excluded from master capture. This action uses no microphone, system capture or upload.');
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
  const pitch = select('Pitch declaration', [['unpitched', 'Unpitched · fixed source rate'], ['pitched', 'Declared root · varispeed']]), rootPitch = numeric('Declared root · MIDI cents', 6000, 2400, 9600);
  const zoom = select('Waveform zoom', [['1', 'Whole prepared window'], ['2', '2×'], ['4', '4×'], ['8', '8×']]), viewFirst = numeric('Waveform first local frame', 0);
  const auditionMode = select('Audition repeat', [['1', 'Once'], ['3', 'Explicit loop · 3 passes, up to 8s per sample pass']]);
  const crossing = node('output'); crossing.setAttribute('aria-label', 'Zero crossing suggestions');
  const status = node('output'), readiness = node('output'), warnings = node('p'), cause = node('details'), causeTitle = node('summary', 'Baked ancestry · separate from the next actor onset'), causeList = node('ol'); cause.append(causeTitle, causeList);
  status.setAttribute('role', 'status'); readiness.setAttribute('aria-label', 'Independent seed readiness');
  const advanced = node('details'), advancedTitle = node('summary', 'COMPONENTS · estimates with aligned original phase'), componentInfo = node('output'), componentStrips = node('div');
  advanced.className = 'studio-seed-components'; advanced.append(advancedTitle, node('p', 'Transient-like, sustained-like and residual estimates share one stereo mask. Neutral reconstruction error measures PCM summation, not perceptual isolation. Selecting a strip uses its material for a separate recipe.'), componentInfo, componentStrips);
  const actions = node('div'); actions.className = 'studio-sound-actions';
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const refresh = () => surface?.invalidate();
  const run = action => () => {
    if (disposed || active) return;
    let work; try { work = action(); } catch (error) { say(error.message); return; }
    active = Promise.resolve(work).catch(error => say(error.message)).finally(() => { active = null; refresh(); }); refresh();
  };
  const button = (text, action) => { const element = node('button', text); element.type = 'button'; listen(element, 'click', action); actions.append(element); return element; };
  const chosenCandidate = () => derivedSelection ? derived.component(derivedSelection) : analysis.candidate();
  const invalidateTrim = () => { derivedSelection = null; derivedDraft = -1; derived.cancel(); draft++; compiledDraft = -1; analysis.cancel(); instrument.stop(); drawn = null; refresh(); };
  const invalidateRecipe = () => { recipeDraft++; compiledDraft = -1; instrument.stop(); refresh(); };
  const nudge = (input, amount) => () => { input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) + amount))); trimIn.value = first.value; trimOut.value = end.value; invalidateTrim(); };
  button('In −1 frame', nudge(first, -1)); button('In +1 frame', nudge(first, 1)); button('Out −1 frame', nudge(end, -1)); button('Out +1 frame', nudge(end, 1));
  const prepare = button('Freeze selected region', run(async () => {
    const revision = draft; await instrument.clear(); await derived.clear(); derivedSelection = null; derivedDraft = -1;
    const result = await analysis.prepare({ firstFrame: Number(first.value), endFrame: Number(end.value), fades: { inFrames: Number(fadeIn.value), outFrames: Number(fadeOut.value), law: law.value }, isCurrent: () => revision === draft });
    candidateDraft = revision; viewFirst.value = '0'; drawn = null; renderAncestry(result); say('Region frozen in memory. Inspect the original frame range, then compile its recipe.');
  }));
  const compile = button('Compile seed instrument', run(async () => {
    if (candidateDraft !== draft) throw new Error('Freeze the edited range before compiling.');
    const revision = draft, recipeRevision = recipeDraft;
    await instrument.prepare(chosenCandidate(), { transform: transform.value, pitch: pitch.value === 'pitched' ? { mode: 'pitched', rootCents: Number(rootPitch.value) } : { mode: 'unpitched' },
      isCurrent: () => revision === draft && recipeRevision === recipeDraft });
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
  button('Stop / cancel', () => { analysis.cancel(); instrument.stop(); });
  const download = button('Export frozen WAV', () => { const candidate = chosenCandidate(); if (!candidate?.metadata().assetReady) return;
    const receipt = deliverArtifactToAnchor(candidate.artifact, { document, windowRef: window }); say(receipt.state === 'delivery-requested' ? 'WAV download requested. Browser completion is unacknowledged; the in-memory seed remains available.' : 'WAV delivery ' + receipt.state + '.'); });
  const decompose = button('Analyze seed components', run(async () => {
    if (candidateDraft !== draft) throw new Error('Freeze the current range before component analysis.');
    const revision = draft; await instrument.clear(); derivedSelection = null;
    await derived.prepare(analysis.candidate(), { isCurrent: () => revision === draft }); derivedDraft = revision; derivedDrawn = null; compiledDraft = -1;
    say('Components prepared in memory. Their source phase, frame alignment and measured neutral reconstruction receipt are retained.');
  }));
  const compare = button('Compare selected dry material · up to 8s', run(() => instrument.audition({ comparison: true })));
  const recombined = button('Use neutral recombined material', () => { if (active || derivedDraft !== draft || !derived.component('neutral-recombined')?.metadata().assetReady) return; derivedSelection = 'neutral-recombined'; invalidateRecipe(); drawn = null; renderAncestry(chosenCandidate()); });
  const original = button('Use original frozen seed', () => { if (active) return; derivedSelection = null; invalidateRecipe(); const candidate = chosenCandidate(); if (candidate) renderAncestry(candidate); drawn = null; });
  for (const kind of ['transient-like', 'sustained-like', 'residual']) {
    const strip = node('div'), label = node('button', 'Use ' + kind), stripCanvas = node('canvas'); label.type = 'button'; stripCanvas.width = 960; stripCanvas.height = 48;
    stripCanvas.setAttribute('role', 'img'); stripCanvas.setAttribute('aria-label', kind + ' stereo waveform with shared seed frame ruler');
    listen(label, 'click', () => { if (active || derivedDraft !== draft || !derived.component(kind)?.metadata().assetReady) return; derivedSelection = kind; invalidateRecipe(); drawn = null; renderAncestry(chosenCandidate()); });
    strip.append(label, stripCanvas); componentStrips.append(strip);
  }
  const nested = button('Use frozen seed as next source', run(async () => { const candidate = chosenCandidate(); if (!candidate?.metadata().assetReady || derivedSelection) return;
    await instrument.clear(); await derived.clear(); derivedDraft = -1; await analysis.selectSource({ artifact: candidate.artifact, manifest: candidate.manifest }); resetRange(); say('Frozen material selected as the next immutable parent. Its original ancestry and gap evidence remain attached.'); }));
  const close = () => { sourceSelection++; analysis.cancel(); derived.cancel(); instrument.stop(); root.hidden = true; };
  button('Close seed dock', close);
  function resetRange() {
    const source = analysis.state().source; first.value = '0'; end.value = String(Math.min(source.sourceFrames, Math.floor(source.sampleRate * 1.5), Math.floor(15 * 1048576 / 8)));
    for (const input of [first, end, trimIn, trimOut]) input.max = String(source.sourceFrames); trimIn.value = first.value; trimOut.value = end.value;
    const edge = Math.min(64, Math.floor(Number(end.value) / 2)); fadeIn.value = fadeOut.value = String(edge); candidateDraft = -1; compiledDraft = -1; draft++; drawn = null; causeList.replaceChildren(); refresh();
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
    if (disposed || !analysis || !instrument || !derived) return; const a = analysis.state(), i = instrument.state(), d = derived.state(), candidate = chosenCandidate(), meta = candidate?.metadata(), validAsset = !!meta?.assetReady && candidateDraft === draft, validPatch = validAsset && compiledDraft === recipeDraft && i.compiledPatchReady;
    sourceText.textContent = a.source ? a.source.originKind + ' · ' + a.source.sourceTap + ' · ' + a.source.sourceFrames.toLocaleString() + ' original frames at ' + a.source.sampleRate + ' Hz · ' + a.source.immutableSourceRef : 'No retained source selected.';
    readiness.textContent = 'ASSET ' + (validAsset ? 'ready in memory' : meta?.assetReady ? 'stale draft' : 'not frozen') + ' · PATCH ' + (validPatch ? 'compiled' : 'not prepared for draft') + ' · AUDITION ' + (validPatch && i.audibleAuditionReady ? 'completed' : 'not completed') + ' · STORAGE ' + (validPatch && i.durable ? 'committed locally' : 'not durable');
    if (a.active || i.active) status.textContent = a.active ? a.phase + (a.progress ? ' · ' + a.progress.completedUnits + '/' + a.progress.totalUnits : '') : i.phase;
    warnings.textContent = [a.error, i.error, ...(validPatch ? i.recipe.warnings : []), meta ? 'Coverage: ' + meta.coverage.status + ' · peak ' + meta.statistics.peak.toFixed(5) + ' · clipped samples ' + meta.statistics.clippedSamples + ' · stereo correlation ' + (meta.statistics.stereoCorrelation == null ? 'undefined for silent channel' : meta.statistics.stereoCorrelation.toFixed(4)) : '',
      pitch.value === 'unpitched' && transform.value === 'ice-dust' ? 'Ice dust requires a declared root for the current granular renderer. Choose a sampler recipe for Unpitched material.' : ''].filter(Boolean).join(' ');
    const busy = !!active || d.active || d.unknownRetirement || a.active || a.selectingSource || i.active || a.unknownRetirement || i.unknownRetirement;
    prepare.disabled = busy || !a.source; compile.disabled = busy || !validAsset; audition.disabled = busy || !validPatch; save.disabled = busy || !validPatch || !i.audibleAuditionReady;
    apply.disabled = busy || !validPatch || !i.audibleAuditionReady || !i.durable; download.disabled = !meta?.assetReady; nested.disabled = busy || !validAsset || !!derivedSelection; decompose.disabled = busy || !validAsset; recombined.disabled = busy || derivedDraft !== draft || !d.analysis; compare.disabled = busy || !validPatch; useCrossings.disabled = busy || !validAsset || !!derivedSelection; original.disabled = busy || !derivedSelection; rootPitch.disabled = pitch.value !== 'pitched';
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
  for (const input of [transform, pitch, rootPitch]) listen(input, 'change', invalidateRecipe);
  for (const input of [zoom, viewFirst]) listen(input, 'change', refresh);
  listen(document, 'keydown', event => { if (event.key === 'Escape' && !root.hidden) { analysis.cancel(); derived.cancel(); instrument.stop(); } });
  root.append(title, sourceText, scope, plot, crossing, fields, readiness, status, warnings, cause, advanced, actions);
  const stage = document.getElementById('procgenStudio'); if (stage) stage.after(root); else (document.getElementById('procgenPresentationRoot') || document.body).append(root);
  surface = scheduler.register({ id: 'sound-seed-lab', element: root, intervalMs: 100, write: paint, onError: message => say(String(message)) });
  analysis = createSoundSeedAnalysisOwner({ resourceBudget, jobs, onState: refresh });
  derived = createSoundSeedDerivedOwner({ resourceBudget, jobs, onState: refresh });
  instrument = createSoundSeedInstrumentOwner({ audio, resourceBudget, jobs, indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, onApply, onState: refresh,
    onReveal: () => { if (!disposed) { root.hidden = false; refresh(); } } });
  return Object.freeze({ async open(source) {
    if (disposed) return; const selection = ++sourceSelection; root.hidden = false; analysis.cancel(); derived.cancel(); instrument.stop();
    await active?.catch(() => {}); await instrument.clear(); await derived.clear(); derivedSelection = null; derivedDraft = -1; if (selection !== sourceSelection || disposed) return;
    await analysis.selectSource(source); if (selection !== sourceSelection || disposed) return; resetRange(); root.scrollIntoView?.({ block: 'nearest' }); first.focus(); say('Choose an exact parent-frame range. The original source is retained by its capture or render owner.');
  }, state: () => Object.freeze({ analysis: analysis.state(), derived: derived.state(), derivedSelection, instrument: instrument.state(), draft, candidateDraft, recipeDraft, compiledDraft, visible: !root.hidden }),
  suspend() { analysis.cancel(); derived.cancel(); instrument.stop(); },
  dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; sourceSelection++; analysis.cancel(); derived.cancel(); instrument.stop();
    const stopped = Promise.resolve(active).catch(() => {}), instrumentFinished = stopped.then(async () => { const receipt = instrument.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Seed audition still owns material.'); });
    return retirement.retire([{ name: 'seed-instrument', run: () => instrumentFinished }, { name: 'seed-derived', run: async () => { await instrumentFinished; return derived.dispose(); } }, { name: 'seed-analysis', run: async () => { await instrumentFinished; const receipt = derived.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Derived analysis still owns seed material.'); return analysis.dispose(); } },
      { name: 'seed-display', run: () => surface.dispose() }, { name: 'seed-scheduler', run: () => { if (!displayScheduler) return scheduler.dispose(); } },
      ...listeners.splice(0).map((remove, index) => ({ name: 'seed-listener-' + index, run: remove })), { name: 'seed-dock', run: () => root.remove() }]);
  } });
}
