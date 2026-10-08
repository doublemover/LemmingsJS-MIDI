const MAX_DISPLAY_VOICES = 64;
const noteName = note => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][note % 12] + (Math.floor(note / 12) - 1);

/** Compositor animations follow successfully created local voices, with no frame loop. */
const createMidiEventPlayback = ({ document, window, getRows }) => {
  const voices = new Map();
  const now = () => window?.performance?.now?.() ?? globalThis.performance?.now?.() ?? Date.now();
  const remove = item => { item.animation?.cancel?.(); item.node?.remove?.(); };
  const paint = item => {
    remove(item);
    const event = item.event, current = now();
    if (event.endMs <= current) return;
    const row = getRows().find(row => Number(row.dataset.gameEventId) === event.sfxId && !row.hidden);
    if (!row) return;
    const node = document.createElement('span');
    node.className = 'midi-audible-note'; node.textContent = noteName(event.note);
    node.setAttribute('aria-hidden', 'true'); node.title = noteName(event.note) + ' (' + event.note + ')';
    node.style.bottom = (2 + event.note % 12 * 0.6) + 'px';
    row.appendChild(node); item.node = node;
    const gate = Number.isFinite(event.durationMs) && event.phase === 'start'
      ? Math.min(event.endMs, event.startMs + event.durationMs) : event.releaseMs;
    const end = Math.min(event.endMs, gate + 40), duration = Math.max(1, end - event.startMs);
    const width = Math.max(0, (row.getBoundingClientRect?.().width || 160) - 28);
    const peak = Math.max(0.3, event.velocity / 127);
    const frames = [
      { transform: 'translateX(0px)', opacity: 0, offset: 0 },
      { transform: 'translateX(' + width * Math.min(1, event.attackMs / duration) + 'px)', opacity: peak, offset: Math.min(1, event.attackMs / duration) },
      { transform: 'translateX(' + width * Math.max(0, Math.min(1, (gate - event.startMs) / duration)) + 'px)', opacity: peak * event.sustain, offset: Math.max(0, Math.min(1, (gate - event.startMs) / duration)) },
      { transform: 'translateX(' + width + 'px)', opacity: 0, offset: 1 }
    ].sort((a, b) => a.offset - b.offset);
    if (node.animate && !window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      item.animation = node.animate(frames, { duration, delay: event.startMs - current, fill: 'both', easing: 'linear' });
      item.animation.onfinish = () => { remove(item); if (voices.get(item.key) === item) voices.delete(item.key); };
    }
  };
  return {
    onPlayback(event) {
      if (!Number.isFinite(event?.sfxId) || !Number.isInteger(event.note)) return;
      const key = event.owner + ':' + event.id;
      const previous = voices.get(key);
      if (event.phase === 'end') { if (previous) remove(previous); voices.delete(key); return; }
      if (previous) remove(previous);
      while (voices.size >= MAX_DISPLAY_VOICES && !voices.has(key)) { const [oldKey, oldest] = voices.entries().next().value; remove(oldest); voices.delete(oldKey); }
      const item = { key, event }; voices.set(key, item); paint(item);
    },
    render() { for (const [key, item] of voices) { if (item.event.endMs <= now()) { remove(item); voices.delete(key); } else if (!item.node?.isConnected) paint(item); } },
    dispose() { for (const item of voices.values()) remove(item); voices.clear(); }
  };
};

export { createMidiEventPlayback };
