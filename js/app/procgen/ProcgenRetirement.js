// A synchronous teardown entry point with an optional bounded, observable async tail.
// Each scope owns one ordered retirement; repeat and reentrant callers share its receipt.
export function afterProcgenRetirement(prerequisites, action) {
  const completed = value => {
    if (value && typeof value.then === 'function') return Promise.resolve(value).then(completed);
    if (value?.schema !== 'lemmings-retirement/v1') return null;
    const check = () => { if (value.outcome !== 'complete') throw new Error('A prerequisite retirement is unresolved; dependent resources remain owned.'); };
    if (value.state === 'retired') { check(); return null; }
    return Promise.resolve(value.completion).then(check);
  };
  const pending = prerequisites.map(completed).filter(Boolean);
  if (!pending.length) return action();
  return Promise.all(pending).then(() => { const result = action(), waiting = completed(result); return waiting ? Promise.resolve(waiting).then(() => result) : result; });
}

export function retireProcgenWorldResources({ world, renderer, terrain, assets, resourceLease } = {}) {
  const readers = createProcgenRetirementScope(), sources = createProcgenRetirementScope();
  return createProcgenRetirementScope().retire([
    { name: 'world-readers', run: () => readers.retire([{ name: 'world', run: () => world?.dispose() }, { name: 'renderer', run: () => renderer?.dispose() }]) },
    { name: 'world-sources', run: () => sources.retire([
      { name: 'terrain-assets', run: () => afterProcgenRetirement([readers.getReceipt()], () => terrain?.dispose?.()) },
      { name: 'display-assets', run: () => afterProcgenRetirement([readers.getReceipt()], () => assets?.dispose?.()) }
    ]) },
    { name: 'asset-provider-lease', run: () => afterProcgenRetirement([readers.getReceipt(), sources.getReceipt()], () => resourceLease?.release()) }
  ]);
}

export function createProcgenRetirementScope({ deadlineMs = 5000 } = {}) {
  let receipt = null;
  return {
    getReceipt: () => receipt,
    retire(actions = []) {
      if (receipt) return receipt;
      let complete;
      receipt = { schema: 'lemmings-retirement/v1', state: 'retiring', outcome: 'pending', resources: [], completion: new Promise(resolve => { complete = resolve; }) };
      const pending = [];
      const settle = (resource, value) => {
        if (resource.status !== 'pending' && resource.status !== 'attempted') return;
        if (value?.schema === receipt.schema && value !== receipt) {
          resource.retirement = value;
          const failed = value.resources.filter(child => child.status === 'failed' || child.status === 'unknown');
          resource.status = failed.some(child => child.status === 'unknown') ? 'unknown' : failed.length ? 'failed' : 'completed';
          if (failed.length) resource.error = failed.map(child => `${child.name}: ${child.error || child.status}`).join('; ').slice(0, 240);
        } else resource.status = 'completed';
      };
      for (const { name, run } of actions) {
        const resource = { name, status: 'attempted' };
        receipt.resources.push(resource);
        try {
          const result = run(), completion = result?.schema === receipt.schema && result !== receipt ? result.state === 'retired' ? null : result.completion : result;
          if (completion && typeof completion.then === 'function') {
            resource.status = 'pending';
            pending.push(Promise.resolve(completion).then(value => { settle(resource, value); }, error => {
              if (resource.status === 'pending') { resource.status = 'failed'; resource.error = String(error?.message || error).slice(0, 240); }
            }));
          } else settle(resource, result);
        } catch (error) {
          resource.status = 'failed'; resource.error = String(error?.message || error).slice(0, 240);
        }
      }
      if (!pending.length) {
        receipt.state = 'retired'; receipt.outcome = receipt.resources.some(resource => resource.status !== 'completed') ? 'partial' : 'complete'; complete(receipt);
      } else {
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => {
          for (const resource of receipt.resources) if (resource.status === 'pending') resource.status = 'unknown';
          resolve();
        }, deadlineMs); });
        Promise.race([Promise.all(pending), deadline]).then(() => {
          clearTimeout(timer); receipt.state = 'retired'; receipt.outcome = receipt.resources.some(resource => resource.status !== 'completed') ? 'partial' : 'complete'; complete(receipt);
        });
      }
      return receipt;
    }
  };
}
