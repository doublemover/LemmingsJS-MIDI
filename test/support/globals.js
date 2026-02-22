const hasOwn = Object.prototype.hasOwnProperty;

const captureGlobalValues = (keys) => {
  const snapshot = keys.map((key) => ({
    key,
    had: hasOwn.call(globalThis, key),
    value: globalThis[key]
  }));
  return () => {
    snapshot.forEach(({ key, had, value }) => {
      if (had) {
        globalThis[key] = value;
      } else {
        delete globalThis[key];
      }
    });
  };
};

const patchGlobalValues = (overrides) => {
  const keys = Object.keys(overrides);
  const restore = captureGlobalValues(keys);
  keys.forEach((key) => {
    globalThis[key] = overrides[key];
  });
  return restore;
};

const withPatchedGlobals = (overrides, fn) => {
  const restore = patchGlobalValues(overrides);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
};

const useGlobalValueRestore = (keys) => {
  let restore = () => {};
  beforeEach(() => {
    restore = captureGlobalValues(keys);
  });
  afterEach(() => {
    restore();
  });
};

export { captureGlobalValues, patchGlobalValues, withPatchedGlobals, useGlobalValueRestore };
