// Device identity deliberately does not depend on the responsive layout width.
const resolveMidiAvailability = ({ windowRef = null, navigatorRef = windowRef?.navigator } = {}) => {
  const nav = navigatorRef || {};
  const mobile = nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (!mobile) return true;
  const values = new URLSearchParams(windowRef?.location?.search || '').getAll('midi');
  return values.length === 1 && values[0] === '1';
};

const applyMidiAvailability = (documentRef, available) => {
  const opener = documentRef?.getElementById?.('midiWorkspaceToggle');
  if (opener) opener.hidden = !available;
  if (!available) {
    const workspace = documentRef?.getElementById?.('midiSequencerWorkspace');
    if (workspace) workspace.hidden = true;
    documentRef?.body?.classList?.remove('studio-open');
  }
};

export { resolveMidiAvailability, applyMidiAvailability };
