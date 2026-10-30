const summaries = new WeakMap();
const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 240) : fallback;
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const freeze = value => Object.freeze(value);
const laneSummary = lanes => {
  if (!Array.isArray(lanes)) return freeze({ count: 0, muted: false, patterns: 0 });
  const cached = summaries.get(lanes); if (cached) return cached;
  const solo = lanes.some(lane => lane.solo && !lane.mute); let audible = 0, patterns = 0;
  for (const lane of lanes) if (!lane.mute && (!solo || lane.solo) && (lane.gain ?? 1) > 0) { audible++; if (lane.mode === 'pattern') patterns++; }
  const value = freeze({ count: lanes.length, muted: lanes.length > 0 && !audible, patterns }); summaries.set(lanes, value); return value;
};

export function createProcgenOperationalSnapshot({ simulation = {}, transport = {}, output = {}, midi = {}, physical = null, lanes = [], storage = {}, recovery = {}, stage = false, identity = '' } = {}) {
  if (typeof identity !== 'string' || identity.length > 1024) throw new Error('Invalid operational source identity.');
  const mix = laneSummary(lanes), hardware = output.selectedBackend === 'midi', audio = output.audio || {}, selectedId = output.selectedOutputId || output.outputId || null;
  const route = midi.outputRoutes?.find(route => route.outputId === selectedId), outputName = text(route?.name || output.outputName || output.selectedOutputName || selectedId, 'No destination selected');
  const simulationState = simulation.failure ? 'failed' : simulation.preparing ? 'preparing' : !simulation.available ? 'unavailable' : simulation.paused ? 'paused' : 'running';
  const clockState = transport.clockSource === 'external' ? transport.clockStatus || 'waiting' : 'internal';
  const routeState = !hardware ? 'not-selected' : output.enabled && route?.active ? 'active' : output.status === 'starting' ? 'preparing' : selectedId && (route?.available === false || output.failureKind === 'destination-missing') ? 'lost' :
    selectedId ? 'selected' : output.discoveredOutputCount > 0 ? 'discovered' : 'undiscovered';
  const contextState = text(audio.contextState, 'unreported'), permission = text(output.midiPermission, 'unknown');
  const sensing = midi.inputLiveness || {}, pressure = midi.pressure || null, blockers = [];
  const observationDomain = text(sensing.observationDomain, 'unreported'), lastTrafficTime = number(sensing.lastTrafficTime), reportedAt = number(transport.timestamp);
  const evidenceAgeMs = observationDomain === 'performance-now' && lastTrafficTime !== null && reportedAt !== null && reportedAt >= lastTrafficTime ? reportedAt - lastTrafficTime : null;
  const add = (priority, code, message, action = null) => blockers.push({ priority, code, message, action });
  if (storage.error) add(110, 'storage-error', 'Project save failed. The current edits remain unsaved.', ['export', 'Prepare a backup file']);
  if (recovery.state === 'unavailable' || recovery.error) add(105, 'recovery-error', 'Recovery could not be saved. Keep the current project open and prepare a backup.', ['export', 'Prepare a backup file']);
  if (hardware && route?.ownedVoiceAdmissionReady === false) add(103, 'owned-cleanup-unconfirmed', 'MIDI note admission is blocked: an owned release is unconfirmed.', ['inspect-midi', 'Review MIDI route']);
  if (clockState === 'lost' || transport.reason === 'clock-lost') add(100, 'clock-lost', 'External clock was lost. Transport remains stopped until an explicit Start or Continue.', ['inspect-clock', 'Review clock input']);
  if (simulationState === 'failed') add(99, 'world-failed', 'World preparation failed: ' + text(simulation.failure, 'The initial world is unavailable.'), simulation.canStartFresh ? ['startup-fresh', 'Start fresh session'] : null);
  if (routeState === 'lost') add(98, 'output-lost', 'The selected MIDI destination is unavailable: ' + outputName + '.', ['review-output', 'Review MIDI destination']);
  if (hardware && output.failureKind === 'api-send') add(96, 'midi-api-error', text(output.message, 'The MIDI output API rejected a send. Acoustic delivery is unverified.'), ['inspect-midi', 'Review MIDI output']);
  if (hardware && output.failureKind === 'permission-revoked') add(96, 'midi-permission-revoked', 'MIDI access was revoked. Discover again before explicitly reactivating the reviewed destination.', ['discover', 'Discover MIDI outputs']);
  if (simulationState === 'preparing') add(95, 'world-preparing', 'The next world is preparing. Output readiness is unchanged.');
  if (['expired', 'unavailable'].includes(sensing.mode) && midi.inputId) add(92, 'controller-observation', sensing.mode === 'expired' ?
    'Controller Active Sensing expired. Port connectivity and clock health are separate.' : 'Controller liveness is unavailable: ' + text(sensing.reason, 'the host cannot observe it') + '.', ['inspect-midi', 'Review controller input']);
  if ((output.performanceLease || audio.performanceLease)?.status === 'busy') add(98, 'performance-owned-elsewhere', 'Another tab owns performance output. Taking over stops and finalizes its owned performance first.',
    !hardware || permission === 'granted' && selectedId ? ['take-over-output', hardware ? 'Take over MIDI output' : 'Take over browser output'] : ['discover', 'Discover MIDI outputs']);
  if (!hardware && audio.status === 'resource-limited') add(90, 'audio-budget', text(audio.message, 'Browser audio resources are unavailable. Stop another workload and retry.'), ['listen', 'Retry browser audio']);
  else if (!hardware && (output.status === 'error' || audio.status === 'error') && !(contextState === 'suspended' && audio.status === 'interrupted')) add(88, 'audio-error', text(output.message || audio.message, 'Browser audio could not start.'), ['listen', 'Retry browser audio']);
  if (hardware && route?.configurationFailure || hardware && route?.activationFailure || hardware && route?.mpeReady === false) add(87, 'route-configuration',
    'MIDI setup is not admitted for ' + outputName + ': ' + text(route.configurationFailure || route.activationFailure, 'setup pending') + '.', ['inspect-midi', 'Review MIDI setup']);
  if (hardware && permission === 'denied') add(86, 'midi-permission-denied', 'MIDI permission was denied. Review browser permission before retrying.', ['discover', 'Retry MIDI discovery']);
  else if (hardware && permission === 'unavailable') add(86, 'midi-unavailable', 'Web MIDI is unavailable in this host. Choose another output backend.', ['review-backend', 'Review output backend']);
  else if (hardware && output.status === 'error' && !['destination-missing', 'api-send', 'permission-revoked'].includes(output.failureKind)) add(82, 'midi-access-error', text(output.message, 'MIDI access or activation failed.'), ['discover', 'Retry MIDI discovery']);
  else if (hardware && ['starting', 'discovering'].includes(output.status)) add(80, 'output-preparing', output.status === 'discovering' ? 'Discovering MIDI ports; no new destination is activated.' : 'Preparing the reviewed MIDI destination.');
  else if (hardware && !selectedId && permission === 'granted' && output.discoveredOutputCount === 0) add(78, 'midi-no-destinations', 'No MIDI outputs discovered. Connect a device and discover again.', ['discover', 'Discover MIDI outputs']);
  else if (hardware && !selectedId) add(78, 'midi-selection', output.discoveredOutputCount > 0 ? 'MIDI outputs are discovered. Choose a named destination before activation.' :
    'Discover MIDI outputs, then review a named destination. Discovery sends no notes.', output.discoveredOutputCount > 0 ? ['review-output', 'Choose MIDI destination'] : ['discover', 'Discover MIDI outputs']);
  else if (hardware && !output.enabled) add(75, 'midi-inactive', 'The reviewed MIDI destination is not activated: ' + outputName + '.', ['activate', 'Activate selected output']);
  if (!hardware && ['starting', 'unlocking'].includes(audio.status)) add(80, 'audio-preparing', 'Browser audio is preparing.');
  else if (!hardware && contextState === 'suspended') add(76, 'audio-suspended', 'Browser audio is suspended. A user gesture is needed to resume it.', ['listen', 'Resume browser audio']);
  else if (!hardware && !output.enabled) add(74, 'audio-off', 'Browser output is off. The world can run silently.', ['listen', 'Listen locally']);
  if (transport.clockSource === 'external' && ['waiting', 'stopped', 'unobserved'].includes(clockState)) add(70, 'clock-waiting', 'Waiting for external MIDI clock. No internal clock is substituted.', ['inspect-clock', 'Review clock input']);
  if (physical?.routingUnavailable && output.enabled) add(69, 'instrument-routing', 'An instrument route is unavailable. Review the source before playing.', ['inspect-physical', 'Review physical mappings']);
  else if (physical && !physical.prepared && output.enabled) add(68, 'instrument-preparing', 'Physical instruments are preparing. No readiness is inferred from the canvas.');
  if (mix.muted) add(65, 'lanes-muted', 'All eligible lane outputs are muted, solo-suppressed or at zero gain.', ['inspect-mix', 'Review lane mix']);
  if (pressure?.throttled) add(60, 'output-thinning', 'Output is being thinned: ' + text(pressure.reason, 'the admitted event budget is full') + '.', ['inspect-midi', 'Review output pressure']);
  if (output.enabled && transport.playing === false && transport.clockSource !== 'external') add(45, 'transport-paused', 'Musical transport is stopped. The world and output enable state are separate.', ['play', 'Play musical transport']);
  if (!blockers.length && output.enabled && physical && !mix.patterns && physical.accepted === 0 && physical.rejected === 0 && physical.degraded === 0)
    add(10, 'no-source-events', 'No eligible physical source event has been observed yet. No hidden test note is played.', recovery.lessonAvailable === true ? ['lesson', 'Open an isolated lesson'] : ['inspect-physical', 'Review physical mappings']);
  blockers.sort((left, right) => right.priority - left.priority);
  const blocker = blockers[0] || { code: 'ready', message: output.enabled ? 'Output admission is enabled. Waiting between events is normal; acoustic delivery is unverified.' : 'Output state is unavailable.', action: null };
  let action = blocker.action;
  if (stage && action && ['inspect-midi', 'inspect-clock', 'review-output', 'review-backend', 'inspect-physical', 'inspect-mix', 'lesson', 'activate', 'export', 'startup-fresh'].includes(action[0])) action = ['exit-stage', 'Exit Stage to review'];
  return freeze({ version: 1, identity, stage, nativeOutputActionAllowed: simulationState !== 'failed' && (!simulation.preparing || output.enabled) && (!hardware || permission !== 'unavailable') && (!stage || !hardware || output.enabled || !selectedId || action?.[0] === 'discover'),
    simulation: freeze({ state: simulationState, label: simulationState === 'preparing' ? 'World preparing' : simulationState === 'unavailable' ? 'World unavailable' : 'World ' + simulationState,
      requestedSpeed: number(simulation.requestedSpeed), achievedTicksPerSecond: number(simulation.achievedTicksPerSecond), tickDurationMs: number(simulation.tickDurationMs), measurementTime: number(simulation.measurementTime) }),
    transport: freeze({ state: transport.playing ? 'playing' : 'stopped', label: 'Music ' + (transport.playing ? 'playing' : 'stopped'), linked: transport.linked === true, bpm: number(transport.bpm), baseBpm: number(transport.baseBpm), gameSpeed: number(transport.gameSpeed), clockSource: text(transport.clockSource, 'unreported') }),
    audioContext: freeze({ state: hardware ? 'not-selected' : contextState, label: hardware ? 'Browser audio not selected' : 'Audio context ' + contextState }),
    localBackend: freeze({ state: hardware ? 'not-selected' : text(output.status, 'unreported'), enabled: !hardware && output.enabled === true }),
    noteOutput: freeze({ state: routeState, label: hardware ? outputName + ' · ' + routeState : 'Browser output ' + (output.enabled ? 'enabled' : 'off'), selectedId, activeId: output.enabled ? output.outputId || null : null, permission }),
    clockAuthority: freeze({ state: clockState, label: transport.clockSource === 'external' ? 'External clock · ' + clockState : 'Internal clock', inputId: midi.inputId || null, outputId: midi.clockOutputId || null }),
    controller: freeze({ connected: midi.inputPortConnected ?? null, liveness: text(sensing.mode, 'unobserved'), evidence: text(sensing.evidence, 'no observation supplied'),
      observationDomain, connectionEpoch: number(sensing.connectionEpoch), lastTrafficTime, deadline: number(sensing.deadline), evidenceAgeMs, bridge: 'not-reported' }),
    pressure: freeze({ throttled: pressure?.throttled === true, reason: text(pressure?.reason), dropped: number(pressure?.dropped) }),
    blockedReason: freeze({ code: blocker.code, message: text(blocker.message), severity: blocker.priority >= 85 ? 'error' : blocker.priority >= 60 ? 'warning' : 'info' }),
    recoveryAction: freeze({ id: action?.[0] || 'none', label: action?.[1] || '', enabled: !!action }),
    evidence: 'Read-only engine, transport and endpoint reports; no acoustic or controller-heartbeat inference.'
  });
}
