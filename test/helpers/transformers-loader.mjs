export async function resolve(specifier, context, defaultResolve) {
  if (specifier === '@xenova/transformers') {
    const source = `export async function pipeline(){return async () => ({ data: new Float32Array([0.1,0.2,0.3]) });}`;
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
