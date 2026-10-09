const TARGET_LABELS = { note: 'Pitch offset', velocity: 'Velocity', pan: 'Pan', duration: 'Gate duration',
  attack: 'Attack strength', decay: 'Attack reduction', sustain: 'Gate length multiplier', release: 'Note-off velocity multiplier' };
const getMidiAutomationTargetInfo = (target, backend = 'none', timbreCc = 74) => {
  const cc = Number.isFinite(Number(timbreCc)) ? Math.max(0, Math.min(127, Math.round(Number(timbreCc)))) : 74;
  const local = backend === 'synth' || backend === 'both', external = backend === 'midi' || backend === 'both';
  if (target === 'timbre') {
    const supported = { 7: 'channel volume', 10: 'channel pan', 11: 'channel expression', 120: 'channel voice clearing', 123: 'channel voice clearing' }[cc];
    const effect = local ? supported ? 'Browser synth uses this controller for ' + supported + ', not tone brightness.' : 'Browser synth ignores CC' + cc + '; it does not change tone brightness.' :
      external ? 'Sends CC' + cc + ' to the selected MIDI destination; its response depends on the device.' : 'Sends CC' + cc + ' on admitted notes. Browser synth ignores the default CC74; MIDI device response varies.';
    return { label: 'Timbre CC' + cc + (local && !supported ? ' (ignored by synth)' : external ? ' (device-dependent)' : ''),
      help: effect + (local && external ? ' MIDI device response is separate and device-dependent.' : '') };
  }
  if (target === 'release') return { label: TARGET_LABELS.release, help: 'Scales MIDI note-off velocity, not envelope release time. ' +
    (local ? 'Forward browser-synth playback ignores note-off velocity.' : external ? 'The selected MIDI device may respond to note-off velocity.' : 'Browser synth ignores forward note-off velocity; MIDI device response varies.') +
    ' Reverse playback can use it as note-on strength.' };
  const help = { note: 'Offsets admitted notes while keeping melodic pitches inside the selected scale and register.',
    velocity: 'Changes note-on strength within the configured velocity range.', pan: 'Changes admitted-note pan; local note routing preserves independent voices.',
    duration: 'Changes the owned note gate length in simulation ticks.', attack: 'Multiplies note-on velocity; this legacy target does not change synth attack time.',
    decay: 'Reduces note-on velocity; this legacy target does not change synth decay time.', sustain: 'Multiplies gate duration; this legacy target does not change synth sustain level.' }[target];
  return { label: TARGET_LABELS[target] || target, help: help || 'Select a target to see its actual output behavior.' };
};
const updateMidiAutomationTargetSelect = (select, backend, timbreCc) => {
  for (const option of select?.children || []) if (option.value) {
    const info = getMidiAutomationTargetInfo(option.value, backend, timbreCc); option.textContent = info.label; option.title = info.help;
  }
  const help = select?.value ? getMidiAutomationTargetInfo(select.value, backend, timbreCc).help : 'Selected spans have different targets.';
  if (select) select.title = help;
  return help;
};
export { getMidiAutomationTargetInfo, updateMidiAutomationTargetSelect };
