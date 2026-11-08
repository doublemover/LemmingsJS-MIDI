import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { createInstrumentDisplayScheduler } from '../resources/InstrumentDisplayScheduler.js';

export function createPrelistenMonitor({ document, audio, home, displayScheduler = null, onStatus = () => {} } = {}) {
  if (!document?.createElement || !audio?.getMonitorRouteState || !audio?.getAuditionState || !home) throw new TypeError('Invalid shared prelisten monitor.');
  const retirement = createProcgenRetirementScope(), listeners = []; let disposed = false, operation = 0, preparing = 0;
  const scheduler = displayScheduler || createInstrumentDisplayScheduler({ document });
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const rail = node('section'); rail.className = 'studio-prelisten'; rail.setAttribute('aria-label', 'PRELISTEN monitor');
  const title = node('strong', 'PRELISTEN'), source = node('output'), route = node('output'), notice = node('output');
  source.setAttribute('aria-label', 'Prelisten source'); route.setAttribute('aria-label', 'Prelisten route'); notice.setAttribute('role', 'status');
  const actions = node('div'); actions.className = 'studio-sound-actions';
  const report = text => { if (!disposed) { notice.textContent = text; onStatus(text); } };
  const run = action => async () => {
    const serial = ++operation; preparing++; render();
    try { await action(); if (!disposed && serial === operation) report(audio.getMonitorRouteState().message); }
    catch (error) { if (!disposed && serial === operation) report(error.message); }
    finally { preparing--; render(); }
  };
  const button = (label, callback) => { const value = node('button', label); value.type = 'button'; value.addEventListener('click', callback);
    listeners.push(() => value.removeEventListener('click', callback)); actions.append(value); return value; };
  const enable = button('Enable prelisten audio', run(() => audio.enable()));
  const separate = button('Choose separate cue device', run(() => audio.prepareCueRoute({ mode: 'separate-device' })));
  const rehearsal = button('Rehearsal on live output', run(() => audio.prepareCueRoute({ mode: 'rehearsal' })));
  const stop = button('Stop preview', () => { audio.stopCue(); render(); });
  const reveal = button('Show source', () => audio.revealAuditionSource());
  const gain = node('input'); gain.type = 'range'; gain.min = '0'; gain.max = '100'; gain.step = '1'; gain.value = '50'; gain.setAttribute('aria-label', 'Prelisten gain');
  const onGain = () => audio.setCueGain(Number(gain.value) / 100); gain.addEventListener('input', onGain); listeners.push(() => gain.removeEventListener('input', onGain));
  const render = () => {
    if (disposed) return;
    const audioState = audio.getState(), routing = audioState.monitorRoute || audio.getMonitorRouteState(), audition = audioState.audition || audio.getAuditionState(), current = audition.foreground, workload = audioState.workload;
    source.textContent = current ? `${current.source.name} · ${current.source.kind} · revision ${current.source.revision} · ${current.state}` : 'No foreground source';
    const mode = routing.mode === 'rehearsal' ? 'Rehearsal on live output' : routing.mode === 'separate-device' ? 'Selected separate device' : 'Route not selected';
    route.textContent = `${mode} · ${routing.state} · ${routing.muted ? 'muted' : 'route open'} · master capture: ${routing.cueIncludedInMasterCapture ? 'included' : 'cue excluded'}` +
      (routing.mode === 'separate-device' ? ' · asynchronous buffering · physical isolation unverified' : '') +
      (workload ? ` · cue quota ${workload.cueVoices}, live quota ${workload.liveVoices}` : '');
    enable.disabled = !!audioState.enabled || !!preparing;
    separate.disabled = !audioState.enabled || preparing > 1 || routing.capabilities?.separateDevice === false;
    rehearsal.disabled = preparing > 1 || audition.unresolvedOwnership;
    stop.disabled = !audition.active && routing.muted; reveal.disabled = !audition.active || !current?.canRevealSource;
    gain.disabled = routing.mode === 'muted'; gain.value = String(Math.round(routing.cueGain * 100));
  };
  const surface = scheduler.register({ id: 'prelisten-monitor', element: rail, intervalMs: 50, write: render, onError: report });
  const unhook = audio.subscribe(() => surface.invalidate()); rail.append(title, source, route, gain, actions, notice); home.append(rail); render();
  return Object.freeze({ mount(parent) { if (!disposed && parent) { parent.append(rail); render(); } },
    mountHome() { if (!disposed) home.append(rail); }, state: () => ({ route: audio.getMonitorRouteState(), audition: audio.getAuditionState() }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; operation++;
      return retirement.retire([{ name: 'prelisten-stop', run: () => audio.stopCue() }, { name: 'audio-subscription', run: unhook },
        { name: 'monitor-mailbox', run: () => surface.dispose() }, { name: 'monitor-scheduler', run: () => { if (!displayScheduler) return scheduler.dispose(); } },
        ...listeners.map((remove, index) => ({ name: 'monitor-listener-' + index, run: remove })), { name: 'monitor-surface', run: () => rail.remove() }]); }
  });
}
