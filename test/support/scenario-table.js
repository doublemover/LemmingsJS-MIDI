const runScenarioTable = (cases, runCase) => {
  const scenarios = Array.isArray(cases) ? cases : [];
  for (const scenario of scenarios) {
    it(scenario.name, function () {
      return runCase(scenario);
    });
  }
};

const runAsyncScenarioTable = (cases, runCase) => {
  const scenarios = Array.isArray(cases) ? cases : [];
  for (const scenario of scenarios) {
    it(scenario.name, async function () {
      await runCase(scenario);
    });
  }
};

export {
  runAsyncScenarioTable,
  runScenarioTable
};
