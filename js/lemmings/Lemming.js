import { transitionPhysicalFlight, endPhysicalFlight, publishObservedFlightBoundary } from '../actions/PhysicalFlightFacts.js';
import { LemmingStateType } from './LemmingStateType.js';
import { BaseLogger } from '../util/LogHandler.js';
import { SoundEventTypes, SoundEffectIds } from '../game/SoundEvents.js';
import { getRuntimeSoundEvents } from '../game/GameRuntime.js';
import { TriggerTypes } from '../level/TriggerTypes.js';

class Lemming extends BaseLogger {
  constructor(x = 0, y = 0, id, runtime = null) {
    super(undefined, true);
    this.runtime = runtime;
    this.reset(x, y, id);
  }

  setRuntime(runtime = null) {
    this.runtime = runtime;
  }

  /**
   * Reinitialize this instance so managers can reuse pooled objects.
   */
  reset(x = 0, y = 0, id) {
    if (this.runtime?.physicalFacts?.canMutate?.(this) === false) throw new Error('Physical actor reset requires a future command boundary.');
    if (this.id != null && !this._physicalTerminated) this.endPhysicalLifecycle('pooled-reset');
    const pendingPhysicalTransitions = this._physicalPendingTransitions;
    this.action?.spriteProvider?.resetActor?.(this);
    this.lookRight = true;
    this.frameIndex = 0;
    this.canClimb = false;
    this.hasParachute = false;
    this.removed = false;
    this.countdown = 0;
    this.action = 0;
    this.state = 0;
    this.hasExploded = false;
    this.disabled = false;
    this.lastTriggerType = null;
    this.countdownAction = null;
    this._activeIndex = -1;
    this.x = x;
    this.y = y;
    this.id = id;
    this.birthCohortId = null; this.crewOriginIds = []; this.crewOriginComplete = true;
    this._physicalFlightSerial = 0; this._physicalFlightState = null;
    this._physicalActionCycle = 0; this._physicalProcessingFrame = null;
    this._physicalActionSerial = 0;
    this._physicalCommandSerial = 0;
    this._physicalInterventionId = null;
    this._physicalWorkSerial = 0;
    this._physicalActionInstanceId = null;
    this._physicalActionPublished = false;
    this._physicalPendingTransitions = pendingPhysicalTransitions || null;
    this._physicalTerminated = false;
    this._physicalDirectionFactTick = -1;
    this._physicalContactSpan = null;
    this._physicalContactSerial = 0;
  }

  getDirection() {
    return this.lookRight ? 'right' : 'left';
  }

  onTrigger(_tick, walker, trigger) {
    const turns = walker && (trigger.type === TriggerTypes.BLOCKER_LEFT && walker.lookRight ||
      trigger.type === TriggerTypes.BLOCKER_RIGHT && !walker.lookRight);
    if (!turns || walker === this) return;
    const facts = this.runtime?.physicalFacts;
    if (facts?.enabled?.(walker) && facts?.enabled?.(this)) {
      const contactId = `${walker.id}:${this.id}:${_tick}:blocker`;
      walker._physicalPendingBlockerContact = { contactId, blockerId: this.id };
      facts.emit({ kind: 'ContactResolved', contactId, actorId: walker.id, otherActorId: this.id,
        actionInstanceId: walker._physicalActionInstanceId, otherActionInstanceId: this._physicalActionInstanceId,
        laneId: walker.laneIndex ?? null, otherLaneId: this.laneIndex ?? null, incomingDirection: walker.lookRight ? 'right' : 'left', triggerId: trigger.id ?? null, causeKind: 'blocker', participantRoles: { actor: 'walker', otherActor: 'blocker' },
        positionBefore: { x: walker.x, y: walker.y }, positionAfter: { x: walker.x, y: walker.y } });
    }
    const bus = getRuntimeSoundEvents(this.runtime);
    bus?.emitSfx?.(SoundEventTypes.BLOCKER_TURN, SoundEffectIds.BLOCKER_TURN,
      { lemmingId: walker.id, blockerId: this.id, x: walker.x, y: walker.y });
    bus?.emitSfx?.(SoundEventTypes.BLOCKER_CONTACT, SoundEffectIds.BLOCKER_CONTACT,
      { lemmingId: this.id, walkerId: walker.id, x: this.x, y: this.y });
  }

  getCountDownTime() {
    return (8 - (this.countdown >> 4));
  }

  setAction(action) {
    if (this.runtime?.physicalFacts?.canMutate?.(this) === false) throw new Error('Physical action mutations require a future command boundary.');
    this.endPhysicalContactSpan('action-change');
    const previousAction = this.action;
    const previousFrameIndex = this.frameIndex;
    previousAction?.spriteProvider?.resetActor?.(this);
    this.action = action;
    this._physicalActionCycle = 0; this._physicalProcessingFrame = null;
    this.frameIndex = 0;
    this.state = 0;
    action?.spriteProvider?.onActionChange?.(this, previousAction, previousFrameIndex);
    if (this.id != null) {
      if (previousAction && this._physicalActionPublished && this._physicalActionInstanceId) this._queuePhysicalTransition({ kind: 'ActionExited', actorId: this.id,
        laneId: this.laneIndex ?? null, action: previousAction.actionName || null, actionInstanceId: this._physicalActionInstanceId,
        positionBefore: { x: this.x, y: this.y }, terminationReason: 'action-change' });
      this._physicalActionInstanceId = action ? `${this.id}:action:${++this._physicalActionSerial}` : null;
      this._physicalActionPublished = !!action && this._queuePhysicalTransition({ kind: 'ActionEntered', actorId: this.id,
        laneId: this.laneIndex ?? null, action: action.actionName || null, actionInstanceId: this._physicalActionInstanceId,
        parentCauseIds: this._physicalInterventionId ? [this._physicalInterventionId] : [],
        positionAfter: { x: this.x, y: this.y } });
      transitionPhysicalFlight(this, previousAction, action);
    }
  }

  _queuePhysicalTransition(fact) {
    const facts = this.runtime?.physicalFacts;
    if (facts?.enabled?.(this)) { facts.emit(fact); return true; }
    if (facts?.observing?.(this)) { (this._physicalPendingTransitions ||= []).push(fact); return true; }
    return false;
  }

  flushPhysicalTransitions() {
    const facts = this.runtime?.physicalFacts;
    if (!facts?.enabled?.(this)) return;
    for (const fact of this._physicalPendingTransitions || []) facts.emit(fact);
    this._physicalPendingTransitions = null;
    if (!this._physicalTerminated && this.action && !this._physicalActionPublished) {
      this._physicalActionPublished = true;
      publishObservedFlightBoundary(this);
      facts.emit({ kind: 'ActionEntered', actorId: this.id, laneId: this.laneIndex ?? null,
        action: this.action.actionName || null, actionInstanceId: this._physicalActionInstanceId,
        positionAfter: { x: this.x, y: this.y } });
    }
  }

  endPhysicalLifecycle(reason = 'removed') {
    if (this.id == null || this._physicalTerminated) return;
    this.endPhysicalContactSpan(reason); endPhysicalFlight(this, reason);
    if (this.runtime?.physicalFacts?.enabled?.(this) || this.runtime?.physicalFacts?.observing?.(this)) {
      if (this.action && this._physicalActionPublished && this._physicalActionInstanceId) this._queuePhysicalTransition({ kind: 'ActionExited', actorId: this.id,
        laneId: this.laneIndex ?? null, action: this.action.actionName || null, actionInstanceId: this._physicalActionInstanceId,
        positionBefore: { x: this.x, y: this.y }, terminationReason: reason });
      this._queuePhysicalTransition({ kind: 'ActorTerminated', actorId: this.id, laneId: this.laneIndex ?? null,
        actionInstanceId: this._physicalActionInstanceId, positionBefore: { x: this.x, y: this.y }, terminationReason: reason });
    }
    this._physicalActionInstanceId = null;
    this._physicalActionPublished = false;
    this._physicalTerminated = true;
  }

  endPhysicalContactSpan(reason) {
    const span = this._physicalContactSpan;
    if (!span) return;
    this._queuePhysicalTransition({ kind: 'ContactSpanEnded', spanId: span.spanId, actorId: this.id,
      laneId: this.laneIndex ?? null, actionInstanceId: span.actionInstanceId,
      anchor: span.anchor, surfaceRevision: span.surfaceRevision, observedTick: span.lastObservedTick,
      reason, precision: 'tick' });
    this._physicalContactSpan = null;
  }

  setCountDown(action) {
    this.countdownAction = action;
    if (this.countdown > 0) return false;
    this.countdown = 80;
    return true;
  }

  getClickDistance(x, y) {
    let yCenter = this.y - 5;
    let xCenter = this.x;
    let x1 = xCenter - 5;
    let y1 = yCenter - 6;
    let x2 = xCenter + 5;
    let y2 = yCenter + 7;
    if ((x >= x1) && (x <= x2) && (y >= y1) && (y < y2)) {
      return ((yCenter - y) * (yCenter - y) + (xCenter - x) * (xCenter - x));
    }
    return -1;
  }

  render(gameDisplay) {
    if (!this.action) return;
    if (this.countdownAction !== null && this.countdownAction !== undefined) {
      this.countdownAction.draw(gameDisplay, this);
    }
    const previousScope = gameDisplay.beginActorAction?.(this);
    try {
      if (!this.action.spriteProvider?.drawCosmeticTransition?.(gameDisplay, this)) this.action.draw(gameDisplay, this);
    } finally { gameDisplay.endActorAction?.(previousScope); }
  }

  renderDebug(gameDisplay) {
    if (!this.action) return;
    gameDisplay.setDebugPixel(this.x, this.y);
  }

  process(level) {
    const lemX = this.x;
    const lemY = this.y;
    if ((lemX < 0) || (this.x >= level.width) || (this.y < 0) || (this.y >= level.height + 6)) {
      let newY = lemY;
      if (lemY >= level.height) {
        newY = level.height - 6;
      }
      const soundBus = getRuntimeSoundEvents(this.runtime);
      soundBus?.emitSfx?.(
        SoundEventTypes.LEMMING_FELL_OFF,
        SoundEffectIds.FELL_OFF,
        { lemmingId: this.id, x: lemX, y: newY }
      );
      return LemmingStateType.OUT_OF_LEVEL;
    }
    // run main action
    if (!this.action) {
      return LemmingStateType.OUT_OF_LEVEL;
    }
    // run secondary action
    if (this.countdownAction) {
      let newAction = this.countdownAction.process(level, this);
      if (newAction !== LemmingStateType.NO_STATE_TYPE) {
        return newAction;
      }
    }
    if (this.action) {
      const action = this.action, cycleLength = action.actionName === 'mining' ? 24 : ['building', 'bashing', 'digging'].includes(action.actionName) ? 16 : 0;
      this._physicalProcessingFrame = this.frameIndex;
      let returnedState;
      try { returnedState = action.process(level, this);
        if (cycleLength && this.action === action && this.frameIndex % cycleLength < this._physicalProcessingFrame % cycleLength) {
          this._physicalActionCycle++;
          this._queuePhysicalTransition({ kind: 'ActionCycleCompleted', actorId: this.id, laneId: this.laneIndex ?? null, action: action.actionName, actionInstanceId: this._physicalActionInstanceId, cycleOrdinal: this._physicalActionCycle, cycleLengthFrames: cycleLength, positionAfter: { x: this.x, y: this.y } });
        }
      } finally { this._physicalProcessingFrame = null; }
      return returnedState;
    }
    // prevent falling through function without returning a type
    this.log.log('lemming state falling through, fix it');
    return LemmingStateType.NO_STATE_TYPE;
  }

  disable() {
    if (this.runtime?.physicalFacts?.canMutate?.(this) === false) throw new Error('Physical actor mutation requires a future command boundary.');
    this.disabled = true;
  }

  remove() {
    if (this.runtime?.physicalFacts?.canMutate?.(this) === false) throw new Error('Physical actor removal requires a future command boundary.');
    this.endPhysicalLifecycle(this.terminalReason || 'removed');
    this.action?.spriteProvider?.resetActor?.(this);
    this.action = null;
    this.countdownAction = null;
    this.removed = true;
    this.hasExploded = false;
    this.id = null;
  }

  isDisabled() { return this.disabled; }
  isRemoved() { return this.action === null; }
}

Lemming.LEM_MIN_Y = -5;
Lemming.LEM_MAX_FALLING = 59;
export { Lemming };
