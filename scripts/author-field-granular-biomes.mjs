import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(ffmpeg|source-dir|name)=(.+)$/.exec(argument);
  if (!match || Object.hasOwn(options, match[1])) throw new Error('Expected unique --ffmpeg=, --source-dir= or --name= options.');
  options[match[1]] = match[2];
}
if (!options.ffmpeg || options.name && !/^[a-z][a-z0-9-]{0,31}$/i.test(options.name)) throw new Error('Provide an FFmpeg executable and optional short author name.');
const cache = path.resolve(root, options['source-dir'] || '.tmp/field-recording-originals');
const gallery = 'https://www.nps.gov/subjects/sound/gallery.htm', revision = 'nps-excerpt-pcm16-v1';
const specs = [
  { id: 'nps-rain', biome: 'rain-glass', title: 'Rain', page: 'sounds-rain.htm', filename: 'nri-RainDEPO.mp3', sha256: '8f349402462580e1faca6a51bc13fea4655698624966e976195d2b2fd08a5337', bytes: 81986 },
  { id: 'nps-rockfall', biome: 'gravel-choir', title: 'Rockfall', page: 'rockfall.htm', filename: 'nri-RockslideYOSE.mp3', sha256: '090c20e5496977cd627d2bfff45006ebcae7da246c3599abf56994c283cd0588', bytes: 161398 },
  { id: 'nps-stream', biome: 'water-lens', title: 'Stream', page: 'sounds-stream.htm', filename: 'nri-StreamMUWO.mp3', sha256: '4d55ce7e299b7d2d9ab50aee2d28233f05662886cbb57e792aa210d39dd73744', bytes: 63536 },
  { id: 'nps-snowplow', biome: 'rust-breath', title: 'Rotary snowplow', page: 'sounds-snowplow.htm', filename: 'nri-RotarySnowPlow.mp3', sha256: 'd86ea031d4ea439ef0dc408258d542de01f8b640cd5caaa8d72c4de014af63c8', bytes: 98287 }
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const version = spawnSync(options.ffmpeg, ['-version'], { encoding: 'utf8', maxBuffer: 65536 });
if (version.status !== 0 || !version.stdout.startsWith('ffmpeg version 7.1-essentials_build-www.gyan.dev ')) throw new Error('These immutable excerpts require FFmpeg 7.1-essentials_build-www.gyan.dev. A different decoder requires a new authoring revision.');
const decoder = version.stdout.split(/\r?\n/)[0], identities = [], provenance = [];
await fs.mkdir(cache, { recursive: true });
const dataDir = path.join(root, 'content/sounds/field-recordings'); await fs.mkdir(dataDir, { recursive: true });
for (const spec of specs) {
  const sourceUrl = 'https://www.nps.gov/nps-audiovideo/legacy/mp3/nri/avElement/' + spec.filename;
  const input = path.join(cache, spec.id + '.mp3'); let original;
  try { const stat = await fs.stat(input); if (!stat.isFile() || stat.size !== spec.bytes) throw new Error('Cached recording inventory changed.'); original = await fs.readFile(input); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw new Error('Recording download unavailable: ' + spec.id);
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > spec.bytes) throw new Error('Recording download exceeds pinned inventory.'); chunks.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    original = Buffer.concat(chunks);
    if (original.length !== spec.bytes || digest(original) !== spec.sha256) throw new Error('Recording source changed: ' + spec.id);
    await fs.writeFile(input, original, { flag: 'wx' });
  }
  if (original.length !== spec.bytes || digest(original) !== spec.sha256) throw new Error('Recording source changed: ' + spec.id);
  const command = ['-nostdin', '-v', 'error', '-i', input, '-map', '0:a:0', '-t', '6', '-ac', '1', '-ar', '32000', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 's16le', 'pipe:1'];
  const decoded = spawnSync(options.ffmpeg, command, { maxBuffer: 1048576 });
  if (decoded.status !== 0 || decoded.stdout.length < 32000 || decoded.stdout.length > 384000 || decoded.stdout.length % 2) throw new Error('Recording cannot form a bounded PCM excerpt: ' + spec.id);
  const pcm = decoded.stdout, frames = pcm.length / 2, fadeFrames = 320;
  for (let frame = 0; frame < frames; frame++) {
    const gain = Math.min(1, frame / fadeFrames, (frames - 1 - frame) / fadeFrames);
    pcm.writeInt16LE(Math.trunc(pcm.readInt16LE(frame * 2) * gain), frame * 2);
  }
  const bytes = Buffer.alloc(44 + pcm.length);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(32000, 24); bytes.writeUInt32LE(64000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(pcm.length, 40); pcm.copy(bytes, 44);
  const identity = { id: spec.id, materialType: 'recording', authoringRevision: revision, channels: 1, sampleRate: 32000, frames,
    path: 'field-recordings/' + spec.id + '.wav', bytes: bytes.length, sha256: digest(bytes) };
  identities.push(identity);
  await fs.writeFile(path.join(dataDir, spec.id + '.json'), JSON.stringify({ schema: 'lemmings-bundled-recording/v1', id: spec.id, base64: bytes.toString('base64') }) + '\n');
  provenance.push({ ...identity, title: spec.title, pageUrl: 'https://www.nps.gov/subjects/sound/' + spec.page, sourceUrl,
    original: { bytes: spec.bytes, sha256: spec.sha256, mediaType: 'audio/mpeg' }, decoder,
    conversion: 'First up to 6 seconds, mono 32000 Hz signed PCM16; bitexact flags; no peak normalization; 320-frame linear edge fades truncated toward zero; canonical 44-byte RIFF header.',
    sourceDescription: spec.id === 'nps-rockfall' ? 'NPS Rockfall. The legacy MP3 filename and page park label differ; no precise location is asserted.' : 'NPS ' + spec.title + '.',
    credit: 'National Park Service, Natural Sounds and Night Skies Division', rightsUrl: gallery, observedDate: '2026-11-07' });
}
await fs.writeFile(path.join(root, 'js/midi/content/FieldRecordingIdentities.js'), '// Generated by scripts/author-field-granular-biomes.mjs; NPS recording excerpts, not synthesized sources.\nexport const FIELD_RECORDING_IDENTITIES = Object.freeze(' + JSON.stringify(identities, null, 2) + '.map(entry => Object.freeze(entry)));\n');
await fs.writeFile(path.join(dataDir, 'provenance.json'), JSON.stringify({ schema: 'lemmings-field-recording-provenance/v1', authoringRevision: revision, sources: provenance }, null, 2) + '\n');
const recipes = JSON.parse(await fs.readFile(path.join(root, 'content/sounds/granular-biomes.json'), 'utf8'));
const licenseId = 'LicenseRef-NPS-Public-Domain', notice = 'NPS Sound Gallery source notice, observed 2026-11-07:\nThe files are in the public domain and may be downloaded. Enjoy, and please give the appropriate credit.\nSource: ' + gallery + '\n';
const licenseTextHash = digest(notice);
recipes.pack = { ...recipes.pack, id: 'lemmings.granular-biomes-recorded', version: '0.2.0', name: 'Granular biomes · NPS recorded edition',
  attribution: 'Four short National Park Service field-recording excerpts; original granular recipes by LemmingsJS-MIDI contributors. Rockfall supplies the rough source and rotary snowplow the mechanical source. Excerpt conversion is documented; listening, alias and device qualification are pending.',
  modifications: [revision + '; source inventory and conversion in content/sounds/field-recordings/provenance.json.'],
  licenses: [{ id: licenseId, sha256: licenseTextHash, text: notice, url: gallery }] };
recipes.files = identities.map((asset, index) => ({ path: asset.path, sha256: asset.sha256, bytes: asset.bytes, kind: 'sample', mediaType: 'audio/wav', parents: [],
  rights: { kind: 'sample-recording', creator: 'National Park Service', sourceUrl: provenance[index].pageUrl, licenseId, licenseUrl: gallery, licenseTextHash,
    attribution: provenance[index].credit + ' · ' + provenance[index].title + '. ' + provenance[index].sourceDescription,
    modifications: [provenance[index].conversion, 'Original MP3 ' + provenance[index].original.sha256 + '; ' + provenance[index].sourceUrl, 'Decoder: ' + decoder],
    declaredUse: 'redistributable' } }));
recipes.recipes.forEach((recipe, index) => {
  const asset = identities[index];
  recipe.id = 'biome.recorded-' + specs[index].biome; recipe.revision = 2; recipe.name += ' · recorded ' + specs[index].title.toLowerCase();
  recipe.tags = recipe.tags.map(tag => tag === 'synthetic-source' ? 'field-recording' : tag);
  recipe.rights.attribution = 'Original actor-owned granular cloud recipe over the credited NPS recording excerpt. Internal grains remain DSP children of one held action gate.';
  recipe.sampleRefs[0].sha256 = asset.sha256; recipe.sampleRefs[0].bytes = asset.bytes; recipe.dependencies = [asset.sha256];
});
for (const group of recipes.realizationGroups) {
  group.id = group.id.replace('realization.biome.', 'realization.biome.recorded-');
  for (const profile of group.profiles) profile.recipeId = profile.recipeId.replace('biome.', 'biome.recorded-');
}
await fs.writeFile(path.join(root, 'content/sounds/granular-biomes-recorded.json'), JSON.stringify(recipes, null, 2) + '\n');
console.log(JSON.stringify({ author: options.name || null, authoringRevision: revision, recordings: identities.map(({ id, bytes, frames, sha256 }) => ({ id, bytes, frames, sha256 })) }));
