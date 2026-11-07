const entries = new Map();
let next = null, lastFrame = -1, spent = false;

export function claimOwnedStateCopy(operation, audioFrame, blockFrames) {
  let entry = entries.get(operation);
  if (!entry) {
    entry = { operation, seen: audioFrame, next: null, previous: null };
    if (next) {
      entry.previous = next.previous; entry.next = next;
      next.previous.next = entry; next.previous = entry;
    } else { entry.next = entry.previous = entry; next = entry; }
    entries.set(operation, entry);
  }
  entry.seen = audioFrame;
  if (audioFrame !== lastFrame) { lastFrame = audioFrame; spent = false; }
  if (spent) return false;
  const staleBefore = audioFrame - Math.max(1, blockFrames) * 3;
  for (let remaining = entries.size; next !== entry && next.seen < staleBefore && remaining > 0; remaining--) next = next.next;
  if (next !== entry) return false;
  spent = true; next = entry.next; return true;
}

export function releaseOwnedStateCopy(operation) {
  const entry = entries.get(operation);
  if (!entry) return false;
  if (entry.next === entry) next = null;
  else {
    entry.previous.next = entry.next; entry.next.previous = entry.previous;
    if (next === entry) next = entry.next;
  }
  entries.delete(operation); return true;
}
