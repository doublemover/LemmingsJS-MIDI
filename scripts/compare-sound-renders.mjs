import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decodeQualificationFloatWav } from '../js/midi/qualification/SoundQualificationWav.js';
import { compareSoundRenders } from '../js/midi/qualification/SoundRenderComparison.js';
import { renderSoundComparisonHtml } from '../js/midi/qualification/SoundComparisonReport.js';
import { hashData } from '../js/core/CanonicalData.js';
import { readAudioEvidenceOptions, launchAudioEvidenceBrowser } from './audio-evidence-browser.js';
const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(a|b|package|trial|out-dir|png|name|browser|channel|executable)=(.+)$/.exec(argument);
  if (!match || options[match[1]]) throw new Error('Unknown or duplicate spectral comparison option.'); options[match[1]] = match[2];
}
if (!options['out-dir'] || options.package && (options.a || options.b) || !options.package && (!options.a || !options.b) || options.png != null && !['true', 'false'].includes(options.png)) throw new Error('Use --package= with optional --trial=, or --a= and --b=, plus --out-dir=.');
const tempRoot = await fs.realpath(path.join(root, 'temp'));
const inside = value => { const resolved = path.resolve(root, value); if (!resolved.startsWith(tempRoot + path.sep)) throw new Error('Comparison inputs/outputs must stay inside project temp.'); return resolved; };
const read = async (value, limit) => { const resolved = await fs.realpath(inside(value)); inside(resolved); const stat = await fs.stat(resolved); if (!stat.isFile() || stat.size > limit) throw new Error('Spectral input exceeds its byte bound.'); return { path: resolved, bytes: await fs.readFile(resolved) }; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let packageRef = null, expected = null;
if (options.package) {
  const input = await read(options.package, 262144), manifest = JSON.parse(input.bytes), { packageHash, ...hashable } = manifest;
  if (manifest.schema !== 'lemmings-blind-sound-listening/v1' || !Array.isArray(manifest.trials) || manifest.trials.length > 64 || await hashData(hashable) !== packageHash) throw new Error('Listening package integrity failed.');
  const selected = options.trial || '1', trial = /^\d+$/.test(selected) ? manifest.trials[Number(selected) - 1] : manifest.trials.find(row => row.id === selected);
  if (!trial || trial.files?.length !== 2 || trial.files.some(file => !/^trial-[a-f0-9]{20}-[AB]\.wav$/.test(file.path))) throw new Error('Select an existing exact blind trial.');
  expected = trial.files; options.a = path.join(path.dirname(input.path), expected[0].path); options.b = path.join(path.dirname(input.path), expected[1].path);
  packageRef = { path: path.relative(root, input.path), packageHash, trialId: trial.id };
}
const inputs = [await read(options.a, 64 * 1048576), await read(options.b, 64 * 1048576)];
if (inputs[0].bytes.length + inputs[1].bytes.length > 64 * 1048576) throw new Error('Combined encoded WAV inputs exceed64MiB.');
const identities = inputs.map((input, index) => { const value = { path: path.relative(root, input.path), bytes: input.bytes.length, sha256: sha(input.bytes) };
  if (expected && (expected[index].sha256 !== value.sha256 || expected[index].bytes !== value.bytes)) throw new Error('Blind PCM artifact identity differs from its package.'); return value;
});
const started = performance.now(), decoded = inputs.map(input => decodeQualificationFloatWav(input.bytes)), report = compareSoundRenders(...decoded);
report.inputs = { a: identities[0], b: identities[1], listeningPackage: packageRef };
const sourceFiles = ['scripts/compare-sound-renders.mjs', 'scripts/audio-evidence-browser.js', 'js/midi/qualification/SoundQualificationWav.js', 'js/midi/qualification/SoundRenderComparison.js',
  'js/midi/qualification/SoundSpectralTransform.js', 'js/midi/qualification/SoundRenderAnalysis.js', 'js/midi/qualification/SoundComparisonReport.js', 'js/app/midi-ui/PcmEvidence.js', 'js/core/CanonicalData.js'];
report.source = { node: process.version, agent: options.name || null, files: await Promise.all(sourceFiles.map(async file => { const bytes = await fs.readFile(path.join(root, file)); return { path: file, bytes: bytes.length, sha256: sha(bytes) }; })) };
report.analysisHashScope = 'numerical-data-input-and-source-identity;excludes-agent-profiling-rendering';
const { agent, ...sourceIdentity } = report.source;
report.analysisHash = sha(JSON.stringify({ ...report, source: sourceIdentity }));
report.profiling = { analysisWallMs: performance.now() - started, processRssBytesAtReport: process.memoryUsage().rss, scope: 'Node analysis wall-time and process RSS, not audio render-thread capacity or acoustic latency' };
const output = inside(options['out-dir']); await fs.mkdir(path.dirname(output), { recursive: true }); inside(path.join(await fs.realpath(path.dirname(output)), path.basename(output))); await fs.mkdir(output);
const html = renderSoundComparisonHtml(report); await fs.writeFile(path.join(output, 'comparison.html'), html); await fs.writeFile(path.join(output, 'comparison.json'), JSON.stringify(report));
if (options.png !== 'false') {
  const { browser, environment } = await launchAudioEvidenceBrowser(readAudioEvidenceOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }), errors = [];
    page.on('pageerror', error => { if (errors.length < 16) errors.push(error.message); });
    await page.setContent(html, { waitUntil: 'load' });
    if (errors.length) throw new Error('Spectral report script failed: ' + errors.join('; '));
    await page.waitForFunction(() => window.__soundComparisonReady === true);
    const canvases = await page.locator('canvas').count(); if (canvases !== 5 || errors.length) throw new Error('Spectral report rendering failed: ' + errors.join('; '));
    const timeline = page.getByLabel('Include the full silent remainder', { exact: true });
    await timeline.check(); const fullRange = await page.locator('#range').innerText();
    if (!fullRange.startsWith('Showing 0–' + report.profile.durationSeconds.toFixed(2) + ' s')) throw new Error('Full comparison timeline did not render.');
    await timeline.uncheck(); const activeRange = await page.locator('#range').innerText();
    if (!activeRange.startsWith('Showing 0–' + report.display.activeEndSeconds.toFixed(2) + ' s')) throw new Error('Active comparison timeline did not restore.');
    await page.locator('#a').hover({ position: { x: 800, y: 120 } });
    if (!(await page.locator('#hover').innerText()).startsWith('Window center ')) throw new Error('Aligned spectral hover did not expose its measurements.');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, 'comparison.png'), fullPage: true });
    const image = await fs.readFile(path.join(output, 'comparison.png'));
    report.rendering = { ...environment, measurementScope: 'spectral-report-rasterization-no-audio-playback', viewport: { width: 1920, height: 1080 }, canvases, fullTimelineToggle: true, activeTimelineRestored: true, alignedHover: true,
      png: { path: 'comparison.png', bytes: image.length, sha256: sha(image) } };
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'comparison.json'), JSON.stringify(report));
}
console.log(JSON.stringify({ directory: path.relative(root, output), analysisHash: report.analysisHash, profile: report.profile, summary: report.summary,
  modulation: { a: { index: report.modulation.a.index, largestBinHz: report.modulation.a.largestBinHz }, b: { index: report.modulation.b.index, largestBinHz: report.modulation.b.largestBinHz } }, rendering: report.rendering || null }));
