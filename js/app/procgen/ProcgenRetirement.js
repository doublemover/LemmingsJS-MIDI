// A synchronous teardown entry point with an optional bounded, observable async tail.
// Each scope owns one ordered retirement; repeat and reentrant callers share its receipt.
export function createProcgenRetirementScope({ deadlineMs = 5000 } = {}) {
  let receipt = null;
  return {
    retire(actions = []) {
      if (receipt) return receipt;
      receipt = { state: 'retiring', resources: [], completion: null };
      const pending = [];
      for (const { name, run } of actions) {
        const resource = { name, status: 'attempted' };
        receipt.resources.push(resource);
        try {
          const result = run();
          if (result && typeof result.then === 'function') {
            resource.status = 'pending';
            pending.push(Promise.resolve(result).then(() => { if (resource.status === 'pending') resource.status = 'completed'; }, error => {
              if (resource.status === 'pending') { resource.status = 'failed'; resource.error = String(error?.message || error).slice(0, 240); }
            }));
          } else resource.status = 'completed';
        } catch (error) {
          resource.status = 'failed'; resource.error = String(error?.message || error).slice(0, 240);
        }
      }
      if (!pending.length) {
        receipt.state = 'retired';
        receipt.completion = Promise.resolve(receipt);
      } else {
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => {
          for (const resource of receipt.resources) if (resource.status === 'pending') resource.status = 'unknown';
          resolve();
        }, deadlineMs); });
        receipt.completion = Promise.race([Promise.all(pending), deadline]).then(() => {
          clearTimeout(timer); receipt.state = 'retired'; return receipt;
        });
      }
      return receipt;
    }
  };
}
