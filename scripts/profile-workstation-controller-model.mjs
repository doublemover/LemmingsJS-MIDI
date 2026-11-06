import { runModelTraceCampaign } from './ModelTraceCampaign.js';
import { generateControllerTrace, replayControllerTrace } from '../test/support/workstation-controller-model.js';
await runModelTraceCampaign({ schema: 'workstation-controller-model-campaign/v2', failurePrefix: 'controller-model', entry: 'scripts/profile-workstation-controller-model.mjs',
  sourceEntries: ['test/support/workstation-controller-model.js'], defaultSteps: 48, maximumSteps: 128, maxSourceFiles: 2048,
  generate: generateControllerTrace, replay: replayControllerTrace, summarize: result => ({ completeInTrace: result.complete, publishedDocuments: result.documents, acceptedDocumentGenerations: result.generations, acceptedImports: result.acceptedImports }),
  scope: 'Actual workstation controller with explicit controlled view/storage/runtime adapters and independent document/history/save/transport reference. Covers held import reads and reversed completion, stale edited/imported/New/disposed owners, parse/read/restart/presentation refusal, captured finalizing writes, explicit pause, undo/redo and teardown; not native device, naming/quiescence, Thru/UMP/Active Sensing or exhaustive phase qualification.' });
