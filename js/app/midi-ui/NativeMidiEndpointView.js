export function createNativeMidiEndpointView({ document, container, routes, getOutputGrant, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Endpoint protocol / function blocks'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const input = field('Endpoint-control input connection', element('select')), protocol = field('Requested endpoint protocol', element('select'));
  for (const [value, label] of [[1, 'MIDI1 in UMP'], [2, 'MIDI2']]) { const option = element('option', label); option.value = String(value); protocol.append(option); }
  const consent = field('Change the selected endpoint protocol at a stopped boundary', element('input')); consent.type = 'checkbox';
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const blocks = element('div'); root.append(status, blocks, element('p', 'Device grants must explicitly allow endpoint control. Leave granted groups empty for a discovery-only connection. Function-block numbers identify group spans; they are not group numbers.')); container.append(root);
  let registry = null, unsubscribe = null, busy = false, disposed = false, operation = 0, displayedRevision = null, displayedOutput = null;
  const render = () => {
    if (disposed) return; const state = registry?.state(), native = routes.state(), previous = input.value;
    if (getOutputGrant() !== displayedOutput) { displayedOutput = getOutputGrant(); consent.checked = false; }
    const placeholder = element('option', 'Select an endpoint-control input'); placeholder.value = ''; input.replaceChildren(placeholder);
    for (const grant of native.grants.filter(row => row.direction === 'input' && (row.permissions & 8))) { const option = element('option', grant.endpoint?.name || 'Published native input'); option.value = String(grant.grant); input.append(option); }
    if ([...input.options].some(row => row.value === previous)) input.value = previous;
    for (const button of buttons) button.disabled = busy;
    discover.disabled ||= !input.value || !native.grants.some(row => row.grant === getOutputGrant() && row.direction === 'output' && (row.permissions & 8)) || routes.client.capabilities?.umpStreamCodecVersion !== 1;
    configure.disabled ||= !registry || state.stale || !state.info || !consent.checked; cancel.disabled = !(busy || state?.discoveryPending || state?.configurationPending || state?.mutation.busy);
    const configured = state?.configuration;
    status.textContent = state ? (state.stale ? 'Endpoint metadata is stale' : state.complete ? 'Endpoint metadata complete' : 'Endpoint metadata incomplete') +
      ' · protocol ' + (configured ? configured.protocol === 2 ? 'MIDI2 active' : 'MIDI1 active' : 'unknown') + ' · supported ' +
      (state.info ? [state.info.supportedProtocols & 1 ? 'MIDI1' : null, state.info.supportedProtocols & 2 ? 'MIDI2' : null].filter(Boolean).join(' / ') : 'unknown') +
      (configured?.jrReceives ? ' · receiver requires JR timestamps; native performance is held until a compatible configuration is selected' : '') +
      (state.reason ? ' · ' + state.reason : '') : 'Read endpoint metadata on explicit native control grants. Enumeration alone never arms an output.';
    if (!state || displayedRevision === state.revision) return;
    displayedRevision = state.revision; blocks.replaceChildren();
    const table = element('table'), header = element('tr'); for (const label of ['Function block', 'Groups', 'Device direction', 'MIDI1 connection']) header.append(element('th', label)); table.append(header);
    for (const block of state.functionBlocks) {
      const row = element('tr'), labels = [block.number + (block.name ? ' · ' + block.name : '') + (block.active ? '' : ' · inactive'),
        block.active ? (block.firstGroup + 1) + '–' + (block.firstGroup + block.groupCount) : 'unavailable',
        ({ 1: 'receives', 2: 'transmits', 3: 'bidirectional' })[block.direction] || 'unknown', ({ 0: 'native UMP', 1: 'MIDI1 · bandwidth unrestricted', 2: 'MIDI1 · 31.25 kbit/s' })[block.midi1] || 'unknown'];
      for (const label of labels) row.append(element('td', label)); table.append(row);
    }
    blocks.append(table);
  };
  const ensure = () => {
    const inputGrant = Number(input.value), outputGrant = getOutputGrant(), previous = registry?.state();
    if (!registry || previous.inputGrant !== inputGrant || previous.outputGrant !== outputGrant || previous.stale) {
      unsubscribe?.(); registry = routes.createEndpointRegistry({ inputGrant, outputGrant }); unsubscribe = registry.subscribe(render); displayedRevision = null; consent.checked = false;
    }
    return registry;
  };
  const button = (label, action, urgent = false) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => {
      if (disposed || busy && !urgent) return; const owned = ++operation; busy = true; render();
      try { await action(); } catch (error) { if (!disposed && owned === operation) onStatus(error.message); }
      finally { if (owned === operation) busy = false; render(); }
    }); return node;
  };
  const discover = button('Read endpoint and function blocks', async () => { const owner = ensure(), result = await owner.discover(); onStatus(result.reason || 'Endpoint metadata: ' + result.status); });
  const configure = button('Request selected protocol', async () => {
    const confirmed = consent.checked, owner = ensure(), result = await owner.configure({ protocol: Number(protocol.value), extensions: 0, confirmed }); consent.checked = false;
    onStatus(result.reason || (result.status === 'ok' ? 'Endpoint notified the selected protocol. Reassign affected native lanes before continuing.' : 'Endpoint configuration: ' + result.status));
  });
  const cancel = button('Cancel endpoint operation', () => { registry?.cancel(); consent.checked = false; }, true);
  bind(input, 'change', () => { registry?.cancel(); consent.checked = false; render(); }); bind(protocol, 'change', () => { consent.checked = false; render(); }); bind(consent, 'change', render);
  bind(root, 'toggle', () => { if (root.open) render(); });
  render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; operation++; unsubscribe?.(); registry?.cancel(); for (const remove of removers) remove(); root.remove(); } });
}
