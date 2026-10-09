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

/** One bounded observer projects admitted local voices onto event rows and selected cells. */
const createMidiEventPlayback = ({ document, window, getRows, getCellTarget }) => {
  const voices = new Map(), cellSlots = new Uint8Array(MAX_DISPLAY_VOICES);
  const now = () => window?.performance?.now?.() ?? globalThis.performance?.now?.() ?? Date.now();
  const syncCellTitle = target => {
    const pitches = [];
    for (const voice of voices.values()) if (voice.cellTarget === target && voice.cellNode?.isConnected) pitches.push(noteName(voice.event.note));
    if (target.dataset.playbackBaseTitle == null) target.dataset.playbackBaseTitle = target.title || '';
    target.title = target.dataset.playbackBaseTitle + (pitches.length ? ' | Admitted local voices: ' + pitches.join(', ') : '');
  };
  const removeCell = item => {
    const target = item.cellTarget; item.cellAnimation?.cancel?.(); item.cellNode?.remove?.(); item.cellAnimation = item.cellNode = item.cellTarget = null;
    if (target) syncCellTitle(target);
  };
  const remove = item => { item.animation?.cancel?.(); item.node?.remove?.(); removeCell(item); };
  const clear = () => { for (const item of voices.values()) remove(item); voices.clear(); };
  const animate = (node, event, envelope, width, finish) => {
    const duration = Math.max(1, envelope.endMs - envelope.startMs);
    const peak = Math.max(0.3, event.velocity / 127), reducedMotion = window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const frames = envelope.points.map(point => {
      const offset = clamp((point.time - event.startMs) / duration, 0, 1);
      return { transform: 'translateX(' + (reducedMotion ? 0 : width * offset) + 'px)', opacity: peak * point.level, offset };
    });
    const animation = node.animate?.(frames, { duration, delay: envelope.startMs - now(), fill: 'both', easing: 'linear' });
    if (animation) animation.onfinish = finish;
    return animation;
  };
  const noteNode = (event, className) => {
    const node = document.createElement('span'); node.className = className; node.textContent = noteName(event.note);
    node.setAttribute('aria-hidden', 'true'); node.title = noteName(event.note) + ' (' + event.note + ')';
    if (Number.isInteger(event.stepIndex) && Number.isInteger(event.stepCount) && event.stepIndex >= 0 && event.stepIndex < event.stepCount) {
      node.dataset.playbackCell = String(event.stepIndex); node.dataset.playbackCells = String(event.stepCount);
      node.title += ' | Cell ' + (event.stepIndex + 1) + ' of ' + event.stepCount + ' actually dispatched';
    }
    return node;
  };
  const finish = item => { remove(item); if (voices.get(item.key) === item) voices.delete(item.key); };
  const paintCell = (item, target = getCellTarget?.(item.event)) => {
    removeCell(item); if (!target) return;
    cellSlots.fill(0);
    for (const voice of voices.values()) if (voice.cellTarget === target && voice.cellNode?.isConnected) cellSlots[voice.cellSlot] = 1;
    let slot = 0; while (cellSlots[slot]) slot++;
    const node = noteNode(item.event, 'midi-dispatched-cell-note'); node.style.top = (2 + slot * 10) + 'px';
    node.dataset.playbackVoice = item.key; target.appendChild(node);
    item.cellNode = node; item.cellTarget = target; item.cellSlot = slot; syncCellTitle(target);
    item.cellAnimation = animate(node, item.event, getMidiEventPlaybackEnvelope(item.event), 0, () => finish(item));
  };
  const paint = item => {
    remove(item);
    const event = item.event, envelope = getMidiEventPlaybackEnvelope(event);
    item.displayEndMs = envelope.endMs;
    if (envelope.endMs <= now() || envelope.endMs <= envelope.startMs) return;
    const row = getRows().find(row => Number(row.dataset.gameEventId) === event.sfxId && !row.hidden);
    if (row) {
      const node = noteNode(event, 'midi-audible-note'); node.style.bottom = (2 + event.note % 12 * 0.6) + 'px';
      row.appendChild(node); item.node = node;
      const width = Math.max(0, (row.getBoundingClientRect?.().width || 160) - 28);
      item.animation = animate(node, event, envelope, width, () => finish(item));
    }
    paintCell(item);
  };
  return {
    onPlayback(event) {
      if (!Number.isFinite(event?.sfxId) || !Number.isInteger(event.note)) return;
      const key = event.owner + ':' + event.id, previous = voices.get(key);
      if (event.phase === 'end') { if (previous) remove(previous); voices.delete(key); return; }
      // Clearing a project/evicting a display voice must not resurrect it on a later release.
      if (event.phase === 'release' && !previous) return;
      if (previous) remove(previous);
      while (voices.size >= MAX_DISPLAY_VOICES && !voices.has(key)) { const [oldKey, oldest] = voices.entries().next().value; remove(oldest); voices.delete(oldKey); }
      const item = { key, event }; voices.set(key, item); paint(item);
    },
    render() {
      for (const [key, item] of voices) {
        if ((item.displayEndMs ?? item.event.endMs) <= now()) { remove(item); voices.delete(key); }
        else if (!item.node?.isConnected) paint(item);
        else {
          const target = getCellTarget?.(item.event);
          if (target !== item.cellTarget || target && !item.cellNode?.isConnected) paintCell(item, target);
        }
      }
    },
    clear, dispose: clear
  };
};

export { createMidiEventPlayback, getMidiEventPlaybackEnvelope };
