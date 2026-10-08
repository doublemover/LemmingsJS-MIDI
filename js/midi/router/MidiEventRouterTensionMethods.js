const midiEventRouterTensionMethods = {
  getLaneMusicTension(lane = 0) { return this.musicTension.snapshot(lane); },
  _synchronizeMusicTension(tick) {
    const world = this.context?.game;
    if (typeof world?.getLaneMusicSignals !== 'function') return null;
    if (world !== this._musicTensionWorld) { if (this._musicTensionWorld) this._releaseTensionVoices(); this.musicTension.reset(); this._musicTensionWorld = world; }
    if (this.musicTension.synchronize(world.generation ?? 0, tick)) this._releaseTensionVoices();
    return world;
  },
  _releaseTensionVoices(lane = null, soloActorId = null) {
    if (!this.scheduler?._activeNotes?.[Symbol.iterator]) return;
    for (const [token, voice] of this.scheduler._activeNotes) if (voice.ensembleRole &&
      (lane == null || voice.laneIndex === lane) && (soloActorId == null || voice.lemmingId !== soloActorId)) this.scheduler._stopActiveNoteToken(token);
  },
  _updateMusicTension(tick) {
    const world = this._synchronizeMusicTension(tick);
    if (!world || !this.mapping.config?.enabled || !this.musicTension.config.enabled || !this.mapping.config?.ensemble?.enabled) return;
    if (world.timeTravel?.isReversing) { this.musicTension.reset(); this._releaseTensionVoices(); return; }
    for (let lane = 0; lane < Math.min(1024, world.laneCount || 1); lane += 1) {
      const previous = this.musicTension.lanes[lane];
      const wasSolo = previous?.strength >= 0.999999, previousActor = previous?.soloActorId;
      const state = this.musicTension.updateLane(lane, world.getLaneMusicSignals(lane), tick);
      if (state?.strength >= 0.999999 && (!wasSolo || previousActor !== state.soloActorId)) this._releaseTensionVoices(lane, state.soloActorId);
    }
  },
  _applyMusicTension(spec, meta, tick) {
    if (!spec.ensembleRole || !this.musicTension.config.enabled || !this.musicTension.config.amount) return spec;
    if (!this._synchronizeMusicTension(tick)) return spec;
    const { spec: result, state } = this.musicTension.decision(spec, meta, tick);
    if (state && this.scheduler._captureEnabled?.()) Object.assign(meta, { tensionStrength: state.strength, tensionReason: state.reason, soloActorId: state.soloActorId });
    if (!result && this.scheduler._captureEnabled?.()) this.scheduler._observe?.('drop', { ...meta, type: 'note', reason: 'musical-tension' });
    return result;
  }
};
export { midiEventRouterTensionMethods };
