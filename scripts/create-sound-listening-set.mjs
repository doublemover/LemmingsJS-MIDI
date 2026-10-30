import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createBlindSoundListeningSet, recordSoundListeningReview } from '../js/midi/qualification/SoundListeningReview.js';
const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const arg of process.argv.slice(2)) { const match = /^--(pairs|out-dir|seed|package|record-review|previous-review)=(.+)$/.exec(arg); if (!match || options[match[1]]) throw new Error('Unknown/repeated listening option.'); options[match[1]] = match[2]; }
const inside = name => { const result = path.resolve(root, name); if (!result.startsWith(path.join(root, 'temp') + path.sep)) throw new Error('Private listening inputs/outputs must stay inside project temp.'); return result; };
const read = async (name, limit = 16 * 1048576) => { const filename = await fs.realpath(inside(name)); inside(filename); const stat = await fs.stat(filename); if (!stat.isFile() || stat.size > limit) throw new Error('Listening input exceeds its byte bound.'); return fs.readFile(filename); };
if (options['record-review']) {
  if (!options.package) throw new Error('Review import requires its exact --package directory.');
  const packageManifest = JSON.parse(await read(path.join(options.package, 'listening.json'))), input = JSON.parse(await read(options['record-review'], 262144));
  const previous = options['previous-review'] ? JSON.parse(await read(options['previous-review'], 262144)) : null;
  const record = await recordSoundListeningReview({ packageManifest, input, previous }), directory = inside(path.join(options.package, 'reviews'));
  await fs.mkdir(directory, { recursive: true }); inside(await fs.realpath(directory));
  const filename = path.join(directory, 'review-' + record.revision + '-' + record.reviewHash + '.json'); await fs.writeFile(filename, JSON.stringify(record, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path: path.relative(root, filename), reviewHash: record.reviewHash, state: record.state, patchAcceptance: 'separate-technical-and-journey-receipts-required' }));
} else {
  if (!options.pairs || !options['out-dir'] || options.seed == null) throw new Error('A new blind package requires --pairs=, --out-dir= and explicit --seed=.');
  const requests = JSON.parse(await read(options.pairs, 262144)); if (!Array.isArray(requests) || !requests.length || requests.length > 64) throw new Error('Expected 1–64 same-take comparison requests.');
  const reports = new Map(), report = async name => { if (!reports.has(name)) { const value = JSON.parse(await read(name)); reports.set(name, value.report || value); } return reports.get(name); };
  const paths = new Map(), pairs = [];
  for (const request of requests) {
    const a = await report(request.reportA), b = await report(request.reportB);
    for (const [value, filename] of [[a, request.reportA], [b, request.reportB]]) for (const row of value.results || []) if (row.artifact) paths.set(row.artifact.sha256 + ':' + row.artifact.path, path.join(path.dirname(filename), row.artifact.path));
    pairs.push({ reportA: a, reportB: b, caseA: request.caseA, caseB: request.caseB, intendedDifference: request.intendedDifference });
  }
  const output = inside(options['out-dir']); await fs.mkdir(path.dirname(output), { recursive: true }); inside(path.join(await fs.realpath(path.dirname(output)), path.basename(output))); await fs.mkdir(output);
  const prepared = await createBlindSoundListeningSet({ pairs, seed: Number(options.seed), readArtifact: artifact => {
    const filename = paths.get(artifact.sha256 + ':' + artifact.path); if (!filename) throw new Error('Missing exact source artifact.'); return read(filename, 64 * 1048576);
  }, writeArtifact: async ({ name, bytes, sha256 }) => { if (!/^trial-[a-f0-9]{20}-[AB]\.wav$/.test(name) || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Invalid blind output.'); await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' }); return { path: name, sha256, bytes: bytes.length }; } });
  await fs.writeFile(path.join(output, 'listening.json'), JSON.stringify(prepared.publicManifest, null, 2), { flag: 'wx' });
  await fs.writeFile(path.join(output, 'private-key.json'), JSON.stringify(prepared.privateKey, null, 2), { flag: 'wx' });
  const embedded = JSON.stringify(prepared.publicManifest).replaceAll('<', '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Blind sound comparison</title>
<style>body{font:16px system-ui;max-width:58rem;margin:auto;padding:2rem;background:#10151b;color:#edf4fb}fieldset{margin:1rem 0;border:1px solid #779;border-radius:.5rem}label{display:block;margin:.8rem 0}audio{max-width:100%}textarea{width:95%;min-height:4rem}button,input,select{font:inherit;padding:.4rem}small{color:#bcd}</style>
<h1>Blind, pair-relative sound review</h1><p>Use a comfortable listening level. A/B files are RMS-matched within each pair with bounded peaks, not normalized to a universal loudness target. Raw render measurements are retained separately. Do not open private-key.json until verdicts are recorded.</p>
<label>Reviewer alias <input id="reviewer" maxlength="64" autocomplete="off"></label><form id="form"></form><button id="save">Download review input</button><output id="status" role="status"></output>
<script>const data=${embedded};const form=document.querySelector('#form'),rows=[];for(const trial of data.trials){const group=document.createElement('fieldset'),title=document.createElement('legend');title.textContent='Trial '+(rows.length/4+1);group.append(title);for(const [i,file]of trial.files.entries()){const label=document.createElement('label');label.textContent=i?'B':'A';const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=file.path;label.append(audio);group.append(label)}for(const condition of trial.conditions)for(const context of trial.contexts){const label=document.createElement('label');label.textContent=condition+' · '+context+' ';const select=document.createElement('select');for(const verdict of trial.verdicts){const option=document.createElement('option');option.value=verdict;option.textContent=verdict;select.append(option)}select.value='skipped';const notes=document.createElement('textarea');notes.maxLength=2048;notes.setAttribute('aria-label',condition+' '+context+' observations or objection');label.append(select,notes);group.append(label);rows.push({trialId:trial.id,condition,context,select,notes})}form.append(group)}document.querySelector('#save').onclick=()=>{const reviewer=document.querySelector('#reviewer').value.trim();if(!reviewer){document.querySelector('#status').textContent='Enter an alias, not personal contact information.';return}const value={reviewer,timestamp:new Date().toISOString(),verdicts:rows.map(({select,notes,...row})=>({...row,verdict:select.value,notes:notes.value}))},url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='review-input.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);document.querySelector('#status').textContent='Downloaded input; import it with the source-bound review tool. No patch has been automatically accepted.'};</script>`;
  await fs.writeFile(path.join(output, 'index.html'), html, { flag: 'wx' }); console.log(JSON.stringify({ directory: path.relative(root, output), packageHash: prepared.publicManifest.packageHash, trials: prepared.publicManifest.trials.length, state: 'listening-pending' }));
}
