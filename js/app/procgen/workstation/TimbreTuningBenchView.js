export function createTimbreTuningBenchView({ document, readSource, readState, open, edit, analyze, invalidateAnalysis, prepare, commit, restore, cancel, compareTake, prepareProofScene, onDraftChange = () => {}, onStatus = () => {} } = {}) {
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; }, element = node('section');
  element.__ownedControl = true; element.className = 'studio-timbre-bench'; element.setAttribute('aria-label', 'Spectrum and tuning bench');
  const header = node('h2', 'SPECTRUM / TUNING'), voice = node('p'), message = node('output'), actions = node('div'), small = node('fieldset'), partials = node('div'), tuning = node('div'), curves = node('div'), receipt = node('pre');
  actions.className = 'studio-compose-controls'; message.setAttribute('role', 'status'); receipt.style.whiteSpace = 'pre-wrap'; receipt.style.overflowWrap = 'anywhere';
  const button = (label, action) => { const value = node('button', label); value.type = 'button'; value.addEventListener('click', () => { Promise.resolve().then(action).catch(error => { message.textContent = error.message; onStatus(error.message); }); }); return value; };
  const field = (parent, label, value, type = 'number') => { const wrap = node('label', label), input = node('input'); input.type = type; input.value = value; input.setAttribute('aria-label', label); if (type === 'number') input.step = 'any'; wrap.append(input); parent.append(wrap); return input; };
  const choice = (parent, label, values) => { const wrap = node('label', label), input = node('select'); input.setAttribute('aria-label', label); for (const [value, text] of values) { const option = node('option', text); option.value = value; input.append(option); } wrap.append(input); parent.append(wrap); return input; };
  const recipe = choice(actions, 'Original paired laboratory recipe', [['harmonic', 'Harmonic reference'], ['stretched', 'Stretched lattice'], ['metal', 'Metal islands']]);
  actions.append(button('Open saved pair or harmonic baseline', async () => { await open(null); dirty = jsonDirty = false; }), button('Load selected recipe as a draft', async () => { await open(recipe.value); dirty = true; jsonDirty = false; onDraftChange(); }));
  const stretch = field(small, 'Authored stretch exponent', 1), damping = field(small, 'T60 damping multiplier', 1), reference = field(small, 'Reference frequency in Hz', 220),
    slice = choice(small, 'Displayed analysis source-second window', [['attack', 'Attack · authored time window'], ['body', 'Body · authored time window'], ['tail', 'Late tail · authored time window']]),
    linked = field(small, 'Link spectrum + tuning', '', 'checkbox');
  stretch.min = '0.94'; stretch.max = '1.10'; stretch.step = '0.001'; damping.min = '0.1'; damping.max = '4'; linked.checked = false;
  small.prepend(node('legend', 'Explicit paired sound draft · changes never run physics'));
  const details = node('details'), options = node('fieldset'), minimum = field(options, 'Analysis register minimum Hz', 110), maximum = field(options, 'Analysis register maximum Hz', 440), points = field(options, 'Offline interval grid point count', 129),
    period = field(options, 'Exact tuning period ratio', 2), degrees = field(options, 'Exact tuning degree ratios · comma separated', '1,1.25,1.5', 'text'), coincidences = field(options, 'Show nearest declared partial coincidences', '', 'checkbox'),
    output = choice(options, 'External output capability review', [['local-only', 'Require local-only output'], ['named-device-approximation', 'Review device-defined timbre and pitch approximation']]);
  const windows = Object.fromEntries(['attack', 'body', 'tail'].map((id, index) => [id, { start: field(options, id + ' window start in source seconds', [0, 0.02, 0.15][index]), end: field(options, id + ' window end in source seconds', [0.02, 0.15, 0.8][index]) }]));
  details.append(node('summary', 'Exact period, degrees, register and model windows'), options);
  const jsonDetails = node('details'), json = node('textarea'); json.rows = 14; json.style.width = '100%'; json.setAttribute('aria-label', 'Exact spectrum and tuning pair JSON'); jsonDetails.append(node('summary', 'Saved pair data and provenance'), json);
  let disposed = false, dirty = false, jsonDirty = false, shownDraft = null, shownAnalysis = null, rows = [], selectedPartial = 0;
  const number = input => { const value = Number(input.value); if (!input.value.trim() || !Number.isFinite(value)) throw new Error('Enter a finite number for ' + input.getAttribute('aria-label') + '.'); return value; };
  const mutate = change => { const state = readState(); if (!state?.draft) throw new Error('Open a paired draft first.'); const draft = JSON.parse(JSON.stringify(state.draft)); change(draft); edit(draft); dirty = true; onDraftChange(); };
  const setValue = (input, value) => { if (document.activeElement !== input) input.value = String(value); };
  linked.addEventListener('change', () => mutate(draft => { draft.coupledMorph.linked = linked.checked; }));
  stretch.addEventListener('change', () => mutate(draft => {
    const next = number(stretch), factor = next / draft.coupledMorph.stretch; draft.partialRatios = draft.partialRatios.map(ratio => ratio ** factor);
    if (draft.coupledMorph.linked) { draft.degreeRatios = draft.degreeRatios.map(ratio => ratio ** factor); draft.periodRatio **= factor; }
    draft.coupledMorph.stretch = next;
  }));
  damping.addEventListener('change', () => { mutate(draft => { const factor = number(damping); draft.partialT60Seconds = draft.partialT60Seconds.map(seconds => seconds * factor); }); damping.value = '1'; });
  reference.addEventListener('change', () => mutate(draft => { draft.referenceHz = number(reference); }));
  period.addEventListener('change', () => mutate(draft => { draft.periodRatio = number(period); }));
  degrees.addEventListener('change', () => mutate(draft => { draft.degreeRatios = degrees.value.split(',').map(value => { if (!value.trim()) throw new Error('Enter every tuning ratio explicitly.'); return Number(value.trim()); }); }));
  for (const input of [minimum, maximum]) input.addEventListener('change', () => mutate(draft => { draft.registerDomain = { minimumHz: number(minimum), maximumHz: number(maximum) }; }));
  json.addEventListener('input', () => { jsonDirty = dirty = true; onDraftChange(); });
  jsonDetails.append(button('Use exact JSON as local draft', () => { const value = JSON.parse(json.value); edit(value); jsonDirty = false; dirty = true; onDraftChange(); }));
  const analysisOptions = bypass => {
    if (jsonDirty) throw new Error('Use or discard pending pair JSON before analyzing.');
    const state = readState(); if (!state?.draft) throw new Error('Open a pair first.');
    const low = number(minimum), high = number(maximum); return { sampleRate: readSource().sampleRate || 48000, scan: { minimumRatio: 1, maximumRatio: state.draft.periodRatio, points: number(points) },
      registerHz: low === high ? [low] : [low, Math.sqrt(low * high), high], windows: Object.entries(windows).map(([id, range]) => ({ id, startSeconds: number(range.start), endSeconds: number(range.end), samples: 3 })), bypass };
  };
  const analyzeButton = button('Analyze declared spectra · offline', () => analyze(analysisOptions(false))), bypass = button('Bypass model · record explicit bypass', () => analyze(analysisOptions(true))),
    stop = button('Cancel bench work · keep draft', cancel), prepareButton = button('Prepare both exact revisions · silent', () => { if (jsonDirty) throw new Error('Use or discard the pending JSON draft before Prepare.'); return prepare({ externalPolicy: output.value }); }),
    commitButton = button('Commit prepared spectrum + tuning · one Undo', () => { const result = commit(); dirty = jsonDirty = false; return result; });
  actions.append(button('Prepare Bent Ladder for review', prepareProofScene), button('Compare prepared pair on saved physical take', compareTake));
  actions.append(analyzeButton, bypass, stop, prepareButton, commitButton, button('Restore saved baseline as draft', () => { restore(); dirty = true; onDraftChange(); }));
  output.addEventListener('change', () => { cancel(); dirty = true; onDraftChange(); });
  const svg = (height, label) => { const value = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); value.setAttribute('viewBox', '0 0 600 ' + height); value.setAttribute('role', 'img'); value.setAttribute('aria-label', label); value.style.width = '100%'; return value; };
  const draw = (target, tag, attrs, label = null) => { const value = document.createElementNS(target.namespaceURI, tag); for (const [key, entry] of Object.entries(attrs)) value.setAttribute(key, String(entry)); if (label) { const title = document.createElementNS(target.namespaceURI, 'title'); title.textContent = label; value.append(title); } target.append(value); return value; };
  const ratioX = ratio => 20 + Math.log2(ratio / 0.125) / Math.log2(32 / 0.125) * 560;
  const renderSpectrum = draft => {
    const plot = svg(150, 'Declared linear amplitude gains on a logarithmic frequency-ratio axis'), text = node('p', 'Log2 ratio axis:1/8–32 × reference ' + draft.referenceHz + 'Hz. Stem height: declared linear amplitude gain,0–1. Circle authored; triangle estimated; cross disabled. This is authored data, not a measured spectrum.');
    draw(plot, 'line', { x1: 20, y1: 130, x2: 580, y2: 130, stroke: 'currentColor' });
    for (let index = 0; index < draft.partialRatios.length; index++) {
      const x = ratioX(draft.partialRatios[index]), y = 130 - draft.partialGains[index] * 110, origin = draft.partialProvenance[index].kind;
      draw(plot, 'line', { x1: x, x2: x, y1: 130, y2: y, stroke: 'currentColor', 'stroke-width': selectedPartial === index ? 3 : 1, 'stroke-dasharray': origin === 'disabled' ? '3 3' : '' });
      const mark = draw(plot, origin === 'estimated' ? 'path' : 'circle', origin === 'estimated' ? { d: 'M' + x + ' ' + (y - 5) + ' l-5 9 h10 z', fill: 'currentColor' } : { cx: x, cy: y, r: origin === 'disabled' ? 2 : 4, fill: origin === 'disabled' ? 'none' : 'currentColor', stroke: 'currentColor' },
        'Partial ' + index + ' · ratio ' + draft.partialRatios[index] + ' · ' + draft.referenceHz * draft.partialRatios[index] + 'Hz · gain ' + draft.partialGains[index] + ' · T60 ' + draft.partialT60Seconds[index] + ' seconds · ' + origin);
      mark.setAttribute('role', 'button'); mark.setAttribute('tabindex', '0'); mark.setAttribute('aria-label', 'Select partial ' + index);
      const select = () => { selectedPartial = index; rows[index]?.ratio.focus(); }; mark.addEventListener('click', select); mark.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
      if (origin === 'disabled') draw(plot, 'path', { d: 'M' + (x - 4) + ' ' + (y - 4) + ' l8 8 m0 -8 l-8 8', stroke: 'currentColor' });
    }
    partials.replaceChildren(node('h3', 'Partial ladder'), text, plot);
    if (rows.length !== draft.partialRatios.length) {
      rows = draft.partialRatios.map((_, index) => {
        const row = node('fieldset'); row.append(node('legend', 'Partial ' + index));
        const ratio = field(row, 'Partial ' + index + ' exact ratio', 1), gain = field(row, 'Partial ' + index + ' linear amplitude gain', 1), t60 = field(row, 'Partial ' + index + ' T60 seconds', 1), slider = field(row, 'Partial ' + index + ' gain drag or keyboard', 1, 'range'), origin = node('p');
        slider.min = gain.min = '0'; slider.max = gain.max = '1'; slider.step = gain.step = '0.001'; ratio.min = '0.125'; ratio.max = '32'; t60.min = '0.04'; t60.max = '4';
        for (const [input, key] of [[ratio, 'partialRatios'], [gain, 'partialGains'], [slider, 'partialGains'], [t60, 'partialT60Seconds']]) input.addEventListener('change', () => mutate(next => { next[key][index] = number(input); selectedPartial = index; }));
        row.append(origin); return { element: row, ratio, gain, slider, t60, origin };
      });
    }
    for (const [index, row] of rows.entries()) {
      setValue(row.ratio, draft.partialRatios[index]); setValue(row.gain, draft.partialGains[index]); setValue(row.slider, draft.partialGains[index]); setValue(row.t60, draft.partialT60Seconds[index]);
      const provenance = draft.partialProvenance[index]; row.origin.textContent = provenance.kind + ' · ' + draft.partialRatios[index] * draft.referenceHz + 'Hz' + (provenance.fitRef ? ' · fit ' + provenance.fitRef.id + ' r' + provenance.fitRef.revision + ' · estimates require the source-fit pin/remove workflow' : '');
      row.ratio.readOnly = row.gain.readOnly = row.t60.readOnly = provenance.kind !== 'authored'; row.slider.disabled = provenance.kind !== 'authored'; partials.append(row.element);
    }
  };
  const renderTuning = draft => {
    const plot = svg(80, 'Exact tuning degree ratios within the explicitly named period'), cents = 1200 * Math.log2(draft.periodRatio);
    draw(plot, 'line', { x1: 20, y1: 45, x2: 580, y2: 45, stroke: 'currentColor' });
    for (const [index, ratio] of [...draft.degreeRatios, draft.periodRatio].entries()) { const x = 20 + Math.log(ratio) / Math.log(draft.periodRatio) * 560; draw(plot, 'line', { x1: x, x2: x, y1: 25, y2: 55, stroke: 'currentColor' }, 'Degree ' + index + ': ratio ' + ratio + ', ' + 1200 * Math.log2(ratio) + ' cents, ' + draft.referenceHz * ratio + 'Hz'); }
    tuning.replaceChildren(node('h3', 'Tuning field · ' + (draft.periodRatio === 2 ? '2:1 octave' : 'period ratio ' + draft.periodRatio + ' · ' + cents + ' cents')), node('p', 'Reference ' + draft.referenceHz + 'Hz at canonical ' + draft.referenceCents + ' cents. Onset-only: held voices retain their onset spectrum and tuning. Retune-held is unsupported for this sparse pair. Link is ' + (draft.coupledMorph.linked ? 'explicitly on' : 'off') + '; unlinking changes no ratios.'), plot);
  };
  const renderCurves = state => {
    const analysis = state.analysis; curves.replaceChildren(); if (!analysis) return;
    curves.append(node('h3', (state.analysisStale ? 'STALE · ' : '') + analysis.model), node('p', 'Relative modeled roughness · declared linear partial amplitudes, exponential T60 snapshots and renderer upper-band taper. Shared ADSR/source-table color and listener preference are outside this model. Predicted difference Hz are not measured beat estimates.'));
    const shown = analysis.curves.filter(curve => curve.window.id === slice.value), plot = svg(180, 'Bounded offline relative roughness for the selected register and explicit source-second window');
    let maximumY = 0; for (const curve of shown) for (const point of curve.points) maximumY = Math.max(maximumY, point.modeledRoughness);
    for (const [index, curve] of shown.entries()) {
      const path = curve.points.map((point, at) => (at ? 'L' : 'M') + (20 + Math.log(point.ratio / analysis.request.scan.minimumRatio) / Math.log(analysis.request.scan.maximumRatio / analysis.request.scan.minimumRatio) * 560) + ' ' + (155 - point.modeledRoughness / (maximumY || 1) * 130)).join(' ');
      draw(plot, 'path', { d: path, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-dasharray': ['', '5 3', '2 3', '8 2 2 2'][index] || '' });
      curves.append(node('p', curve.registerHz + 'Hz fundamental · ' + curve.window.id + ' ' + curve.window.startSeconds + '–' + curve.window.endSeconds + ' source seconds · ' + curve.window.samples + ' snapshots.'));
    }
    plot.style.opacity = state.analysisStale ? '0.45' : '1'; curves.append(plot, node('p', 'Y maximum ' + maximumY + ' relative model units. ' + analysis.status + '. Input ' + analysis.requestHash));
    if (coincidences.checked) curves.append(node('pre', JSON.stringify(analysis.coincidences.map(group => ({ registerHz: group.registerHz, ratio: group.ratio, pairs: group.pairs.slice(0, 4), omittedPairs: group.omittedPairs })), null, 2)));
  };
  for (const input of [slice, coincidences]) input.addEventListener('input', () => renderCurves(readState() || {}));
  for (const input of [points, ...Object.values(windows).flatMap(range => Object.values(range))]) input.addEventListener('change', () => { invalidateAnalysis(); dirty = true; onDraftChange(); shownAnalysis = null; message.textContent = 'The requested source-second windows changed; Analyze explicitly to replace the retained curve.'; });
  function render() {
    if (disposed) return; const source = readSource(), state = readState(), draft = state?.draft;
    voice.textContent = 'Selected voice: ' + (source?.lane?.name || 'unavailable') + ' · local output rate ' + (source?.sampleRate || 'not enabled') + 'Hz. External route approximation is reviewed separately.';
    small.disabled = options.disabled = !draft; analyzeButton.disabled = bypass.disabled = !draft || !!state?.busy || !!state?.stale; prepareButton.disabled = !draft || !!state?.busy || !!state?.stale || jsonDirty; commitButton.disabled = !state?.canCommit || jsonDirty; stop.disabled = !state?.busy && !state?.prepared;
    if (state?.error) message.textContent = state.error; else if (state?.stale) message.textContent = 'Selected source changed. Retained draft/evidence are stale; reopen the current voice before preparing.';
    else if (state?.busy) message.textContent = 'Owned offline bench work in progress; live physics is unchanged.';
    else if (state?.committed) { message.textContent = 'Spectrum and tuning committed together. Held onset voices and physical timing are retained.'; dirty = false; }
    else if (state?.prepared) message.textContent = 'Both exact revisions prepared silently; Commit publishes one sound edit.';
    if (!draft) return;
    if (shownDraft !== draft) {
      shownDraft = draft; setValue(stretch, draft.coupledMorph.stretch); linked.checked = draft.coupledMorph.linked; setValue(reference, draft.referenceHz); setValue(period, draft.periodRatio); setValue(degrees, draft.degreeRatios.join(','));
      setValue(minimum, draft.registerDomain.minimumHz); setValue(maximum, draft.registerDomain.maximumHz); if (!jsonDirty) setValue(json, JSON.stringify(draft, null, 2)); renderSpectrum(draft); renderTuning(draft);
    }
    if (shownAnalysis !== state.analysis || state.analysisStale) { shownAnalysis = state.analysis; renderCurves(state); }
    receipt.textContent = JSON.stringify({ draftReferenceState: state.prepared ? 'freshly-hashed-in-prepared-set' : 'local-draft;content-hashes-recomputed-by-offline-analysis-or-prepare', spectrumRef: draft.spectrumRef, tuningRef: draft.tuningRef, heldPolicy: draft.heldPolicy, prepared: state.prepared, analysisStale: state.analysisStale, analysisReceipt: state.analysis?.receipt || null }, null, 2);
  }
  element.append(header, voice, actions, message, small, partials, tuning, details, curves, jsonDetails, receipt);
  return Object.freeze({ element, render, hasDraft: () => dirty || jsonDirty, dispose() { disposed = true; rows = []; element.remove(); } });
}
