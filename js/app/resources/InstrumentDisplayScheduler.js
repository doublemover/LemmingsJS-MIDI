import { createOwnedResourceReservation } from './OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

let nextScheduler = 0;
export function createInstrumentDisplayScheduler({ document, window = document?.defaultView || globalThis, resourceBudget = null,
  maxSurfaces = 64, sampleCapacity = 128 } = {}) {
  if (!document || !Number.isSafeInteger(maxSurfaces) || maxSurfaces < 1 || maxSurfaces > 128 ||
      !Number.isSafeInteger(sampleCapacity) || sampleCapacity < 8 || sampleCapacity > 1024) throw new TypeError('Invalid instrument display bounds.');
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'instrument-display-' + (++nextScheduler), kind: 'display-mailboxes',
    category: 'graphics', bytes: 65536 + maxSurfaces * 4096 + sampleCapacity * 8 });
  const retirement = createProcgenRetirementScope(), surfaces = new Map(), elements = new Map(), samples = new Float64Array(sampleCapacity);
  const now = () => window.performance?.now?.() ?? globalThis.performance.now();
  const later = (callback, delay) => (window.setTimeout || globalThis.setTimeout).call(window, callback, delay);
  const clearLater = timer => (window.clearTimeout || globalThis.clearTimeout).call(window, timer);
  const requestFrame = callback => window.requestAnimationFrame ? window.requestAnimationFrame(callback) : later(() => callback(now()), 16);
  const cancelFrame = frame => window.cancelAnimationFrame ? window.cancelAnimationFrame(frame) : clearLater(frame);
  let frame = null, timer = null, timerDue = Infinity, disposed = false, flushing = false, sampleCount = 0, totalFrames = 0, revision = 0;
  const hidden = () => document.hidden === true;
  const cancel = () => { if (frame != null) cancelFrame(frame); if (timer != null) clearLater(timer); frame = timer = null; };
  const visible = surface => surface.active && surface.intersecting && surface.element?.hidden !== true;
  const arm = () => {
    if (disposed || flushing || hidden() || frame != null) return;
    let due = Infinity; const time = now();
    for (const surface of surfaces.values()) if (surface.dirty && visible(surface)) due = Math.min(due, surface.lastWrite + surface.intervalMs);
    if (due === Infinity) return;
    if (timer != null) { if (timerDue <= due) return; clearLater(timer); timer = null; }
    if (due <= time) frame = requestFrame(flush);
    else { timerDue = due; timer = later(() => { timer = null; arm(); }, Math.max(1, due - time)); }
  };
  const fail = (surface, error) => {
    surface.errors++; surface.lastError = String(error?.message || 'Instrument display unavailable.').slice(0, 512);
    try { surface.onError?.(surface.lastError); } catch { /* A failing view cannot stop independent displays. */ }
  };
  function flush() {
    frame = null; if (disposed || hidden()) return;
    flushing = true; const started = now(), ready = [];
    try {
      for (const surface of surfaces.values()) {
        if (!surface.dirty || !visible(surface) || started - surface.lastWrite < surface.intervalMs) continue;
        const packet = surface.packet, dirty = surface.dirty; surface.dirty = 0;
        try { ready.push({ surface, packet, dirty, measured: surface.read?.(packet, dirty) }); }
        catch (error) { fail(surface, error); }
      }
      for (const item of ready) {
        const { surface, packet, measured, dirty } = item;
        if (!surface.active || !visible(surface) || packet !== surface.packet) { surface.skipped++; if (surface.active) surface.dirty |= dirty; continue; }
        try { surface.write(measured, packet, dirty); surface.writes++; surface.lastWrite = now(); surface.lastAgeMs = Math.max(0, started - surface.requestedAt); }
        catch (error) { fail(surface, error); }
      }
    } finally {
      samples[totalFrames % sampleCapacity] = Math.max(0, now() - started); totalFrames++; sampleCount = Math.min(sampleCapacity, sampleCount + 1);
      flushing = false; arm();
    }
  }
  const observer = typeof window.IntersectionObserver === 'function' ? new window.IntersectionObserver(entries => {
    for (const entry of entries) for (const surface of elements.get(entry.target) || []) {
      surface.intersecting = entry.isIntersecting; if (surface.intersecting) surface.dirty |= 1;
    } arm();
  }) : null;
  const visibility = () => {
    cancel(); if (!hidden()) { for (const surface of surfaces.values()) { surface.dirty |= 1; surface.lastWrite = -Infinity; } arm(); }
  };
  document.addEventListener?.('visibilitychange', visibility);
  return Object.freeze({
    register({ id, element = null, intervalMs = 32, read = null, write, onError = null } = {}) {
      if (disposed || surfaces.size >= maxSurfaces || typeof id !== 'string' || !id || id.length > 128 || surfaces.has(id) ||
          !Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 1000 || typeof write !== 'function' || read != null && typeof read !== 'function')
        throw new TypeError('Invalid or unavailable display surface.');
      const surface = { id, element, intervalMs, read, write, onError, packet: Object.freeze({ revision: ++revision, submittedAt: now(), identity: null, value: null }),
        dirty: 0, active: true, intersecting: true, lastWrite: -Infinity, requestedAt: now(), writes: 0, coalesced: 0, skipped: 0, errors: 0, lastError: null, lastAgeMs: null };
      surfaces.set(id, surface);
      if (element && observer) { let group = elements.get(element); if (!group) { group = new Set(); elements.set(element, group); observer.observe(element); } group.add(surface); }
      const invalidate = (mask = 1) => {
        if (!surface.active || disposed) return false;
        if (!Number.isInteger(mask) || mask < 1 || mask > 0x7fffffff) throw new TypeError('Invalid display dirty mask.');
        if (surface.dirty) surface.coalesced++; surface.dirty |= mask; surface.requestedAt = now(); arm(); return true;
      };
      return Object.freeze({ invalidate,
        publish(value, identity = null, mask = 1) {
          if (!surface.active || disposed) return false;
          if (!value || typeof value !== 'object' || !Object.isFrozen(value) || identity != null && (typeof identity !== 'string' || identity.length > 256))
            throw new TypeError('Display publication requires a frozen snapshot and bounded identity.');
          surface.packet = Object.freeze({ revision: ++revision, submittedAt: now(), identity, value }); return invalidate(mask);
        },
        clearError() { surface.lastError = null; },
        dispose() {
          if (!surface.active) return; surface.active = false; surfaces.delete(id);
          const group = elements.get(element); if (group) { group.delete(surface); if (!group.size) { observer.unobserve(element); elements.delete(element); } }
          surface.packet = null; surface.read = surface.write = surface.onError = null; cancel(); arm();
        }
      });
    },
    diagnostics() {
      const ordered = Array.from(samples.subarray(0, sampleCount)).sort((left, right) => left - right);
      const quantile = q => ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * q))] : null;
      return Object.freeze({ schema: 'lemmings-instrument-display/v1', disposed, hidden: hidden(), registered: surfaces.size, maxSurfaces,
        pendingFrames: Number(frame != null), pendingTimers: Number(timer != null), totalFrames, measuredFrames: sampleCount, sampleCapacity,
        costMs: Object.freeze({ p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99) }),
        surfaces: Object.freeze([...surfaces.values()].map(surface => Object.freeze({ id: surface.id, dirty: surface.dirty, visible: visible(surface),
          writes: surface.writes, coalesced: surface.coalesced, skipped: surface.skipped, errors: surface.errors, lastError: surface.lastError, ageMs: surface.lastAgeMs }))) });
    },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      let nativeRetirement;
      return retirement.retire([{ name: 'native-display-sources', run: () => nativeRetirement = createProcgenRetirementScope().retire([
        { name: 'display-schedule', run: cancel }, { name: 'visibility-listener', run: () => document.removeEventListener?.('visibilitychange', visibility) },
        { name: 'visibility-observer', run: () => observer?.disconnect() }]) }, { name: 'display-mailboxes', run: () => { for (const surface of surfaces.values()) {
        surface.active = false; surface.packet = surface.read = surface.write = surface.onError = null;
      } surfaces.clear(); elements.clear(); } }, { name: 'display-reservation', run: () => {
        if (nativeRetirement?.outcome !== 'complete') throw new Error('Display sources have unresolved retirement.'); reservation.release();
      } }]);
    }
  });
}
