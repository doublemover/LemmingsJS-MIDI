const MAX_DISPLAY_VOICES = 64;
const noteName = note => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][note % 12] + (Math.floor(note / 12) - 1);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const getMidiEventPlaybackEnvelope = event => {
  const latency = Math.max(0, Number(event.mixLatencyMs) || 0), start = event.startMs;
  const attack = Math.max(0, Number(event.attackMs) || 0), decay = Math.max(0, Number(event.decayMs) || 0);
  const sustain = clamp(Number.isFinite(event.sustain) ? event.sustain : 1, 0, 1);
  const release = Math.max(0, Number.isFinite(event.releaseDurationMs) ? event.releaseDurationMs : event.endMs - event.releaseMs);
  const gate = Math.max(start, event.phase === 'start' && Number.isFinite(event.durationMs)
    ? Math.min(event.releaseMs, start + event.durationMs) : event.releaseMs);
  const end = Math.min(event.endMs, gate + release, sustain === 0 ? start + attack + decay : Infinity);
  const levelAt = elapsed => elapsed < attack ? elapsed / attack
    : decay > 0 && elapsed < attack + decay ? 1 - (1 - sustain) * (elapsed - attack) / decay : sustain;
  const points = [{ time: start, level: 0 }];
  if (attack > 0 && start + attack < gate && start + attack < end) points.push({ time: start + attack, level: 1 });
  if (decay > 0 && start + attack + decay < gate && start + attack + decay < end) points.push({ time: start + attack + decay, level: sustain });
  if (gate < end) points.push({ time: gate, level: event.phase === 'release' && Number.isFinite(event.releaseLevel)
    ? clamp(event.releaseLevel, 0, 1) : levelAt(gate - start) });
  points.push({ time: end, level: 0 });
  return { startMs: start + latency, endMs: end + latency, points };
};

/** Compositor animations follow successfully created local voices, with no frame loop. */
const createMidiEventPlayback = ({ document, window, getRows }) => {
  const voices = new Map();
  const now = () => window?.performance?.now?.() ?? globalThis.performance?.now?.() ?? Date.now();
  const remove = item => { item.animation?.cancel?.(); item.node?.remove?.(); };
  const paint = item => {
    remove(item);
    const event = item.event, current = now(), envelope = getMidiEventPlaybackEnvelope(event);
    item.displayEndMs = envelope.endMs;
    if (envelope.endMs <= current || envelope.endMs <= envelope.startMs) return;
    const row = getRows().find(row => Number(row.dataset.gameEventId) === event.sfxId && !row.hidden);
    if (!row) return;
    const node = document.createElement('span');
    node.className = 'midi-audible-note'; node.textContent = noteName(event.note);
    node.setAttribute('aria-hidden', 'true'); node.title = noteName(event.note) + ' (' + event.note + ')';
    if (Number.isInteger(event.stepIndex) && Number.isInteger(event.stepCount) && event.stepIndex >= 0 && event.stepIndex < event.stepCount) {
      node.dataset.playbackCell = String(event.stepIndex); node.dataset.playbackCells = String(event.stepCount);
      node.title += ' | Cell ' + (event.stepIndex + 1) + ' of ' + event.stepCount + ' actually dispatched';
    }
    node.style.bottom = (2 + event.note % 12 * 0.6) + 'px';
    row.appendChild(node); item.node = node;
    const duration = Math.max(1, envelope.endMs - envelope.startMs);
    const width = Math.max(0, (row.getBoundingClientRect?.().width || 160) - 28);
    const peak = Math.max(0.3, event.velocity / 127), reducedMotion = window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const frames = envelope.points.map(point => {
      const offset = clamp((point.time - event.startMs) / duration, 0, 1);
      return { transform: 'translateX(' + (reducedMotion ? 0 : width * offset) + 'px)', opacity: peak * point.level, offset };
    });
    if (node.animate) {
      item.animation = node.animate(frames, { duration, delay: envelope.startMs - current, fill: 'both', easing: 'linear' });
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
    render() { for (const [key, item] of voices) { if ((item.displayEndMs ?? item.event.endMs) <= now()) { remove(item); voices.delete(key); } else if (!item.node?.isConnected) paint(item); } },
    dispose() { for (const item of voices.values()) remove(item); voices.clear(); }
  };
};

export { createMidiEventPlayback, getMidiEventPlaybackEnvelope };
