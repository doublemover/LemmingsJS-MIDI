const pending = new WeakMap();

export function loadDeferredWebMidi({ document, window }) {
  if (window.WebMidi) return Promise.resolve(window.WebMidi);
  if (pending.has(window)) return pending.get(window);
  const work = new Promise((resolve, reject) => {
    const script = document.createElement('script'); let timer, settled = false;
    const finish = error => {
      if (settled) return; settled = true;
      window.clearTimeout(timer); script.onload = script.onerror = null; script.remove();
      if (error) reject(error); else resolve(window.WebMidi);
    };
    script.src = new URL('../../vendor/webmidi.js', import.meta.url).href; script.async = true;
    script.onload = () => finish(window.WebMidi ? null : new Error('MIDI library did not initialize. Connect again to retry.'));
    script.onerror = () => finish(new Error('MIDI library could not load. Check the connection and retry.'));
    timer = window.setTimeout(() => finish(new Error('MIDI library loading timed out. Connect again to retry.')), 15000);
    try { document.head.append(script); } catch (error) { finish(error); }
  });
  pending.set(window, work);
  work.then(() => pending.delete(window), () => pending.delete(window));
  return work;
}
