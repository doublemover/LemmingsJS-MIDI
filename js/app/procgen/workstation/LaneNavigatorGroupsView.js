export function createLaneNavigatorGroupsView({ document, metadata, getSelection, onChange }) {
  const element = document.createElement('section'), heading = document.createElement('strong'), choice = document.createElement('select'), name = document.createElement('input'), status = document.createElement('output');
  element.className = 'studio-lane-organization'; element.setAttribute('aria-label', 'Lane organization'); heading.textContent = 'Lane organization'; choice.setAttribute('aria-label', 'Lane group'); name.setAttribute('aria-label', 'Lane group name'); name.maxLength = 64; name.type = 'text';
  status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true'); element.append(heading, choice, name);
  const buttons = new Map(), listeners = []; let disposed = false, identity, initialized = false, lastRevision = -1, selectedLane = null, selectedGroup = '', composing = false, stateCache = null, stateRevision = -1;
  const on = (node, type, fn) => { node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn)); };
  const add = (id, label, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', label); buttons.set(id, button); element.append(button);
    on(button, 'click', () => { if (disposed || composing) return; const changed = action(); if (changed) onChange({ revealLaneId: id === 'pin' && metadata.getState().pinned.includes(getSelection()) ? getSelection() : null }); else { name.setAttribute('aria-invalid', 'true'); status.textContent = 'No organization change. Check the group name, selection or capacity.'; } }); return button;
  };
  const create = add('create', 'Create lane group', () => { const id = metadata.createGroup(name.value); if (id) selectedGroup = id; return !!id; });
  add('rename', 'Rename lane group', () => metadata.renameGroup(selectedGroup, name.value));
  add('assign', 'Assign selected lane', () => metadata.assign(getSelection(), selectedGroup || null));
  add('remove', 'Remove lane group', () => metadata.removeGroup(selectedGroup));
  const collapse = add('collapse', 'Toggle lane group visibility', () => metadata.toggleCollapsed(selectedGroup));
  const pin = add('pin', 'Pin selected lane', () => metadata.togglePinned(getSelection()));
  add('up', 'Move selected lane up', () => metadata.move(getSelection(), -1)); add('down', 'Move selected lane down', () => metadata.move(getSelection(), 1));
  add('undo', 'Undo lane organization', () => metadata.undo()); add('redo', 'Redo lane organization', () => metadata.redo()); element.append(status);
  const update = documentIdentity => {
    if (disposed) return;
    const replacement = initialized && identity !== documentIdentity, currentSelection = getSelection(), changedSelection = selectedLane !== currentSelection;
    if (replacement) { selectedGroup = ''; name.value = ''; composing = false; lastRevision = -1; }
    identity = documentIdentity; initialized = true; selectedLane = currentSelection;
    if (!stateCache || stateRevision !== metadata.revision) { stateCache = metadata.getState(); stateRevision = metadata.revision; }
    const state = stateCache;
    if (changedSelection) { selectedGroup = metadata.groupFor(selectedLane) || ''; name.value = state.groups.find(group => group.id === selectedGroup)?.name || ''; }
    if (lastRevision !== metadata.revision) {
      const previousFocus = document.activeElement === choice, options = new Map([...choice.options].map(option => [option.value, option]));
      const values = [{ id: '', name: 'Ungrouped' }, ...state.groups];
      for (const [index, group] of values.entries()) {
        let option = options.get(group.id); if (!option) { option = document.createElement('option'); option.value = group.id; } option.textContent = group.name;
        if (choice.children[index] !== option) choice.insertBefore(option, choice.children[index] || null); options.delete(group.id);
      }
      for (const option of options.values()) option.remove(); if (!state.groups.some(group => group.id === selectedGroup)) selectedGroup = ''; choice.value = selectedGroup; if (previousFocus) choice.focus(); lastRevision = metadata.revision;
    }
    const group = state.groups.find(group => group.id === selectedGroup), collapsed = state.collapsed.includes(selectedGroup), pinned = state.pinned.includes(selectedLane);
    name.removeAttribute('aria-invalid'); create.disabled = state.groups.length >= 128;
    for (const key of ['rename', 'remove', 'collapse']) buttons.get(key).disabled = !group;
    for (const key of ['assign', 'pin', 'up', 'down']) buttons.get(key).disabled = !selectedLane;
    pin.setAttribute('aria-pressed', String(pinned)); pin.textContent = pinned ? 'Unpin selected lane' : 'Pin selected lane'; collapse.setAttribute('aria-pressed', String(collapsed)); collapse.textContent = collapsed ? 'Expand group' : 'Collapse group';
    buttons.get('undo').disabled = !state.undoCount; buttons.get('redo').disabled = !state.redoCount;
    status.textContent = `${state.groups.length} groups · ${state.collapsed.length} collapsed · ${state.pinned.length} pinned${state.dropped ? ' · oldest organization undo retired' : ''}`;
  };
  on(choice, 'change', () => { if (disposed) return; selectedGroup = choice.value; name.value = metadata.getState().groups.find(group => group.id === selectedGroup)?.name || ''; update(identity); });
  on(name, 'compositionstart', () => { composing = true; }); on(name, 'compositionend', () => { composing = false; });
  return { element, update, dispose() { if (disposed) return; disposed = true; for (const release of listeners) release(); buttons.clear(); stateCache = null; element.remove(); } };
}
