// Real browser surfaces require an explicit opt-in, regardless of device or width.
const resolveMidiAvailability = ({ windowRef = null } = {}) => {
  // Dependency-only controller fixtures have no browser navigation surface.
  if (!windowRef?.location) return true;
  const values = new URLSearchParams(windowRef.location.search || '').getAll('midi');
  return values.length === 1 && values[0] === '1';
};

const applyMidiAvailability = (documentRef, available) => {
  const opener = documentRef?.getElementById?.('midiWorkspaceToggle');
  if (opener) opener.hidden = !available;
  for (const id of ['midiAudioControls', 'midiOutputSummary']) { const element = documentRef?.getElementById?.(id); if (element) element.hidden = !available; }
  const eventList = documentRef?.getElementById?.('midiGameEventList');
  if (eventList?.parentElement) eventList.parentElement.hidden = !available;
  if (!available) {
    const head = documentRef?.getElementById?.('midiInstrumentHead'); if (head) head.hidden = true;
    const dock = documentRef?.getElementById?.('midiSkillEventDock'); if (dock) dock.hidden = true;
    const workspace = documentRef?.getElementById?.('midiSequencerWorkspace');
    if (workspace) workspace.hidden = true;
    documentRef?.body?.classList?.remove('studio-open');
  }
};

export { resolveMidiAvailability, applyMidiAvailability };
