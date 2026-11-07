import { canonicalDataText } from '../../core/CanonicalData.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
export function createGestureSoundBrowserView({ document, jobs, resourceBudget, getCandidates, getTake = null, getSourceIdentity, onSelect, onStatus = () => {} } = {}) {
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; }, element = node('details'), controls = node('div'), results = node('ol'), status = node('output'), importInput = node('input');
  element.className = 'studio-gesture-sound-query'; element.append(node('summary', 'Find demonstrated physical-gesture compatibility'));
  const choice = (label, values) => { const wrap = node('label', label), input = node('select'); input.setAttribute('aria-label', label); for (const [value, text] of values) { const option = node('option', text); option.value = value; input.append(option); } wrap.append(input); controls.append(wrap); return input; },
    field = (label, value, type = 'number') => { const wrap = node('label', label), input = node('input'); input.type = type; input.value = value; input.setAttribute('aria-label', label); if (type === 'number') { input.min = '0'; input.step = 'any'; } wrap.append(input); controls.append(wrap); return input; };
  const gesture = choice('Requested gesture', [['any', 'Any exact measured domain'], ['short-trigger', 'Short physical triggers'], ['held', 'Long held gesture'], ['contact-friction', 'Captured contact friction/motion'], ['dense', 'Dense actual physical fixture']]),
    attack = field('Maximum digital relative attack rise in seconds · blank ignores', '', 'number'), hold = field('Minimum demonstrated hold in seconds', 1), gate = field('Exact tested gate seconds · blank ignores', '', 'number'),
    pitch = field('Exact demonstrated pitch in Hz · blank ignores', '', 'number'), tags = field('Authored taste tags · comma separated', '', 'text'), take = field('Intersect selected saved physical take', '', 'checkbox'),
    bend = field('Require independent per-voice pitch', '', 'checkbox'), ready = field('Require currently prepared candidate', '', 'checkbox');
  take.checked = !!getTake; take.disabled = !getTake; bend.checked = false; ready.checked = false;
  importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.setAttribute('aria-label', 'Import local generated gesture descriptor receipts');
  let descriptors = null, result = null, operation = null, disposed = false, serial = 0, resultIdentity = null; const retirement = createProcgenRetirementScope();
  const report = text => { status.textContent = text; onStatus(text); }, cancel = () => operation?.controller.abort(new Error('The gesture query changed.'));
  const run = async work => {
    if (disposed || operation) throw new Error('Finish or cancel the gesture query first.');
    const controller = new AbortController(), token = { controller, completion: null, identity: getSourceIdentity(), serial: ++serial }; operation = token; paint();
    const current = () => !disposed && operation === token && !controller.signal.aborted && getSourceIdentity() === token.identity;
    token.completion = (async () => { try { return await work(token, current); } finally { if (operation === token) operation = null; paint(); } })();
    return token.completion;
  };
  importInput.addEventListener('change', () => { const file = importInput.files?.[0]; if (!file) return;
    run(async (token, current) => {
      if (file.size < 1 || file.size > 16 * 1048576) throw new Error('Choose a local descriptor set of at most16MiB.');
      let candidate = null;
      try { candidate = await jobs.compute({ kind: 'import-gesture-sound-descriptors', ownerId: 'sound-library-gesture-receipts', ownerEpoch: token.serial, sourceRevision: token.identity, inputBytes: file.size, maxBytes: 16 * 1048576, maxNodes: 1000000, estimatedPeakBytes: 192 * 1048576, deadlineMs: 60000,
        budgetAdapter: resourceBudget, signal: token.controller.signal, isCurrent: current, prepareInput: () => file.text() });
      if (!current()) throw new Error('The staged content changed while importing gesture receipts.'); descriptors?.release(); descriptors = candidate; candidate = null; result?.release(); result = null; results.replaceChildren(); report('Local receipts imported. Search rechecks exact patch, renderer, quality and take coverage; imported evidence is not new render qualification.');
      } finally { candidate?.release(); }
    }).catch(error => report(error.message));
  });
  const optional = input => input.value.trim() ? Number(input.value) : null;
  const search = node('button', 'Search staged exact revisions'), stop = node('button', 'Cancel gesture search'); search.type = stop.type = 'button'; stop.addEventListener('click', cancel);
  search.addEventListener('click', () => run(async (token, current) => {
    const candidates = await getCandidates(); if (!current()) throw new Error('The sound stage changed before query.');
    const selectedTake = take.checked && getTake ? await getTake({ signal: token.controller.signal }) : null; if (!current()) throw new Error('The selected take changed before query.');
    const query = { schema: 'lemmings-sound-query/v1', gesture: gesture.value, minimumHoldSeconds: Number(hold.value), requirePerVoicePitch: bend.checked, preparedOnly: ready.checked, authoredTags: tags.value.split(',').map(value => value.trim()).filter(Boolean), maximumResults: 8,
        ...Object.fromEntries([['maximumAttackSeconds', attack], ['gateSeconds', gate], ['pitchHz', pitch]].flatMap(([key, input]) => optional(input) == null ? [] : [[key, optional(input)]])) },
      input = { candidates, descriptors: descriptors?.value.descriptors || [], query, take: selectedTake }; let candidate = null;
    try { candidate = await jobs.compute({ kind: 'query-gesture-sounds', ownerId: 'sound-library-gesture-query', ownerEpoch: token.serial, sourceRevision: token.identity,
      inputBytes: canonicalDataText(input, { maxBytes: 16 * 1048576, maxNodes: 1000000 }).bytes.length, maxBytes: 16 * 1048576, maxNodes: 1000000, estimatedPeakBytes: 192 * 1048576, deadlineMs: 60000, signal: token.controller.signal, budgetAdapter: resourceBudget, isCurrent: current, prepareInput: () => input });
    if (!current()) throw new Error('The sound or take source changed during query.'); result?.release(); result = candidate; candidate = null; resultIdentity = token.identity; paint(); report('Compatibility is ranked separately from authored taste. Missing or stale measurements remain unknown. Choose explicitly; audition still prepares the current backend.');
    } finally { candidate?.release(); }
  }).catch(error => report(error.message)));
  for (const input of [gesture, attack, hold, gate, pitch, tags, take, bend, ready]) input.addEventListener('input', () => { cancel(); resultIdentity = null; paint(); });
  function paint() {
    if (disposed) return; search.disabled = !!operation; stop.disabled = !operation; importInput.disabled = !!operation;
    results.replaceChildren();
    if (!result) return; const stale = resultIdentity !== getSourceIdentity(), response = result.value;
    for (const row of response.candidates) {
      const entry = node('li'), choose = node('button', 'Select ' + row.name + ' for explicit audition'); choose.type = 'button'; choose.disabled = stale || row.state === 'unsupported'; choose.addEventListener('click', () => { if (resultIdentity !== getSourceIdentity()) { report('Search the changed content/take again before selecting this suggestion.'); return; } onSelect(row.identity, { schema: 'lemmings-gesture-compatibility-receipt/v1', requestHash: response.requestHash, descriptorHash: row.descriptorHash, state: row.state, patchReceipt: row.patchReceipt, take: response.take ? { takeId: response.take.takeId, revision: response.take.revision, canonicalHash: response.take.canonicalHash } : null, explanations: [...row.reasons, ...row.unknown, ...row.constraints].slice(0, 8).map(text => text.slice(0, 512)), scope: 'exact-query-source-and-local-report-reference;not-new-render-or-listening-acceptance' }); });
      entry.append(node('strong', row.name + ' · ' + row.state + (stale ? ' · STALE' : '')), node('p', [...row.reasons, ...row.unknown, ...row.constraints].join(' ')), node('p', 'Authored tag matches: ' + (row.subjectivePreference.matchedAuthoredTags.join(', ') || 'none') + '. Evidence ' + (row.descriptorHash || 'unknown') + '; assets ' + (row.assetBytes ?? 'unknown') + ' bytes.'), choose); results.append(entry);
    }
  }
  element.append(node('p', 'Measurements describe exact tested gestures and renderer revisions. Authored adjectives express taste. Missing controls can require explicit reinterpretation or reconstruction; discovery never creates them or switches the live patch.'), controls, importInput, search, stop, status, results);
  return Object.freeze({ element, refresh: paint, invalidate() { cancel(); resultIdentity = null; paint(); },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; cancel(); return retirement.retire([{ name: 'gesture-query-job', run: async () => { await operation?.completion.catch(() => {}); descriptors?.release(); result?.release(); element.remove(); } }]); } });
}
