export function createPhysicalJunctionView(options) {
  let view = null, loading = null, disposed = false, request = 0;
  return Object.freeze({ async open() {
    const serial = ++request, world = options.getRuntime?.()?.world;
    try {
      loading ||= import('./PhysicalJunctionControls.js');
      const { createPhysicalJunctionControls } = await loading;
      if (disposed || serial !== request) return false;
      if (!world || world !== options.getRuntime?.()?.world) throw new Error('The world changed. Open junction controls for the committed world.');
      view ||= createPhysicalJunctionControls(options); return view.open();
    } catch (error) { loading = null; if (!disposed && serial === request) options.onStatus?.(error.message); return false; }
  }, refresh() { view?.refresh(); }, suspend() { ++request; view?.suspend(); },
  dispose() { if (disposed) return; disposed = true; ++request; return view?.dispose(); } });
}
