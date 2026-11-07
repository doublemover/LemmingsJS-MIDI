import { runModelTraceCampaign } from './ModelTraceCampaign.js';
import { generateInputRecordingTrace, replayInputRecordingTrace } from '../test/support/midi-input-recording-model.js';
await runModelTraceCampaign({ schema: 'midi-input-recording-model-campaign/v1', failurePrefix: 'input-model', entry: 'scripts/profile-midi-input-recording-model.mjs',
  sourceEntries: ['test/support/midi-input-recording-model.js'], fixtures: ['test/fixtures/midi-input-callback-ownership.json'], defaultSteps: 128, maximumSteps: 256,
  generate: generateInputRecordingTrace, replay: replayInputRecordingTrace, summarize: result => ({ completeInTrace: result.complete, retainedEvents: result.retainedEvents, callbacks: result.callbacks }),
  scope: 'Actual MIDI ports and recording owners, independent input/recording/source automaton, injected clock and synchronous callback boundaries. MIDI1 notes/CC, no Thru/hardware/UMP/active-sensing timing or full document replacement qualification.' });
