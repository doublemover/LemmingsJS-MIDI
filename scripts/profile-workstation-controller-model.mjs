import { runModelTraceCampaign } from './ModelTraceCampaign.js';
import { generateControllerTrace, replayControllerTrace } from '../test/support/workstation-controller-model.js';
await runModelTraceCampaign({ schema: 'workstation-controller-model-campaign/v1', failurePrefix: 'controller-model', entry: 'scripts/profile-workstation-controller-model.mjs',
  sourceEntries: ['test/support/workstation-controller-model.js'], defaultSteps: 48, maximumSteps: 128, maxSourceFiles: 2048,
  generate: generateControllerTrace, replay: replayControllerTrace, summarize: result => ({ completeInTrace: result.complete, publishedDocuments: result.documents, acceptedDocumentGenerations: result.generations }),
  scope: 'Actual workstation controller with explicit controlled view/storage/runtime adapters and independent document/history/save/transport reference. Covers captured finalizing writes, successful/refused/committed-presentation-error replacement, explicit pause, undo/redo and teardown; not native device, import, Thru/UMP/Active Sensing or exhaustive phase qualification.' });
