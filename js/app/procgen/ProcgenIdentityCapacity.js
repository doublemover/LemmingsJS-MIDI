// MAX_SAFE_INTEGER is reserved as an exhausted frontier: checkpoint admission
// rejects that sentinel, and no live producer may publish it.
export const LAST_PROCGEN_IDENTITY = Number.MAX_SAFE_INTEGER - 1;
export function assertProcgenIdentityCapacity(value, successors, domain) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(successors) || successors < 0 ||
      value > LAST_PROCGEN_IDENTITY - successors) throw new RangeError(domain + ' identity exhausted.');
}
