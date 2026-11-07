import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createOwnedAudioListeners() {
  const records = [], retirement = createProcgenRetirementScope(); let disposed = false;
  return Object.freeze({
    add(target, type, callback) {
      if (disposed || typeof type !== 'string' || !type || type.length > 64 || typeof callback !== 'function' || records.length >= 16) throw new TypeError('Invalid owned audio listener.');
      if (target == null) return false;
      const add = target.addEventListener, remove = target.removeEventListener;
      if (add == null && remove == null) return false;
      if (typeof add !== 'function' || typeof remove !== 'function') throw new TypeError('Audio event observation requires removable native listeners.');
      const listener = event => { if (!disposed) callback(event); };
      records.push({ target, type, remove, listener });
      Reflect.apply(add, target, [type, listener]); return true;
    },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      return retirement.retire(records.splice(0).map((record, index) => ({ name: 'audio-listener-' + index + '-' + record.type,
        run: () => Reflect.apply(record.remove, record.target, [record.type, record.listener]) })));
    }
  });
}
