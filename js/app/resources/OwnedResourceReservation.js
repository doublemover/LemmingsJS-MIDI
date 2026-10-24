const MAX_BYTES = 512 * 1048576;
const failure = message => Object.assign(new Error(message), { name: 'ResourceOwnershipError' });
const asFailure = error => error instanceof Error ? error : failure(String(error ?? 'Unknown resource ownership failure.'));

export function createOwnedResourceReservation({ budget = null, owner, kind, category = 'checkpoint', generation = 0, bytes = 4096, maxBytes = MAX_BYTES } = {}) {
  if (budget != null && (typeof budget.reserve !== 'function' || typeof budget.release !== 'function') || typeof owner !== 'string' || !owner || owner.length > 256 ||
      typeof kind !== 'string' || !kind || kind.length > 128 || typeof category !== 'string' || !category || category.length > 64 || !Number.isSafeInteger(generation) || generation < 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > MAX_BYTES || !Number.isSafeInteger(bytes) || bytes < 4096 || bytes > maxBytes)
    throw new TypeError('Invalid owned resource reservation.');
  const token = {}; let declaredBytes = 0, admitted = false, released = false, error = null, releaseAttempted = false;
  const receipt = () => Object.freeze({ enabled: !!budget, owner, kind, category, generation, declaredBytes, maxBytes,
    state: released ? 'released' : error ? 'failed-or-unknown' : 'reserved', error: error?.message || null });
  const resize = next => {
    if (released || releaseAttempted || error) throw error || failure('The reservation has retired.');
    if (!Number.isSafeInteger(next) || next < 4096 || next > maxBytes) throw new RangeError('Resource resize exceeds its declared bound.');
    if (admitted && next === declaredBytes) return receipt();
    try {
      const acknowledged = budget?.reserve({ token, owner, kind, category, generation, bytes: next, previousBytes: admitted ? declaredBytes : null,
        pinned: true, cache: false, reloadable: false });
      if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
        if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {});
        throw failure('Reservation resize did not acknowledge synchronously.');
      }
    } catch (caught) {
      if (caught?.name === 'ResourceBudgetError') throw caught;
      error = asFailure(caught); throw error;
    }
    admitted = true; declaredBytes = next; return receipt();
  };
  resize(bytes);
  return Object.freeze({ receipt, resize, isActive: () => admitted && !released && !error && !releaseAttempted,
    release() {
      if (released) return false; if (error) throw error; if (releaseAttempted) throw failure('Resource retirement is already pending.');
      releaseAttempted = true; error = failure('Resource retirement did not acknowledge.');
      try {
        const acknowledged = budget?.release({ token, owner });
        if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
          if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {}); throw error;
        }
      } catch (caught) { error = asFailure(caught); throw error; }
      released = true; error = null; return true;
    }
  });
}
