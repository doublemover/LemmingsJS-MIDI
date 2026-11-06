import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import type { ResourceBudgetAdapter, ResourceEvictionCallback } from '../../js/app/resources/ResourceBudgetContracts.js';
const budget = createResourceBudget({ limitBytes: 4096 }), token = {};
const request = { token, owner: 'world', generation: 1, bytes: 1024 };
const reservation = budget.reserve(request), observation = budget.inspectReservation(request);
const diagnostics = budget.diagnostics(), owners = budget.inspectOwners();
const adapter: ResourceBudgetAdapter = budget;
adapter.reserve(request); adapter.release(request); adapter.inspectReservation?.(request);
budget.registerEvictor('cache', () => { budget.release(request); });
// @ts-expect-error A reservation must identify its token.
budget.reserve({ owner: 'world', bytes: 1024 });
// @ts-expect-error Admission requires an explicit byte estimate.
budget.reserve({ token, owner: 'world' });
// @ts-expect-error Byte estimates retain numeric units.
budget.reserve({ ...request, bytes: '1024' });
// @ts-expect-error Generations cannot be string identities.
budget.reserve({ ...request, generation: 'epoch:1' });
// @ts-expect-error A release must identify its token.
budget.release({ owner: 'world' });
// @ts-expect-error Transfer requires the current generation.
budget.transfer({ token, owner: 'world', toOwner: 'replacement' });
// @ts-expect-error Admission cannot return an asynchronous acknowledgment.
const asyncReserve: ResourceBudgetAdapter = { reserve: async () => true, release: () => true };
// @ts-expect-error Leaf release acknowledgment is synchronous.
const asyncRelease: ResourceBudgetAdapter = { reserve() {}, release: async () => true };
// @ts-expect-error Exact-token inspection cannot defer or invent absence.
const asyncInspection: ResourceBudgetAdapter = { ...adapter, inspectReservation: async () => null };
// @ts-expect-error An eviction callback cannot defer admission accounting.
const asyncEvictor: ResourceEvictionCallback = async () => true;
// @ts-expect-error The actual registration API preserves synchronous callbacks.
budget.registerEvictor('async', async () => false);
// @ts-expect-error The published lease does not permit byte mutation.
reservation.bytes = 0;
// @ts-expect-error Exact inspection is immutable.
if (observation) observation.revision = 2;
// @ts-expect-error Published accounting is immutable.
diagnostics.accountedBytes = 0;
// @ts-expect-error Nested category accounting is immutable.
diagnostics.categories.other.residentBytes = 0;
// @ts-expect-error Category peaks are immutable.
diagnostics.categoryPeaks.other = 0;
// @ts-expect-error Published eviction-owner arrays are immutable.
diagnostics.evictionOwners.push({ owner: 'fake', priority: 0, calls: 0, failures: 0, misses: 0, evictions: 0, reclaimedBytes: 0 });
// @ts-expect-error Individual eviction receipts are immutable.
diagnostics.evictionOwners[0].failures = 0;
// @ts-expect-error Owner observations cannot be appended.
owners.owners.push({ owner: 'fake', generation: 1, entries: 0, residentBytes: 0, accountedBytes: 0, pinned: 0, unreleased: 0 });
// @ts-expect-error Owner totals are immutable.
owners.owners[0].accountedBytes = 0;
// @ts-expect-error Diagnostics describe accounting, not physical release proof.
const confirmed: 'native-released' = diagnostics.admissionPolicy;
// @ts-expect-error Inspection is a nullable owned-token observation.
const missing: undefined = budget.inspectReservation(request);
void asyncReserve; void asyncRelease; void asyncInspection; void asyncEvictor; void confirmed; void missing;
