import { normalizeLaneHeight } from './ProcgenLaneGeometry.js';
import { SoundEventBus } from '../../game/SoundEvents.js';

// Shared actions report actual world coordinates; an event emitted during a
// boundary-crossing action must already identify its destination stripe.
class ProcgenSoundEventBus extends SoundEventBus {
  constructor(timer, laneCount, laneHeight = 96) { super(timer); this.laneCount = laneCount; this.laneHeight = normalizeLaneHeight(laneHeight); }
  emit(event) {
    if (event && event.laneIndex == null && Number.isFinite(event.y)) {
      event = { ...event, laneIndex: Math.max(0, Math.min(this.laneCount - 1, Math.floor(event.y / this.laneHeight))) };
    }
    return super.emit(event);
  }
}
export { ProcgenSoundEventBus };
