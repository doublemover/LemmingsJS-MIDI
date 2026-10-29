export function requireSynchronousResourceAcknowledgement(value, label = 'Resource retirement') {
  if (value === false || value && typeof value.then === 'function') {
    if (value?.then) Promise.resolve(value).catch(() => {});
    throw Object.assign(new Error(`${label} did not acknowledge synchronously.`), { name: 'ResourceOwnershipError' });
  }
}
export function retireBackgroundResult(result) {
  if (!result) return;
  requireSynchronousResourceAcknowledgement(result.release(), 'Background result release');
  const state = result.retirementState?.();
  if (!state || !['released', 'canceled'].includes(state.phase)) throw Object.assign(new Error('Background result retirement is unresolved.'), { name: 'ResourceOwnershipError', retirementState: state || null });
}
export function resourceRetirementSummary(errors) {
  return Object.freeze({ status: errors.length ? 'unknown' : 'complete', failureCount: errors.length,
    failures: Object.freeze(errors.slice(0, 16).map(error => String(error?.message || error).slice(0, 240))) });
}
export async function awaitBackgroundFailureRetirement(error) {
  if (!error?.backgroundRetirementCompletion && !error?.backgroundRetirement) return;
  let state;
  try { state = await (error.backgroundRetirementCompletion || error.backgroundRetirement); }
  catch (cause) { throw Object.assign(new Error('Background producer retirement could not be confirmed.', { cause }), { name: 'ResourceOwnershipError' }); }
  if (!state || !['released', 'canceled'].includes(state.phase)) throw Object.assign(new Error('Background producer retirement is unresolved.', { cause: error }), { name: 'ResourceOwnershipError', retirementState: state || null });
}
