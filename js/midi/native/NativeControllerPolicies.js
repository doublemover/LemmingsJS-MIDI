export function createNativeControllerPolicies({ client, isGrantActive, onFailure }) {
  const records = new Map(); let disposed = false;
  return Object.freeze({
    async acquire(grant, resetWords, semantic) {
      if (disposed || !isGrantActive(grant) || !['momentary', 'toggle'].includes(semantic)) throw new Error('Current typed controller output required');
      const session = client.session, words = Object.freeze([...resetWords]), key = JSON.stringify([session, grant, words]);
      let record = records.get(key);
      if (record && (record.retiring || record.semantic !== semantic)) throw new Error('Controller release ownership conflicts with the current mapping');
      if (!record) {
        if (records.size >= 4096) throw new Error('Controller release policy capacity');
        record = { key, session, grant, words, semantic, refs: 0, id: null, retiring: false, forgotten: false };
        records.set(key, record);
        record.ready = client.registerControllerPolicy(grant, words).then(receipt => {
          if (receipt.kind !== 'registered-controller-policy' || receipt.grant !== grant || !Number.isInteger(receipt.policy) || receipt.policy < 1) throw new Error('Native controller policy registration was not confirmed');
          record.id = receipt.policy; return receipt;
        });
        record.ready.catch(() => { if (records.get(key) === record) records.delete(key); });
      }
      record.refs++;
      try { await record.ready; if (disposed || record.forgotten || session !== client.session || !isGrantActive(grant)) throw new Error('Controller policy connection changed'); }
      catch (error) { record.refs--; throw error; }
      let released = false;
      return Object.freeze({ key, id: record.id, resetWords: words, semantic,
        policyCurrent: () => !disposed && !record.forgotten && !record.retiring && session === client.session && isGrantActive(grant),
        current: () => !released && !disposed && !record.forgotten && !record.retiring && session === client.session && isGrantActive(grant),
        release() {
          if (released) return record.retirement || Promise.resolve(); released = true;
          if (--record.refs || record.forgotten || session !== client.session || !isGrantActive(grant)) return Promise.resolve();
          record.retiring = true;
          record.retirement = client.retireControllerPolicy(grant, record.id).then(receipt => {
            if (receipt.kind !== 'retired-controller-policy' || receipt.cleanupUnconfirmedControls) throw new Error('Native controller policy cleanup remains unconfirmed');
            if (records.get(key) === record) records.delete(key);
          }).catch(error => { onFailure(grant, error.message); throw error; });
          return record.retirement;
        }
      });
    },
    forget(grant = null) { for (const [key, record] of records) if (grant == null || record.grant === grant) { record.forgotten = true; records.delete(key); } },
    dispose() { disposed = true; for (const record of records.values()) record.forgotten = true; records.clear(); }
  });
}
