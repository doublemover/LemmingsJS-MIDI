export function createNativeMidiPatchView({ document, container, routes, getCiSession, getPeerMuid, getLaneId, getWireTarget, onRequestPatch, onBindPatch, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Hardware sounds / device patch browser'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, event, handler) => { node.addEventListener(event, handler); removers.push(() => node.removeEventListener(event, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const channel = field('Device ChannelList entry', element('select')), collection = field('Advertised program collection', element('select')), search = field('Search this loaded patch page', element('input')), program = field('Hardware bank / program', element('select'));
  search.maxLength = 128; search.type = 'search';
  const confirm = field('This device ChannelList entry corresponds to the native group/channel selected above; recall it at a stopped boundary', element('input')); confirm.type = 'checkbox';
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(status, element('p', 'The selected local instrument remains the preview approximation. Saved device patch intent grants no hardware access. The ChannelList address mapping is explicitly supplied here; it is not independently verified endpoint metadata.')); container.append(root);
  let catalog = null, ci = null, unsubscribe = null, page = null, currentReceipt = null, busy = false, disposed = false, operation = 0, channelRevision = null, targetSignature = null;
  const options = (node, rows, placeholder) => { const old = node.value, empty = element('option', placeholder); empty.value = ''; node.replaceChildren(empty); for (const [value, title] of rows) { const row = element('option', title); row.value = String(value); node.append(row); } if ([...node.options].some(row => row.value === old)) node.value = old; };
  const showPrograms = () => {
    const query = search.value.toLowerCase(), rows = (page?.entries || []).filter(row => !query || row.search.includes(query));
    options(program, rows.slice(0, 128).map(row => [row.key, row.title + ' · bank ' + row.bankPC[0] + '/' + row.bankPC[1] + ' · program ' + row.bankPC[2]]), 'Select an advertised patch');
    return rows.length;
  };
  const render = () => {
    if (disposed) return; const state = catalog?.state(), result = state?.latest, shown = showPrograms(), target = getWireTarget();
    const signature = JSON.stringify([getLaneId(), target.grant, target.group, target.channel, target.protocol]); if (signature !== targetSignature) { targetSignature = signature; confirm.checked = false; }
    if (state && state.channelsRevision !== channelRevision) {
      channelRevision = state.channelsRevision; options(channel, state.channels.map(row => [row.channel, row.channel + ' · ' + row.title + (row.programTitle ? ' · ' + row.programTitle : '')]), 'Select a device channel'); updateCollections();
    }
    for (const button of buttons) button.disabled = busy;
    loadPrograms.disabled ||= !catalog || !channel.value || !collection.value;
    previous.disabled ||= !page?.paginated || page.offset === 0; next.disabled ||= !page?.paginated || page.entries.length < 64 || page.totalCount != null && page.offset + page.entries.length >= page.totalCount;
    save.disabled ||= !page || !program.value; recall.disabled ||= !page || !program.value || !confirm.checked; bindPatch.disabled ||= !currentReceipt || !catalog?.isReceiptCurrent(currentReceipt);
    cancel.disabled = !(busy || state?.loading || state?.mutation.busy);
    status.textContent = state ? 'Hardware sounds: ' + (state.stale ? 'refresh required' : 'current catalog') + ' · ' + (page ? page.entries.length + ' patches on page at ' + page.offset + ' · ' + shown + ' match' : 'choose a program collection') +
      (shown > 128 ? ' · showing first 128 matches' : '') + ' · native group ' + (target.group + 1) + ', channel ' + (target.channel + 1) +
      (result ? ' · ' + result.status + (result.reason ? ' · ' + result.reason : '') : '') :
      'Select a current CI peer and owned output above, then read its device channels.';
  };
  const updateCollections = () => {
    const row = catalog?.state().channels.find(row => row.channel === Number(channel.value));
    options(collection, (row?.collections || []).map(row => [row.resId, row.title + ' · ' + row.resId]), 'Select an advertised collection');
  };
  const ensureCatalog = async () => {
    const session = await getCiSession(), peerMuid = getPeerMuid(); if (!Number.isInteger(peerMuid)) throw new Error('Discover and select a current device peer');
    if (!catalog || ci !== session || catalog.state().peerMuid !== peerMuid || catalog.state().disposed) {
      unsubscribe?.(); catalog?.cancel(); catalog = routes.createDevicePatchCatalog(session, peerMuid); ci = session; page = null; currentReceipt = null; channelRevision = null; confirm.checked = false;
      unsubscribe = catalog.subscribe(render);
    }
    return catalog;
  };
  const button = (label, action, urgent = false) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => {
      if (disposed || busy && !urgent) return;
      const owned = ++operation; busy = true; render();
      try { await action(); } catch (error) { if (!disposed && owned === operation) onStatus(error.message); }
      finally { if (owned === operation) busy = false; render(); }
    }); return node;
  };
  const loadChannels = button('Read device channels and collections', async () => { const owner = await ensureCatalog(), result = await owner.loadChannels(); if (owner !== catalog || disposed) return; page = null; confirm.checked = false; onStatus(result.reason || 'Device channels: ' + result.status); render(); });
  const readPage = async offset => {
    const owner = await ensureCatalog(), result = await owner.loadPrograms({ propertyChannel: Number(channel.value), collection: collection.value, offset, limit: 64 });
    if (owner !== catalog || disposed) return; if (result.page) page = result.page; confirm.checked = false; onStatus(result.reason || 'Device programs: ' + result.status); render();
  };
  const loadPrograms = button('Read selected program collection', () => readPage(0)), previous = button('Previous program page', () => readPage(Math.max(0, page.offset - 64))), next = button('Next program page', () => readPage(page.offset + 64));
  const save = button('Save selected patch intent for this lane', () => {
    if (!catalog || !page) throw new Error('Choose a current device patch'); const intent = catalog.requestIntent(page, program.value); onRequestPatch(getLaneId(), intent);
    onStatus('Saved requested hardware patch “' + intent.title + '”. Local sound remains its preview approximation; hardware requires explicit recall.');
  });
  const recall = button('Recall selected patch on owned device', async () => {
    const owner = await ensureCatalog(); if (!page) throw new Error('Choose a current device patch'); const laneId = getLaneId(), intent = owner.requestIntent(page, program.value);
    onRequestPatch(laneId, intent);
    const result = await owner.recall({ page, entryKey: program.value, target: { ...getWireTarget(), propertyChannel: Number(channel.value), addressMapping: routes.resolvePropertyChannel(ci, owner.state().peerMuid, Number(channel.value)) ? 'endpoint-function-block' : 'user-declared' }, confirmed: confirm.checked,
      isCurrent: () => !disposed && owner === catalog && getLaneId() === laneId });
    confirm.checked = false; if (owner !== catalog || disposed) return; currentReceipt = result.status === 'ok' ? result : null;
    onStatus(result.reason || (result.status === 'ok' ? 'Selected ChannelList entry reports the requested bank/program under your declared mapping. Bind the patch to this lane; review and rebind MPE first if applicable. Audible sound remains unverified.' : 'Hardware patch: ' + result.status));
  });
  const bindPatch = button('Bind acknowledged hardware patch to this lane', () => {
    const laneId = getLaneId(), route = routes.bindDevicePatch({ laneId, catalog, receipt: currentReceipt }); onBindPatch(laneId, currentReceipt.intent, route);
    onStatus('Current hardware patch bound to this native lane. Reopening the project will require a fresh device selection and recall.');
  });
  const cancel = button('Cancel patch operation', () => { catalog?.cancel(); confirm.checked = false; }, true);
  bind(channel, 'change', () => { catalog?.cancel(); page = null; confirm.checked = false; updateCollections(); render(); });
  bind(collection, 'change', () => { catalog?.cancel(); page = null; confirm.checked = false; render(); });
  bind(search, 'input', () => { confirm.checked = false; render(); }); bind(program, 'change', () => { confirm.checked = false; render(); }); bind(confirm, 'change', render);
  bind(root, 'toggle', () => { if (!root.open) catalog?.cancel(); render(); });
  loadChannels.disabled = false; render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; operation++; unsubscribe?.(); catalog?.cancel(); for (const remove of removers) remove(); root.remove(); } });
}
