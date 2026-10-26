import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createPerformanceSceneControlView({ document, parent, displayScheduler, getScene, getWorld, performReleaseGesture, requestJunction, getSceneMacroState = null, performSceneMacro = null, openControl, onStatus = () => {} } = {}) {
  const retirement = createProcgenRetirementScope(), rows = [], listeners = [];
  let disposed = false, selectedScene = null, selectedWorld = null, generation = null;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const root = node('section'); root.className = 'studio-scene-controls'; root.setAttribute('aria-label', 'Current physical score controls'); root.hidden = true; parent.append(root);
  const status = node('output'); status.setAttribute('role', 'status');
  const report = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  const clear = () => { for (const remove of listeners.splice(0)) remove(); rows.length = 0; root.replaceChildren(); selectedScene = selectedWorld = generation = null; };
  const current = () => !disposed && getScene() === selectedScene && getWorld() === selectedWorld && selectedWorld?.generation === generation;
  const listen = (element, event, callback) => { element.addEventListener(event, callback); listeners.push(() => element.removeEventListener(event, callback)); };
  const action = callback => () => { try { if (!current()) throw new Error('The score or world changed. Reopen its current controls.'); callback(); } catch (error) { report(error.message); } };
  const button = (label, callback, parent) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', action(callback)); parent.append(value); return value; };
  const rebuild = (scene, world) => {
    clear(); selectedScene = scene; selectedWorld = world; generation = world?.generation; root.hidden = !scene;
    if (!scene) return;
    root.append(node('strong', scene.title), node('p', 'Perform entry spacing and route requests in the current world. Other controls open their existing editor. A queued request is separate from a realized change.'));
    for (const control of scene.physicalControls || []) {
      const [binding] = control.target.split(';'), line = node('div'); line.className = 'studio-scene-control'; line.append(node('span', control.label)); root.append(line);
      const result = node('output'); result.setAttribute('aria-label', control.label + ' actual state');
      if (['release-gesture:nominalGapTicks', 'release-gesture:spreadTicks'].includes(binding)) {
        const field = binding.slice('release-gesture:'.length), caption = field === 'spreadTicks' ? 'spread' : 'spacing';
        const input = node('input'); input.type = 'number'; input.required = true; input.min = String(control.minimum); input.max = String(control.maximum); input.step = String(control.step); input.value = String(world?.population?.pendingReleaseGesture?.[field] ?? world?.population?.releaseGesture?.[field] ?? control.initial); input.setAttribute('aria-label', control.label); line.append(input);
        const apply = button('Request ' + caption, () => {
          if (!input.checkValidity()) throw new Error('Choose entry spacing inside this score’s authored range.');
          const source = selectedWorld?.population?.pendingReleaseGesture || selectedWorld?.population?.releaseGesture;
          if (!source) throw new Error('The current physical release policy is unavailable.');
          const receipt = performReleaseGesture({ ...source, [field]: Number(input.value) });
          if (receipt?.status !== 'queued') throw new Error(receipt?.reason || 'The release request was not admitted.');
          report('Entry ' + caption + ' requested for the next cohort boundary. Existing actors keep their motion.');
        }, line); rows.push({ kind: 'spacing', field, caption, result, apply, input });
      } else if (binding.startsWith('patch-macro:') && getSceneMacroState && performSceneMacro) {
        const input = node('input'); input.type = 'number'; input.required = true; input.min = '0'; input.max = '1'; input.step = String(control.step); input.placeholder = 'Mixed'; input.setAttribute('aria-label', control.label); line.append(input);
        try { const state = getSceneMacroState(control.id); input.value = state.value01 == null ? '' : String(state.value01); } catch {}
        const apply = button('Apply to later onsets', () => {
          if (!input.checkValidity()) throw new Error('Choose a normalized macro value from zero to one.');
          const state = getSceneMacroState(control.id), receipt = performSceneMacro({ sceneHash: state.sceneHash, controlId: control.id, value01: Number(input.value) });
          if (!['committed', 'unchanged'].includes(receipt?.status)) throw new Error('The complete scene macro edit was not admitted.');
          report('Scene macro applied to its authored lanes for later causal onsets. Existing actors and held voices keep their state.');
        }, line);
        button('Open lane editor', () => openControl(control, selectedScene), line); rows.push({ kind: 'macro', control, input, result, apply });
      } else if (binding.startsWith('junction:')) {
        const id = binding.slice('junction:'.length), definition = world?.physicalJunctions?.definitions.find(item => item.id === id), input = node('select'); input.setAttribute('aria-label', control.label);
        for (const configuration of definition?.configurations || []) { const option = node('option', configuration.id); option.value = configuration.id; input.append(option); } input.value = world?.queryJunction?.(id, { includeDefinition: false })?.actual?.configurationId || definition?.configurations[0]?.id || ''; line.append(input);
        const apply = button('Request safe route', () => {
          const latest = selectedWorld?.physicalJunctions?.definitions.find(item => item.id === id);
          if (!definition || latest !== definition || !latest.configurations.some(item => item.id === input.value)) throw new Error('The junction definition changed. Review it before requesting another route.');
          const receipt = requestJunction(id, input.value, 'waitForSafeBoundary');
          if (receipt?.status !== 'queued') throw new Error(receipt?.reason || 'The route request was not admitted.');
          report('Route request queued. It will wait for the junction’s qualified empty boundary.');
        }, line); rows.push({ kind: 'junction', id, definition, input, result, apply });
      } else button('Open ' + control.label.split(' · ')[0], () => openControl(control, selectedScene), line);
      line.append(result);
    }
    root.append(status);
  };
  const refresh = () => {
    if (disposed) return; const scene = getScene(), world = getWorld();
    if (scene !== selectedScene || world !== selectedWorld || world?.generation !== generation || rows.some(row => row.kind === 'junction' && world?.physicalJunctions?.definitions.find(item => item.id === row.id) !== row.definition)) rebuild(scene, world);
    for (const row of rows) {
      if (row.kind === 'spacing') {
        const actual = world?.population?.releaseGesture, pending = world?.population?.pendingReleaseGesture;
        row.result.textContent = actual ? 'Realized ' + row.caption + ': ' + actual[row.field] + ' ticks' + (pending ? ' · pending: ' + pending[row.field] + ' ticks' : '') + (actual.paused ? ' · entrants paused' : '') : 'No active release policy'; row.apply.disabled = !world || !actual;
      } else if (row.kind === 'macro') {
        try { const state = getSceneMacroState(row.control.id); row.result.textContent = (state.value01 == null ? 'Mixed saved values' : 'Saved value: ' + state.value01) + ' · ' + state.targets.length + ' authored lanes · later onsets only'; row.apply.disabled = false; }
        catch (error) { row.result.textContent = error.message; row.apply.disabled = true; }
      } else {
        const state = world?.queryJunction?.(row.id, { includeDefinition: false }), pending = state?.pending || [];
        row.result.textContent = (state?.actual ? 'Realized: ' + state.actual.configurationId + ' · ' + state.actual.status : 'No realized route') + (pending.length ? ' · pending: ' + pending.map(request => request.desiredConfiguration + ' · ' + request.state).join('; ') : state?.receipts?.at(-1)?.reason ? ' · ' + state.receipts.at(-1).reason : '');
        row.apply.disabled = !world || !row.definition || state?.authoringRevision !== row.definition.revision; row.input.disabled = row.apply.disabled;
      }
    }
  };
  const surface = displayScheduler.register({ id: 'current-score-controls', element: root, intervalMs: 50, write: refresh, onError: error => report(error.message) }); refresh();
  return Object.freeze({ refresh: () => { refresh(); surface.invalidate(); }, element: root,
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; return retirement.retire([{ name: 'score-control-mailbox', run: () => surface.dispose() }, { name: 'score-control-listeners', run: clear }, { name: 'score-control-surface', run: () => root.remove() }]); }
  });
}
