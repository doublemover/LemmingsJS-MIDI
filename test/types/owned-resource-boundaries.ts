import { createOwnedResourceReservation } from '../../js/app/resources/OwnedResourceReservation.js';
import { createSceneCatalogStorage } from '../../js/app/procgen/workstation/SceneCatalogStorage.js';
import type { OwnedResourceReservation } from '../../js/app/resources/OwnedResourceReservationContracts.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
const budget = createResourceBudget(), owner: OwnedResourceReservation = createOwnedResourceReservation({ budget, owner: 'typed-owner', kind: 'prepared-scene', bytes: 4096 });
const receipt = owner.resize(8192);
const state: 'reserved' | 'released' | 'failed-or-unknown' = receipt.state;
const released: boolean = owner.release();
// @ts-expect-error Ownership identity and kind are required before admission.
createOwnedResourceReservation({ budget, bytes: 4096 });
// @ts-expect-error A resource generation is numeric, separate from a document ID.
createOwnedResourceReservation({ owner: 'typed-owner', kind: 'scene', generation: 'document:1' });
// @ts-expect-error A byte count cannot be supplied as display text.
owner.resize('8192');
// @ts-expect-error Public ownership observations are immutable.
receipt.declaredBytes = 0;
// @ts-expect-error A reservation is not an asynchronous producer retirement receipt.
const completion: Promise<unknown> = owner.release();
// @ts-expect-error A synchronous budget cannot acknowledge after publication.
createOwnedResourceReservation({ owner: 'typed-owner', kind: 'scene', budget: { reserve: async () => true, release: () => true } });
const storage = createSceneCatalogStorage({ resourceBudget: budget });
storage.finishConstruction();
const disposeCompletion: Promise<void> = storage.dispose();
void state; void released; void completion; void disposeCompletion;

const prepare = storage.trackFactory(async (workspace, key: string, bytes: number) => { workspace.resize(bytes); return key.length; });
const prepared: Promise<number> = prepare('scene', 8192);
// @ts-expect-error Factory argument types survive the ownership wrapper.
prepare(7, '8192');
// @ts-expect-error A prepared numeric result is not a rendered-audio receipt.
const rendered: Promise<{ audible: true }> = prepare('scene', 8192);
const metadata = storage.makeMap(); metadata.set('recipe', { revision: 1 });
// @ts-expect-error Retained values require domain validation before use.
const unchecked: { revision: number } = metadata.get('recipe');
void prepared; void rendered; void unchecked;
