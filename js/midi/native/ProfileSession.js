import { createDeviceMutationOwner } from './DeviceMutation.js';

export const profileIdKey = id => Array.isArray(id) && id.length === 5 && id.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 127) ? id.map(byte => byte.toString(16).padStart(2, '0')).join('') : null;
const validScope = scope => Number.isInteger(scope) && (scope >= 0 && scope < 16 || scope === 126 || scope === 127);
const specifications = Object.freeze({
  '7e31000101': Object.freeze({ name: 'MIDI-CI MPE Profile', revision: 'M2-120 v2.0.3', channelStructure: 'manager-and-members', minimumChannels: 2,
    url: 'https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-120-UM_v2-0-3_MIDI_Polyphonic_Expression_Profile.pdf' })
});
export function createProfileSession({ routes, ci, peerMuid, now = () => performance.now(), timeoutMs = 2000 } = {}) {
  const peer = ci.getPeer(peerMuid);
  if (!peer || peer.version !== 2 || !(peer.categories & 4) || routes.client.capabilities?.ciProfileCodecVersion !== 1 || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('Discover a current Profile Configuration peer using a companion with profile decoding');
  const identity = ci.state(), records = new Map(), listeners = new Set(), mutation = createDeviceMutationOwner({ routes, ci, now });
  let disposed = false, active = null, revision = 0, latest = null, retainedBytes = 0;
  const current = () => !disposed && ci.state().epoch === identity.epoch && !!ci.getPeer(peerMuid);
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const key = (group, scope, id) => [group, scope, profileIdKey(id)].join(':');
  const finish = result => { if (!active) return; const request = active; active = null; clearTimeout(request.timer); latest = Object.freeze(result); request.resolve(latest); emit(); };
  const retain = (group, scope, id, changes) => {
    const idKey = profileIdKey(id); if (!idKey || !validScope(scope)) throw new Error('Malformed profile identity or scope');
    const address = key(group, scope, id), prior = records.get(address);
    if (!prior && records.size >= 256) throw new Error('Profile evidence capacity');
    const dataBytes = (changes.profileData?.length ?? prior?.profileData?.length ?? 0) + (changes.detailsData?.length ?? prior?.detailsData?.length ?? 0);
    const before = (prior?.profileData?.length || 0) + (prior?.detailsData?.length || 0), nextBytes = retainedBytes - before + dataBytes;
    if (nextBytes > 65536) throw new Error('Profile data aggregate capacity');
    const record = Object.freeze({ ...prior, profile: Object.freeze([...id]), id: idKey, group, scope, specification: specifications[idKey] || null,
      connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, peerMuid, ...changes, revision: ++revision, observedHostMs: now() });
    records.set(address, record); retainedBytes = nextBytes; return record;
  };
  const request = (operation, { scope, profile = null, target = null, channels = null, isCurrent = () => true }) => {
    if (!current() || active) return Promise.resolve(Object.freeze({ status: 'rejected', reason: 'Profile session is stale or busy' }));
    let resolve; const completion = new Promise(done => { resolve = done; });
    const entry = { operation, scope, profile, target, channels, resolve, staged: new Map(), group: identity.group, isCurrent };
    active = entry; entry.timer = setTimeout(() => { if (active === entry) finish({ status: 'timeout', reason: 'No complete matching profile response; receiver state remains unknown' }); }, timeoutMs);
    const parameters = profile ? [...profile, target ?? channels ?? 0] : [];
    const send = operation === 'profile-on' || operation === 'profile-off' ? ci.sendProfileControl : ci.sendReadControl;
    send(peerMuid, { operation, parameters, deviceScope: scope, isCurrent: () => active === entry && current() && isCurrent() }).catch(error => { if (active === entry) finish({ status: 'incomplete', reason: error.message, receiverState: 'unknown' }); });
    emit(); return completion;
  };
  const invalidate = reason => {
    if (active) finish({ status: 'cancelled', reason, receiverState: 'unknown' });
    mutation.cancel();
    for (const [address, record] of records) records.set(address, Object.freeze({ ...record, freshness: 'stale', enabled: null, channels: null, revision: ++revision, reason }));
    emit();
  };
  const changed = reason => {
    void routes.invalidateDeviceState(identity.outputGrant, reason).catch(error => { latest = Object.freeze({ status: 'incomplete', reason: error.message, receiverState: 'unknown' }); emit(); });
  };
  const receive = event => {
    if (!current()) { invalidate('Device peer or CI epoch changed'); return; }
    if (event.epoch !== identity.epoch) return;
    if (event.kind === 'malformed-ci') { if (active) finish({ status: 'malformed', reason: event.reason, receiverState: 'unknown' }); return; }
    if (event.kind !== 'ci' || event.message.sourceMuid !== peerMuid) return;
    const message = event.message, group = event.group, pending = active;
    if (message.subtype === 127 && pending && (message.version === 1 || message.transaction === ({ 'profile-inquiry': 32, 'profile-details': 40, 'profile-on': 34, 'profile-off': 35 })[pending.operation]) && message.scope === pending.scope) {
      finish({ status: 'refused', reason: message.message || 'Device declined profile request', receiverState: 'unknown' }); return;
    }
    try {
      if (message.subtype === 33) {
        if (!pending || pending.operation !== 'profile-inquiry' || message.destinationMuid !== identity.localMuid ||
            pending.scope !== 127 && (message.scope !== pending.scope || group !== pending.group)) return;
        if (pending.staged.has(group + ':' + message.scope)) throw new Error('Duplicate profile inquiry scope');
        const enabled = message.enabledProfiles, disabled = message.disabledProfiles;
        if (!Array.isArray(enabled) || !Array.isArray(disabled) || enabled.length + disabled.length > 128) throw new Error('Invalid profile inquiry lists');
        const seen = new Set();
        for (const [values, state] of [[enabled, true], [disabled, false]]) for (const id of values) {
          const idKey = profileIdKey(id); if (!idKey || seen.has(idKey)) throw new Error('Contradictory or duplicate profile evidence'); seen.add(idKey);
          if (pending.staged.size + records.size > 512) throw new Error('Profile inquiry scope capacity');
          pending.staged.set(key(group, message.scope, id), { group, scope: message.scope, profile: id, enabled: state });
        }
        pending.staged.set(group + ':' + message.scope, null);
        if (pending.staged.size > 512) throw new Error('Profile inquiry aggregate capacity');
        if (pending.scope === 127 && message.scope !== 127) return;
        const evidence = [...pending.staged.values()].filter(Boolean);
        const replaced = [...records].filter(([, row]) => pending.scope === 127 || row.group === group && row.scope === message.scope);
        const retained = records.size - replaced.length;
        if (retained + evidence.length > 256) throw new Error('Profile inquiry aggregate profile capacity');
        for (const [address, row] of replaced) { retainedBytes -= (row.profileData?.length || 0) + (row.detailsData?.length || 0); records.delete(address); }
        for (const row of evidence) retain(row.group, row.scope, row.profile, { supported: true, enabled: row.enabled, channels: null, freshness: 'current', origin: 'profile-inquiry', detailsData: null, profileData: null, requested: null });
        finish({ status: 'ok', scopes: pending.staged.size - evidence.length, profiles: evidence.length, receiverState: 'reported', completeWithinGrantedInputs: true }); return;
      }
      if (message.subtype === 41) {
        if (!pending || pending.operation !== 'profile-details' || message.destinationMuid !== identity.localMuid || pending.group !== group || pending.scope !== message.scope || profileIdKey(pending.profile) !== profileIdKey(message.profile) || pending.target !== message.target) return;
        const data = message.profileData;
        if (!Array.isArray(data) || data.length > 1024) throw new Error('Profile details data capacity');
        let allocation = null;
        if (message.target === 0) {
          if (data.length !== 4) throw new Error('Malformed profile channel-count details');
          allocation = Object.freeze({ current: data[0] | data[1] << 7, maximum: data[2] | data[3] << 7 });
          if (allocation.maximum > 256 || allocation.current > allocation.maximum) throw new Error('Invalid profile channel-count details');
        }
        const record = retain(group, message.scope, message.profile, { detailsTarget: message.target, detailsData: Object.freeze([...data]), ...(allocation ? { allocation } : {}), freshness: 'current' });
        finish({ status: 'ok', record, receiverState: 'reported' }); return;
      }
      if (![36, 37, 38, 39, 47].includes(message.subtype)) return;
      const address = key(group, message.scope, message.profile), prior = records.get(address);
      if (message.subtype === 47) {
        if (!prior || !Array.isArray(message.profileData) || message.profileData.length > 1024) return;
        retain(group, message.scope, message.profile, { profileData: Object.freeze([...message.profileData]), profileDataInterpretation: 'unverified-read-only' }); emit(); return;
      }
      const enabled = message.subtype === 36 ? true : message.subtype === 37 ? false : message.subtype === 38 ? prior?.enabled ?? false : null;
      const own = pending && ['profile-on', 'profile-off'].includes(pending.operation) && group === pending.group && pending.scope === message.scope && profileIdKey(pending.profile) === profileIdKey(message.profile);
      const channels = [36, 37].includes(message.subtype) ? message.channels : null;
      const record = retain(group, message.scope, message.profile, { supported: message.subtype !== 39, enabled, channels,
        freshness: 'current', origin: own ? 'matching-receiver-report' : 'changed-externally', requested: own ? { enabled: pending.operation === 'profile-on', channels: pending.channels } : null,
        allocation: null, detailsData: null });
      if (own && [36, 37].includes(message.subtype)) {
        const matches = enabled === (pending.operation === 'profile-on');
        finish({ status: matches ? 'ok' : 'refused', record, receiverState: 'reported', acceptedChannels: enabled ? channels : 0,
          partialAllocation: matches && enabled && channels !== pending.channels, reason: matches ? null : 'Device reported the opposite profile state' });
      } else if (!prior || prior.enabled !== enabled || prior.channels !== channels || prior.supported !== record.supported) {
        changed('external-profile-change'); if (pending) finish({ status: 'cancelled', reason: 'Profile changed externally during request', receiverState: 'reported' });
      }
      emit();
    } catch (error) { if (active) finish({ status: 'malformed', reason: error.message, receiverState: 'unknown' }); else { latest = Object.freeze({ status: 'malformed', reason: error.message }); emit(); } }
  };
  const unsubscribe = ci.subscribeProtocol(receive), unsubscribeCi = ci.subscribe(() => { if (!current()) invalidate('Device peer or CI epoch changed'); }), unsubscribeMutation = mutation.subscribe(emit);
  return Object.freeze({
    inquire(scope = 127) {
      if (!validScope(scope) || mutation.state().busy) return Promise.resolve(Object.freeze({ status: 'rejected', reason: 'Choose a current idle profile scope' }));
      return request('profile-inquiry', { scope });
    },
    details(profile, scope, target = 0) {
      if (!profileIdKey(profile) || !validScope(scope) || !Number.isInteger(target) || target < 0 || target > 127 || !records.get(key(identity.group, scope, profile))?.supported || mutation.state().busy) return Promise.resolve(Object.freeze({ status: 'rejected', reason: 'Choose an advertised profile and details target' }));
      return request('profile-details', { profile: [...profile], scope, target });
    },
    async setEnabled({ profile, scope, enabled, channels = 1, confirmed = false }) {
      const record = records.get(key(identity.group, scope, profile)), specification = record?.specification;
      if (!current() || active || !specification || !record.supported || record.freshness !== 'current' || typeof enabled !== 'boolean' || !validScope(scope)) return Object.freeze({ status: 'unsupported', reason: 'Only an advertised profile with a reviewed specification can be changed' });
      if (enabled && (scope >= 126 || !Number.isInteger(channels) || channels < specification.minimumChannels || channels > (record.allocation?.maximum ?? 0))) return Object.freeze({ status: 'rejected', reason: 'Read channel-allocation details and choose an available channel count first' });
      const desired = Object.freeze({ profile: Object.freeze([...profile]), scope, enabled, channels: enabled ? channels : 0, group: identity.group });
      return mutation.run({ requested: desired, confirmed, isCurrent: current,
        send: isCurrent => request(enabled ? 'profile-on' : 'profile-off', { profile: desired.profile, scope, channels: desired.channels, isCurrent }) });
    },
    binding(profile, scope) {
      const record = records.get(key(identity.group, scope, profile));
      return current() && record?.freshness === 'current' && record.enabled === true && record.specification && Number.isInteger(record.channels) ?
        Object.freeze({ ...record, transportProtocol: 'not-implied-by-profile', perNoteControllerResponse: 'not-implied-by-profile' }) : null;
    },
    state: () => Object.freeze({ disposed, peerMuid, connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, group: identity.group, revision,
      busy: !!active || mutation.state().busy, pending: active ? Object.freeze({ operation: active.operation, scope: active.scope, profile: active.profile }) : null,
      profiles: Object.freeze([...records.values()]), retainedBytes, latest, mutation: mutation.state() }),
    subscribe(listener) { if (disposed || typeof listener !== 'function' || listeners.size >= 8) throw new Error('Profile observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    cancel() { if (active) finish({ status: 'cancelled', reason: 'Profile request cancelled', receiverState: 'unknown' }); mutation.cancel(); },
    dispose() { if (disposed) return; disposed = true; if (active) finish({ status: 'cancelled', reason: 'Profile owner retired', receiverState: 'unknown' }); mutation.dispose(); unsubscribe(); unsubscribeCi(); unsubscribeMutation(); records.clear(); listeners.clear(); retainedBytes = 0; }
  });
}
