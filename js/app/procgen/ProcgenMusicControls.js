const ROOTS = ['C', 'C# / Db', 'D', 'D# / Eb', 'E', 'F', 'F# / Gb', 'G', 'G# / Ab', 'A', 'A# / Bb', 'B'];
const spreadLabel = value => value === 0 ? 'Same register · 0 semitones' : value % 12 === 0 ? `${value / 12} ${value === 12 ? 'octave' : 'octaves'} · ${value} semitones` : `${value} semitones`;
const laneLabel = (start, end) => start === end ? `Lane ${start}` : `Lanes ${start}–${end}`;
const createProcgenMusicControls = ({ document, getState, onChange }) => {
  const globalHost = document.getElementById('procgenMusicGlobalControls'), rangeHost = document.getElementById('procgenLaneMusicControls');
  if (!globalHost || !rangeHost) return { sync() {}, dispose() {} };
  const listeners = [], rows = new Map(); let disposed = false;
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  const listen = (el, event, handler, owned = listeners) => { el.addEventListener(event, handler); owned.push([el, event, handler]); };
  const removeListeners = owned => { for (const [el, event, handler] of owned) el.removeEventListener(event, handler); };
  const field = (parent, text, input, className) => { const label = node('label', text, className); label.append(input); parent.append(label); return input; };
  const select = (parent, text, id) => { const el = field(parent, text, node('select')); el.id = id; return el; };
  const number = (parent, text, min, max, id) => { const el = field(parent, text, node('input')); el.type = 'number'; el.min = String(min); el.max = String(max); el.step = '1'; if (id) el.id = id; return el; };
  const button = (parent, text, action, owned = listeners) => { const el = node('button', text); el.type = 'button'; parent.append(el); listen(el, 'click', action, owned); return el; };
  const setValue = (el, value, force = false) => { if (force || document.activeElement !== el) el.value = String(value); };
  const options = (el, choices) => {
    const signature = JSON.stringify(choices);
    if (el.dataset.options === signature) return;
    el.replaceChildren(); for (const choice of choices) { const option = node('option', choice.label); option.value = String(choice.id); el.append(option); }
    el.dataset.options = signature;
  };
  const change = command => { if (!disposed) { onChange(command); sync(true); } };
  const globals = node('div', '', 'procgen-music-global-fields'); globalHost.append(globals);
  const root = select(globals, 'Global key', 'procgenMusicRoot'), scale = select(globals, 'Scale', 'procgenMusicScale');
  const spread = number(globals, 'Pitch spread', 0, 48, 'procgenMusicSpread');
  options(root, ROOTS.map((label, id) => ({ id, label })));
  const feedback = node('output', '', 'procgen-lane-music-summary'); feedback.id = 'procgenMusicSpreadValue'; feedback.setAttribute('for', spread.id); globalHost.append(feedback);
  const presets = node('div', '', 'procgen-spread-presets'); presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', 'Pitch spread shortcuts'); globalHost.append(presets);
  for (const value of [0, 12, 24, 36, 48]) button(presets, value ? `${value / 12} ${value === 12 ? 'octave' : 'octaves'}` : 'Same register', () => change({ type: 'global', patch: { spread: value } }));
  globalHost.append(node('p', 'Spread is the total low-to-high pitch range across the current lanes. Key and scale affect melodic schemes; drums keep their instrument numbers.'));
  const advanced = node('details'), advancedSummary = node('summary', 'Stereo & percussion'); advanced.append(advancedSummary); globalHost.append(advanced);
  const advancedFields = node('div', '', 'procgen-music-global-fields'); advanced.append(advancedFields);
  const stereoWidth = number(advancedFields, 'Local stereo width', 0, 127, 'procgenMusicStereoWidth'), variation = select(advancedFields, 'Percussion variation', 'procgenMusicVariation');
  options(variation, ['steady', 'balanced', 'animated'].map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })));
  advanced.append(node('p', 'Local stereo width: 0 stays centered; 127 uses the full stereo field in browser audio. Percussion variation changes event-driven drum responses.'));
  for (const [el, key] of [[root, 'root'], [scale, 'scaleId'], [spread, 'spread'], [stereoWidth, 'stereoWidth'], [variation, 'variation']]) listen(el, 'change', () => {
    if (el.type === 'number' && (!String(el.value).trim() || !Number.isFinite(Number(el.value)) || Number(el.value) < Number(el.min) || Number(el.value) > Number(el.max))) { sync(true); return; }
    change({ type: 'global', patch: { [key]: ['scaleId', 'variation'].includes(key) ? el.value : Number(el.value) } });
  });
  const rules = node('p', 'Ranges include both endpoints. The last enabled matching row wins. All other lanes use the default scheme. Disabled ranges and ranges beyond the current world stay saved.', 'procgen-lane-music-rules'); rangeHost.append(rules);
  const list = node('div', '', 'procgen-lane-music-list'); list.id = 'procgenLaneMusicList'; rangeHost.append(list);
  const empty = node('p', 'All lanes use the default scheme. Add a range to give part of the world a different voice.', 'procgen-lane-music-empty'); rangeHost.append(empty);
  const add = button(rangeHost, 'Add lane range', () => {
    const previous = new Set(rows.keys()); change({ type: 'addRange' });
    for (const [id, row] of rows) if (!previous.has(id)) { row.start.focus(); break; }
  }); add.id = 'procgenLaneMusicAdd';
  const capacity = node('p'); capacity.id = 'procgenLaneMusicCapacity'; rangeHost.append(capacity);
  const effective = node('details'); effective.append(node('summary', 'Effective lane assignments'));
  const assignmentList = node('ul'); assignmentList.id = 'procgenLaneMusicAssignments'; effective.append(assignmentList); rangeHost.append(effective);
  const createRow = entry => {
    const owned = [], host = node('div', '', 'procgen-lane-music-row'); host.dataset.rangeId = entry.id; host.setAttribute('role', 'group');
    const fields = node('div', '', 'procgen-lane-music-fields'); host.append(fields);
    const enabled = node('input'); enabled.type = 'checkbox'; field(fields, 'Enabled', enabled);
    const start = number(fields, 'From lane', 1, 1024), end = number(fields, 'Through lane', 1, 1024);
    const scheme = field(fields, 'Scheme', node('select'), 'procgen-lane-scheme-field');
    const actions = node('div', '', 'procgen-lane-music-actions'); fields.append(actions);
    const up = button(actions, 'Move up', () => change({ type: 'moveRange', id: entry.id, direction: -1 }), owned);
    const down = button(actions, 'Move down', () => change({ type: 'moveRange', id: entry.id, direction: 1 }), owned);
    button(actions, 'Remove', () => {
      const focused = host.contains(document.activeElement);
      change({ type: 'removeRange', id: entry.id });
      if (focused) add.focus();
    }, owned);
    const description = node('p'), status = node('p', '', 'procgen-lane-music-summary'), warning = node('p', '', 'procgen-lane-music-warning'); host.append(description, status, warning);
    for (const [el, key] of [[enabled, 'enabled'], [start, 'startLane'], [end, 'endLane'], [scheme, 'schemeId']]) listen(el, 'change', () => {
      if (el.type === 'number' && (!String(el.value).trim() || !Number.isFinite(Number(el.value)) || Number(el.value) < 1 || Number(el.value) > 1024)) { sync(true); return; }
      change({ type: 'updateRange', id: entry.id, patch: { [key]: key === 'enabled' ? el.checked : key === 'schemeId' ? el.value : Number(el.value) } });
    }, owned);
    return { host, enabled, start, end, scheme, up, down, description, status, warning, owned };
  };
  const sync = (force = false) => {
    if (disposed) return;
    const state = getState(); if (!state) return;
    options(scale, state.scales); setValue(root, state.root, force); setValue(scale, state.scaleId, force); setValue(spread, state.spread, force);
    setValue(stereoWidth, state.stereoWidth, force); setValue(variation, state.variation, force); feedback.textContent = spreadLabel(state.spread);
    const ids = new Set(state.ranges.map(entry => entry.id));
    for (const [id, row] of rows) if (!ids.has(id)) { removeListeners(row.owned); row.host.remove(); rows.delete(id); }
    const winners = Array.from({ length: state.laneCount }, (_, index) => {
      const lane = index + 1; let winner = null;
      for (const entry of state.ranges) if (entry.enabled && lane >= entry.startLane && lane <= entry.endLane) winner = entry;
      return winner;
    });
    for (let index = 0; index < state.ranges.length; index++) {
      const entry = state.ranges[index]; let row = rows.get(entry.id);
      if (!row) { row = createRow(entry); rows.set(entry.id, row); }
      if (list.children[index] !== row.host) {
        const focused = document.activeElement, restoreFocus = list.contains(focused);
        list.insertBefore(row.host, list.children[index] || null);
        if (restoreFocus) focused.focus({ preventScroll: true });
      }
      row.host.setAttribute('aria-label', `Range ${index + 1}: ${laneLabel(entry.startLane, entry.endLane)}`);
      row.host.classList.toggle('is-bypassed', !entry.enabled); row.enabled.checked = entry.enabled;
      setValue(row.start, entry.startLane, force); setValue(row.end, entry.endLane, force); options(row.scheme, state.schemes); setValue(row.scheme, entry.schemeId, force);
      row.up.disabled = index === 0; row.down.disabled = index === state.ranges.length - 1;
      row.description.textContent = state.schemes.find(s => s.id === entry.schemeId)?.description || '';
      const covered = Math.max(0, Math.min(state.laneCount, entry.endLane) - entry.startLane + 1), active = winners.filter(winner => winner?.id === entry.id).length;
      row.status.textContent = !entry.enabled ? 'Disabled; other ranges or the default apply.' : `${active} of ${state.laneCount} current lanes use this scheme.`;
      row.warning.textContent = entry.endLane > state.laneCount ? `Saved through lane ${entry.endLane}; the current world has ${state.laneCount} lanes.` : '';
      if (entry.enabled && covered > active) row.warning.textContent += (row.warning.textContent ? ' ' : '') + (active ? 'Partly overridden by a later range.' : 'Overridden by a later range.');
      row.warning.hidden = !row.warning.textContent;
    }
    empty.hidden = state.ranges.length > 0; add.disabled = state.ranges.length >= state.maxRanges;
    capacity.textContent = `${state.ranges.length} / ${state.maxRanges} ranges · ${state.laneCount} current lanes`;
    const segments = [];
    for (let lane = 1; lane <= state.laneCount; lane++) {
      const winner = winners[lane - 1], id = winner?.schemeId || state.defaultSchemeId, source = winner?.id || null, last = segments.at(-1);
      if (last?.id === id && last.source === source) last.end = lane;
      else segments.push({ id, source, start: lane, end: lane });
    }
    assignmentList.replaceChildren(...segments.map(segment => node('li', `${laneLabel(segment.start, segment.end)}: ${state.schemes.find(s => s.id === segment.id)?.label || segment.id}${segment.source ? '' : ' (default)'}`)));
  };
  sync();
  return { sync, dispose() { disposed = true; removeListeners(listeners); for (const row of rows.values()) removeListeners(row.owned); } };
};
export { createProcgenMusicControls, spreadLabel };
