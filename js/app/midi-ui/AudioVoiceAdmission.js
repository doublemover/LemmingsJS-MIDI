export function workloadVoiceCount(owner, voices = this._voices) {
  const workload = this._workloadClass(owner); let count = 0;
  for (const voice of voices) if ((voice.workloadClass || 'live') === workload) count += voice.renderCost || 1;
  return count;
}

export function inspectVoiceInterval(owner, { start, end, releaseAt, cost = 1, overrides = null, patchVoices = null, patchLimit = null } = {}) {
  if (!this._intervalAdmission) return Object.freeze({ accepted: false, reason: 'interval-owner-unavailable' });
  const workload = this._workloadClass(owner), limit = workload === 'cue' ? this._maxCueCostUnits : this._maxVoices;
  const sourceLimit = workload === 'cue' ? this._maxCueScheduledVoices : this._maxLiveScheduledVoices;
  if (this._workloadVoiceCount(owner) + cost > sourceLimit) return Object.freeze({ accepted: false, reason: 'workload-source-reservations' });
  if (workload === 'cue') {
    const logical = this._intervalAdmission.inspect({ voices: this._voices, first: start, last: Math.max(start, releaseAt), cost: 1, limit: this._maxCueVoices, mode: 'gate', semantic: true, workload, overrides });
    if (!logical.accepted) return logical;
  }
  const gate = this._intervalAdmission.inspect({ voices: this._voices, first: start, last: Math.max(start, releaseAt), cost, limit, mode: 'gate', workload, overrides });
  if (!gate.accepted) return gate;
  const sources = this._intervalAdmission.inspect({ voices: this._voices, first: start, last: end, cost, limit: this._maxScheduledVoices, overrides });
  if (!sources.accepted) return sources;
  if (patchVoices && patchLimit != null) return this._intervalAdmission.inspect({ voices: patchVoices, first: start, last: Math.max(start, releaseAt), cost: 1,
    limit: patchLimit, mode: 'gate', semantic: true, overrides });
  return gate;
}

export function inspectVoiceExtensions(changes, { patchVoices = null, patchLimit = null } = {}) {
  if (!this._intervalAdmission) return Object.freeze({ accepted: false, reason: 'interval-owner-unavailable' });
  const first = this._context.currentTime, workloads = new Set(); let last = first;
  for (const [voice, interval] of changes) {
    if (!this._voices.has(voice) || !Number.isFinite(interval.end) || !Number.isFinite(interval.releaseAt) || interval.end < voice.start ||
        interval.releaseAt < voice.start || interval.releaseAt > interval.end) return Object.freeze({ accepted: false, reason: 'invalid-extended-interval' });
    last = Math.max(last, voice.end, interval.end); workloads.add(voice.workloadClass || 'live');
  }
  if (last === first) return Object.freeze({ accepted: true, reason: null });
  for (const workload of workloads) {
    if (workload === 'cue') {
      const logical = this._intervalAdmission.inspect({ voices: this._voices, first, last, cost: 0, limit: this._maxCueVoices, mode: 'gate', semantic: true, workload, overrides: changes });
      if (!logical.accepted) return logical;
    }
    const gate = this._intervalAdmission.inspect({ voices: this._voices, first, last, cost: 0, limit: workload === 'cue' ? this._maxCueCostUnits : this._maxVoices,
      mode: 'gate', workload, overrides: changes });
    if (!gate.accepted) return gate;
  }
  const sources = this._intervalAdmission.inspect({ voices: this._voices, first, last, cost: 0, limit: this._maxScheduledVoices, overrides: changes });
  if (!sources.accepted) return sources;
  if (patchVoices && patchLimit != null) return this._intervalAdmission.inspect({ voices: patchVoices, first, last, cost: 0, limit: patchLimit,
    mode: 'gate', semantic: true, overrides: changes });
  return sources;
}
