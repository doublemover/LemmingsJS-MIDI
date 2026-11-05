/** @typedef {{onEvent: (event: unknown) => boolean, getAutomationSpanState: (id: string, lane: number) => unknown}} WorkstationAdapter */

export function createMidiWorkstationAdapterOwner() {
  /** @type {Readonly<WorkstationAdapter> | null} */
  let binding = null;
  let disposed = false;
  return Object.freeze({
    /** @param {WorkstationAdapter} adapter */
    bind(adapter) {
      if (disposed) throw new Error('The preview router has retired.');
      if (binding) throw new Error('The preview router already has a workstation owner.');
      if (typeof adapter?.onEvent !== 'function' || typeof adapter?.getAutomationSpanState !== 'function') throw new TypeError('Invalid workstation router adapter.');
      const current = Object.freeze({ onEvent: adapter.onEvent, getAutomationSpanState: adapter.getAutomationSpanState }); binding = current;
      return Object.freeze({ release() { if (binding !== current) return false; binding = null; return true; } });
    },
    /** @param {unknown} event */
    handleEvent(event) { return binding?.onEvent(event) === true; },
    automationProvider: () => binding?.getAutomationSpanState || null,
    dispose() { if (disposed) return false; disposed = true; binding = null; return true; }
  });
}
