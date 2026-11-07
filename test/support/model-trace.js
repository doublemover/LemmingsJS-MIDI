// Preconditions belong to the caller's replay, so invalid deletions never count
// as reproductions. Keep the same failure signature throughout minimization.
export async function shrinkModelTrace(trace, fails, { maximumAttempts = 128, checkBudget = () => {} } = {}) {
  if (!Array.isArray(trace) || typeof fails !== 'function' || !Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 4096) throw new TypeError('Invalid model trace shrinking inputs.');
  let result = trace.slice(), attempts = 0, width = Math.max(1, Math.floor(result.length / 2));
  while (width >= 1) {
    let changed = false;
    for (let start = 0; start < result.length && attempts < maximumAttempts; start += width) {
      checkBudget(); const candidate = result.slice(0, start).concat(result.slice(start + width)); attempts++;
      if (await fails(candidate)) { result = candidate; changed = true; break; }
    }
    if (attempts >= maximumAttempts) break; if (!changed) width = Math.floor(width / 2);
  }
  return { trace: result, attempts, exhausted: attempts >= maximumAttempts };
}
