import { createPhysicalJunctionPresentation } from './PhysicalJunctionPresentation.js';
import { procgenWorldToScreen, overlapsProcgenPresentation } from '../ProcgenPresentationSnapshot.js';
let controlSequence = 0;

export function createPhysicalJunctionControls({ document, window, displayScheduler, getRuntime, getDefinitions, save, request, cancel,
  canRequest = () => true, canAuthor = () => true, onRevealLane = () => {}, onObserveCrossing = () => {}, onStatus = () => {} } = {}) {
  const token = {}, listeners = [], choices = [], anchors = new Map(), hiddenInspectorChildren = new Map();
  const hatchId = 'junction-influence-' + (++controlSequence);
  let disposed = false, opened = false, world = null, renderer = null, generation = null, observer = null, unhook = null, previousFocus = null, worldEpoch = 0;
  let desired = null, policyValue = 'waitForSafeBoundary', choiceDefinition = null, anchorDefinitions = null, surface = null, editor = null, inspectionAnchor = null, priorAnchor = null, paintKey = '';
  const node = (tag, text, className) => { const value = document.createElement(tag); if (text) value.textContent = text; if (className) value.className = className; return value; };
  const on = (element, event, handler) => { element.addEventListener(event, handler); listeners.push(() => element.removeEventListener(event, handler)); };
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const say = value => { text(status, value); onStatus(value); };
  const action = callback => event => {
    if (disposed || !opened) return;
    try { callback(event); refresh(); }
    catch (error) { say(/unmaterialized-terrain|unrevealed-terrain/.test(error.message) ? 'This junction’s source terrain is still being prepared. Use Play or Step until the region has generated, then retry. The applied route is unchanged.' : error.message); }
  };
  const button = (label, callback) => { const value = node('button', label); value.type = 'button'; on(value, 'click', action(callback)); return value; };
  const dock = node('section', '', 'studio-junction-controls'); dock.setAttribute('aria-label', 'Selected physical junction'); dock.hidden = true;
  const title = node('h2', 'Switchyard'), select = node('select'), status = node('output'), summary = node('p');
  select.setAttribute('aria-label', 'Inspect physical junction'); status.setAttribute('role', 'status');
  const layer = node('div', '', 'studio-junction-layer'); layer.hidden = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true');
  const floating = node('section', '', 'studio-junction-floating'); floating.setAttribute('aria-label', 'World junction lever');
  layer.append(svg, floating);
  const ownFocus = target => dock.contains(target) || layer.contains(target) || editor?.contains(target);
  const scopeInspector = () => {
    const parent = dock.parentElement; if (!parent) return;
    for (const element of hiddenInspectorChildren.keys()) if (element.parentElement !== parent) hiddenInspectorChildren.delete(element);
    for (const element of parent.children) if (element !== dock && !element.classList.contains('studio-resize')) {
      if (!hiddenInspectorChildren.has(element)) hiddenInspectorChildren.set(element, { hidden: element.hidden, inert: !!element.inert });
      element.hidden = true; element.inert = true;
    }
  };
  const hold = active => {
    if (!renderer) return;
    if (active && renderer.junctionInspectionOwner !== token) { renderer.junctionInspectionOwner = token; renderer.camera?.applyState?.({ ...renderer.camera.getState(), follow: false }); }
    else if (!active && renderer.junctionInspectionOwner === token) delete renderer.junctionInspectionOwner;
  };
  const detachWorld = () => {
    worldEpoch++;
    hold(false); unhook?.(); unhook = null; observer?.dispose(); observer = null;
    if (renderer?.inspectionRowAnchor === inspectionAnchor) renderer.inspectionRowAnchor = priorAnchor;
    world = renderer = generation = inspectionAnchor = priorAnchor = null; anchorDefinitions = choiceDefinition = null; paintKey = ''; desired = null;
    for (const entry of anchors.values()) entry.remove(); anchors.clear(); svg.replaceChildren();
    floating.hidden = true; for (const choice of choices) choice.send.disabled = choice.stop.disabled = true;
  };
  const reveal = () => {
    const value = observer?.read(), definition = value?.definition; if (!definition || !renderer) return;
    const x = (definition.control.x1 + definition.control.x2) / 2, y = (definition.control.y1 + definition.control.y2) / 2;
    const lane = Math.floor(y / world.laneHeight); onRevealLane(lane);
    if (renderer.inspectionRowAnchor !== inspectionAnchor) priorAnchor = renderer.inspectionRowAnchor || null;
    inspectionAnchor = { lane, worldY: y }; renderer.inspectionRowAnchor = inspectionAnchor;
    renderer.camera?.applyState?.({ ...renderer.camera.getState(), cameraX: Math.max(0, x - (renderer.viewWidth || 400) / 2), follow: false });
    renderer.lastFrameKey = null; renderer.render?.(false);
  };
  const chooseJunction = id => { observer?.select(id || null); choiceDefinition = null; desired = null; reveal(); };
  const submit = () => {
    const current = observer?.read(), frame = renderer?.presentation?.getSnapshot();
    if (!current?.definition || !frame || frame.worldId !== world.worldId || frame.generation !== generation || !canRequest()) throw new Error('Wait for the committed world display before requesting a route.');
    const receipt = request(current.selectedId, desired, policyValue);
    if (receipt?.status !== 'queued') throw new Error(receipt?.reason || 'The switch request was not admitted.');
    say('Route requested. The solid lever keeps the applied configuration until a safe physical boundary.');
  };
  const cancelPending = () => {
    const current = observer?.read(); if (!current) return;
    let count = 0; for (const pending of current.pending) if (cancel(pending.requestId)) count++;
    say(count ? 'Uncommitted route request canceled. Applied geometry is unchanged.' : 'No uncommitted request remains to cancel.');
  };
  const makeChoice = (parent, location, compact = false) => {
    const destination = node('select'), policy = node('select'), lever = node('div', '', 'studio-junction-notches'), value = node('output');
    destination.setAttribute('aria-label', location + ' junction destination'); policy.setAttribute('aria-label', location + ' junction busy policy'); lever.setAttribute('aria-hidden', 'true');
    for (const [id, label] of [['waitForSafeBoundary', 'Wait until safe'], ['rejectIfBusy', 'Reject if busy']]) { const option = node('option', label); option.value = id; policy.append(option); }
    on(destination, 'change', () => { if (opened && !disposed) { desired = destination.value; refresh(); } }); on(policy, 'change', () => { if (opened && !disposed) { policyValue = policy.value; refresh(); } });
    const ownedCommand = (label, callback, reviewDestination) => {
      let gesture = null;
      const capture = (kind, pointerId = null) => { gesture = { kind, pointerId, epoch: worldEpoch, junctionId: observer?.read()?.selectedId, desired, policyValue }; };
      const command = button(label, () => {
        const accepted = gesture; gesture = null;
        if (accepted && (accepted.canceled || accepted.epoch !== worldEpoch || accepted.junctionId !== observer?.read()?.selectedId ||
            reviewDestination && (accepted.desired !== desired || accepted.policyValue !== policyValue))) throw new Error('The reviewed switch control changed. Review its current state before trying again.');
        callback();
      });
      on(command, 'pointerdown', event => { if (event.isPrimary !== false && (event.button ?? 0) === 0) capture('pointer', event.pointerId); });
      on(command, 'pointercancel', event => { if (gesture?.kind === 'pointer' && gesture.pointerId === event.pointerId) gesture.canceled = true; });
      on(command, 'keydown', event => { if ([' ', 'Enter'].includes(event.key) && !event.isComposing) { if (event.repeat) event.preventDefault(); else capture('keyboard'); } });
      return command;
    };
    const send = ownedCommand('Switch request', submit, true), stop = ownedCommand('Cancel pending', cancelPending, false);
    parent.append(...(compact ? [lever, destination, send, value] : [lever, destination, policy, send, stop, value])); choices.push({ destination, policy, lever, value, send, stop });
  };
  const closeEditor = () => { const current = editor; editor = null; if (!current) return; current.close?.(); current.remove(); if (opened) author.focus?.(); };
  const editDefinitions = () => {
    if (!canAuthor()) throw new Error('Exit Stage and finish the current world/history operation before editing junction definitions.');
    closeEditor(); const dialog = node('dialog', '', 'studio-junction-dialog'); editor = dialog; editor.setAttribute('aria-label', 'Physical junction definitions');
    const input = node('textarea'); input.maxLength = 1048576; input.rows = 12; input.value = JSON.stringify(getDefinitions(), null, 2); input.setAttribute('aria-label', 'Physical junction definitions JSON');
    const error = node('output'); error.setAttribute('role', 'status');
    const commit = node('button', 'Save definitions'), exit = node('button', 'Cancel'); commit.type = exit.type = 'button';
    commit.addEventListener('click', () => { if (disposed || !opened || editor !== dialog) return; try { if (!canAuthor()) throw new Error('Junction authoring is currently protected.'); if (input.value.length > 1048576) throw new Error('Junction definitions exceed the editor bound.'); save(JSON.parse(input.value)); closeEditor(); say('Definitions saved; their physical command boundary is pending.'); refresh(); } catch (failure) { error.textContent = failure.message; } });
    exit.addEventListener('click', () => { if (editor === dialog) closeEditor(); }); editor.addEventListener('cancel', event => { event.preventDefault(); if (editor === dialog) closeEditor(); });
    editor.append(node('h2', 'Junction definitions'), input, error, commit, exit); document.body.append(editor); editor.showModal(); input.focus();
  };
  const author = button('Edit definitions…', editDefinitions), close = button('Close switchyard', () => suspend());
  dock.append(title, select, summary); makeChoice(dock, 'Dock'); makeChoice(floating, 'World', true);
  dock.append(button('Reveal junction', reveal), author, close, status);
  const crossingSummary = node('p'), history = node('ol'); history.setAttribute('aria-label', 'Observed junction crossings'); dock.append(crossingSummary, history);
  on(select, 'change', () => { chooseJunction(select.value); refresh(); });
  on(document, 'focusin', event => { if (opened) hold(ownFocus(event.target)); });
  for (const root of [dock, layer]) on(root, 'keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.target?.tagName !== 'SELECT') { event.preventDefault(); event.stopPropagation(); suspend(); } });
  const ensureWorld = () => {
    const runtime = getRuntime(), next = runtime?.world, display = runtime?.lanes?.renderer;
    if (next === world && display === renderer && next?.generation === generation) return !!observer;
    detachWorld(); if (!next || !display?.presentation) return false;
    world = next; renderer = display; generation = next.generation;
    observer = createPhysicalJunctionPresentation({ world, resources: renderer.resources });
    unhook = renderer.presentation.subscribe(frame => {
      for (const anchor of anchors.values()) if (!anchor.hidden && (!frame || overlapsProcgenPresentation(frame,
        { left: parseFloat(anchor.style.left) - 22, top: parseFloat(anchor.style.top) - 22, width: 44, height: 44 }))) anchor.hidden = true;
      surface?.invalidate();
    });
    const definitions = world.physicalJunctions.definitions; if (definitions.length) observer.select(definitions[0].id);
    return true;
  };
  const svgNode = (tag, attributes) => { const value = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, content] of Object.entries(attributes)) value.setAttribute(key, String(content)); return value; };
  const anchorLayout = frame => {
    const placed = []; for (const anchor of anchors.values()) anchor.hidden = true; if (!frame) return;
    const rect = frame.rect;
    for (const definition of world.physicalJunctions.definitions) {
      if (placed.length >= 12) break;
      const at = procgenWorldToScreen(frame, (definition.control.x1 + definition.control.x2) / 2, definition.control.y1); if (!at) continue;
      for (const [dx, dy] of [[0, -50], [46, -50], [-46, -50], [0, 50], [46, 50], [-46, 50], [92, 0], [-92, 0]]) {
        const box = { left: at.x + dx - 22, top: at.y + dy - 22, width: 44, height: 44 };
        if (box.left < rect.left || box.top < rect.top || box.left + 44 > rect.left + rect.width || box.top + 44 > rect.top + rect.height ||
            placed.some(prior => box.left < prior.left + 44 && box.left + 44 > prior.left && box.top < prior.top + 44 && box.top + 44 > prior.top) || overlapsProcgenPresentation(frame, box)) continue;
        const anchor = anchors.get(definition.id); if (!anchor) break;
        anchor.hidden = false; anchor.style.left = box.left + 22 + 'px'; anchor.style.top = box.top + 22 + 'px'; placed.push(box); break;
      }
    }
  };
  const paint = (frame, value) => {
    anchorLayout(frame);
    const key = `${frame?.worldId}:${frame?.generation}:${frame?.projectionRevision}:${value.revision}:${value.selectedId}:${value.state?.actual?.status}:${value.pending.map(item => item.reason).join(',')}`;
    if (key === paintKey) return; paintKey = key;
    svg.replaceChildren(); floating.hidden = true;
    if (!frame) return;
    const rect = frame.rect, toPoint = (x, y) => { const result = procgenWorldToScreen(frame, x, y); return result && { x: result.x - rect.left, y: result.y - rect.top }; };
    Object.assign(svg.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' }); svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    for (const [id, anchor] of anchors) anchor.setAttribute('aria-pressed', String(value.selectedId === id));
    const definition = value.definition; if (!definition) return;
    const projectRegion = bounds => {
      const projected = [], x1 = Math.max(bounds.x1, frame.originX), x2 = Math.min(bounds.x2, frame.originX + frame.viewWidth); if (x1 >= x2) return projected;
      for (const row of frame.rows) {
        const y1 = Math.max(bounds.y1, row.sourceY), y2 = Math.min(bounds.y2, row.sourceY + row.sourceHeight); if (y1 >= y2) continue;
        const a = procgenWorldToScreen(frame, x1, y1, row.lane), b = procgenWorldToScreen(frame, x2, y2, row.lane); if (!a || !b) continue;
        projected.push({ x: a.x - rect.left, y: a.y - rect.top, width: b.x - a.x, height: b.y - a.y, clipped: x1 !== bounds.x1 || x2 !== bounds.x2 || y1 !== bounds.y1 || y2 !== bounds.y2 });
      }
      return projected;
    };
    const controlled = projectRegion(definition.control), safety = projectRegion(definition.influence);
    if (safety.length) {
      const defs = svgNode('defs', {}), pattern = svgNode('pattern', { id: hatchId, width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
      pattern.append(svgNode('path', { d: 'M-2 2L2-2M0 8L8 0M6 10L10 6', class: 'junction-hatch' })); defs.append(pattern); svg.append(defs);
      for (const region of safety) { const { clipped, ...bounds } = region; svg.append(svgNode('rect', { ...bounds, class: 'junction-safety-region', fill: `url(#${hatchId})` }));
        const mark = svgNode('text', { x: region.x + 6, y: region.y + 14, class: 'junction-safety-mark' }), reason = value.pending.at(-1)?.reason || '';
        mark.textContent = (reason && !reason.includes('unknown') && /occupied|footprint|claimed-work/.test(reason) ? '●' : '?') + (clipped ? ' ↕' : ''); svg.append(mark);
      }
    }
    for (const region of controlled) svg.append(svgNode('rect', { x: region.x, y: region.y, width: region.width, height: region.height, class: value.state?.actual?.status === 'observed-at-application' ? 'junction-applied-region' : 'junction-unverified-region' }));
    const control = controlled[0];
    if (control) { floating.hidden = rect.width < 276 || rect.height < 160; floating.style.left = Math.max(rect.left + 8, Math.min(rect.left + control.x, rect.left + rect.width - 258)) + 'px'; floating.style.top = Math.max(rect.top + 8, Math.min(rect.top + control.y + control.height + 10, rect.top + rect.height - 150)) + 'px'; }
    for (const port of definition.ports) {
      const at = toPoint(port.position.x, port.position.y); if (!at) continue;
      svg.append(svgNode('circle', { cx: at.x, cy: at.y, r: 4, class: 'junction-port ' + port.role }));
      for (const direction of port.direction === 'either' ? [-1, 1] : [port.direction === 'left' ? -1 : 1]) svg.append(svgNode('path', { d: `M${at.x - direction * 10} ${at.y}L${at.x + direction * 10} ${at.y}L${at.x + direction * 6} ${at.y - 3}M${at.x + direction * 10} ${at.y}L${at.x + direction * 6} ${at.y + 3}`, class: 'junction-port-direction' }));
    }
    for (const observed of value.observed) {
      let path = ''; for (const segment of observed.segments) {
        const a = toPoint(segment[0], segment[1]), b = toPoint(segment[2], segment[3]); if (a && b) path += `M${a.x} ${a.y}L${b.x} ${b.y}`;
      }
      if (!path) continue;
      const historical = value.state?.actual?.status !== 'observed-at-application' || observed.commandId !== value.state.actual.commandId;
      svg.append(svgNode('path', { d: path, class: 'junction-observed-outline', 'data-historical': historical }));
      svg.append(svgNode('path', { d: path, class: historical ? 'junction-observed junction-historical' : 'junction-observed' }));
    }
  };
  const refresh = () => {
    if (!opened || disposed) return;
    scopeInspector();
    if (!ensureWorld()) {
      select.disabled = true; text(summary, 'Waiting for a committed world. Junction requests are unavailable during replacement.');
      for (const choice of choices) { choice.send.disabled = choice.stop.disabled = choice.destination.disabled = true; text(choice.value, 'No current applied route is available.'); for (const notch of choice.lever.children) notch.dataset.applied = notch.dataset.requested = 'false'; }
      return;
    }
    const definitions = world.physicalJunctions.definitions;
    if (anchorDefinitions !== definitions) {
      anchorDefinitions = definitions; select.replaceChildren(); for (const entry of anchors.values()) entry.remove(); anchors.clear();
      for (const definition of definitions) {
        const option = node('option', definition.id); option.value = definition.id; select.append(option);
        const anchor = node('button', definition.id.slice(0, 16), 'studio-junction-anchor'); anchor.type = 'button'; anchor.setAttribute('aria-label', 'Inspect junction ' + definition.id);
        const sourceWorld = world, sourceGeneration = generation, sourceEpoch = worldEpoch;
        anchor.addEventListener('click', action(() => { if (sourceEpoch !== worldEpoch || world !== sourceWorld || generation !== sourceGeneration || !world.physicalJunctions.definitions.includes(definition)) throw new Error('The junction definition changed.'); chooseJunction(definition.id); refresh(); (floating.hidden ? choices[0] : choices[1]).destination.focus(); })); layer.append(anchor); anchors.set(definition.id, anchor);
      }
    }
    let value = observer.read(); if (!value.definition && definitions.length) { observer.select(definitions[0].id); value = observer.read(); }
    const definition = value.definition;
    if (definition !== choiceDefinition) {
      choiceDefinition = definition; desired = value.pending.at(-1)?.desiredConfiguration || value.state?.actual?.configurationId || definition?.configurations[0]?.id || null;
      for (const choice of choices) { choice.destination.replaceChildren(); choice.lever.replaceChildren(); for (const config of definition?.configurations || []) { const option = node('option', config.id), notch = node('span', config.id); option.value = config.id; notch.dataset.configuration = config.id; choice.destination.append(option); choice.lever.append(notch); } }
    }
    select.value = value.selectedId || ''; select.disabled = !definitions.length;
    const actual = value.state?.actual, pending = value.pending, receipt = value.state?.receipts?.at(-1), candidate = renderer.presentation.getSnapshot();
    const frame = candidate?.worldId === world.worldId && candidate.generation === generation ? candidate : null;
    const applied = actual ? `Applied ${actual.configurationId} at tick ${actual.appliedTick} · ${actual.status}.` : 'No applied configuration.';
    const waiting = pending.map(item => `${item.desiredConfiguration}: ${item.state}${item.reason ? ' (' + item.reason + ')' : ''} · ${item.remainingTicks} eligible ticks remain`).join('; ');
    const current = definition && frame && canRequest() && value.state?.authoringRevision === definition.revision;
    for (const choice of choices) {
      choice.destination.value = desired || ''; choice.policy.value = policyValue; choice.destination.disabled = choice.policy.disabled = !definition;
      choice.send.disabled = !current; choice.stop.disabled = !pending.length || !canRequest();
      text(choice.value, applied + (waiting ? ' Requested ' + waiting + '.' : '') + (receipt ? ` Last request ${receipt.status}${receipt.reason ? ': ' + receipt.reason : ''}${receipt.supersededBy ? ' → ' + receipt.supersededBy : ''}.` : '') + (!frame ? ' Waiting for a coherent world display.' : ''));
      choice.lever.dataset.geometry = actual?.status || 'unverified';
      for (const notch of choice.lever.children) { notch.dataset.applied = String(notch.dataset.configuration === actual?.configurationId); notch.dataset.requested = String(pending.some(item => item.desiredConfiguration === notch.dataset.configuration)); notch.dataset.draft = String(notch.dataset.configuration === desired); }
    }
    author.disabled = !canAuthor(); text(summary, definitions.length ? 'Solid notch: applied geometry. Ghost notch: queued request. Port marks are declared anchors; only committed actor crossings create a travel trail. Safety hatch: influence envelope; ● blocked, ? unverified, ↕ clipped by this row.' : 'No committed junctions. Edit bounded definitions or open an authored score.');
    text(crossingSummary, `${value.currentCrossings} observed inlet-to-outlet crossing(s) for the applied route. Displays the last ${value.capacity.crossings} crossings only. ${value.gap || 'No passage guarantee is inferred from switching.'}`);
    const historyKey = `${value.revision}:${value.observed.length}`;
    if (history.dataset.revision !== historyKey) {
      history.dataset.revision = historyKey;
      history.replaceChildren(...value.observed.map(item => {
        const row = node('li'), details = node('details'), heading = node('summary', `Actor ${item.actorId}: ${item.inletId} → ${item.outletId}, ${item.configurationId}, tick ${item.tick}${item.trailComplete ? '' : ' · trail prefix outside display retention'}`);
        details.append(heading, node('p', `Committed movement ${item.entryCauseId} → ${item.exitCauseId}. Applied command ${item.commandId}. Port anchor tolerance: ${item.anchorTolerancePixels}px; this is observed geometry, not a passage guarantee.`));
        const follow = node('button', 'Inspect actor'); follow.type = 'button'; follow.addEventListener('click', action(() => { if (item.worldId !== world.worldId || item.generation !== generation) throw new Error('The observed actor belongs to an earlier world.'); suspend(); onObserveCrossing(item); })); details.append(follow); row.append(details); return row;
      }));
    }
    paint(frame, value);
  };
  const suspend = () => {
    if (!opened) return; opened = false; closeEditor(); surface?.dispose(); surface = null; detachWorld(); dock.hidden = layer.hidden = true;
    for (const [element, previous] of hiddenInspectorChildren) if (element.parentElement === dock.parentElement) { element.hidden = previous.hidden; element.inert = previous.inert; } hiddenInspectorChildren.clear();
    if (!disposed && previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true }); previousFocus = null;
  };
  return Object.freeze({ open() {
    if (disposed) return false; if (opened) { select.focus(); return true; }
    const parent = document.querySelector('.studio-inspector'), root = document.getElementById('procgenPresentationRoot');
    if (!parent || !root) throw new Error('Junction controls need the current workstation presentation.');
    previousFocus = document.activeElement; parent.append(dock); root.append(layer); dock.hidden = layer.hidden = false; opened = true;
    surface = displayScheduler?.register({ id: 'physical-junction-controls', element: layer, intervalMs: 50, write: refresh, onError: error => say(error.message) });
    try { refresh(); reveal(); refresh(); select.focus(); return true; } catch (error) { suspend(); throw error; }
  }, refresh() { if (opened) { refresh(); surface?.invalidate(); } }, suspend,
  dispose() { if (disposed) return; disposed = true; suspend(); closeEditor(); for (const stop of listeners.splice(0)) stop(); dock.remove(); layer.remove(); choices.length = 0; } });
}
