import { placeAnchoredControl } from '../../controls/AnchoredControlPosition.js';

const chromeOwners = new WeakMap(), placementOwners = new WeakMap();

export function createWorkstationChrome({ document, window, topbar, footer, health, setupFields = [], viewFields = [], viewMenu, stageRestricted = [] }) {
  const owner = {}, menus = [], placements = [], listeners = [], created = [], registered = [];
  let disposed = false;
  chromeOwners.get(document)?.dispose();
  const owns = () => !disposed && chromeOwners.get(document)?.owner === owner;
  const on = (target, type, handler, options) => { target?.addEventListener?.(type, handler, options); listeners.push(() => target?.removeEventListener?.(type, handler, options)); };
  const move = (element, target) => {
    if (!element || !target || element === target || element.contains?.(target)) return;
    const previous = placementOwners.get(element), lease = { owner, parent: previous ? previous.parent : element.parentNode, next: previous ? previous.next : element.nextSibling };
    placementOwners.set(element, lease); placements.push({ element, lease }); target.append(element);
  };
  const close = (menu, focus = false) => { menu.open = false; const body = menu.querySelector(':scope > .studio-command-menu-body'); if (body) body.hidden = true; menu.querySelector(':scope > summary')?.setAttribute('aria-expanded', 'false'); if (focus) menu.querySelector(':scope > summary')?.focus?.({ preventScroll: true }); };
  const closeAll = () => { for (const menu of menus) close(menu); };
  function register(menu, name) {
    const original = { menu, open: menu.open, named: menu.getAttribute('data-menu-name'), styled: menu.classList.contains('studio-command-menu'), expanded: menu.querySelector(':scope > summary')?.getAttribute('aria-expanded') };
    menu.classList.add('studio-command-menu'); menu.dataset.menuName = name; const summary = menu.querySelector(':scope > summary'), body = document.createElement('div');
    registered.push({ ...original, body, summary });
    body.className = 'studio-command-menu-body'; body.hidden = !menu.open; body.setAttribute('role', 'group'); body.setAttribute('aria-label', name + ' controls');
    for (const child of [...menu.children]) if (child !== summary) move(child, body);
    menu.append(body); summary.setAttribute('aria-expanded', String(menu.open)); menus.push(menu);
    on(menu, 'toggle', () => {
      if (!owns()) return; body.hidden = !menu.open; summary.setAttribute('aria-expanded', String(menu.open));
      if (menu.open) { for (const other of menus) if (other !== menu) close(other); placeAnchoredControl({ element: body, anchor: summary, window, preferAbove: footer.contains(menu) }); }
    });
    on(summary, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
    on(body, 'click', event => {
      const command = event.target?.closest?.('button[data-command-group]');
      if (owns() && !event.defaultPrevented && command && !command.disabled && command.closest('.studio-command-menu') === menu) close(menu, body.contains(document.activeElement));
    });
    return body;
  }
  function create(name, parent) {
    const menu = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = name; menu.append(summary); parent.append(menu); created.push(menu);
    return { element: menu, body: register(menu, name) };
  }
  const setup = create('Setup', topbar); setup.element.classList.add('studio-setup-menu');
  for (const field of setupFields) move(field, setup.body);
  const viewBody = viewMenu ? register(viewMenu, 'View') : null;
  const statusMenu = health?.querySelector('.studio-operational-details'); if (statusMenu) register(statusMenu, 'Status details');
  for (const field of viewFields) move(field, viewBody || setup.body);
  const groups = new Map([['Setup', setup]]);
  if (viewBody) groups.set('View', { element: viewMenu, body: viewBody });
  for (const element of [...footer.children]) if (element.dataset.commandGroup) {
    const group = element.dataset.commandGroup;
    if (!groups.has(group)) groups.set(group, create(group, footer)); move(element, groups.get(group).body);
  }
  health?.classList.add('studio-health-band'); topbar.classList.add('studio-quiet-chrome'); footer.classList.add('studio-quiet-rail');
  if (health?.parentNode === topbar) topbar.insertBefore(setup.element, health);
  const nuke = document.getElementById?.('procgenNukeStatus'); if (nuke) move(nuke, topbar);
  on(document, 'click', event => {
    if (!owns() || document.querySelector('dialog[open]')) return;
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) close(menu);
  }, true);
  on(topbar, 'keydown', escape); on(footer, 'keydown', escape);
  function escape(event) {
    if (!owns() || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.target?.tagName === 'SELECT') return;
    const menu = event.target?.closest?.('.studio-command-menu'); if (!menu || !menus.includes(menu) || !menu.open) return;
    event.preventDefault(); event.stopPropagation(); close(menu, true);
  }
  on(window, 'blur', closeAll); on(document, 'visibilitychange', () => { if (document.hidden) closeAll(); });
  const api = { owner, close: closeAll, suspend() { closeAll(); for (const menu of menus) menu.hidden = true; },
    reveal(element) { if (!owns() || !element) return false; const menu = element.closest?.('.studio-command-menu'); if (!menu || !menus.includes(menu)) return true; menu.hidden = false; menu.open = true; const body = menu.querySelector(':scope > .studio-command-menu-body'), summary = menu.querySelector(':scope > summary'); body.hidden = false; summary?.setAttribute('aria-expanded', 'true'); for (const other of menus) if (other !== menu) close(other); placeAnchoredControl({ element: body, anchor: summary, window, preferAbove: footer.contains(menu) }); return true; },
    stage(active) { closeAll(); for (const element of stageRestricted) if (element) element.hidden = !!active; },
    dispose() {
      if (disposed) return; const current = owns(); closeAll(); disposed = true; for (const release of listeners) release();
      for (const { element, lease } of placements.reverse()) if (placementOwners.get(element) === lease) {
        placementOwners.delete(element); if (lease.parent?.isConnected) lease.parent.insertBefore(element, lease.next?.parentNode === lease.parent ? lease.next : null);
      }
      for (const menu of created) menu.remove();
      for (const { menu, body, summary, named, styled, expanded, open } of registered) if (!created.includes(menu)) {
        body.remove(); if (!styled) menu.classList.remove('studio-command-menu');
        if (named == null) menu.removeAttribute('data-menu-name'); else menu.setAttribute('data-menu-name', named);
        if (expanded == null) summary.removeAttribute('aria-expanded'); else summary.setAttribute('aria-expanded', expanded);
        menu.open = open;
      }
      if (current) { chromeOwners.delete(document); topbar.classList.remove('studio-quiet-chrome'); }
      footer.classList.remove('studio-quiet-rail'); health?.classList.remove('studio-health-band');
    }
  };
  chromeOwners.set(document, api); return Object.freeze(api);
}
