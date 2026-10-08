const createMidiTensionControls = ({ document, prefix, getProject, update, getRouter = () => null, getLaneCount = () => 1 }) => {
  const byId = suffix => document?.getElementById(prefix + suffix), listeners = [];
  const fields = [['Amount', 'amount', 100], ['Healthy', 'healthyPopulation', 1], ['Fade', 'fadeTicks', 0.06],
    ['Establish', 'healthyTicks', 0.06], ['Collapse', 'collapseRatio', 100], ['Recovery', 'recoveryRatio', 100],
    ['Breakthrough', 'breakthroughPixels', 1], ['Hold', 'breakthroughHoldTicks', 0.06]];
  const listen = (element, handler) => { if (element) { element.addEventListener('change', handler); listeners.push([element, handler]); } };
  const setValue = (element, value, force = false) => { if (element && (force || document.activeElement !== element)) element.value = String(value); };
  const syncStatus = () => {
    const status = byId('Status'); if (!status) return;
    const ensemble = getProject()?.ensemble, lane = Math.max(0, Math.min(getLaneCount() - 1, Math.trunc(Number(byId('Lane')?.value) || 1) - 1));
    const state = getRouter()?.getLaneMusicTension?.(lane);
    let text = 'Bypassed';
    if (ensemble?.enabled && ensemble.tension?.enabled && ensemble.tension.amount > 0) {
      if (!state) text = 'Waiting for completed crew observations';
      else {
        const phase = state.established ? state.reason.replaceAll('-', ' ') : 'crew developing';
        text = 'Lane ' + (lane + 1) + ' · ' + state.alive + ' alive · ' + Math.round(state.strength * 100) + '% thinned · ' + phase;
        if (state.strength > 0 && state.soloActorId != null) text += ' · lead voice actor ' + state.soloActorId;
      }
    }
    if (status.textContent !== text) status.textContent = text;
  };
  const sync = (force = false) => {
    const ensemble = getProject()?.ensemble, settings = ensemble?.tension;
    const host = byId('Fields'); if (host) host.hidden = !ensemble;
    if (byId('Enabled')) byId('Enabled').checked = !!settings?.enabled;
    for (const [suffix, key, scale] of fields) setValue(byId(suffix), Math.round((settings?.[key] || 0) * scale * 100) / 100, force);
    if (byId('Lane')) { byId('Lane').max = String(getLaneCount()); setValue(byId('Lane'), Math.max(1, Math.min(getLaneCount(), Number(byId('Lane').value) || 1)), force); }
    syncStatus();
  };
  listen(byId('Enabled'), event => { update({ enabled: !!event.target.checked }); sync(true); });
  for (const [suffix, key, scale] of fields) listen(byId(suffix), event => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) update({ [key]: value / scale });
    sync(true);
  });
  listen(byId('Lane'), syncStatus);
  return { sync, syncStatus, dispose() { for (const [element, handler] of listeners) element.removeEventListener('change', handler); } };
};
export { createMidiTensionControls };
