export function createLazyWorkstationToolGate({ getIdentity, getInteraction = () => ({}), onError = () => {} } = {}) {
  if (typeof getIdentity !== 'function' || typeof getInteraction !== 'function' || typeof onError !== 'function') throw new TypeError('Lazy tools require the current workstation and interaction owners.');
  let serial = 0, disposed = false;
  return Object.freeze({
    async open(name, load, apply) {
      if (disposed) return false;
      if (typeof name !== 'string' || !name || name.length > 128 || typeof load !== 'function' || typeof apply !== 'function') throw new TypeError('Choose a bounded tool and its literal module loader.');
      const request = ++serial; let identity, interaction;
      try {
        identity = getIdentity(); interaction = getInteraction();
        const module = await load();
        if (disposed || request !== serial || identity !== getIdentity()) return false;
        const current = getInteraction();
        if (current.hidden || current.dialog && current.dialog !== interaction.dialog ||
            interaction.focus?.isConnected !== false && current.focus && interaction.focus && current.focus !== interaction.focus && current.focus !== current.body) return false;
        return apply(module);
      } catch (error) {
        let current = false; try { current = identity === getIdentity(); } catch { /* A retired context cannot own status. */ }
        if (!disposed && request === serial && current) try { onError(name, error); } catch { /* Status cannot publish a view. */ }
        return false;
      }
    },
    cancel() { serial++; },
    dispose() { disposed = true; serial++; }
  });
}
