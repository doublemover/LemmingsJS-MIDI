import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const WORKSTATION_GATE_MUTATIONS = Object.freeze({
  'save-cancel': { category: '@workstation-save-cancel', module: '/js/app/controls/ProjectNameDialog.js',
    before: 'cancel.addEventListener(\'click\', () => finish(null));', after: 'cancel.addEventListener(\'click\', () => finish(input.value.trim() || \'Mutant copy\'));' },
  'world-rollback': { category: '@workstation-world-rollback', module: '/js/app/procgen/workstation/ProcgenWorkstation.js',
    before: 'Object.assign(legacy.settings, oldSettings); lastLegacySpeed = legacy.settings.speed; if (previous.playing) play(); throw error;',
    after: 'project = validatedProject; Object.assign(legacy.settings, oldSettings); lastLegacySpeed = legacy.settings.speed; if (previous.playing) play(); throw error;' },
  'causal-output': { category: '@workstation-physical-music', module: '/js/app/procgen/workstation/CausalMusicEngine.js',
    before: 'try { deliver(sealed, batch, latestBodyPreparations.commands); }', after: 'try { deliver([], batch, []); }' },
  'local-audio': { category: '@workstation-local-audio' }
});

export const test = base.extend({
  workstationGateMutation: [async ({ page }, use, testInfo) => {
    const id = process.env.LEMMINGS_BROWSER_GATE_MUTATION;
    if (!id) { await use(); return; }
    const mutation = WORKSTATION_GATE_MUTATIONS[id];
    if (!mutation || !testInfo.tags.includes(mutation.category)) throw new Error('Invalid or incorrectly selected workstation gate mutation.');
    const proof = { id, runId: process.env.LEMMINGS_BROWSER_MUTATION_RUN, category: mutation.category, file: path.basename(testInfo.file), title: testInfo.title, project: testInfo.project.name, applied: false };
    if (mutation.module) await page.route('**' + mutation.module, async route => {
      const response = await route.fetch(), source = await response.text();
      if (source.split(mutation.before).length !== 2) throw new Error('Mutation anchor must match exactly once: ' + id);
      proof.sourceSha256 = createHash('sha256').update(source).digest('hex'); proof.module = mutation.module;
      await route.fulfill({ response, body: source.replace(mutation.before, mutation.after) }); proof.applied = true;
    });
    else await page.addInitScript(() => {
      window.__workstationBlockedAudioConnections = 0;
      window.AudioNode.prototype.connect = function(destination) { window.__workstationBlockedAudioConnections++; return destination; };
    });
    try { await use(); }
    finally {
      if (!mutation.module) proof.applied = await page.evaluate(() => window.__workstationBlockedAudioConnections > 0).catch(() => false);
      proof.status = testInfo.status;
      const output = process.env.LEMMINGS_BROWSER_MUTATION_RECEIPT;
      if (!output) throw new Error('Mutation qualification requires a receipt destination.');
      await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
    }
  }, { auto: true }]
});
export { expect };
