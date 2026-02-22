const makeChannel = (id, calls) => ({
  sendNoteOn(note, opts) { calls.push({ type: 'noteOn', id, note, opts }); },
  sendNoteOff(note, opts) { calls.push({ type: 'noteOff', id, note, opts }); },
  sendPitchBend(value, opts) { calls.push({ type: 'pitchBend', id, value, opts }); },
  sendControlChange(cc, value, opts) { calls.push({ type: 'cc', id, cc, value, opts }); },
  sendPitchBendRange(semitones, cents) { calls.push({ type: 'bendRange', id, semitones, cents }); },
  sendAllNotesOff() { calls.push({ type: 'allNotesOff', id }); }
});

const makeOutput = (ids, calls) => ({
  channels: Object.fromEntries(ids.map((id) => [id, makeChannel(id, calls)]))
});

export { makeChannel, makeOutput };
