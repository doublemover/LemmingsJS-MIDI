import { runModelTraceCampaign } from './ModelTraceCampaign.js';
import { generateCacheScenario, replayCacheTrace } from '../test/support/cache-transaction-model.js';
await runModelTraceCampaign({ schema: 'cache-transaction-model-campaign/v1', failurePrefix: 'cache-model', entry: 'scripts/profile-cache-transaction-model.mjs',
  sourceEntries: ['test/support/cache-transaction-model.js'], fixtures: ['test/fixtures/cache-transaction-stale-total.json'], defaultSteps: 64, maximumSteps: 128,
  generate: generateCacheScenario, replay: replayCacheTrace, summarize: result => ({ completeInTrace: result.complete, committedEntries: result.committedEntries, committedBytes: result.committedBytes }),
  scope: 'Actual persistent FileProvider operations, two isolated database connections and a controlled serial native transaction/request adapter, compared to independent committed payload/metadata/byte totals. Small-entry publication schedules, not eviction capacity, native IndexedDB or process RSS qualification.' });
