import { MidiAutomationSpans } from './MidiAutomationSpans.js';
import { midiEventRouterAutomationMethods } from './MidiEventRouterAutomationMethods.js';
import { MidiLaneMusicTension } from './MidiLaneMusicTension.js';
import { midiEventRouterTensionMethods } from './MidiEventRouterTensionMethods.js';
import { MidiMapping } from '../MidiMapping.js';
import { MidiScheduler } from '../MidiScheduler.js';
import { midiEventRouterLifecycleMethods } from './MidiEventRouterLifecycleMethods.js';
import { midiEventRouterPlanningMethods } from './MidiEventRouterPlanningMethods.js';
import { midiEventRouterEventMethods } from './MidiEventRouterEventMethods.js';
import { midiEventRouterPhraseMethods } from './MidiEventRouterPhraseMethods.js';

class MidiEventRouter {
  constructor(mapping = null) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler = new MidiScheduler(this.mapping.config);
    this.musicTension = new MidiLaneMusicTension(this.mapping.config?.ensemble?.tension);
    this._musicTensionWorld = null;
    this.automationSpans = new MidiAutomationSpans(this.mapping.config?.automationSpans);
    this._automationWorld = null; this._automationEventSerial = 0;
    this.soundBus = null;
    this.context = {};
    this._lastTickBySfx = new Map();
    this._tickCounter = { tick: null, count: 0 };
    this._tickLaneCounts = new Map();
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
    this._boundPhraseTick = this._advanceGamePhrases.bind(this);
    this._phraseTimer = null;
  }
}

Object.assign(
  MidiEventRouter.prototype,
  midiEventRouterLifecycleMethods,
  midiEventRouterTensionMethods,
  midiEventRouterAutomationMethods,
  midiEventRouterPlanningMethods,
  midiEventRouterPhraseMethods,
  midiEventRouterEventMethods
);

export { MidiEventRouter };
