import { MidiMapping } from '../MidiMapping.js';
import { MidiScheduler } from '../MidiScheduler.js';
import { midiEventRouterLifecycleMethods } from './MidiEventRouterLifecycleMethods.js';
import { midiEventRouterPlanningMethods } from './MidiEventRouterPlanningMethods.js';
import { midiEventRouterEventMethods } from './MidiEventRouterEventMethods.js';

class MidiEventRouter {
  constructor(mapping = null) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler = new MidiScheduler(this.mapping.config);
    this.soundBus = null;
    this.context = {};
    this._lastTickBySfx = new Map();
    this._tickCounter = { tick: null, count: 0 };
    this._clockBaseMs = null;
    this._clockFrameMs = null;
    this._clockSpeedFactor = null;
    this._lastAcceptedBySfx = new Map();
    this._arpStateBySfx = new Map();
    this._repeatHistoryByKey = new Map();
    this._singleNoteBuffer = [0];
    this._arpNotesScratch = [];
    this._arpPatternScratch = [];
    this._lastRateReport = null;
    this._boundOnEvent = this._onEvent.bind(this);
  }
}

Object.assign(
  MidiEventRouter.prototype,
  midiEventRouterLifecycleMethods,
  midiEventRouterPlanningMethods,
  midiEventRouterEventMethods
);

export { MidiEventRouter };
