// @ts-check
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
/** @param {unknown} target @param {string} name @returns {unknown} */
const property = (target, name) => { try { return Reflect.get(Object(target), name); } catch { return undefined; } };

/** @param {import('./AudioRuntimeContracts.js').AudioOutputWatchOptions} options */
export function createAudioOutputWatch({ mediaDevices, permissions, watchPermission = false, onChange }) {
  if (typeof onChange !== 'function') throw new TypeError('An audio output watch needs a change listener.');
  const retirement = createProcgenRetirementScope();
  let disposed = false, devicesListening = false, devicesAttempted = false, permissionListening = false, explicitPermissionRevoked = false;
  /** @type {unknown} */
  let permission = null, previousPermission = null, removePermission = null;
  /** @type {'unavailable' | 'pending' | 'observing' | 'retired'} */
  let permissionQuery = 'unavailable';
  const addDevices = property(mediaDevices, 'addEventListener'), removeDevices = property(mediaDevices, 'removeEventListener'), query = property(permissions, 'query');
  const devicesChanged = () => { if (!disposed) onChange('devices-changed'); };
  const permissionChanged = () => {
    if (disposed) return;
    const next = property(permission, 'state'), revoked = next === 'denied' || previousPermission === 'granted' && next !== 'granted';
    previousPermission = next;
    if (next === 'granted') explicitPermissionRevoked = false;
    else if (revoked) explicitPermissionRevoked = true;
    if (revoked) onChange('speaker-permission-revoked');
  };
  if (typeof addDevices === 'function' && typeof removeDevices === 'function') {
    devicesAttempted = true;
    try { Reflect.apply(addDevices, mediaDevices, ['devicechange', devicesChanged]); devicesListening = true; } catch { /* Optional observation can be denied. */ }
  }
  if (watchPermission && typeof query === 'function') {
    permissionQuery = 'pending';
    // The late read-only reply may settle after retirement, but cannot attach a listener.
    Promise.resolve().then(() => disposed ? null : Reflect.apply(query, permissions, [{ name: 'speaker-selection' }])).then(status => {
      if (disposed) return;
      const add = property(status, 'addEventListener'), remove = property(status, 'removeEventListener');
      if (!status || typeof add !== 'function' || typeof remove !== 'function') { permissionQuery = 'unavailable'; return; }
      permission = status; removePermission = remove; previousPermission = property(status, 'state');
      permissionListening = true; Reflect.apply(add, status, ['change', permissionChanged]); permissionQuery = 'observing';
      if (previousPermission === 'denied') { explicitPermissionRevoked = true; onChange('speaker-permission-revoked'); }
    }).catch(() => { if (!disposed) permissionQuery = 'unavailable'; });
  }
  return Object.freeze({
    state: () => Object.freeze({ devicesListening, speakerPermission: permissionQuery, explicitPermissionRevoked, physicalRouteConfirmed: false }),
    dispose: () => retirement.retire([
      { name: 'invalidate-output-watch', run: () => { disposed = true; permissionQuery = 'retired'; } },
      { name: 'device-availability-listener', run: () => { if (devicesAttempted && typeof removeDevices === 'function') Reflect.apply(removeDevices, mediaDevices, ['devicechange', devicesChanged]); devicesListening = false; } },
      { name: 'speaker-permission-listener', run: () => { if (permissionListening && typeof removePermission === 'function') Reflect.apply(removePermission, permission, ['change', permissionChanged]); permissionListening = false; permission = removePermission = null; } }
    ])
  });
}
