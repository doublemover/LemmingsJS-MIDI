import { expect, test } from './helpers/workstationValidation.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { enableComplementaryPatterns } from './helpers/procgenPatterns.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';

const ready = async page => { await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2'); await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain); await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); }); };
const command = async (page, name) => useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name, exact: true }), { button: name }, 'click');
const review = page => page.getByRole('region', { name: 'Review project replacement', exact: true });
const edit = page => page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, lane = studio.getProject().procgen.lanes[0]; studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { gain: .75 } }); });
const saveName = async (page, name) => { const dialog = page.getByRole('dialog', { name: 'Project name', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByRole('textbox').fill(name); await dialog.getByRole('button', { name: 'Save', exact: true }).click(); };

test('native New cancel restores an unfinished compact number, exact caret and unchanged world', { tag: ['@boundary', '@workstation-save-cancel'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page);
  const toggle = page.getByRole('button', { name: 'Edit Level value', exact: true }).first(); await expect(toggle).toBeVisible(); await toggle.click();
  const entry = page.locator('.parameter-entry-popover:visible input').first(); await entry.fill('+'); await entry.evaluate(element => { element.setSelectionRange(1, 1); window.replacementEntry = element; const studio = window.__PROCGEN_STUDIO__; window.replacementSource = { world: window.__PROCGEN_LANES__.world, project: studio.getProject(), identity: studio.getOperationalSnapshot().documentIdentity, bpm: studio.transport.getState().bpm }; });
  await command(page, 'New'); await expect(review(page)).toContainText('local text draft'); await expect(review(page).getByRole('button', { name: 'Save project, then replace' })).toBeHidden();
  await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(page.locator('#procgenPanic')).toBeEnabled();
  await review(page).getByRole('button', { name: 'Cancel replacement' }).click(); await expect(review(page)).toHaveCount(0);
  await expect(entry).toBeVisible(); await expect(entry).toBeFocused(); await expect(entry).toHaveValue('+');
  const result = await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, source = window.replacementSource; return { sameField: document.activeElement === window.replacementEntry, caret: window.replacementEntry.selectionStart, sameWorld: source.world === window.__PROCGEN_LANES__.world, sameProject: source.project === studio.getProject(), sameIdentity: source.identity === studio.getOperationalSnapshot().documentIdentity, bpm: studio.transport.getState().bpm, originalBpm: source.bpm, operation: studio.getOperationState(), draft: studio.getReplacementReview().textDrafts }; });
  expect(result).toMatchObject({ sameField: true, caret: 1, sameWorld: true, sameProject: true, sameIdentity: true, operation: null, draft: 1 }); expect(result.bpm).toBe(result.originalBpm); await info.attach('native-replacement-draft-cancel', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('native hosted Open saves the current source through one naming dialog before loading the selected ID paused', { tag: ['@boundary', '@workstation-storage'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page);
  await page.evaluate(() => { window.targetSave = window.__PROCGEN_STUDIO__.handlers.save(); }); await saveName(page, 'Replacement target'); expect(await page.evaluate(() => window.targetSave)).toBe(true);
  const target = await page.evaluate(() => window.__PROCGEN_STUDIO__.getDocumentState()); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.new())).toBe(true); await edit(page);
  await command(page, 'Load'); const picker = page.getByRole('dialog', { name: 'Saved projects', exact: true }); await expect(picker).toBeVisible();
  await picker.getByRole('button').filter({ hasText: /^Replacement target ·/ }).click(); await expect(review(page)).toBeVisible(); await expect(page.locator('dialog[open]')).toHaveCount(1);
  await review(page).getByRole('button', { name: 'Save project, then replace', exact: true }).click(); await expect(page.locator('dialog[open]')).toHaveCount(1); await saveName(page, 'Source kept before Open');
  await expect(picker).not.toBeVisible(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getDocumentState().id)).toBe(target.id);
  const result = await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; return { document: studio.getDocumentState(), playing: studio.transport.getState().playing, receipts: studio.getNoticeState().entries.map(value => value.receipt).filter(Boolean) }; });
  expect(result.document).toMatchObject({ id: target.id, revision: 1, dirty: false }); expect(result.playing).toBe(false); expect(result.receipts.filter(value => value.kind === 'save' && value.outcome === 'committed')).toHaveLength(2); expect(new Set(result.receipts.map(value => value.id)).size).toBe(result.receipts.length);
  await command(page, 'Load'); await expect(picker.getByRole('button').filter({ hasText: /^Source kept before Open ·/ })).toHaveCount(1); await picker.getByRole('button', { name: 'Close', exact: true }).click(); await info.attach('native-replacement-save-open', { body: JSON.stringify({ target, result }), contentType: 'application/json' });
});

test('native file-input cancellation refuses candidate reads and keeps canonical edits and retained export', { tag: ['@boundary', '@workstation-import-refusal'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page); await edit(page);
  const json = await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; await studio.handlers.export(); window.importReplacement = { world: window.__PROCGEN_LANES__.world, project: studio.getProject(), reads: 0, artifact: studio.getExportState().artifact.artifactId }; const stream = File.prototype.stream; File.prototype.stream = function(...args) { window.importReplacement.reads++; return stream.apply(this, args); }; return JSON.stringify(studio.capture()); });
  const input = page.locator('input[type=file][accept*="json"]'); await input.setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await expect(review(page)).toContainText('prepared file is independent');
  await review(page).getByRole('button', { name: 'Cancel replacement', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getOperationState())).toBe(null);
  const result = await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, source = window.importReplacement; return { reads: source.reads, sameWorld: source.world === window.__PROCGEN_LANES__.world, sameProject: source.project === studio.getProject(), artifact: studio.getExportState().artifact.artifactId, originalArtifact: source.artifact, dirty: studio.getDocumentState().dirty }; });
  expect(result).toMatchObject({ reads: 0, sameWorld: true, sameProject: true, dirty: true }); expect(result.artifact).toBe(result.originalArtifact); await info.attach('native-replacement-import-cancel', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('native replacement revalidates canonical Undo and keeps Panic available before explicit discard', { tag: ['@boundary', '@workstation-storage'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page); await edit(page);
  await page.evaluate(() => { window.reviewedWorld = window.__PROCGEN_LANES__.world; }); await command(page, 'New'); await expect(review(page)).toBeVisible();
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.undo()); await expect(review(page)).toContainText('changed during review');
  const replace = review(page).getByRole('button', { name: /^(?:Discard changes and replace|Replace project|Finalize take, discard changes and replace)$/ }); await replace.click(); await expect(review(page)).toBeVisible(); await expect(page.locator('#procgenPanic')).toBeEnabled();
  await replace.click(); await expect(review(page)).toHaveCount(0); await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world !== window.reviewedWorld)).toBe(true);
  const result = await page.evaluate(() => ({ operation: window.__PROCGEN_STUDIO__.getOperationState(), document: window.__PROCGEN_STUDIO__.getDocumentState(), playing: window.__PROCGEN_STUDIO__.transport.getState().playing })); expect(result.operation).toBe(null); expect(result.playing).toBe(false); await info.attach('native-replacement-undo-discard', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('native curve drafts survive replacement cancellation across inspector selection', { tag: ['@boundary', '@workstation-save-cancel'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page);
  await page.getByRole('button', { name: 'Inspect selected lane', exact: true }).click();
  await page.locator('.studio-inspector-tabs').getByRole('tab', { name: 'Automation', exact: true }).click();
  await page.getByRole('button', { name: 'Add CC curve', exact: true }).click(); const points = page.getByRole('textbox', { name: 'Points', exact: true }); await points.fill('0:'); await points.evaluate(element => { element.setSelectionRange(2, 2); window.curveReplacementDraft = element; });
  await command(page, 'New'); await expect(review(page)).toContainText('local curve draft'); await expect(review(page).getByRole('button', { name: 'Save project, then replace' })).toBeHidden();
  await review(page).getByRole('button', { name: 'Cancel replacement', exact: true }).click(); await expect(points).toHaveValue('0:'); await expect(points).toBeFocused();
  const result = await page.evaluate(() => ({ sameField: document.activeElement === window.curveReplacementDraft, caret: window.curveReplacementDraft.selectionStart, review: window.__PROCGEN_STUDIO__.getReplacementReview() })); expect(result.sameField).toBe(true); expect(result.caret).toBe(2); expect(result.review.curveDrafts).toBe(1); await info.attach('native-replacement-curve-cancel', { body: JSON.stringify(result), contentType: 'application/json' });
});

for (const mode of ['recording', 'learning']) test('native replacement admission preserves active MIDI ' + mode + ' and the following input boundary', { tag: ['@boundary', '@workstation-save-cancel'] }, async ({ page }, info) => {
  test.setTimeout(90000); await installWebMidiStub(page); await ready(page); await enableComplementaryPatterns(page);
  await page.evaluate(async mode => { const studio = window.__PROCGEN_STUDIO__; await studio.handlers.connect(); studio.handlers.input('pw-input-1'); if (mode === 'recording') { studio.handlers.record(true); window.__WEBMIDI_STUB__.sendInput([0x90, 67, 97]); } else if (!studio.handlers.learn()) throw new Error('Input target was not armed.'); window.activeInputReplacement = { world: window.__PROCGEN_LANES__.world, project: studio.getProject(), lease: studio.getInputEditLease() }; }, mode);
  await command(page, 'New'); await expect(review(page)).toHaveCount(0); await expect(page.locator('.studio-status')).toContainText(mode === 'recording' ? 'Stop MIDI recording' : 'Finish or cancel MIDI Learn');
  const before = await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, source = window.activeInputReplacement; return { world: window.__PROCGEN_LANES__.world === source.world, project: studio.getProject() === source.project, lease: studio.getInputEditLease(), originalLease: source.lease, operation: studio.getOperationState(), recording: studio.ports.getState().recording, learning: studio.ports.getState().learning }; });
  expect(before).toMatchObject({ world: true, project: true, operation: null }); expect(before.lease).toEqual(before.originalLease); expect(before[mode]).toBe(true);
  const after = await page.evaluate(mode => { window.__WEBMIDI_STUB__.sendInput(mode === 'recording' ? [0x80, 67, 0] : [0x90, 81, 100]); const studio = window.__PROCGEN_STUDIO__; return { step: studio.getProject().procgen.lanes[0].patterns[0].steps[0], lease: studio.getInputEditLease(), world: window.__PROCGEN_LANES__.world === window.activeInputReplacement.world }; }, mode);
  expect(after.world).toBe(true); if (mode === 'recording') { expect(after.step.note).toBe(67); expect(after.step.duration).toBeGreaterThan(0); expect(after.step.duration).toBeLessThan(1); } else { expect(after.step.note).toBe(81); expect(after.lease).toBe(null); }
  await info.attach('native-replacement-active-input-' + mode, { body: JSON.stringify({ before, after }), contentType: 'application/json' });
});
