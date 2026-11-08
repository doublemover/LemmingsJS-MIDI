import { resolveOwnedSourceSeed } from '../../js/app/midi-ui/OwnedSourceSeed.js';
import type { SeedSource } from '../../js/app/midi-ui/OwnedSourceSeed.js';

declare const source: SeedSource;
const result = resolveOwnedSourceSeed(source, { id: 'patch', revision: 1 }, { actorId: 'actor', worldId: 'world', generation: 1, onsetId: 'onset' }, { variation: { seed: 7 } });
if (result.receipt) {
  // @ts-expect-error Receipt schema is versioned.
  const futureSchema: typeof result.receipt.schema = 'lemmings-owned-source-seed/v2';
  // @ts-expect-error Published seed inputs are immutable.
  result.receipt.inputs[0] = 'other-domain';
  // @ts-expect-error Published birth inputs are also immutable.
  result.receipt.inputs[3].push('another-owner');
  // @ts-expect-error The source revision cannot change after an accepted onset.
  result.receipt.contract.source.buildId = 'changed';
  void futureSchema;
}
// @ts-expect-error Physical birth generations are numeric.
resolveOwnedSourceSeed(source, { id: 'patch', revision: 1 }, { generation: 'one' }, null);
// @ts-expect-error A patch revision is numeric.
resolveOwnedSourceSeed(source, { id: 'patch', revision: 'latest' }, {}, null);
