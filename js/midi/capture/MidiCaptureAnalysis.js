import { resolveScale } from '../midi-mapping/MidiMappingDomain.js';

const timeOf = record => Number.isFinite(record.scheduledMs) ? record.scheduledMs : record.dispatchMs;
const keyOf = record => `${record.captureScope || ''}/${record.outputScope || record.outputId || record.backend || 'output'}/${record.channel}/${record.note}`;
const lifecycleKey = record => String(record.captureScope || '') + '/' + String(record.outputScope || record.outputId || record.backend || '') + '/' + record.channel + '/' + record.note + '/' +
  (record.token != null ? 't' + record.token + '/' + record.requestId : 'v' + record.voiceId);
const round = value => Math.round(value * 1000) / 1000;
const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const histogram = map => [...map].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || Number(a.value) - Number(b.value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char]);

/** Demand-only objective inspection; values describe retained evidence, never acoustic quality. */
const analyzeMidiOutputCapture = snapshot => {
  const records = (snapshot?.records || []).slice(-32768);
  const lanes = new Map(), gates = new Map(), notes = [], collisions = [], orphanOffs = [], drops = new Map();
  const byLifecycle = new Map();
  let outsideScale = 0;
  let analysisTruncated = false;
  const apiTypes = new Map(), classes = new Map(), intervals = new Map(), rhythms = new Map(), coalescing = new Map();
  const scale = resolveScale(snapshot?.metadata?.scale || { name: 'chromatic', root: 0 });
  const laneFor = record => {
    const id = Number.isInteger(record.laneIndex) ? Math.max(0, Math.min(1023, record.laneIndex)) : 'unknown';
    if (!lanes.has(id)) lanes.set(id, { laneIndex: id, requestedEvents: 0, noteOns: 0, acceptedRequests: new Set(),
      requestedIds: new Set(), dropped: 0, notes: [], minNote: Infinity, maxNote: -Infinity });
    return lanes.get(id);
  };
  const close = (note, record, reason = 'note-off') => {
    note.endMs = Math.max(note.startMs, timeOf(record));
    note.durationMs = round(note.endMs - note.startMs);
    note.endReason = reason;
    note.endSeq = record.seq;
  };
  for (const record of [...records].sort((a, b) => timeOf(a) - timeOf(b) || a.seq - b.seq)) {
    if (record.stage === 'request') {
      const lane = laneFor(record); lane.requestedEvents += 1; lane.requestedIds.add(record.seq);
    }
    if (record.stage === 'drop' || record.stage === 'cancelled') {
      increment(drops, record.reason || record.stage); laneFor(record).dropped += 1;
    }
    if (record.stage === 'coalesced') coalescing.set(record.reason || 'coalesced', (coalescing.get(record.reason || 'coalesced') || 0) + (record.count || 1));
    if (record.stage !== 'api-dispatch' || record.accepted === false) continue;
    increment(apiTypes, record.type);
    const channelNotes = () => [...gates.values()].flat().filter(note => note.outputScope === record.outputScope && note.outputId === record.outputId && (record.channel == null || note.channel === record.channel));
    if (record.type === 'clear' || record.type === 'sendAllNotesOff' || (record.type === 'controlChange' && (record.cc === 120 || record.cc === 123))) {
      for (const note of channelNotes()) {
        close(note, record, record.reason || 'panic');
        const remaining = (gates.get(note.gateKey) || []).filter(entry => entry !== note);
        if (remaining.length) gates.set(note.gateKey, remaining); else gates.delete(note.gateKey);
      }
      continue;
    }
    if (record.type === 'programChange' || (record.type === 'controlChange' && [10, 74].includes(record.cc))) {
      const active = channelNotes().filter(note => note.startMs <= timeOf(record));
      if (active.length) collisions.push({ seq: record.seq, type: record.type, cc: record.cc, outputId: record.outputId,
        channel: record.channel, activeNotes: active.map(note => note.note), reason: record.reason || 'active-channel-change' });
    }
    if (record.type === 'noteOn') {
      const note = { ...record, startMs: timeOf(record), endMs: null, durationMs: null, gateKey: keyOf(record) };
      const gate = gates.get(note.gateKey) || []; gate.push(note); gates.set(note.gateKey, gate); notes.push(note);
      byLifecycle.set(lifecycleKey(note), note);
      if (gates.size > 512) { gates.delete(gates.keys().next().value); analysisTruncated = true; }
      if (gate.length > 32) { gate.shift(); analysisTruncated = true; }
      const lane = laneFor(record); lane.noteOns += 1; lane.notes.push(note);
      if (record.requestId != null) lane.acceptedRequests.add(record.requestId);
      lane.minNote = Math.min(lane.minNote, record.note); lane.maxNote = Math.max(lane.maxNote, record.note);
      if (!record.percussion && record.ensembleRole !== 'percussion' && record.channel !== 10) {
        const pitch = ((record.note % 12) + 12) % 12;
        increment(classes, pitch);
        const degrees = Array.isArray(record.scaleDegrees) ? record.scaleDegrees : scale.degrees;
        const root = Number.isFinite(record.scaleRoot) ? record.scaleRoot : scale.root;
        if (!degrees.includes(((pitch - root) % 12 + 12) % 12)) outsideScale += 1;
      }
    }
    if (record.type === 'noteOff') {
      const gate = gates.get(keyOf(record)) || [];
      const index = record.token != null ? gate.findIndex(note => note.token === record.token && (record.requestId == null || note.requestId === record.requestId))
        : record.voiceId != null ? gate.findIndex(note => note.voiceId === record.voiceId) : 0;
      if (index >= 0 && gate[index]) {
        const [note] = gate.splice(index, 1); close(note, record);
        if (!gate.length) gates.delete(keyOf(record));
      } else orphanOffs.push({ seq: record.seq, channel: record.channel, note: record.note });
    }
  }
  // Local cancellation/end evidence qualifies future API schedules without asserting audibility.
  for (const record of records.filter(entry => entry.stage === 'synth-end')) {
    const note = byLifecycle.get(lifecycleKey(record));
    if (note) { note.synthEndReason = record.reason; note.cancelledBeforeStart = record.reason !== 'source-ended' && record.dispatchMs < note.startMs; }
  }
  const timeline = [];
  for (const note of notes) {
    timeline.push({ time: note.startMs, seq: note.seq, delta: 1 });
    if (note.endMs != null) timeline.push({ time: note.endMs, seq: note.endSeq, delta: -1 });
  }
  timeline.sort((a, b) => a.time - b.time || a.seq - b.seq || a.delta - b.delta);
  let polyphony = 0, maxPolyphony = 0;
  for (const entry of timeline) { polyphony = Math.max(0, polyphony + entry.delta); maxPolyphony = Math.max(maxPolyphony, polyphony); }
  const firstMs = records.length ? Math.min(...records.map(record => record.dispatchMs)) : snapshot?.state?.startedMs || 0;
  const lastMs = records.length ? Math.max(...records.map(record => record.dispatchMs)) : firstMs;
  const elapsedSeconds = Math.max(0.001, (lastMs - firstMs) / 1000);
  const laneStats = [...lanes.values()].map(lane => {
    lane.notes.sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
    let repeatedPitch = 0;
    for (let index = 1; index < lane.notes.length; index += 1) {
      const previous = lane.notes[index - 1], note = lane.notes[index];
      increment(intervals, note.note - previous.note);
      increment(rhythms, Math.round(note.startMs - previous.startMs));
      if (note.note === previous.note) repeatedPitch += 1;
    }
    return { laneIndex: lane.laneIndex, requestedEvents: lane.requestedEvents, acceptedEvents: lane.acceptedRequests.size,
      noteOns: lane.noteOns, densityPerSecond: round(lane.noteOns / elapsedSeconds), dropped: lane.dropped,
      register: lane.noteOns ? [lane.minNote, lane.maxNote] : null, repeatedPitch,
      admissionRatio: lane.requestedEvents ? round(lane.acceptedRequests.size / lane.requestedEvents) : null };
  }).sort((a, b) => Number(a.laneIndex) - Number(b.laneIndex));
  const jitter = records.filter(record => record.stage === 'api-dispatch' && record.type === 'noteOn' && Number.isFinite(record.scheduledMs))
    .map(record => record.dispatchMs - record.scheduledMs);
  const demanded = laneStats.filter(lane => lane.requestedEvents > 0), heard = demanded.filter(lane => lane.noteOns > 0);
  const openNotes = [...gates.values()].flat().map(note => ({ channel: note.channel, note: note.note, token: note.token,
    requestId: note.requestId, held: note.held === true, laneIndex: note.laneIndex }));
  return { schemaVersion: 1, evidence: snapshot?.evidence, truncated: snapshot?.state?.truncated || 0,
    partialLifecycle: (snapshot?.state?.truncated || 0) > 0 || (snapshot?.state?.lifecycleTruncated || 0) > 0 || analysisTruncated, elapsedSeconds: round(elapsedSeconds), records: records.length,
    requests: records.filter(record => record.stage === 'request').length, scheduled: records.filter(record => record.stage === 'scheduled').length,
    apiMessages: histogram(apiTypes), noteOns: notes.length, synthSchedules: records.filter(record => record.stage === 'synth-scheduled').length,
    synthEnds: records.filter(record => record.stage === 'synth-end').length, renderSamples: records.filter(record => record.stage === 'synth-render-sample'),
    drops: histogram(drops), coalescing: histogram(coalescing), maxPolyphony, laneStats, pitchClasses: histogram(classes), outsideScale,
    melodicIntervals: histogram(intervals).slice(0, 16), onsetIntervalsMs: histogram(rhythms).slice(0, 16),
    apiDispatchJitterMs: jitter.length ? { min: round(Math.min(...jitter)), max: round(Math.max(...jitter)), mean: round(jitter.reduce((sum, value) => sum + value, 0) / jitter.length) } : null,
    fairness: { demandedLanes: demanded.length, heardLanes: heard.length, unheardLanes: demanded.filter(lane => !lane.noteOns).map(lane => lane.laneIndex) },
    activeChannelChangeCount: collisions.length, orphanReleaseCount: orphanOffs.length, openGateCount: openNotes.length,
    activeChannelChanges: collisions.slice(0, 128), orphanNoteOffs: orphanOffs.slice(0, 128), openNotes: openNotes.slice(0, 128),
    notes: notes.slice(0, 2048) };
};

const formatMidiCaptureSummary = snapshot => {
  const report = analyzeMidiOutputCapture(snapshot);
  const lines = ['MIDI output capture', snapshot?.evidence || '',
    `${report.records} retained records; ${report.truncated} overwritten. ${report.partialLifecycle ? 'Lifecycle checks are partial because capture or analysis limits were reached.' : 'No retained records were overwritten.'}`,
    `${report.requests} requests; ${report.scheduled} scheduled notes; ${report.noteOns} accepted note-on API calls; ${report.synthSchedules} local synth schedules; ${report.synthEnds} synth end callbacks.`,
    `Observed maximum scheduled polyphony: ${report.maxPolyphony}. Melodic notes outside selected scale: ${report.outsideScale}.`,
    `Demanded lanes with accepted note calls: ${report.fairness.heardLanes}/${report.fairness.demandedLanes}; active-channel program/pan/timbre changes: ${report.activeChannelChangeCount}; open note gates: ${report.openGateCount}.`,
    `Orphan note releases: ${report.orphanReleaseCount}; a capture started mid-note may observe a release whose note-on preceded this session.`,
    `API dispatch minus scheduled time: ${report.apiDispatchJitterMs ? JSON.stringify(report.apiDispatchJitterMs) + ' ms (negative means scheduled ahead)' : 'no timestamped note calls'}.`,
    `Drops/cancellations: ${report.drops.map(entry => entry.value + '=' + entry.count).join(', ') || 'none'}.`,
    `Controller coalescing: ${report.coalescing.map(entry => entry.value + '=' + entry.count).join(', ') || 'none'}.`,
    'Lane | requested events | accepted events | notes | density/s | register | drops'];
  for (const lane of report.laneStats.slice(0, 64)) lines.push(`${lane.laneIndex} | ${lane.requestedEvents} | ${lane.acceptedEvents} | ${lane.noteOns} | ${lane.densityPerSecond} | ${lane.register?.join('..') || '-'} | ${lane.dropped}`);
  if (report.laneStats.length > 64) lines.push(`Showing 64 of ${report.laneStats.length} lanes; structured analysis retains all bounded lane summaries.`);
  lines.push('Intervals, repetition and density are objective measurements. Musical quality and acoustic/physical receipt are not inferred.');
  return lines.join('\n') + '\n';
};

const renderMidiCaptureReport = snapshot => {
  const report = analyzeMidiOutputCapture(snapshot), notes = report.notes.filter(note => Number.isInteger(note.note) && note.note >= 0 && note.note <= 127).slice(0, 1024);
  const minMs = notes.length ? Math.min(...notes.map(note => note.startMs)) : 0;
  const maxMs = notes.length ? Math.max(...notes.map(note => note.endMs ?? note.startMs + 100)) : 1000;
  const minPitch = notes.length ? Math.max(0, Math.min(...notes.map(note => note.note)) - 2) : 48;
  const maxPitch = notes.length ? Math.min(127, Math.max(...notes.map(note => note.note)) + 2) : 84;
  const span = Math.max(1, maxMs - minMs), width = 1000, height = 246, pitchStep = 190 / Math.max(1, maxPitch - minPitch);
  const pitchY = pitch => 18 + (maxPitch - pitch) * pitchStep;
  const pitchLabel = pitch => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pitch % 12] + (Math.floor(pitch / 12) - 1);
  let grid = '';
  const pitchStride = Math.max(1, Math.ceil((maxPitch - minPitch) / 10));
  for (let pitch = minPitch; pitch <= maxPitch; pitch += pitchStride) {
    const y = round(pitchY(pitch));
    grid += `<line x1="48" x2="988" y1="${y}" y2="${y}" stroke="#e0e7ea"/><text x="3" y="${y + 4}" font-size="12">${pitchLabel(pitch)}</text>`;
  }
  for (let index = 0; index <= 4; index++) {
    const x = 48 + index * 235;
    grid += `<line x1="${x}" x2="${x}" y1="12" y2="214" stroke="#e0e7ea"/><text x="${Math.min(948, x)}" y="237" font-size="12">${round(span / 1000 * index / 4)}s</text>`;
  }
  const rectangles = notes.map(note => {
    const x = 48 + (note.startMs - minMs) / span * 940, y = pitchY(note.note);
    const w = Math.max(2, ((note.endMs ?? note.startMs + 100) - note.startMs) / span * 940);
    const h = Math.max(1.5, Math.min(8, pitchStep * 0.8));
    const title = `lane ${note.laneIndex ?? '?'} | ch ${note.channel} | ${pitchLabel(note.note)} (${note.note}) | velocity ${note.velocity ?? '?'} | ${note.durationMs ?? 'open'}ms | ${note.ensembleRole || note.eventType || 'note'}`;
    return `<rect x="${round(x)}" y="${round(y - h / 2)}" width="${round(w)}" height="${round(h)}" fill="${note.cancelledBeforeStart ? '#999' : `hsl(${(Number(note.laneIndex) || 0) * 61 % 360} 60% 42%)`}"><title>${escapeHtml(title)}</title></rect>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>MIDI capture inspection</title><style>body{font:14px system-ui;margin:12px;color:#17252a;background:#f5f7f8}svg{display:block;width:100%;height:210px;max-width:1200px;background:white;border:1px solid #b8c6cd}pre{white-space:pre-wrap;line-height:1.5}h1{font-size:1.25rem;margin:0 0 8px}p{font-size:12px;margin:8px 0}</style><h1>MIDI capture inspection</h1><p>Captured register and seconds from the first accepted note schedule. Grey marks were cancelled locally before their start. Up to 1,024 notes are drawn.</p><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Piano roll of captured API note schedules">${grid}${rectangles}</svg><pre>${escapeHtml(formatMidiCaptureSummary(snapshot))}</pre></html>`;
};

export { analyzeMidiOutputCapture, formatMidiCaptureSummary, renderMidiCaptureReport };
