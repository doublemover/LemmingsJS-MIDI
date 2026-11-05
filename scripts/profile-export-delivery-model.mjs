import { runModelTraceCampaign } from './ModelTraceCampaign.js';
import { generateDeliveryTrace, replayDeliveryTrace } from '../test/support/export-delivery-model.js';
await runModelTraceCampaign({ schema: 'export-delivery-model-campaign/v1', failurePrefix: 'delivery-model', entry: 'scripts/profile-export-delivery-model.mjs',
  sourceEntries: ['test/support/export-delivery-model.js'], fixtures: ['test/fixtures/export-delivery-premature-release.json'],
  generate: generateDeliveryTrace, replay: replayDeliveryTrace, summarize: result => ({ logicalOutcome: result.receipt?.state || 'pending-prefix',
    completeInTrace: result.reference.settled && !Object.values(result.reference.pending).some(Boolean), sourceHash: result.sourceHash,
    finalSourceRetained: result.reference.retained, neighborLeaseRetained: result.reference.neighbor }),
  scope: 'Actual export artifact/delivery owners with controlled native file promises and a separate serial reference. No browser filesystem, disk durability or process-memory qualification.' });
