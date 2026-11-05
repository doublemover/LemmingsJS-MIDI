import { runModelTraceCampaign } from './ModelTraceCampaign.js';
import { generateAcquisitionTrace, replayAcquisitionTrace } from '../test/support/asset-acquisition-model.js';
await runModelTraceCampaign({ schema: 'asset-acquisition-model-campaign/v1', failurePrefix: 'acquisition-model', entry: 'scripts/profile-asset-acquisition-model.mjs',
  sourceEntries: ['test/support/asset-acquisition-model.js'], fixtures: ['test/fixtures/asset-acquisition-request-epoch.json'], defaultSteps: 64, maximumSteps: 256,
  generate: generateAcquisitionTrace, replay: replayAcquisitionTrace, summarize: result => ({ completeInTrace: result.complete, sourceCount: result.sourceCount }),
  scope: 'Actual FileProvider/RawAssetHandle/BinaryReader/RawByteLease owners, controlled XHR and inline digest adapter, separate serial reference. Persistent cache, browser transport and background-worker admission are separate qualifications.' });
