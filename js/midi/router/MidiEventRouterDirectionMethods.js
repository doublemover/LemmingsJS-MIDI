import { MidiMusicDirector } from './MidiMusicDirector.js';
import { getMidiMusicalPosition } from '../project/MidiMusicalPosition.js';
import { applyMidiEnsembleRoleToSpec } from '../project/MidiEnsemble.js';
import { MidiMapping } from '../MidiMapping.js';
import { buildMidiClipCell, buildMidiClipPhrase, flattenMidiClipPhrase } from '../project/MidiClipPlayback.js';
import { SoundEffectIds } from '../../game/SoundEvents.js';
const midiEventRouterDirectionMethods = {
  _directionPosition(tick) {
    return getMidiMusicalPosition(this.mapping.config.timing, tick, (this._phraseTimer || this.context?.game?.getGameTimer?.())?.TIME_PER_FRAME_MS || 60, this.context?.game?.generationStartTick || 0);
  },
  _releaseMusicDirection() {
    for (const key of this._directionKeys || []) this.scheduler.cancelGamePhrase?.(key);
    this._directionKeys?.clear();
    if (this.musicDirector) { this.musicDirector.reset(); this.musicDirector = null; }
  },
  _syncMusicDirection(tick) {
    if (this.mapping.config?.musicDirector?.recipe !== 'scenes' || !this.mapping.config.enabled || !this.scheduler.hasAnyOutput?.() ||
        !Number.isInteger(tick) || this.context?.game?.timeTravel?.isReversing) {
      if (this.musicDirector) { this._releaseMusicDirection(); this.musicDirector = null; }
      return null;
    }
    this.musicDirector ||= new MidiMusicDirector(); this._directionKeys ||= new Set();
    const world = this.context.game, timing = this.mapping.config.timing;
    const clock = JSON.stringify([timing.bpmBase, timing.timeSignature, world?.generationStartTick || 0]);
    if (this.musicDirector.bind(world, tick, this.scheduler.gamePhrases.epoch, clock)) {
      for (const key of this._directionKeys) this.scheduler.cancelGamePhrase?.(key);
      this._directionKeys.clear();
    }
    return this.musicDirector;
  },
  getMusicDirection() {
    return this.musicDirector?.snapshot(this._directionPosition(this._phraseTimer?.getGameTicks?.())) ||
      { enabled: false, current: 'exploration', pending: null, nextBar: null, cue: 'idle' };
  },
  _applyMusicDirection(spec, tick) { return spec && this.musicDirector ? this.musicDirector.apply(spec, this._directionPosition(tick)) : spec; },
  _queueMusicDirectionEvent(event, spec, meta) {
    if (event.sfxId !== SoundEffectIds.PROCGEN_ROUTE_COMPLETE || this.mapping.config?.musicDirector?.recipe !== 'scenes') return false;
    const director = this._syncMusicDirection(event.tick);
    if (director) {
      const project = this.context.game?.lanePolicy?.projects?.lanes?.[event.laneIndex ?? 0]?.projects?.find(project => project.id === event.crewProjectId);
      if (project?.phase === 'complete' && project.generation === event.generation && project.ownerId === event.lemmingId &&
          Array.isArray(project.tiles) && project.tiles.length <= 8 && director.request(event, spec, meta, this._directionPosition(event.tick))) {
        // Completed projects leave active admission lists; this bounded completion
        // reference retains the real proof through its short musical lifetime.
        director.cues.get(event.laneIndex ?? 0).routeProject = project;
      }
    }
    return true;
  },
  _musicCueRelevant(cue) {
    const world = this.context.game;
    if (!world || world.generation !== cue.generation || world.timeTravel?.isReversing || world._manualNukeLanes?.[cue.lane] || world.stall && world.stall.phase !== 'running') return false;
    const project = cue.routeProject;
    return project?.phase === 'complete' && project.generation === cue.generation && Array.isArray(project.tiles) && project.tiles.length <= 8 &&
      project.tiles.every(([key, revision]) => world.getTerrainTileRevision(key) === revision);
  },
  _musicDirectionCells(cue, phase, position) {
    const config = this.mapping.config, source = this.mapping.getSfxConfig(cue.event.sfxId);
    if (!source) return [];
    const ensemble = config.ensemble, automatic = ensemble?.enabled && source.trackId === ensemble.sourceTrackId;
    if (phase === 'reply' && !automatic) return [];
    const roles = automatic ? ensemble.roles.filter(role => !role.disabled && role.track && !role.percussion) : [];
    const lead = roles.find(role => role.id === 'melody') || roles[0];
    const role = phase === 'lead' ? lead : roles.find(role => role !== lead && role.id === 'bass') || roles.find(role => role !== lead);
    if (automatic && (!role || phase === 'reply' && role === lead)) return [];
    const mapping = automatic ? new MidiMapping({ ...config, ensemble: { ...ensemble, enabled: false } }) : this.mapping;
    const map = step => {
      const spec = mapping.mapEvent(cue.event, {}, 0, { ...source, ...step, notes: step?.note == null ? source.notes : null, phrase: null, arp: null });
      return spec && automatic ? applyMidiEnsembleRoleToSpec(spec, role, config, source, cue.event) : spec;
    };
    const base = map({}); if (!base) return [];
    let entries;
    if (source.clipSequence?.steps?.length) {
      const sequence = source.clipSequence, key = this._resolveArpKey(cue.event, source);
      if (phase === 'lead') {
        const previous = this._arpStateBySfx.get(key), count = previous?.seqKey === sequence.id ? previous.index : 0;
        const completedPasses = previous?.seqKey === sequence.id ? previous.completedPasses || 0 : 0;
        cue.clipCounts = { event: count + 1, pass: sequence.advance === 'event' ? Math.floor(count / sequence.steps.length) + 1 : sequence.passCounter === 'completed' ? completedPasses + 1 : count + 1 };
        this._storeArpState(key, { index: count + 1, seqKey: sequence.id, completedPasses, advance: sequence.advance });
        if (sequence.advance !== 'event') cue.clipCompletion = { key, id: sequence.id };
      }
      const count = cue.clipCounts, mapStep = step => map({ note: step.note, velocity: step.velocity, durationTicks: step.durationTicks });
      const cells = sequence.advance === 'event'
        ? [buildMidiClipCell(sequence, sequence.steps[(count.event - 1) % sequence.steps.length], count.event, count.pass, mapStep, position.bar)]
        : buildMidiClipPhrase(sequence, count.event, count.pass, mapStep, position.bar);
      const expanded = flattenMidiClipPhrase(cells, source.clipSequence.spacingTicks);
      if (phase === 'lead') cue.clipEnd = expanded.completionTicks;
      entries = expanded.entries.filter(entry => Number.isFinite(entry.note)).slice(0, 4);
    } else {
      const pitches = (base.notes || [base.note]).filter(Number.isFinite).slice(0, 4);
      entries = pitches.map((note, index) => ({ ...base, note, offsetTicks: Math.round(index * position.ticksPerQuarter / 2) }));
    }
    if (phase === 'reply') entries = entries.slice(0, 2).reverse().map((entry, index) => ({ ...entry, offsetTicks: Math.round(index * position.ticksPerQuarter / 2) }));
    const maximumOffset = position.quartersPerBar * position.ticksPerQuarter * 0.75;
    const voices = entries.filter(entry => entry.offsetTicks <= maximumOffset).map(entry => ({ ...entry, notes: null, arp: null, phrase: null,
      musicDirectionCue: true, velocity: Math.max(1, Math.round(entry.velocity * (phase === 'reply' ? 0.7 : 0.85))) }));
    if (phase === 'lead' && Number.isFinite(cue.clipEnd) && voices.length) voices.push({ note: null, offsetTicks: cue.clipEnd });
    return voices.length ? [{ voices }] : [];
  },
  _advanceMusicDirection(tick) {
    const director = this._syncMusicDirection(tick); if (!director) return;
    const position = this._directionPosition(tick), world = this.context.game;
    let working = false;
    if (typeof world?.getLaneMusicSignals === 'function') for (let lane = 0; lane < Math.min(1024, world.laneCount || 1); lane++) {
      const signal = world.getLaneMusicSignals(lane);
      if (signal && (signal.buildingCount > 0 || signal.bashingCount > 0 || signal.diggingCount > 0 || signal.miningCount > 0)) { working = true; break; }
    }
    director.observe(position, working);
    const queue = this.scheduler.gamePhrases, ready = director.ready(position, cue => this._musicCueRelevant(cue), key => queue.voices.has(key));
    if (ready?.cancel) {
      for (const key of this._directionKeys) this.scheduler.cancelGamePhrase?.(key);
      this._directionKeys.clear(); director.foreground = null; director.cueStatus = director.cues.size ? 'pending' : 'idle'; return;
    }
    if (!ready?.cue) return;
    const cells = this._musicDirectionCells(ready.cue, ready.phase, position);
    let ordinary = 0; for (const voice of queue.voices.values()) if (!voice.rolling) ordinary++;
    if (!cells.length || ordinary >= 16) { director.cueStatus = 'thinned'; director.foreground = null; return; }
    if (ready.phase === 'lead') { for (const key of this._directionKeys) this.scheduler.cancelGamePhrase?.(key); this._directionKeys.clear(); }
    const key = JSON.stringify(['music-direction', ready.cue.generation, ready.cue.lane, ready.cue.id, ready.phase]);
    director.started(ready.cue, ready.phase, key, position); this._directionKeys.add(key);
    queue.replaceSteps(key, cells, { ...ready.cue.meta, musicCueId: ready.cue.id }, tick, 1, () => {
      if (ready.phase === 'lead' && ready.cue.clipCompletion) {
        const completion = ready.cue.clipCompletion, state = this._arpStateBySfx.get(completion.key);
        if (state?.seqKey === completion.id) state.completedPasses++;
      }
      director.completed(key);
    });
  }
};
export { midiEventRouterDirectionMethods };
