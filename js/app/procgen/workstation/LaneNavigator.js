const MAX_LANES = 1024, PAGE_SIZE = 16;
const integer = value => Number.isFinite(value) ? Math.trunc(value) : 0;

export function createLaneNavigator({ firstLane = 0 } = {}) {
  let lanes = [], indices = new Map(), names = [], identity, initialized = false, disposed = false, anchor = null, first = Math.max(0, integer(firstLane)), count = 8;
  let all = [], allIndices = new Map();
  let indexedSoloIds = null, searchCache = null;
  const stats = { syncBuilds: 0, searchBuilds: 0, searchHits: 0, summaryVisits: 0 };
  let remainder = 0, wheelTime = null;
  const locate = index => { first = Math.max(0, Math.min(Math.max(0, lanes.length - count), integer(index))); anchor = lanes[first]?.id ?? null; return first; };
  return {
    sync(next, documentIdentity, { allLanes = next, soloLaneIds = null } = {}) {
      if (disposed) return first;
      if (next.length > MAX_LANES || allLanes.length > MAX_LANES) throw new RangeError('Lane navigator exceeds the admitted lane count.');
      if (soloLaneIds != null && (!(soloLaneIds instanceof Set) || soloLaneIds.size > MAX_LANES)) throw new TypeError('Invalid indexed lane solos.');
      if (initialized && next === lanes && all === allLanes && identity === documentIdentity) { indexedSoloIds = soloLaneIds; return first; }
      const changedDocument = initialized && identity !== documentIdentity, previous = lanes, previousFirst = first;
      const nextIndices = new Map(next.map((lane, index) => [lane.id, index]));
      if (nextIndices.size !== next.length) throw new Error('Lane navigator requires unique lane IDs.');
      indices = nextIndices;
      if (changedDocument) { anchor = null; first = 0; remainder = 0; wheelTime = null; }
      else if (anchor && !indices.has(anchor)) {
        anchor = null;
        for (let distance = 1; distance <= previous.length && !anchor; distance++) {
          for (const index of [previousFirst + distance, previousFirst - distance]) if (indices.has(previous[index]?.id)) { anchor = previous[index].id; break; }
        }
      }
      lanes = next; all = allLanes; allIndices = new Map(all.map((lane, index) => [lane.id, index])); names = all.map(lane => `${lane.name || ''} ${lane.role || ''} ${lane.id}`.toLocaleLowerCase()); identity = documentIdentity; initialized = true;
      indexedSoloIds = soloLaneIds; searchCache = null; stats.syncBuilds++;
      return locate(anchor && indices.has(anchor) ? indices.get(anchor) : first);
    },
    window(visibleCount) { if (disposed) return first; count = Math.max(1, Math.min(8, integer(visibleCount))); return locate(first); },
    move(delta) { if (disposed) return first; remainder = 0; return locate(first + integer(delta)); },
    jump(id) { if (disposed || !indices.has(id)) return null; remainder = 0; return locate(indices.get(id)); },
    wheel({ deltaY, deltaMode = 0, ctrlKey = false, metaKey = false }, rowHeight, pageHeight, now = 0) {
      if (disposed || ctrlKey || metaKey || !Number.isFinite(deltaY) || !deltaY || lanes.length <= count) return null;
      const step = Math.max(40, Math.min(48, (Number.isFinite(rowHeight) ? rowHeight : 116) * 0.3));
      const pixels = Math.max(-1200, Math.min(1200, deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, pageHeight || 1080) : 1)));
      if (wheelTime == null || now < wheelTime || now - wheelTime > 250 || remainder && Math.sign(remainder) !== Math.sign(pixels)) remainder = 0;
      wheelTime = now; remainder += pixels;
      const rows = Math.max(-count, Math.min(count, Math.trunc(remainder / step)));
      if (!rows) return first;
      remainder %= step; const old = first; locate(first + rows); if (first === old) remainder = 0; return first;
    },
    search(query = '', page = 0) {
      const text = String(query).slice(0, 256).trim().toLocaleLowerCase(), requestedPage = Math.max(0, integer(page));
      if (searchCache?.query === text && searchCache.requestedPage === requestedPage) { stats.searchHits++; return searchCache.value; }
      const terms = text.split(/\s+/).filter(Boolean), matches = []; stats.searchBuilds++;
      if (!disposed) for (let index = 0; index < all.length; index++) if (terms.every(term => names[index].includes(term))) matches.push(index);
      const offset = Math.max(0, Math.min(Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1), integer(page))) * PAGE_SIZE;
      const value = Object.freeze({ total: matches.length, page: offset / PAGE_SIZE, pageSize: PAGE_SIZE, items: Object.freeze(matches.slice(offset, offset + PAGE_SIZE).map(index => Object.freeze({ id: all[index].id, name: String(all[index].name || ''), ordinal: index + 1 }))) });
      searchCache = { query: text, requestedPage, value }; return value;
    },
    summary(selectedId, armedIds = []) {
      const visible = new Set(lanes.slice(first, first + count).map(lane => lane.id)), armed = new Set(armedIds), selected = allIndices.has(selectedId) && !visible.has(selectedId) ? selectedId : null;
      let soloCount = 0, armedCount = 0, soloId = null, armedId = null;
      if (indexedSoloIds) {
        let soloIndex = Infinity, armedIndex = Infinity;
        for (const id of indexedSoloIds) { stats.summaryVisits++; const index = allIndices.get(id); if (index == null || visible.has(id)) continue; soloCount++; if (index < soloIndex) { soloIndex = index; soloId = id; } }
        for (const id of armed) { stats.summaryVisits++; const index = allIndices.get(id); if (index == null || visible.has(id)) continue; armedCount++; if (index < armedIndex) { armedIndex = index; armedId = id; } }
      } else for (const lane of all) { stats.summaryVisits++; if (!visible.has(lane.id)) {
        if (lane.solo) { soloCount++; soloId ??= lane.id; } if (armed.has(lane.id)) { armedCount++; armedId ??= lane.id; }
      } }
      return { selected, soloCount, armedCount, target: selected || armedId || soloId, firstVisibleId: anchor, firstLane: first, visibleCount: Math.min(count, lanes.length), visibleTotal: lanes.length, total: all.length };
    },
    diagnostics: () => ({ ...stats }),
    dispose() { disposed = true; lanes = []; all = []; indices.clear(); allIndices.clear(); indexedSoloIds = null; searchCache = null; names = []; anchor = null; remainder = 0; wheelTime = null; }
  };
}

export function createLaneNavigatorView({ document, navigator, onJump, onQuery = () => false, getSelection, getArmed = () => [] }) {
  const element = document.createElement('section'), label = document.createElement('label'), search = document.createElement('input'), status = document.createElement('output'), results = document.createElement('div'), previous = document.createElement('button'), next = document.createElement('button'), breadcrumb = document.createElement('button');
  element.className = 'studio-lane-navigator'; element.setAttribute('aria-label', 'Lane navigator'); search.type = 'search'; search.maxLength = 256; search.setAttribute('aria-label', 'Lane search'); label.append('Find lane ', search);
  results.setAttribute('role', 'group'); results.setAttribute('aria-label', 'Matching lanes'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  previous.textContent = 'Previous matches'; next.textContent = 'Next matches'; breadcrumb.setAttribute('aria-label', 'Jump to offscreen lane'); breadcrumb.className = 'studio-offscreen-lanes';
  for (const button of [previous, next, breadcrumb]) button.type = 'button';
  element.append(label, status, results, previous, next);
  let page = 0, disposed = false, composing = false, target = null, documentIdentity, initialized = false;
  const buttons = new Map();
  const update = identity => {
    if (disposed) return;
    if (initialized && documentIdentity !== identity) {
      if (results.contains(document.activeElement)) search.focus();
      for (const button of buttons.values()) button.remove(); buttons.clear(); search.value = ''; page = 0; composing = false;
    } documentIdentity = identity; initialized = true;
    const match = navigator.search(search.value, page), summary = navigator.summary(getSelection(), getArmed()); page = match.page; target = summary.target;
    status.textContent = match.total ? `${match.total} matching lanes · ${page * match.pageSize + 1}–${page * match.pageSize + match.items.length}` : 'No matching lanes';
    previous.disabled = page === 0; next.disabled = (page + 1) * match.pageSize >= match.total;
    const retained = new Set(match.items.map(item => item.id));
    for (const [id, button] of buttons) if (!retained.has(id)) { if (document.activeElement === button) search.focus(); button.remove(); buttons.delete(id); }
    for (const [index, item] of match.items.entries()) {
      let button = buttons.get(item.id);
      if (!button) { button = document.createElement('button'); button.type = 'button'; button.dataset.jumpLaneId = item.id; buttons.set(item.id, button); }
      button.textContent = `${item.ordinal} · ${item.name}`; button.setAttribute('aria-pressed', String(item.id === getSelection())); if (results.children[index] !== button) results.insertBefore(button, results.children[index] || null);
    }
    breadcrumb.hidden = !target; breadcrumb.textContent = [summary.selected ? 'Selected offscreen' : '', summary.soloCount ? `Solo ${summary.soloCount} offscreen` : '', summary.armedCount ? `Armed ${summary.armedCount} offscreen` : ''].filter(Boolean).join(' · ');
    breadcrumb.setAttribute('aria-label', 'Jump to offscreen lane' + (breadcrumb.textContent ? ' · ' + breadcrumb.textContent : ''));
    return summary;
  };
  const input = event => { if (disposed || composing || event.isComposing) return; page = 0; if (onQuery(search.value) !== true) update(documentIdentity); };
  const compositionStart = () => { composing = true; }, compositionEnd = () => { composing = false; input({}); };
  const click = event => { if (disposed) return; const id = event.target.closest?.('[data-jump-lane-id]')?.dataset.jumpLaneId; if (id) onJump(id); };
  const prev = () => { if (!disposed && page > 0) { page--; update(documentIdentity); } }, more = () => { if (!disposed && !next.disabled) { page++; update(documentIdentity); } }, jump = () => { if (!disposed && target) onJump(target); };
  search.addEventListener('input', input); search.addEventListener('compositionstart', compositionStart); search.addEventListener('compositionend', compositionEnd); results.addEventListener('click', click); previous.addEventListener('click', prev); next.addEventListener('click', more); breadcrumb.addEventListener('click', jump);
  return { element, breadcrumb, update, getQuery: () => search.value, setQuery(value, notify = true) { if (disposed) return; search.value = String(value).slice(0, 256); page = 0; if (!notify || onQuery(search.value) !== true) update(documentIdentity); }, dispose() {
    if (disposed) return; disposed = true; search.removeEventListener('input', input); search.removeEventListener('compositionstart', compositionStart); search.removeEventListener('compositionend', compositionEnd); results.removeEventListener('click', click); previous.removeEventListener('click', prev); next.removeEventListener('click', more); breadcrumb.removeEventListener('click', jump); buttons.clear(); element.remove(); breadcrumb.remove(); navigator.dispose();
  } };
}
