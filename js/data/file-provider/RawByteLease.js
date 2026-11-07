export class RawByteLease {
  #adapter;
  #token = Object.freeze({});
  #owner;
  #generation;
  #bytes;
  #references = new Map();
  #initial = Symbol('acquisition');
  #retired = false;
  #onRelease;
  #onResize;

  constructor(adapter, { owner, generation, bytes, onRelease, onResize } = {}) {
    this.#adapter = adapter;
    this.#owner = owner;
    this.#generation = generation;
    this.#bytes = bytes;
    this.#onRelease = onRelease;
    this.#onResize = onResize;
    this.#references.set(this.#initial, 'pending');
    this.#publish(bytes);
  }

  get bytes() { return this.#bytes; }
  get references() { return this.#references.size; }
  get pinned() { return [...this.#references.values()].some(role => role !== 'cache'); }

  #publish(bytes) {
    const pinned = this.pinned;
    this.#adapter.reserve({ token: this.#token, owner: this.#owner, generation: this.#generation,
      category: 'asset', bytes, cache: !pinned, pinned, reloadable: !pinned });
  }

  resize(bytes) {
    if (this.#retired) throw new Error('Raw byte lease has retired');
    this.#publish(bytes);
    this.#bytes = bytes;
    this.#onResize?.(this);
  }

  acquire(role = 'consumer') {
    if (this.#retired) throw new Error('Raw byte lease has retired');
    const token = Symbol(role);
    this.#references.set(token, role);
    try { this.#publish(this.#bytes); }
    catch (error) { this.#references.delete(token); throw error; }
    let released = false;
    return Object.freeze({
      release: () => { if (!released) { released = true; this.#release(token); } },
      setRole: next => {
        if (released) return;
        this.#references.set(token, next);
        try { this.#publish(this.#bytes); } catch { /* Keep the existing charge during service retirement. */ }
      }
    });
  }

  release() { this.#release(this.#initial); }

  #release(token) {
    if (!this.#references.delete(token)) return;
    if (!this.#references.size) {
      this.#retired = true;
      this.#adapter.release({ token: this.#token, owner: this.#owner });
      this.#onRelease?.(this);
    } else {
      try { this.#publish(this.#bytes); } catch { /* References still own these charged bytes. */ }
    }
  }
}
