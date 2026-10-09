import { LemmingStateType } from '../lemmings/LemmingStateType.js';

const MAX_GAME_MUSIC_ACTOR_POSITIONS = 4096;
const failureStates = new Set([LemmingStateType.SPLATTING, LemmingStateType.EXPLODING,
  LemmingStateType.DROWNING, LemmingStateType.FRYING, LemmingStateType.OHNO]);
const count = value => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const clockTick = game => game?.gameTimer?.getGameTicks?.() ?? game?.gameTimer?.tickIndex;
const actionType = (manager, actor) => manager.actionTypeByAction?.get(actor.action) ?? manager.actions.indexOf(actor.action);
const liveActor = (manager, actor) => actor && !actor.removed && !actor.disabled && actor.action &&
  actor.action !== manager.actions[LemmingStateType.EXITING] && !failureStates.has(actionType(manager, actor));

/** One main-level lane, published after simulation work. Returned records are borrowed read-only snapshots. */
class GameMusicObservations {
  constructor({ maxActorPositions = MAX_GAME_MUSIC_ACTOR_POSITIONS } = {}) {
    this.maxActorPositions = Math.max(1, Math.min(MAX_GAME_MUSIC_ACTOR_POSITIONS, count(maxActorPositions) || MAX_GAME_MUSIC_ACTOR_POSITIONS));
    this.generation = 0; this.generationStartTick = 0; this.positions = new Map(); this.positionPool = [];
    this.signals = [{}, {}]; this.slot = 0; this.reset();
  }
  reset(game = null) {
    this.generation++; this.tick = null; this.signal = null;
    for (const [id, record] of this.positions) this._retirePosition(id, record);
    this.level = game?.level ?? null; this.manager = game?.lemmingManager ?? null; this.timer = game?.gameTimer ?? null;
    this.serial = 0; this.peakAlive = 0; this.bestDistance = 0; this.lastProgressTick = 0;
  }
  _retirePosition(id, record) {
    this.positions.delete(id); record.actor = null;
    if (this.positionPool.length < this.maxActorPositions) this.positionPool.push(record);
  }
  _available(game) {
    const manager = game?.lemmingManager;
    return game?.level && Array.isArray(manager?.activeLemmings) && Array.isArray(manager.actions) &&
      Number.isFinite(manager.spawnTotal) && Number.isFinite(game?.gameVictoryCondition?.getSurvivorsCount?.());
  }
  bind(game) { if (!this._sameSource(game)) this.reset(game); }
  _sameSource(game) { return this.level === game?.level && this.manager === game?.lemmingManager && this.timer === game?.gameTimer; }
  _readable(game) {
    const tick = clockTick(game);
    return this.signal && this._available(game) && this._sameSource(game) && !game?.timeTravel?.isReversing &&
      Number.isInteger(tick) && tick >= this.tick && tick <= this.tick + 1;
  }
  update(game) {
    const tick = clockTick(game), manager = game?.lemmingManager, victory = game?.gameVictoryCondition;
    if (!this._sameSource(game) || this.tick != null && (tick < this.tick || tick > this.tick + 1)) this.reset(game);
    if (!Number.isInteger(tick) || tick < 0 || !this._available(game)) {
      if (this.signal || this.positions.size) this.reset(game);
      return null;
    }
    if (game.timeTravel?.isReversing) { this.reset(game); return null; }
    const slot = 1 - this.slot, serial = ++this.serial;
    for (const [id, record] of this.positions) if (!liveActor(manager, record.actor) || manager.getLemming?.(id) !== record.actor) this._retirePosition(id, record);
    let alive = 0, active = 0, exiting = 0, dying = 0, lowest = null, maxX = 0;
    let buildingCount = 0, bashingCount = 0, floatingCount = 0;
    for (const actor of manager.activeLemmings) {
      if (!actor || actor.removed || !actor.action) continue;
      active++;
      const type = actionType(manager, actor);
      if (type === LemmingStateType.EXITING) { exiting++; continue; }
      if (!liveActor(manager, actor)) { dying++; continue; }
      alive++;
      if (Number.isInteger(actor.id) && actor.id >= 0 && (lowest == null || actor.id < lowest)) lowest = actor.id;
      if (Number.isFinite(actor.x)) maxX = Math.max(maxX, actor.x);
      if (type === LemmingStateType.BUILDING) buildingCount++;
      if (type === LemmingStateType.BASHING) bashingCount++;
      if (type === LemmingStateType.FLOATING) floatingCount++;
      if (!Number.isInteger(actor.id) || actor.id < 0 || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) continue;
      let record = this.positions.get(actor.id);
      if (!record) {
        if (this.positions.size >= this.maxActorPositions) continue;
        record = this.positionPool.pop() || { actor, positions: [{}, {}] }; this.positions.set(actor.id, record);
      }
      record.actor = actor;
      const position = record.positions[slot];
      position.x = actor.x; position.y = actor.y; position.tick = tick; position.generation = this.generation;
      record.serial = serial;
    }
    for (const [id, record] of this.positions) if (record.serial !== serial || !liveActor(manager, record.actor)) this._retirePosition(id, record);
    const saved = count(victory.getSurvivorsCount()), spawned = count(manager.spawnTotal);
    const successfulDepartures = Math.min(spawned, saved + exiting);
    this.peakAlive = Math.max(this.peakAlive, alive);
    if (maxX > this.bestDistance) { this.bestDistance = maxX; this.lastProgressTick = tick; }
    const signal = this.signals[slot];
    Object.assign(signal, { alive, active, spawned, saved, exiting, dying, dead: Math.max(0, spawned - active - saved),
      successfulDepartures, admitted: Math.max(0, spawned - successfulDepartures), peakAlive: this.peakAlive,
      lowestSurvivingActorId: lowest, maxX, bestDistance: this.bestDistance, previousDistance: 0,
      lastProgressTick: this.lastProgressTick, buildingCount, bashingCount, floatingCount,
      tick, generation: this.generation, source: 'game-completed-tick', positionCount: this.positions.size,
      positionsTruncated: alive > this.positions.size });
    this.tick = tick; this.slot = slot; this.signal = signal;
    return signal;
  }
  getSignals(game, lane = 0) { return lane === 0 && this._readable(game) ? this.signal : null; }
  getActorPosition(game, id, lane = 0) {
    if (lane !== 0 || !this._readable(game)) return null;
    const record = this.positions.get(id);
    if (!record || !liveActor(this.manager, record.actor) || this.manager.getLemming?.(id) !== record.actor) return null;
    return record.positions[this.slot];
  }
}
export { GameMusicObservations, MAX_GAME_MUSIC_ACTOR_POSITIONS };
