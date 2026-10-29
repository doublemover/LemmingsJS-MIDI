import { getPointerGestureArbiter } from '../../controls/PointerGestureArbiter.js';
import { normalizeWorkstationDockPreferences, workstationDockHeight, createWorkstationDockContext } from './WorkstationDockState.js';

export function createWorkstationDock({ document, window, shell, inspector, resize, tabs, fields, state, getIdentity, getContext, isSuspended = () => false, onModeChange = () => {}, onOpen, onClose, onLayout, onPreferences, onStatus = () => {} }) {
  Object.assign(state, normalizeWorkstationDockPreferences(state));
  const listeners = [], arbiter = getPointerGestureArbiter(document), header = document.createElement('header'), breadcrumb = document.createElement('output');
  let disposed = false, gesture = null, returnFocus = null, context = null, selectionPanel = null;
  const on = (element, type, handler) => { element.addEventListener(type, handler); listeners.push(() => element.removeEventListener(type, handler)); };
  const button = (text, handler) => { const value = document.createElement('button'); value.type = 'button'; value.textContent = text; on(value, 'click', handler); return value; };
  inspector.id = 'procgenDeepDock'; inspector.classList.add('studio-deep-dock'); header.className = 'studio-dock-header'; breadcrumb.setAttribute('aria-label', 'Current editor target');
  const toggle = button('Inspect selected lane', () => state.workspaceMode === 'inspect' ? choose('perform') : open()); toggle.setAttribute('aria-controls', inspector.id);
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Workspace mode'); for (const [id, label] of [['perform', 'Perform'], ['inspect', 'Inspect'], ['overview', 'Overview']]) { const option = document.createElement('option'); option.value = id; option.textContent = label; mode.append(option); }
  const close = button('Close instrument dock', () => choose('perform')), smaller = button('Smaller dock', () => height(state.dockHeight - 32, true)), larger = button('Larger dock', () => height(state.dockHeight + 32, true));
  header.append(breadcrumb, smaller, larger, close); inspector.insertBefore(header, tabs);
  resize.setAttribute('aria-label', 'Resize instrument dock'); resize.setAttribute('aria-orientation', 'horizontal'); resize.setAttribute('aria-valuemin', '180'); resize.setAttribute('aria-valuemax', '480'); resize.setAttribute('aria-controls', inspector.id);
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Instrument editor'); fields.setAttribute('role', 'tabpanel');
  const visible = () => state.workspaceMode === 'inspect' && !isSuspended();
  function paint() {
    const selection = inspector.querySelector(':scope > .studio-world-inspector');
    if (selection) { selectionPanel ||= document.createElement('div'); selectionPanel.className = 'studio-selection-panel'; selectionPanel.id = 'procgenWorldSelectionPanel'; selectionPanel.setAttribute('role', 'tabpanel'); selectionPanel.setAttribute('aria-labelledby', 'procgen-dock-tab-Selection'); if (!selectionPanel.isConnected) inspector.append(selectionPanel); selectionPanel.append(selection); }
    if (selectionPanel) selectionPanel.hidden = !visible() || context?.editorKind !== 'Selection' || !selectionPanel.firstElementChild; fields.hidden = !!selectionPanel?.firstElementChild && context?.editorKind === 'Selection';
    const size = workstationDockHeight(state.dockHeight, shell.clientHeight); shell.dataset.workspaceMode = state.workspaceMode; shell.style.setProperty('--dock-height', size + 'px'); inspector.hidden = !visible();
    const toggleName = visible() ? 'Return to performance' : 'Inspect selected lane'; toggle.textContent = visible() ? 'Perform' : 'Inspect'; toggle.setAttribute('aria-label', toggleName); toggle.title = toggleName; toggle.setAttribute('aria-expanded', String(visible())); toggle.disabled = mode.disabled = isSuspended(); mode.value = state.workspaceMode; resize.setAttribute('aria-valuenow', String(size)); smaller.disabled = size <= 180; larger.disabled = size >= workstationDockHeight(480, shell.clientHeight);
    if (context) { const prefix = context.targetScope === 'world' ? 'Shared world · lane context ' : context.targetScope === 'physical-graph' ? 'Shared physical graph · lane context ' : ''; breadcrumb.textContent = `${prefix}${context.laneName} [${context.laneId}] › ${context.editorKind}${context.targetId ? ' › ' + context.targetId : ''}${context.selectedEntity ? ' · selected ' + context.selectedEntity.kind + ' reference ' + context.selectedEntity.id : ''}${context.dirtyBuffer.some(value => value.dirty) ? ' · uncommitted curve draft' : ''}`; inspector.dataset.contextKey = context.key; }
  }
  function height(value, persist = false) { state.dockHeight = workstationDockHeight(value, shell.clientHeight); paint(); onLayout(); if (persist) onPreferences(); }
  function choose(next, { focus = true } = {}) {
    if (disposed || !['perform', 'inspect', 'overview'].includes(next)) return; if (isSuspended()) { onStatus('Exit stage mode to change the deep editor workspace.'); return; }
    const wasVisible = visible(); gesture?.lease.cancel('mode-changed'); if (state.workspaceMode !== next) onModeChange(); state.workspaceMode = next; paint();
    if (visible() && !wasVisible) { onOpen(); if (focus) (tabs.querySelector('[aria-selected="true"]') || tabs.querySelector('button') || close).focus({ preventScroll: true }); }
    if (!visible() && wasVisible) { onClose(); if (focus) { const target = returnFocus?.deref(), menu = target?.closest?.('details:not([open])'), restored = menu?.querySelector('summary') || target; (restored?.isConnected && !inspector.contains(restored) ? restored : toggle).focus({ preventScroll: true }); } returnFocus = null; }
    onLayout(); onPreferences();
  }
  function open() { if (disposed) return; if (!visible()) { const active = document.activeElement; returnFocus = active ? new WeakRef(active) : null; } choose('inspect'); }
  on(mode, 'change', () => choose(mode.value, { focus: false }));
  on(resize, 'keydown', event => { if (!visible() || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); height(event.key === 'Home' ? 180 : event.key === 'End' ? 480 : state.dockHeight + (event.key === 'ArrowUp' ? 16 : -16), true); });
  on(resize, 'pointerdown', event => {
    if (disposed || !visible() || event.button !== 0) return; const startHeight = state.dockHeight, startY = event.clientY;
    const lease = arbiter.acquire({ pointerId: event.pointerId, targetKey: 'instrument-dock-resize', identity: getIdentity(), getIdentity, captureTarget: resize, onCancel: () => { gesture = null; height(startHeight); } });
    if (!lease) return; gesture = { lease, startHeight, startY }; try { resize.setPointerCapture(event.pointerId); } catch { lease.cancel('capture-unavailable'); return; } event.preventDefault(); event.stopPropagation();
  });
  on(resize, 'pointermove', event => { if (gesture?.lease.owns(event)) height(gesture.startHeight + gesture.startY - event.clientY); });
  on(resize, 'pointerup', event => { if (!gesture?.lease.finish(event)) return; gesture = null; onPreferences(); });
  for (const type of ['pointercancel', 'lostpointercapture']) on(resize, type, event => { if (gesture?.lease.owns(event)) gesture.lease.cancel(type); });
  on(window, 'blur', () => gesture?.lease.cancel('blur')); on(window, 'resize', () => { gesture?.lease.cancel('resize'); if (!disposed) paint(); });
  on(inspector, 'keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.target?.tagName !== 'SELECT') { event.preventDefault(); event.stopPropagation(); choose('perform'); } });
  on(tabs, 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target.getAttribute('role') !== 'tab') return;
    const buttons = [...tabs.querySelectorAll('[role="tab"]')], index = buttons.indexOf(event.target); if (index < 0) return;
    event.preventDefault(); event.stopPropagation(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + buttons.length + (event.key === 'ArrowLeft' ? -1 : 1)) % buttons.length; buttons[next].click(); buttons[next].focus();
  });
  paint();
  return Object.freeze({ toggle, mode, open, choose, visible, panelId: tab => tab === 'Selection' && selectionPanel?.firstElementChild ? selectionPanel.id : fields.id, cancel: reason => gesture?.lease.cancel(reason),
    update() { if (disposed) return; try { context = createWorkstationDockContext({ ...getContext(), documentIdentity: getIdentity() }); } catch (failure) { context = null; onStatus(failure.message); } paint(); },
    inspect: () => Object.freeze({ mode: state.workspaceMode, height: state.dockHeight, visible: visible(), context, gestureId: gesture?.lease.id ?? null }),
    dispose() { if (disposed) return; gesture?.lease.cancel('disposed'); disposed = true; for (const release of listeners) release(); if (selectionPanel) { for (const child of [...selectionPanel.children]) inspector.append(child); selectionPanel.remove(); selectionPanel = null; } header.remove(); toggle.remove(); mode.remove(); context = returnFocus = null; } });
}
