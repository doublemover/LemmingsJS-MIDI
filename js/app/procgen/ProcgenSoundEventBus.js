import { SoundEventBus } from '../../game/SoundEvents.js';

// Shared actions report actual world coordinates; an event emitted during a
// boundary-crossing action must already identify its destination stripe.
class ProcgenSoundEventBus extends SoundEventBus {
  constructor(timer, laneCount) { super(timer); this.laneCount = laneCount; }
  emit(event) {
    if (event && event.laneIndex == null && Number.isFinite(event.y)) {
      event = { ...event, laneIndex: Math.max(0, Math.min(this.laneCount - 1, Math.floor(event.y / 96))) };
    }
    return super.emit(event);
  }
}
export { ProcgenSoundEventBus };
