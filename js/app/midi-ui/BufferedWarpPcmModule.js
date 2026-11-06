const modules = new WeakMap();
export function prepareWarpPcmModule(context) {
  if (!context?.audioWorklet?.addModule) throw new TypeError('Owned WarpVoice output requires AudioWorklet module loading.');
  let module = modules.get(context);
  if (!module) { module = context.audioWorklet.addModule(new URL('./worklet/BufferedWarpPcmProcessor.js', import.meta.url)); modules.set(context, module); module.catch(() => { if (modules.get(context) === module) modules.delete(context); }); }
  return module;
}
