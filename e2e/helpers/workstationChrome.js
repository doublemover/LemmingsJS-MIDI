import { expect } from '@playwright/test';

export async function revealWorkstationControl(page, locator, hint = {}) {
  if (await locator.isVisible()) return locator;
  let target = locator;
  if (hint.button) target = page.locator('#procgenStudioFooter').getByRole('button', { name: hint.button, exact: true, includeHidden: true });
  if (await target.count() === 1) {
    const owner = await target.evaluate(element => ({ menu: element.closest('.studio-command-menu')?.getAttribute('data-menu-name'),
      exact: element.closest('.parameter-entry-popover')?.id, name: element.getAttribute('aria-label') }));
    if (owner.menu) {
      const menu = page.locator('.studio-command-menu[data-menu-name=' + JSON.stringify(owner.menu) + ']');
      if (!await menu.evaluate(element => element.open)) { const summary = menu.locator(':scope > summary'); await summary.focus(); await summary.press('Space'); }
    }
    else if (owner.exact) await page.locator(`[aria-controls="${owner.exact}"]`).click();
  }
  await expect(locator).toBeVisible(); return locator;
}

export async function useWorkstationControl(page, locator, hint, action, ...args) {
  const target = await revealWorkstationControl(page, locator, hint); return target[action](...args);
}
