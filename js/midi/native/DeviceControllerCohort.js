export function createDeviceControllerCohort({ maximumParts = 256, maximumContributions = 8192 } = {}) {
  const parts = new Map(); let contributions = 0, disposed = false;
  const prepare = () => {
    const words = [], leasePolicyIds = [], observations = [], updates = [], dependencies = [];
    for (const part of parts.values()) {
      if (updates.length >= 8) break;
      if (!part.lease.policyCurrent() || part.fault) continue;
      let on = false; for (const contribution of part.contributors.values()) if (contribution.on) { on = true; break; }
      if (on === part.queued) continue;
      words.push(...(on ? part.onWords : part.lease.resetWords)); leasePolicyIds.push(part.lease.id);
      if (part.completion) dependencies.push({ completion: part.completion, requireSubmitted: false });
      updates.push({ part, on });
      observations.push(Object.freeze({ stableId: part.stableId, value: on ? part.maximum : part.minimum, semantic: part.lease.semantic === 'toggle' ? 'shared-rising-edge-trigger-receiver-latch-unknown' : 'shared-momentary-input', contributors: part.contributors.size }));
    }
    return Object.freeze({ words, leasePolicyIds, observations, dependencies,
      releaseOnly: updates.every(row => !row.on),
      commit(completion) {
        for (const { part, on } of updates) {
          part.queued = on; part.pending++; part.completion = completion;
          completion.then(receipt => { part.pending--; if (receipt.kind !== 'driver-submitted') part.fault = receipt.reason || 'device-controller-submission-unconfirmed'; }, error => { part.pending--; part.fault = error.message; });
        }
      }
    });
  };
  return Object.freeze({
    contribute({ claim, mapping, parameter, route, voiceId, laneId, value, onWords }) {
      if (disposed || !claim.lease?.current()) throw new Error('Device controller release lease is stale');
      let part = parts.get(claim.lease.key);
      if (!part) {
        if (parts.size >= maximumParts) throw new Error('Shared device controller part capacity');
        part = { lease: claim.lease, route, stableId: parameter.stableId, minimum: parameter.minimum, maximum: parameter.maximum, onWords, contributors: new Map(), queued: false, pending: 0, completion: null, fault: null };
        parts.set(claim.lease.key, part);
      }
      if (part.fault) throw new Error(part.fault);
      const key = JSON.stringify([voiceId, laneId, mapping.stableId]);
      if (!part.contributors.has(key)) { if (contributions >= maximumContributions) throw new Error('Device controller contribution capacity'); contributions++; }
      part.contributors.set(key, { voiceId, laneId, mapping, claim, on: value === parameter.maximum });
    },
    removeVoice(voiceId) { for (const part of parts.values()) for (const [key, row] of part.contributors) if (row.voiceId === voiceId) { part.contributors.delete(key); contributions--; } return prepare(); },
    prune(getLane) {
      for (const [partKey, part] of parts) {
        for (const [key, row] of part.contributors) if (!row.claim.current(getLane(row.laneId))) { part.contributors.delete(key); contributions--; }
        if (!part.lease.policyCurrent() && !part.pending) { contributions -= part.contributors.size; parts.delete(partKey); }
      }
      return prepare();
    },
    prepare,
    isQuiescent: () => [...parts.values()].every(part => !part.pending && (!part.lease.policyCurrent() || !part.queued)),
    dispose() { disposed = true; parts.clear(); contributions = 0; }
  });
}
