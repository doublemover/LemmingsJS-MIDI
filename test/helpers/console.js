const withConsoleStub = (stubs) => {
  const original = {};
  for (const [method, fn] of Object.entries(stubs)) {
    original[method] = console[method];
    console[method] = fn;
  }
  return () => {
    for (const method of Object.keys(stubs)) {
      console[method] = original[method];
    }
  };
};

export { withConsoleStub };
