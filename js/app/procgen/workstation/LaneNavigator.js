const MAX_LANES = 1024, PAGE_SIZE = 16;
const integer = value => Number.isFinite(value) ? Math.trunc(value) : 0;

export function createLaneNavigator({ firstLane = 0 } = {}) {
  let lanes = [], indices = new Map(), names = [], identity, initialized = false, disposed = false, anchor = null, first = Math.max(0, integer(firstLane)), count = 8;
  let remainder = 0, wheelTime = null;
  const locate = index => { first = Math.max(0, Math.min(Math.max(0, lanes.length - count), integer(index))); anchor = lanes[first]?.id ?? null; return first; };
  return {
    sync(next, documentIdentity) {
      if (disposed) return first;
      if (next.length > MAX_LANES) throw new RangeError('Lane navigator exceeds the admitted lane count.');
      if (initialized && next === lanes && identity === documentIdentity) return first;
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
      lanes = next; names = lanes.map(lane => `${lane.name || ''} ${lane.role || ''} ${lane.id}`.toLocaleLowerCase()); identity = documentIdentity; initialized = true;
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
      const terms = String(query).slice(0, 256).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), matches = [];
      if (!disposed) for (let index = 0; index < lanes.length; index++) if (terms.every(term => names[index].includes(term))) matches.push(index);
      const offset = Math.max(0, Math.min(Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1), integer(page))) * PAGE_SIZE;
      return { total: matches.length, page: offset / PAGE_SIZE, pageSize: PAGE_SIZE, items: matches.slice(offset, offset + PAGE_SIZE).map(index => ({ id: lanes[index].id, name: String(lanes[index].name || ''), ordinal: index + 1 })) };
    },
    summary(selectedId, armedIds = []) {
      const visible = new Set(lanes.slice(first, first + count).map(lane => lane.id)), armed = new Set(armedIds), selected = indices.has(selectedId) && !visible.has(selectedId) ? selectedId : null;
      let soloCount = 0, armedCount = 0, soloId = null, armedId = null;
      for (const lane of lanes) if (!visible.has(lane.id)) {
        if (lane.solo) { soloCount++; soloId ??= lane.id; }
        if (armed.has(lane.id)) { armedCount++; armedId ??= lane.id; }
      }
      return { selected, soloCount, armedCount, target: selected || armedId || soloId, firstVisibleId: anchor, firstLane: first, visibleCount: Math.min(count, lanes.length), total: lanes.length };
    },
    dispose() { disposed = true; lanes = []; indices.clear(); names = []; anchor = null; remainder = 0; wheelTime = null; }
  };
}

export function createLaneNavigatorView({ document, navigator, onJump, getSelection, getArmed = () => [] }) {
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
    return summary;
  };
  const input = event => { if (disposed || composing || event.isComposing) return; page = 0; update(documentIdentity); };
  const compositionStart = () => { composing = true; }, compositionEnd = () => { composing = false; input({}); };
  const click = event => { if (disposed) return; const id = event.target.closest?.('[data-jump-lane-id]')?.dataset.jumpLaneId; if (id) onJump(id); };
  const prev = () => { if (!disposed && page > 0) { page--; update(documentIdentity); } }, more = () => { if (!disposed && !next.disabled) { page++; update(documentIdentity); } }, jump = () => { if (!disposed && target) onJump(target); };
  search.addEventListener('input', input); search.addEventListener('compositionstart', compositionStart); search.addEventListener('compositionend', compositionEnd); results.addEventListener('click', click); previous.addEventListener('click', prev); next.addEventListener('click', more); breadcrumb.addEventListener('click', jump);
  return { element, breadcrumb, update, dispose() {
    if (disposed) return; disposed = true; search.removeEventListener('input', input); search.removeEventListener('compositionstart', compositionStart); search.removeEventListener('compositionend', compositionEnd); results.removeEventListener('click', click); previous.removeEventListener('click', prev); next.removeEventListener('click', more); breadcrumb.removeEventListener('click', jump); buttons.clear(); element.remove(); breadcrumb.remove(); navigator.dispose();
  } };
}
