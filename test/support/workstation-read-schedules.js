import assert from 'node:assert/strict';
import { setup } from '../helpers/workstation-fixture.js';

export const deferredRead = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

export async function replayListingSchedule({ seed, failCurrent, interruption }, { workstationFactory } = {}) {
  const reads = [], rendered = [], events = []; let word = seed >>> 0;
  const random = max => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % max; };
  const fixture = setup({ workstationFactory, storageOverride: { listDocumentPage() { const read = deferredRead(); reads.push(read); return read.promise; }, close() {} } });
  const requests = []; let world, project, expectedStatuses = 0, expectedPage = null, latestFinished = false;
  try {
    fixture.studio.bindRuntime(); fixture.view.showProjectPage = page => rendered.push(page.sourceOrdinal);
    for (let index = 0; index < 4; index++) requests.push(fixture.studio.handlers.load());
    if (interruption === 'cancel') fixture.studio.handlers.cancelProjectPicker();
    else if (interruption === 'new') { assert.equal(await fixture.studio.handlers.new(), true); fixture.studio.transport.pause(); }
    else if (interruption === 'dispose') await fixture.studio.dispose().completion;
    world = fixture.runtime.world; project = fixture.studio.getProject();
    const statusBaseline = fixture.statuses.length, order = [0, 1, 2, 3];
    for (let at = order.length - 1; at > 0; at--) { const other = random(at + 1); [order[at], order[other]] = [order[other], order[at]]; }
    for (const index of order) {
      const current = index === 3 && interruption === 'none', failed = index === 3 ? failCurrent : random(2) === 0;
      if (failed) reads[index].reject(new Error('listing-source-' + index + '-failed'));
      else reads[index].resolve({ items: [], nextCursor: null, sourceOrdinal: index });
      const result = await requests[index]; assert.equal(result, current && !failed, 'only the latest live listing can publish');
      if (current) { latestFinished = true; if (failed) expectedStatuses++; else expectedPage = index; }
      assert.deepEqual(rendered, expectedPage === null ? [] : [expectedPage]);
      assert.equal(fixture.statuses.length - statusBaseline, expectedStatuses, 'obsolete listing cannot publish status');
      assert.equal(fixture.runtime.world, world); assert.equal(fixture.studio.getProject(), project);
      const operation = fixture.studio.getOperationState();
      if (interruption === 'none' && (!latestFinished || !failCurrent)) assert.equal(operation?.kind, 'select-session');
      else assert.ok(operation === null || operation.aborted, 'terminal listing cannot retain a live operation');
      events.push({ index, failed, result, rendered: [...rendered], operation });
    }
    return { seed, failCurrent, interruption, order, events };
  } catch (error) { error.listingSchedule = { seed, failCurrent, interruption, events }; throw error; }
  finally { for (const read of reads) read.resolve({ items: [], nextCursor: null }); await Promise.all(requests); await fixture.studio.dispose().completion; }
}
