import { expect, test } from './helpers/workstationValidation.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';

const ready = async page => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); window.__materialWorld = window.__PROCGEN_LANES__.world; window.__PROCGEN_LANES__.renderer.render(true); });
};
const specimen = async page => { await page.goto('/test/support/workstation-materials.html'); await page.waitForFunction(() => window.materialSpecimen); };
const scope = page => page.evaluate(() => ({ world: window.__materialWorld === window.__PROCGEN_LANES__.world, tick: window.__PROCGEN_LANES__.world.tickIndex,
  routes: window.__PROCGEN_STUDIO__.ports.getState().outputRoutes, sent: window.__WEBMIDI_STUB__.metrics().sent }));

test('compact exact entry owns invalid drafts, composition, conflict and two-stage Escape', { tag: ['@boundary', '@typed-controls'] }, async ({ page }) => {
  await specimen(page); const row = page.locator('article[data-material-state=idle]'), control = row.locator('.studio-lane-pan'), entry = control.getByLabel('Pan numeric value');
  await expect(entry).toBeHidden(); await control.getByRole('button', { name: 'Edit Pan value' }).click(); await expect(entry).toBeFocused();
  await entry.fill('-'); await entry.press('Enter'); await expect(entry).toHaveAttribute('aria-invalid', 'true');
  await entry.press('Escape'); await expect(entry).toHaveValue('0'); await expect(entry).toBeVisible(); await entry.press('Escape'); await expect(entry).toBeHidden();
  await control.getByRole('button', { name: 'Edit Pan value' }).click(); await entry.fill('-32');
  await entry.dispatchEvent('compositionstart'); await entry.press('Enter'); expect(await page.evaluate(() => window.materialSpecimen.commits)).toEqual([]);
  await page.evaluate(() => window.materialSpecimen.controls[1].setState({ value: 48 })); await expect(entry).toHaveValue('-32');
  await entry.dispatchEvent('compositionend'); await entry.press('Enter'); expect(await page.evaluate(() => window.materialSpecimen.commits)).toEqual([]);
  await page.evaluate(() => {
    window.exactEntryEvents = []; const control = window.materialSpecimen.controls[1], root = control.element, panel = root.querySelector('.parameter-entry-popover');
    for (const type of ['pointerdown','focusout','focusin','click']) document.addEventListener(type, event => window.exactEntryEvents.push({ type, target: event.target.tagName + ':' + event.target.textContent?.slice(0, 30), active: document.activeElement.tagName, inside: panel.contains(event.target), state: control.inspect(), value: panel.querySelector('input').value, hidden: panel.hidden }), true);
  });
  await control.getByRole('button', { name: 'Keep my edit', exact: true }).click(); expect(await page.evaluate(() => window.materialSpecimen.commits), JSON.stringify(await page.evaluate(() => window.exactEntryEvents))).toEqual([{ state: 'idle', name: 'Pan', next: -32 }]);
});

test('closing, resizing and removing compact exact entry never publish a valid buffered value', { tag: '@boundary' }, async ({ page }) => {
  await specimen(page); const control = page.locator('article[data-material-state=idle] .studio-lane-pan'), entry = control.getByLabel('Pan numeric value');
  await control.getByRole('button', { name: 'Edit Pan value' }).click(); await entry.fill('64'); await page.locator('#outside').click(); await expect(entry).toBeHidden();
  expect(await page.evaluate(() => window.materialSpecimen.commits)).toEqual([]);
  await control.getByRole('button', { name: 'Edit Pan value' }).click(); await expect(entry).toHaveValue('64'); await page.setViewportSize({ width: 1920, height: 1200 }); await expect(entry).toBeHidden();
  await control.getByRole('button', { name: 'Edit Pan value' }).click(); await page.evaluate(() => window.materialSpecimen.controls[1].element.remove()); await expect(page.locator('.parameter-entry-popover:visible')).toHaveCount(0);
  expect(await page.evaluate(() => window.materialSpecimen.commits)).toEqual([]);
});

test('quiet command menus preserve native controls, modal focus return, output warnings and Stage access', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); const before = await scope(page); await expect(page.locator('#procgenPanic')).toBeVisible(); await expect(page.locator('#procgenListen')).toBeVisible();
  await expect(page.locator('#procgenOutput')).toBeHidden(); await expect(page.locator('.studio-export-desk')).toBeHidden();
  await page.locator('details[data-menu-name=Setup] > summary').click(); await expect(page.locator('#procgenOutput')).toBeVisible(); await page.locator('#procgenOutput').focus();
  await page.keyboard.press('Escape'); await expect(page.locator('details[data-menu-name=Setup] > summary')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('details[data-menu-name=Setup] > summary').focus(); await page.keyboard.press('Escape'); await expect(page.locator('details[data-menu-name=Setup] > summary')).toBeFocused(); await expect(page.locator('details[data-menu-name=Setup] > summary')).toHaveAttribute('aria-expanded', 'false');
  await useWorkstationControl(page, page.getByRole('button', { name: 'Save As', exact: true }), { button: 'Save As' }, 'click');
  const dialog = page.getByRole('dialog', { name: 'Save project copy', exact: true }); await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save As', exact: true })).toBeFocused(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Stage mode', exact: true }).click(); await expect(page.locator('#procgenPanic')).toBeVisible(); await page.getByRole('button', { name: 'Exit stage', exact: true }).first().click();
  expect(await scope(page)).toEqual(before); await expect(page.locator('#procgenDeepDock')).toBeHidden();
});

test('lane Pan and Level exact values use canonical Undo without opening deep editors or changing physical ownership', { tag: ['@boundary', '@typed-controls'] }, async ({ page }) => {
  await ready(page); const before = await scope(page), row = page.locator('.studio-lane-header').first(), pan = row.locator('.studio-lane-pan');
  await expect(row.getByRole('slider')).toHaveCount(2); await pan.getByRole('button', { name: 'Edit Pan value' }).click(); const input = pan.getByLabel('Pan numeric value');
  await input.fill('-64'); await input.press('Enter'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].pan)).toBe(-64);
  await input.press('Escape'); await expect(pan.getByRole('button', { name: 'Edit Pan value' })).toBeFocused();
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }).click(); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].pan)).toBe(0);
  const level = row.locator('.studio-lane-fader'); await level.getByRole('button', { name: 'Edit Level value' }).click(); await level.getByLabel('Level numeric value').fill('-6.0206 dB'); await level.getByLabel('Level numeric value').press('Enter');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].gain)).toBe(0.5); await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await scope(page)).toEqual(before); await expect(page.locator('#procgenDeepDock')).toBeHidden();
});

test('command chrome replacement restores borrowed nodes once and stale disposal cannot remove the current owner', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/README.md'); await page.setContent('<header id="top"><div id="field"><button id="native">Native action</button></div><section id="health"></section></header><footer id="foot"><button data-command-group="Project" id="save">Save As</button></footer>');
  const result = await page.evaluate(async () => {
    const { createWorkstationChrome } = await import('/js/app/procgen/workstation/WorkstationChrome.js'); const topbar = document.querySelector('#top'), footer = document.querySelector('#foot'), field = document.querySelector('#field'), native = document.querySelector('#native'), save = document.querySelector('#save'); let calls = 0; native.addEventListener('click', () => calls++);
    const options = { document, window, topbar, footer, health: document.querySelector('#health'), setupFields: [field] };
    const a = createWorkstationChrome(options), b = createWorkstationChrome(options); a.dispose(); b.reveal(native); native.click(); const current = { menus: topbar.querySelectorAll('details').length, connected: native.isConnected, same: document.querySelector('#native') === native, calls, open: native.closest('details').open }; b.dispose(); b.dispose();
    return { current, restored: field.parentElement === topbar && save.parentElement === footer, remaining: document.querySelectorAll('.studio-command-menu').length };
  });
  expect(result).toEqual({ current: { menus: 1, connected: true, same: true, calls: 1, open: true }, restored: true, remaining: 0 });
});

for (const dpr of [1, 1.5, 2]) test.describe(`material DPR ${dpr}`, () => {
  test.use({ deviceScaleFactor: dpr });
  test('production material contact sheet preserves geometry and contrast across desktop effects and enlargement', { tag: '@boundary' }, async ({ page }, testInfo) => {
    test.setTimeout(90000); await specimen(page); let baseline;
    for (const mode of ['normal', 'low-effects', 'high-contrast', 'forced-colors', 'greyscale']) {
      await page.emulateMedia({ reducedMotion: mode === 'low-effects' ? 'reduce' : 'no-preference', contrast: mode === 'high-contrast' ? 'more' : 'no-preference', forcedColors: mode === 'forced-colors' ? 'active' : 'none' });
      await page.locator('body').evaluate((body, mode) => body.classList.toggle('greyscale', mode === 'greyscale'), mode);
      const geometry = await page.locator('.parameter-knob-cap').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; }));
      if (!baseline) baseline = geometry; else expect(geometry).toEqual(baseline);
      await page.locator('article[data-material-state=hover] .parameter-knob-cap').first().hover(); await page.locator('article[data-material-state=focus] .parameter-knob-cap').first().focus();
      await page.screenshot({ path: testInfo.outputPath(`materials-${dpr}-${mode}.png`), fullPage: true });
    }
    await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference' });
    await page.locator('body').evaluate(body => { body.classList.remove('greyscale'); });
    const contrasts = await page.evaluate(() => {
      const root = document.body, style = window.getComputedStyle(root), channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number), luminance = rgb => rgb.map(value => { value /= 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const color = token => { const node = document.createElement('span'); node.style.color = style.getPropertyValue(token); root.append(node); const value = channels(window.getComputedStyle(node).color); node.remove(); return luminance(value); };
      const ratio = (a, b) => (Math.max(color(a), color(b)) + 0.05) / (Math.min(color(a), color(b)) + 0.05);
      const rendered = [...document.querySelectorAll('h1,p,.parameter-knob-label,.parameter-knob-value,.studio-lane-display,button')].filter(node => node.textContent.trim() && node.getBoundingClientRect().width > 0).map(node => {
        const ink = luminance(channels(window.getComputedStyle(node).color)); let parent = node, background;
        while (parent) { const value = window.getComputedStyle(parent).backgroundColor, values = value.match(/[\d.]+/g).map(Number); if (values.length === 3 || values[3] === 1) { background = luminance(values.slice(0, 3)); break; } parent = parent.parentElement; }
        if (background == null) throw new Error('Unmeasured specimen background.');
        return { text: node.textContent.trim().slice(0, 48), ratio: (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) };
      });
      const intercepted = [...document.querySelectorAll('.parameter-knob-cap')].filter(node => { const r = node.getBoundingClientRect(), target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return target !== node && !node.contains(target); }).length;
      return { engraving: ratio('--material-engraving', '--material-cap-hover'), secondary: ratio('--material-secondary', '--material-panel'), unavailable: ratio('--state-unavailable', '--material-panel'), mark: ratio('--material-line', '--material-cap-hover'), focus: ratio('--state-focus', '--material-cap-hover'), active: ratio('--function-time', '--material-glass'), rendered, intercepted, actualBodyBackground: style.backgroundColor };
    });
    for (const name of ['engraving','secondary','unavailable']) expect(contrasts[name], name).toBeGreaterThanOrEqual(4.5); for (const name of ['mark','focus','active']) expect(contrasts[name], name).toBeGreaterThanOrEqual(3);
    expect(contrasts.actualBodyBackground).toBe('rgb(21, 24, 28)'); expect(contrasts.intercepted).toBe(0); for (const text of contrasts.rendered) expect(text.ratio, text.text).toBeGreaterThanOrEqual(4.5);
    await page.setViewportSize({ width: 3840, height: 2160 }); await page.locator('body').evaluate(body => { body.style.zoom = '2'; });
    const control = page.locator('article[data-material-state=idle] .studio-lane-pan'); await control.getByRole('button', { name: 'Edit Pan value' }).click(); const box = await control.locator('.parameter-entry-popover').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(2160);
    await page.screenshot({ path: testInfo.outputPath(`materials-${dpr}-css-enlargement-200.png`), fullPage: true }); await testInfo.attach('material-measurements', { body: JSON.stringify({ dpr, contrasts, bounds: baseline, enlargement: { method: 'CSS zoom 2, 3840x2160 desktop viewport; logical 1920x1080', popup: box } }), contentType: 'application/json' });
  });
  test('eight-lane production instrument retains terrain priority and readable control bounds', { tag: '@boundary' }, async ({ page }, testInfo) => {
    test.setTimeout(90000); await ready(page);
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport); await expect(page.locator('.studio-lane-header')).toHaveCount(8);
      for (const contrast of ['no-preference', 'more']) {
        await page.emulateMedia({ contrast }); const measurements = await page.evaluate(() => {
          const rectangle = selector => { const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
          return { viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }, workspace: rectangle('#procgenStudio'), world: rectangle('#procgenStudioStage'), topbar: rectangle('#procgenTopbar'), footer: rectangle('#procgenStudioFooter'), rows: document.querySelectorAll('.studio-lane-header').length, caps: [...document.querySelectorAll('.studio-lane-header .parameter-knob-cap')].map(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; }) };
        });
        expect(measurements.rows).toBe(8); expect(measurements.world.width / measurements.workspace.width).toBeGreaterThanOrEqual(0.65); for (const cap of measurements.caps) { expect(cap.width).toBeGreaterThanOrEqual(32); expect(cap.height).toBeGreaterThanOrEqual(32); }
        await testInfo.attach(`instrument-${viewport.width}-${contrast}`, { body: JSON.stringify(measurements), contentType: 'application/json' }); await page.screenshot({ path: testInfo.outputPath(`instrument-${viewport.width}-dpr-${dpr}-${contrast}.png`) });
      }
    }
    await page.locator('body').evaluate(body => { body.style.zoom = '2'; });
    await expect(page.locator('#procgenPanic')).toBeVisible(); await page.locator('.studio-lane-pan').first().getByRole('button', { name: 'Edit Pan value' }).click();
    const popup = await page.locator('.parameter-entry-popover:visible').boundingBox(); expect(popup.x + popup.width).toBeLessThanOrEqual(3840); expect(popup.y + popup.height).toBeLessThanOrEqual(2160);
    await page.screenshot({ path: testInfo.outputPath(`instrument-css-enlargement-200-dpr-${dpr}.png`) });
  });
});
