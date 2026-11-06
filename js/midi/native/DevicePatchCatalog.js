import { createDeviceMutationOwner } from './DeviceMutation.js';
import { validateDevicePatchIntent } from './DevicePatchIntent.js';
import { encodeIntent } from '../protocol/UmpPacketCodec.js';

const validBank = value => Array.isArray(value) && value.length === 3 && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 127);
const sameBank = (left, right) => validBank(left) && validBank(right) && left.every((byte, index) => byte === right[index]);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,36}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const digest = async value => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
export function createDevicePatchCatalog({ routes, ci, properties, peerMuid, now = () => performance.now() } = {}) {
  const identity = ci.state(), peer = ci.getPeer(peerMuid), listeners = new Set(), pages = new Map(), mutation = createDeviceMutationOwner({ routes, ci, now });
  if (!peer || properties.state().peerMuid !== peerMuid || properties.state().ciEpoch !== identity.epoch) throw new Error('An owned current Property Exchange peer is required');
  let disposed = false, generation = 0, loading = false, channels = [], channelsRevision = null, channelDeviceRevision = null, retainedEntries = 0, retainedEstimate = 0, latest = null, applied = null;
  const current = () => !disposed && ci.state().epoch === identity.epoch && !!ci.getPeer(peerMuid) && !properties.state().stale && !properties.state().disposed;
  const revision = () => routes.state().grants.find(row => row.grant === identity.outputGrant)?.deviceRevision ?? null;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const staleApplied = reason => {
    if (!applied) return; applied = null;
    void routes.invalidateDeviceState(identity.outputGrant, reason).catch(error => { latest = Object.freeze({ status: 'incomplete', reason: error.message, receiverState: 'unknown' }); emit(); });
  };
  const parseChannels = value => {
    if (!Array.isArray(value) || value.length > 256) throw new Error('ChannelList must be a bounded channel array');
    const seen = new Set();
    return Object.freeze(value.map(row => {
      if (!row || !Number.isInteger(row.channel) || row.channel < 1 || row.channel > 256 || seen.has(row.channel) || !text(row.title) ||
          row.bankPC != null && !validBank(row.bankPC) || row.links != null && (!Array.isArray(row.links) || row.links.length > 32)) throw new Error('Malformed or duplicate ChannelList entry');
      seen.add(row.channel);
      const collections = [];
      for (const link of row.links || []) if (link?.resource === 'ProgramList') {
        if (!id(link.resId) || collections.some(value => value.resId === link.resId) || link.title != null && !text(link.title)) throw new Error('Malformed or duplicate ProgramList link');
        collections.push(Object.freeze({ resId: link.resId, title: link.title || link.resId }));
      }
      return Object.freeze({ channel: row.channel, title: row.title, programTitle: text(row.programTitle) ? row.programTitle : null,
        bankPC: row.bankPC ? Object.freeze([...row.bankPC]) : null, collections: Object.freeze(collections),
        clusterType: row.clusterType || null, clusterChannelStart: row.clusterChannelStart ?? null, clusterLength: row.clusterLength ?? null });
    }));
  };
  const commitChannels = record => {
    const next = parseChannels(record.data);
    if (applied) {
      const observed = next.find(row => row.channel === applied.target.propertyChannel);
      if (!observed || !sameBank(observed.bankPC, applied.intent.bankPC)) staleApplied('device-patch-changed-externally');
    }
    channels = next; channelsRevision = record.revision; channelDeviceRevision = record.deviceRevision; return channels;
  };
  const readChannels = async isCurrent => {
    if (properties.state().resourcesStale) { const refreshed = await properties.discoverResources(); if (refreshed.status !== 'ok') throw new Error(refreshed.reason || 'Device resource discovery failed'); }
    const response = await properties.get('ChannelList', { isCurrent });
    if (response.status !== 'ok' || !response.record) throw new Error(response.reason || 'Device ChannelList is unavailable');
    if (!current() || !isCurrent()) throw new Error('Device patch selection changed');
    return response.record;
  };
  const clearPages = () => { pages.clear(); retainedEntries = retainedEstimate = 0; };
  const unsubscribe = properties.subscribeObservations(event => {
    if (!current()) { generation++; staleApplied('device-patch-peer-stale'); channels = []; clearPages(); emit(); return; }
    const record = event?.record;
    if (!record) return;
    try {
      if (record.resource === 'ChannelList' && record.deviceRevision === revision()) commitChannels(record);
      if (record.resource === 'ProgramList') { clearPages(); staleApplied('device-program-catalog-changed'); }
      emit();
    } catch (error) { latest = Object.freeze({ status: 'malformed', reason: error.message }); staleApplied('ambiguous-device-patch-observation'); emit(); }
  });
  const unsubscribeCi = ci.subscribe(() => { if (!current()) { generation++; channels = []; clearPages(); staleApplied('device-patch-peer-stale'); latest = Object.freeze({ status: 'stale', reason: 'Device patch peer changed' }); emit(); } });
  const api = Object.freeze({
    async loadChannels() {
      if (!current() || loading) return Object.freeze({ status: 'rejected', reason: 'Patch catalog is stale or busy' });
      const selected = ++generation; loading = true; emit();
      try { const negotiation = await properties.discoverResources(); if (negotiation.status !== 'ok') return negotiation; const record = await readChannels(() => selected === generation && !disposed); commitChannels(record); clearPages(); latest = Object.freeze({ status: 'ok', channels: channels.length }); return latest; }
      catch (error) { latest = Object.freeze({ status: 'incomplete', reason: error.message }); return latest; }
      finally { loading = false; emit(); }
    },
    async loadPrograms({ propertyChannel, collection, offset = 0, limit = 64, encoding = 'ASCII' }) {
      if (!current() || loading || channelDeviceRevision !== revision()) return Object.freeze({ status: 'stale', reason: 'Refresh device channels before choosing a program collection' });
      const channel = channels.find(row => row.channel === propertyChannel), descriptor = properties.state().resources.find(row => row.resource === 'ProgramList');
      if (!channel?.collections.some(row => row.resId === collection) || !descriptor || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 128) return Object.freeze({ status: 'unsupported', reason: 'Choose a ProgramList collection advertised for this channel' });
      const selected = ++generation; loading = true; emit();
      try {
        const options = { resId: collection, encoding, isCurrent: () => selected === generation && !disposed, ...(descriptor.canPaginate ? { offset, limit } : {}) };
        const response = await properties.get('ProgramList', options);
        if (response.status !== 'ok' || !response.record) return response;
        if (selected !== generation || !current() || response.record.deviceRevision !== revision()) throw new Error('Program list belongs to an old device selection');
        const rows = response.record.data;
        if (!Array.isArray(rows) || rows.length > (descriptor.canPaginate ? limit : 2048)) throw new Error('ProgramList entry capacity');
        const seen = new Set(), entries = [];
        for (const row of rows) {
          if (!row || !text(row.title) || !validBank(row.bankPC) || seen.has(row.bankPC.join(':'))) throw new Error('Malformed or ambiguous ProgramList bank/program identity');
          seen.add(row.bankPC.join(':'));
          if (row.category != null && !Array.isArray(row.category) || row.tags != null && !Array.isArray(row.tags)) throw new Error('ProgramList categories and tags must be arrays');
          const tags = [...(row.category || []), ...(row.tags || [])];
          if (tags.length > 32 || tags.some(value => !text(value))) throw new Error('ProgramList tag capacity');
          entries.push(Object.freeze({ key: row.bankPC.join(':'), title: row.title, bankPC: Object.freeze([...row.bankPC]), tags: Object.freeze(tags), search: (row.title + ' ' + tags.join(' ') + ' ' + row.bankPC.join(' ')).toLowerCase() }));
        }
        const catalogDigest = await digest(entries.map(row => [row.bankPC, row.title, row.tags]).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[0][2] - b[0][2]));
        if (selected !== generation || !current()) throw new Error('Program selection changed while preparing its identity');
        const key = JSON.stringify([propertyChannel, collection, descriptor.canPaginate ? offset : 0]), previous = pages.get(key);
        const estimate = JSON.stringify(entries).length * 2 + entries.length * 128, count = retainedEntries - (previous?.entries.length || 0) + entries.length, bytes = retainedEstimate - (previous?.retainedEstimate || 0) + estimate;
        if (count > 2048 || bytes > 1048576 || !previous && pages.size >= 32) throw new Error('Device program catalog aggregate capacity; refresh before browsing more pages');
        const page = Object.freeze({ propertyChannel, collection, offset: descriptor.canPaginate ? offset : 0, paginated: !!descriptor.canPaginate, entries: Object.freeze(entries), catalogDigest,
          totalCount: Number.isSafeInteger(response.record.header.totalCount) ? response.record.header.totalCount : null, resourceRevision: response.record.revision,
          deviceRevision: response.record.deviceRevision, retainedEstimate: estimate, observedHostMs: now() });
        pages.set(key, page); retainedEntries = count; retainedEstimate = bytes; latest = Object.freeze({ status: 'ok', page }); return latest;
      } catch (error) { latest = Object.freeze({ status: 'malformed', reason: error.message }); return latest; }
      finally { loading = false; emit(); }
    },
    requestIntent(page, entryKey) {
      if (!current() || page.deviceRevision !== revision() || ![...pages.values()].includes(page)) throw new Error('Refresh the selected device program page');
      const entry = page.entries.find(row => row.key === entryKey); if (!entry) throw new Error('Select an advertised bank/program');
      return validateDevicePatchIntent({ schema: 'lemmings-device-patch-intent/v1', title: entry.title, collection: page.collection, bankPC: entry.bankPC, catalogDigest: page.catalogDigest, deviceIdentity: peer.identity });
    },
    async recall({ page, entryKey, target, confirmed = false, isCurrent = () => true }) {
      let intent;
      try { intent = api.requestIntent(page, entryKey); } catch (error) { return Object.freeze({ status: 'stale', reason: error.message }); }
      const grant = routes.state().grants.find(row => row.grant === identity.outputGrant);
      if (!grant || !target || target.grant !== identity.outputGrant || !Number.isInteger(target.group) || target.group < 0 || target.group > 15 || !(grant.groupMask & 1 << target.group) ||
          !Number.isInteger(target.channel) || target.channel < 0 || target.channel > 15 || !['midi2', 'midi1-in-ump'].includes(target.protocol) ||
          target.propertyChannel !== page.propertyChannel || target.addressMapping !== 'user-declared') return Object.freeze({ status: 'rejected', reason: 'Choose an exact owned wire address and explicitly declare its ChannelList mapping' });
      const epoch = ++generation, wireExecution = routes.allocateExecutionEpoch(), ownedTarget = Object.freeze({ group: target.group, channel: target.channel, protocol: target.protocol, propertyChannel: target.propertyChannel, addressMapping: target.addressMapping }), provenance = Object.freeze({ schema: 'lemmings-device-patch-recall/v1', peerMuid,
        connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, group: target.group, channel: target.channel, propertyChannel: target.propertyChannel, intent });
      const outcome = await mutation.run({ requested: { kind: 'program-recall', intent, target: ownedTarget }, confirmed,
        isCurrent: () => current() && epoch === generation && isCurrent(),
        send: async owns => {
          const [msb, lsb, program] = intent.bankPC, words = target.protocol === 'midi2' ? encodeIntent({ group: target.group, channel: target.channel, status: 'programChange', bankValid: true, bankMSB: msb, bankLSB: lsb, program }) :
            [((0x20000000 | target.group << 24 | 11 << 20 | target.channel << 16 | msb) >>> 0), ((0x20000000 | target.group << 24 | 11 << 20 | target.channel << 16 | 32 << 8 | lsb) >>> 0), ((0x20000000 | target.group << 24 | 12 << 20 | target.channel << 16 | program << 8) >>> 0)];
          let submission;
          try {
            if (!owns()) throw new Error('Patch recall was cancelled before submission');
            submission = await routes.client.sendBatch({ grant: identity.outputGrant, execution: wireExecution, words, priority: 2, targetTimeMs: routes.client.now() + 10, provenance });
            routes.recordSubmission({ words, receipt: submission, provenance });
            if (submission.kind !== 'driver-submitted') return Object.freeze({ status: 'incomplete', reason: submission.reason || 'Patch setup was only partially submitted', receiverState: 'unknown', submission });
            const record = await readChannels(owns), reported = parseChannels(record.data).find(row => row.channel === target.propertyChannel);
            if (!sameBank(reported?.bankPC, intent.bankPC)) return Object.freeze({ status: 'mismatch', reason: 'Selected device ChannelList did not report the requested bank/program', receiverState: 'reported-mismatch', submission });
            return Object.freeze({ status: 'ok', intent, target: ownedTarget, submission, reported: Object.freeze({ channel: reported.channel, bankPC: reported.bankPC, programTitle: reported.programTitle, revision: record.revision }),
              receiverState: 'matching-reported-channel-under-user-declared-address-mapping', acousticState: 'unverified' });
          } catch (error) {
            if (!submission) routes.recordSubmission({ words, provenance, receipt: { session: identity.connectionEpoch, grant: identity.outputGrant, execution: wireExecution, kind: 'error', acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: error.notSubmitted !== true, submissionExtent: error.notSubmitted === true ? 'observed-prefix' : 'unobserved-batch', reason: error.message } });
            return Object.freeze({ status: 'incomplete', reason: error.message, receiverState: 'unknown', submission });
          } finally {
            try { const receipt = await routes.client.cancelExecution(identity.outputGrant, wireExecution); if (receipt.kind !== 'cancelled-execution' || receipt.cleanupUnconfirmedNotes) throw new Error('Patch control cancellation remains unconfirmed'); }
            catch (error) { routes.quarantineDeviceState(identity.outputGrant, error.message); throw error; }
          }
        }
      });
      latest = outcome;
      if (outcome.status === 'ok' && current() && epoch === generation) applied = Object.freeze({ ...outcome, deviceRevision: revision(), connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, peerMuid, outputGrant: identity.outputGrant });
      emit(); return applied && outcome.status === 'ok' ? applied : outcome;
    },
    applied: () => applied,
    isReceiptCurrent(receipt) { return current() && receipt === applied && receipt.deviceRevision === revision(); },
    state: () => Object.freeze({ disposed, peerMuid, connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, outputGrant: identity.outputGrant, loading,
      stale: !current() || channelDeviceRevision !== revision(), channels, channelsRevision, pages: Object.freeze([...pages.values()]), retainedEntries, retainedEstimate, latest, mutation: mutation.state() }),
    subscribe(listener) { if (disposed || listeners.size >= 8 || typeof listener !== 'function') throw new Error('Patch catalog observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    cancel() { generation++; mutation.cancel(); properties.cancelResource('ProgramList'); properties.cancelResource('ChannelList'); emit(); },
    dispose() { if (disposed) return; api.cancel(); disposed = true; unsubscribe(); unsubscribeCi(); channels = []; clearPages(); applied = null; listeners.clear(); return mutation.dispose(); }
  });
  return api;
}
