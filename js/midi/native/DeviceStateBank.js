import { propertyJsonBytes, parsePropertyJson, PROPERTY_LIMITS } from './PropertyDataCodec.js';

const label = (value, maximum = 256) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const stateId = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,36}$/.test(value);
const identityKeys = ['manufacturer', 'family', 'model', 'revision'];
const sameIdentity = (left, right) => identityKeys.every(key => left?.[key] === right?.[key]);
const identityOf = value => {
  if (!value || !identityKeys.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 0x0fffffff)) throw new Error('Device identity is incomplete');
  return Object.freeze(Object.fromEntries(identityKeys.map(key => [key, value[key]])));
};
const hash = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
const bytesOf = (data, mediaType) => {
  if (mediaType === 'application/json') return propertyJsonBytes(data);
  if (mediaType !== 'application/octet-stream' || !Array.isArray(data) || data.length > PROPERTY_LIMITS.decodedBytes || data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Device state must be bounded JSON or opaque bytes');
  return Uint8Array.from(data);
};
const parseList = value => {
  if (!Array.isArray(value) || value.length > 128) throw new Error('StateList capacity');
  const seen = new Set();
  return Object.freeze(value.map(row => {
    if (!row || !stateId(row.stateId) || seen.has(row.stateId) || !label(row.title) ||
        row.stateRev != null && !label(row.stateRev) || row.description != null && !label(row.description, 4096) ||
        row.size != null && (!Number.isSafeInteger(row.size) || row.size < 0) || row.timestamp != null && (!Number.isSafeInteger(row.timestamp) || row.timestamp < 0)) throw new Error('Malformed or duplicate device state');
    seen.add(row.stateId);
    return Object.freeze({ stateId: row.stateId, title: row.title, stateRev: row.stateRev ?? null, timestamp: row.timestamp ?? null, description: row.description || '', size: row.size ?? null });
  }));
};

export function createDeviceStateBank({ routes, ci, properties, peerMuid, now = () => performance.now() }) {
  const scope = ci.state(), peer = ci.getPeer(peerMuid), deviceIdentity = identityOf(peer?.identity), snapshots = new Map(), previews = new WeakSet(), listeners = new Set();
  let disposed = false, busy = false, generation = 0, list = [], listRevision = null, listDeviceRevision = null, retainedBytes = 0, latest = null, closing = null, activeCompletion = null;
  const revision = () => routes.state().grants.find(row => row.grant === scope.outputGrant)?.deviceRevision ?? null;
  const current = () => !disposed && ci.state().epoch === scope.epoch && sameIdentity(ci.getPeer(peerMuid)?.identity, deviceIdentity) && !properties.state().stale && !properties.state().disposed;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const descriptor = () => properties.state().resources.find(row => row.resource === 'State');
  const transferOptions = mediaType => {
    const row = descriptor(); if (!row) throw new Error('The device did not advertise State');
    const mediaTypes = row.mediaTypes || ['application/octet-stream'], encodings = row.encodings || ['Mcoded7'];
    const selected = mediaType || (mediaTypes.includes('application/octet-stream') ? 'application/octet-stream' : mediaTypes.includes('application/json') ? 'application/json' : null);
    const encoding = ['Mcoded7', 'zlib+Mcoded7', 'ASCII'].find(value => encodings.includes(value) && (selected === 'application/json' || value !== 'ASCII'));
    if (!selected || !mediaTypes.includes(selected) || !encoding) throw new Error('No supported State media type and encoding were advertised');
    return { mediaType: selected, encoding };
  };
  const refresh = async owns => {
    if (properties.state().resourcesStale || !properties.state().resources.length) { const result = await properties.discoverResources(); if (result.status !== 'ok') throw new Error(result.reason || 'Resource discovery failed'); }
    const response = await properties.get('StateList', { isCurrent: owns });
    if (response.status !== 'ok' || !response.record || !owns() || !current()) throw new Error(response.reason || 'StateList read did not finish on the selected device');
    list = parseList(response.record.data); listRevision = response.record.revision; listDeviceRevision = response.record.deviceRevision; emit(); return list;
  };
  const put = async snapshot => {
    const bytes = bytesOf(snapshot.data, snapshot.mediaType);
    if (bytes.length > PROPERTY_LIMITS.decodedBytes || snapshots.size >= 4 || retainedBytes + bytes.length > 1048576) throw new Error('Private state bank capacity; discard a capture before adding more');
    const sha256 = await hash(bytes);
    if (snapshot.sha256 != null && snapshot.sha256 !== sha256) throw new Error('Device state digest does not match its data');
    const value = Object.freeze({ ...snapshot, byteSize: bytes.length, sha256, captureId: globalThis.crypto.randomUUID(), privacy: 'private-device-state-excluded-from-project-exports', authorization: 'explicit-current-device-selection-and-restore-required' });
    snapshots.set(value.captureId, value); retainedBytes += value.byteSize; return value;
  };
  const run = action => {
    if (!current() || busy) return Promise.resolve(Object.freeze({ status: 'rejected', reason: 'Select an idle current device-state bank' }));
    const selected = ++generation; busy = true; emit();
    activeCompletion = (async () => {
      try { latest = Object.freeze(await action(() => current() && selected === generation)); }
      catch (error) { latest = Object.freeze({ status: 'incomplete', reason: error.message, receiverState: 'unknown' }); }
      finally { busy = false; activeCompletion = null; emit(); }
      return latest;
    })(); return activeCompletion;
  };
  const unsubscribe = properties.subscribeObservations(event => {
    if (event?.record?.resource === 'StateList' && current() && event.record.deviceRevision === revision()) {
      try { list = parseList(event.record.data); listRevision = event.record.revision; listDeviceRevision = event.record.deviceRevision; } catch { list = []; listRevision = listDeviceRevision = null; }
    }
    emit();
  });
  const api = Object.freeze({
    load: () => run(async owns => ({ status: 'ok', states: (await refresh(owns)).length })),
    capture(id) {
      return run(async owns => {
        await refresh(owns); const row = list.find(row => row.stateId === id);
        if (!row || row.size != null && row.size > PROPERTY_LIMITS.decodedBytes) throw new Error('Choose an advertised state within the capture byte limit');
        const options = transferOptions(), response = await properties.get('State', { ...options, resId: id, isCurrent: owns });
        if (response.status !== 'ok' || !response.record || !owns()) throw new Error(response.reason || 'State capture did not complete');
        const record = response.record;
        if (row.stateRev != null && record.header.stateRev != null && row.stateRev !== record.header.stateRev) throw new Error('Device state changed during capture; refresh before capturing again');
        const data = record.data, stateRev = record.header.stateRev ?? row.stateRev;
        if (stateRev != null && !label(stateRev)) throw new Error('Malformed captured State revision');
        const timestamp = record.header.timestamp ?? row.timestamp;
        if (timestamp != null && (!Number.isSafeInteger(timestamp) || timestamp < 0)) throw new Error('Malformed captured State timestamp');
        const capture = await put({ schema: 'lemmings-private-device-state/v1', deviceIdentity, stateId: id, title: row.title, description: row.description, stateRev,
          timestamp, capturedAt: new Date().toISOString(), mediaType: options.mediaType, data });
        if (!owns()) { api.discard(capture.captureId); throw new Error('State selection changed during capture'); }
        return { status: 'ok', captureId: capture.captureId, receiverState: 'unchanged-by-read', revisionEvidence: stateRev == null ? 'unversioned-device-observation' : 'device-reported-revision' };
      });
    },
    importPrivate(value) {
      return run(async owns => {
        if (!value || value.schema !== 'lemmings-private-device-state/v1' || !stateId(value.stateId) || !label(value.title) ||
            value.description != null && !label(value.description || ' ', 4096) || value.stateRev != null && !label(value.stateRev) ||
            value.timestamp != null && (!Number.isSafeInteger(value.timestamp) || value.timestamp < 0) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Malformed private device-state file');
        const identity = identityOf(value.deviceIdentity), bytes = bytesOf(value.data, value.mediaType);
        const data = value.mediaType === 'application/json' ? parsePropertyJson(bytes).value : Object.freeze(Array.from(bytes));
        const capture = await put({ schema: value.schema, deviceIdentity: identity, stateId: value.stateId, title: value.title, description: value.description || '',
          stateRev: value.stateRev ?? null, timestamp: value.timestamp ?? null, capturedAt: typeof value.capturedAt === 'string' ? value.capturedAt.slice(0, 64) : null, mediaType: value.mediaType, sha256: value.sha256, data });
        if (!owns()) { api.discard(capture.captureId); throw new Error('Device selection changed during private import'); }
        return { status: 'ok', captureId: capture.captureId, receiverState: 'unchanged-by-import' };
      });
    },
    async preview(captureId, targetGrant) {
      let preview = null;
      const result = await run(async owns => {
        if (targetGrant !== scope.outputGrant) throw new Error('Choose the exact native output paired with this CI peer');
        const capture = snapshots.get(captureId); if (!capture || !sameIdentity(capture.deviceIdentity, deviceIdentity)) throw new Error('State requires the same manufacturer, model, family and software revision');
        await refresh(owns); const row = list.find(row => row.stateId === capture.stateId), resource = descriptor();
        if (!row || !['full', 'partial'].includes(resource?.canSet)) throw new Error('The current device does not advertise this writable State');
        const options = transferOptions(capture.mediaType), native = routes.state();
        preview = Object.freeze({ captureId, targetGrant, connectionEpoch: scope.connectionEpoch, ciEpoch: scope.epoch, peerMuid,
          deviceRevision: revision(), listRevision, targetTitle: row.title, sourceTitle: capture.title, stateId: capture.stateId, sourceStateRev: capture.stateRev, targetStateRev: row.stateRev,
          byteSize: capture.byteSize, sha256: capture.sha256, mediaType: capture.mediaType, options, createdHostMs: now(),
          affectedState: row.description || 'Device-defined state; may include settings in every group and channel', affectedNativeOutputs: Object.freeze(native.grants.filter(row => row.direction === 'output').map(row => row.grant)),
          scope: 'device-state-not-channel-state', mutationBoundary: 'all-owned-native-output-stopped', verification: 'explicit-write-then-bounded-byte-readback' });
        previews.add(preview); return { status: 'ok', preview };
      });
      return result;
    },
    restore(preview, { confirmed = false, isCurrent = () => true } = {}) {
      return run(async owns => {
        const capture = snapshots.get(preview?.captureId);
        if (!capture || !previews.has(preview) || preview.targetGrant !== scope.outputGrant || preview.connectionEpoch !== scope.connectionEpoch ||
            preview.deviceRevision !== revision() || preview.listRevision !== listRevision || listDeviceRevision !== revision() || now() - preview.createdHostMs > 60000 ||
            confirmed !== true || !isCurrent()) throw new Error('Review a fresh device-state preview and explicitly confirm its exact destination');
        previews.delete(preview);
        const result = await properties.set('State', capture.data, { ...preview.options, resId: capture.stateId, confirmed: true,
          isCurrent: () => owns() && isCurrent() });
        if (result.status !== 'ok') return { ...result, receiverState: 'unknown', restored: false };
        if (!owns() || !isCurrent()) return { status: 'cancelled', reason: 'Device selection changed after the state write', receiverState: 'unknown', restored: false };
        await refresh(owns);
        const readback = await properties.get('State', { ...transferOptions(capture.mediaType), resId: capture.stateId, isCurrent: () => owns() && isCurrent() });
        if (readback.status !== 'ok' || !readback.record || !owns() || !isCurrent()) return { status: 'acknowledged', reason: readback.reason || 'State write acknowledged; readback unavailable', receiverState: 'acknowledged-property-write', restored: false };
        const actual = await hash(bytesOf(readback.record.data, capture.mediaType)), matches = actual === capture.sha256;
        return { status: matches ? 'ok' : 'mismatch', restored: matches, receiverState: matches ? 'matching-device-state-readback' : 'reported-different-state',
          stateId: capture.stateId, requestedDigest: capture.sha256, observedDigest: actual, reportedStateRev: readback.record.header.stateRev ?? null, acousticState: 'unverified' };
      });
    },
    exportPrivate(captureId) { const value = snapshots.get(captureId); if (!value) throw new Error('Choose a private capture'); const { captureId: ignored, ...snapshot } = value; return snapshot; },
    discard(captureId) { const value = snapshots.get(captureId); if (!value) return false; retainedBytes -= value.byteSize; snapshots.delete(captureId); emit(); return true; },
    state: () => Object.freeze({ disposed, stale: !current() || listDeviceRevision !== revision(), busy, peerMuid, outputGrant: scope.outputGrant, states: list, listRevision, retainedBytes,
      captures: Object.freeze([...snapshots.values()].map(({ data, ...metadata }) => Object.freeze({ ...metadata, compatible: sameIdentity(metadata.deviceIdentity, deviceIdentity) }))), latest }),
    subscribe(listener) { if (disposed || typeof listener !== 'function' || listeners.size >= 8) throw new Error('State observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    cancel() { generation++; properties.cancelResource('State'); properties.cancelResource('StateList'); emit(); },
    dispose() { if (closing) return closing; api.cancel(); disposed = true; unsubscribe(); listeners.clear(); closing = (async () => { await activeCompletion; snapshots.clear(); list = []; retainedBytes = 0; })(); return closing; }
  });
  return api;
}
