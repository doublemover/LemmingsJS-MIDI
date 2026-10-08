import { MIDI_BYTES_PER_SECOND } from './MidiSchedulerShared.js';
import { midiSchedulerChannelMethods } from './MidiSchedulerChannelMethods.js';
import { midiSchedulerRateMethods } from './MidiSchedulerRateMethods.js';
import { midiSchedulerSendMethods } from './MidiSchedulerSendMethods.js';
import { MidiGamePhraseQueue } from './MidiGamePhraseQueue.js';

class MidiScheduler {
  constructor(config = {}) {
    this.output = null;
    this._outputsById = new Map();
    this.tickMs = 60;
    this._activeByChannel = new Map();
    this._activeNotes = new Map();
    this._usedOutputChannels = new Map();
    this._expressionByOutput = new Map();
    this._pendingNoteOns = new Map();
    this.gamePhrases = new MidiGamePhraseQueue();
    this._maxActiveNotes = 32;
    this._memberChannels = [];
    this._noteOffs = [];
    this._noteOffTimerId = 0;
    this._noteOffSeq = 0;
    this._rateWindowMs = 1000;
    this._rateSent = [];
    this._ratePlanned = [];
    this._reservationSeq = 0;
    this._rateLaneActivity = new Map();
    this._rateLaneLastServed = new Map();
    this._rateLaneStartMs = null;
    this._rateLaneCount = 1;
    this._throttleState = { dropped: 0, lastDropMs: -Infinity, reason: null };
    this._maxMessagesPerSecond = 1000;
    this._maxBytesPerSecond = MIDI_BYTES_PER_SECOND;
    this._lastRateErrorMs = 0;
    this.setConfig(config);
  }
}

Object.assign(
  MidiScheduler.prototype,
  midiSchedulerChannelMethods,
  midiSchedulerRateMethods,
  midiSchedulerSendMethods
);

export { MidiScheduler };
