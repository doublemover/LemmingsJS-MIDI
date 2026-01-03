const waitForHarnessReady = async (page) => {
  await page.waitForFunction(() => {
    const api = window.__E2E__;
    if (!api?.getState) return false;
    return api.getState().ready === true;
  });
};

const clearLocalStorage = async (page) => {
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
  });
};

const seedSavedLevels = async (page, entries) => {
  await page.addInitScript((savedEntries) => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
    if (!Array.isArray(savedEntries)) return;
    const index = savedEntries.map(({ id, name, updatedAt }) => ({
      id,
      name,
      updatedAt
    }));
    window.localStorage?.setItem?.('lemmings.editor.levels', JSON.stringify(index));
    for (const entry of savedEntries) {
      if (!entry?.id) continue;
      const text = typeof entry.text === 'string' ? entry.text : '';
      window.localStorage?.setItem?.(`lemmings.editor.level.${entry.id}`, text);
    }
  }, entries);
};

export { clearLocalStorage, seedSavedLevels, waitForHarnessReady };
