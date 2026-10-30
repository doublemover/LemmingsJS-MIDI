import { expect } from '@playwright/test';

export async function inspectLane(page, tab = null) {
  const open = page.getByRole('button', { name: 'Inspect selected lane', exact: true });
  if (await open.isVisible()) await open.click();
  const dock = page.locator('#procgenDeepDock'); await expect(dock).toBeVisible();
  if (tab) await dock.getByRole('tab', { name: tab, exact: true }).click();
  return dock;
}
