export function createNativeMidiPropertyView({ document, container, routes, getCiSession, getPeerMuid, onStatus = () => {} }) {
  const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  const root = node('details'); root.className = 'midi-preset-panel'; root.append(node('summary', 'Device parameters / Property Exchange'));
  const controls = node('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (element, type, action) => { element.addEventListener(type, action); removers.push(() => element.removeEventListener(type, action)); };
  const field = (label, element) => { const wrapper = node('label'); wrapper.className = 'midi-field'; wrapper.append(node('span', label), element); element.setAttribute('aria-label', label); controls.append(wrapper); return element; };
  const resource = field('Advertised resource', node('select')), resId = field('Resource ID (when required)', node('input')), encoding = field('Property encoding', node('select'));
  resId.maxLength = 36; resId.autocomplete = 'off';
  for (const value of ['ASCII', 'Mcoded7', 'zlib+Mcoded7']) { const option = node('option', value); option.value = value; encoding.append(option); }
  const offset = field('List offset', node('input')), limit = field('List page size', node('input'));
  for (const input of [offset, limit]) { input.type = 'number'; input.min = '0'; input.step = '1'; } offset.value = '0'; limit.value = '64'; limit.min = '1'; limit.max = '256';
  const editor = field('Requested JSON value', node('textarea')); editor.rows = 8; editor.cols = 72; editor.maxLength = 262144; editor.spellcheck = false;
  const confirm = field('Apply this JSON write to the selected device; owned playback is stopped and device state may change', node('input')); confirm.type = 'checkbox';
  const status = node('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const values = node('pre'); values.className = 'midi-help'; values.style.whiteSpace = 'pre-wrap'; values.style.overflowWrap = 'anywhere';
  root.append(status, values, node('p', 'Device data is read-only until you explicitly apply a write. Device descriptions and schema references are shown as text; no device URL is fetched.')); container.append(root);
  let client = null, ci = null, unsubscribe = null, busy = false, disposed = false, serial = 0, selection = 0, currentResource = '', currentRecord = null;
  const descriptor = () => client?.state().resources.find(row => row.resource === resource.value) || null;
  const requestOptions = () => {
    const row = descriptor(), options = { encoding: encoding.value, ...(resId.value ? { resId: resId.value } : {}) };
    if (row?.canPaginate) { options.offset = Number(offset.value); options.limit = Number(limit.value); }
    return options;
  };
  const showRecord = record => {
    currentRecord = record;
    if (!record) { values.textContent = 'No complete current observation for this resource.'; return; }
    const text = JSON.stringify(record.data, null, 2);
    values.textContent = (record.stale ? 'Stale observation — refresh before relying on it.\n' : 'Read-only device observation · revision ' + record.revision + ' · ' + record.byteSize + ' bytes\n') +
      (text.length > 32768 ? text.slice(0, 32768) + '\nDisplay truncated. Writes require an independently reviewed complete value.' : text);
  };
  const render = () => {
    if (disposed) return;
    const state = client?.state(), row = descriptor(), permitted = row?.canSet === 'full' || row?.canSet === 'partial';
    for (const button of buttons) button.disabled = busy;
    read.disabled ||= !client || !resource.value; subscribe.disabled ||= !row?.canSubscribe; unsubscribeButton.disabled ||= !state?.subscriptions.length;
    apply.disabled ||= !permitted || !confirm.checked || !editor.value.trim(); copy.disabled ||= !currentRecord || currentRecord.mediaType !== 'application/json' || currentRecord.byteSize > 131072;
    cancel.disabled = !(busy || state?.pendingRequests || state?.queuedRequests || state?.preparingWrite || state?.mutation.busy);
    offset.disabled = limit.disabled = !row?.canPaginate; confirm.disabled = !permitted;
    if (row && !(row.encodings || ['ASCII']).includes(encoding.value)) encoding.value = (row.encodings || ['ASCII']).find(value => ['ASCII', 'Mcoded7', 'zlib+Mcoded7'].includes(value)) || 'ASCII';
    status.textContent = state ? 'Properties: ' + state.resources.length + ' resources · ' + state.pendingRequests + ' pending · ' + state.queuedRequests + ' queued · ' + state.subscriptions.length + ' subscriptions' +
      (state.stale ? ' · stale peer' : '') + (state.latest ? ' · ' + state.latest.status + (state.latest.reason ? ' · ' + state.latest.reason : '') : '') +
      (state.mutation.latest ? ' · write ' + state.mutation.latest.status + ' · ' + (state.mutation.latest.receiverState || 'unknown receiver state') : '') : 'Select CI input/output and a discovered peer above, then load its resource list.';
  };
  const ensureClient = async () => {
    const session = await getCiSession(), peerMuid = getPeerMuid();
    if (!Number.isInteger(peerMuid)) throw new Error('Discover and select a Property Exchange peer');
    if (!client || ci !== session || client.state().peerMuid !== peerMuid || client.state().stale || client.state().disposed) {
      unsubscribe?.(); client?.cancelResource(currentResource); client = routes.createPropertyClient(session, peerMuid); ci = session; currentResource = ''; currentRecord = null; confirm.checked = false;
      unsubscribe = client.subscribeObservations(event => {
        if (event?.record && event.record.resource === resource.value && (event.record.resId || '') === resId.value) showRecord(event.record);
        render();
      });
    }
    return client;
  };
  const action = (label, run, urgent = false) => {
    const button = node('button', label); button.type = 'button'; buttons.push(button); controls.append(button);
    bind(button, 'click', async () => {
      if (busy && !urgent || disposed) return;
      const operation = ++serial; busy = true; render();
      try { await run(); } catch (error) { if (operation === serial && !disposed) { status.textContent = error.message; onStatus(error.message); } }
      finally { if (operation === serial) busy = false; render(); }
    }); return button;
  };
  const load = action('Load device resource list', async () => {
    const owner = await ensureClient(), result = await owner.discoverResources(); if (owner !== client || disposed) return;
    if (result.status !== 'ok') { onStatus(result.reason || result.status); return; }
    const previous = resource.value; resource.replaceChildren(node('option', 'Choose an advertised resource'));
    resource.options[0].value = '';
    for (const row of owner.state().resources) { const option = node('option', row.resource + (row.schema?.title ? ' · ' + row.schema.title : '')); option.value = row.resource; resource.append(option); }
    if ([...resource.options].some(row => row.value === previous)) resource.value = previous;
    showRecord(null);
  });
  const read = action('Read resource / list page', async () => {
    const owner = await ensureClient(), selected = ++selection, result = await owner.get(resource.value, { ...requestOptions(), isCurrent: () => owner === client && selected === selection && !disposed });
    if (owner === client && selected === selection && !disposed) { showRecord(result.record || null); onStatus(result.reason || 'Device resource: ' + result.status); }
  });
  const subscribe = action('Subscribe to selected resource', async () => { const owner = await ensureClient(); const result = await owner.subscribe(resource.value, requestOptions()); onStatus(result.reason || 'Subscription: ' + result.status); });
  const unsubscribeButton = action('End device subscriptions', async () => { if (client) await Promise.allSettled(client.state().subscriptions.map(row => client.unsubscribe(row.subscribeId))); });
  const copy = action('Copy observed JSON into requested value', () => {
    if (!currentRecord || currentRecord.mediaType !== 'application/json' || currentRecord.byteSize > 131072) throw new Error('Choose a complete bounded JSON observation first');
    editor.value = JSON.stringify(currentRecord.data, null, 2); confirm.checked = false;
  });
  const apply = action('Apply requested JSON to device', async () => {
    const owner = await ensureClient(), selected = ++selection, requested = editor.value;
    if (requested.length > 262144) throw new Error('Requested JSON exceeds the editor limit');
    const result = await owner.set(resource.value, JSON.parse(requested), { ...requestOptions(), confirmed: confirm.checked, isCurrent: () => owner === client && selected === selection && !disposed });
    confirm.checked = false; if (owner === client && !disposed) { onStatus(result.reason || 'Device write: ' + result.status); const cached = owner.cached(resource.value, requestOptions()); if (cached) showRecord(cached); }
  });
  const cancel = action('Cancel property operation', () => { selection++; client?.cancel(); confirm.checked = false; }, true);
  const change = () => {
    selection++; confirm.checked = false; if (currentResource) client?.cancelResource(currentResource); currentResource = resource.value;
    showRecord(client?.cached(resource.value, requestOptions()) || null); render();
  };
  bind(resource, 'change', change); bind(resId, 'change', change); bind(encoding, 'change', change); bind(offset, 'change', change); bind(limit, 'change', change);
  bind(editor, 'input', () => { confirm.checked = false; render(); }); bind(confirm, 'change', render);
  bind(root, 'toggle', () => { if (!root.open && client) { selection++; client.cancel(); void Promise.allSettled(client.state().subscriptions.map(row => client.unsubscribe(row.subscribeId))); } render(); });
  load.disabled = false; render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; serial++; selection++; unsubscribe?.(); client?.cancel(); for (const remove of removers) remove(); root.remove(); } });
}
