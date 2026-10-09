const STATE_LABELS = { exploration: 'Exploring', construction: 'Building', relief: 'Relief' };
const musicDirectionStatus = (recipe, direction) => {
  if (recipe !== 'scenes') return 'Event music';
  if (!direction?.enabled) return 'Scene replies · waiting for output';
  let text = STATE_LABELS[direction.current] || 'Exploring';
  if (STATE_LABELS[direction.pending]) text += ' · ' + STATE_LABELS[direction.pending] + ' next bar' + (Number.isFinite(direction.nextBar) ? ' ' + direction.nextBar : '');
  if (direction.cue === 'pending') text += ' · Breakthrough queued';
  else if (direction.cue === 'reply-pending') text += ' · Reply queued';
  else if (direction.cue === 'thinned') text += ' · Cue thinned';
  return text;
};

const createMidiMusicDirectionControls = ({ document, prefix, getProject, update, getRouter = () => null }) => {
  const select = document?.getElementById(prefix + 'Recipe'), status = document?.getElementById(prefix + 'Status');
  let disposed = false;
  const recipe = () => getProject()?.global?.musicDirector?.recipe === 'scenes' ? 'scenes' : 'events';
  const syncStatus = () => {
    if (disposed || !status) return;
    const choice = recipe(), direction = choice === 'scenes' ? getRouter()?.getMusicDirection?.() : null;
    const text = musicDirectionStatus(choice, direction);
    if (status.textContent !== text) status.textContent = text;
    if (status.title !== text) status.title = text;
  };
  const sync = (force = false) => {
    if (disposed) return;
    if (select && (force || document.activeElement !== select) && select.value !== recipe()) select.value = recipe();
    syncStatus();
  };
  const change = event => { if (disposed) return; update({ recipe: event.target.value === 'scenes' ? 'scenes' : 'events' }); sync(true); };
  select?.addEventListener('change', change); sync();
  return { sync, syncStatus, dispose() { disposed = true; select?.removeEventListener('change', change); } };
};
export { createMidiMusicDirectionControls, musicDirectionStatus };
