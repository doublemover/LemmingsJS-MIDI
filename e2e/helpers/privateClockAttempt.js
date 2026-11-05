/** @param {'stall' | 'cancel' | 'unrelatedOwner'} action */
export async function observePrivateClockAttempt(page, testInfo, action, value = null) {
  const attempt = await page.evaluate(async ({ action, value }) => {
    let produced = null, stage = 'source-production';
    try {
      produced = await window.__privateClock.produce(); stage = action;
      return { produced, actual: await window.__privateClock[action](value) };
    } catch (error) {
      let snapshot = null, snapshotError = null;
      try { snapshot = await window.__privateClock.snapshot(); }
      catch (failure) { snapshotError = String(failure?.message ?? failure).slice(0, 1024); }
      return { produced, failure: { stage, name: String(error?.name || 'Error').slice(0, 128), message: String(error?.message ?? error).slice(0, 2048),
        stack: String(error?.stack || '').slice(0, 4096) }, snapshot, snapshotError };
    }
  }, { action, value });
  if (attempt.failure) {
    await testInfo.attach('native-clock-failed-attempt.json', { body: JSON.stringify(attempt), contentType: 'application/json' });
    throw new Error(attempt.failure.message);
  }
  return attempt;
}
