import { BinaryReader } from '../../../data/BinaryReader.js';
import { FileContainer } from '../../../data/FileContainer.js';
import { MaskProvider } from '../../../render/MaskProvider.js';
import { GroundReader } from '../../../level/GroundReader.js';
import { DEFAULT_STEEL_SPRITES } from '../../../steelSpritesData.js';
import { loadTerrainRecipeBook, selectThemeRecipe } from '../ProcgenTerrainRecipes.js';
import { fingerprintTerrainImages, getPackTerrainWidthLimit, selectTerrainDescriptor } from '../ProcgenTerrainDescriptors.js';
import { fingerprintObjectImages, selectAuthoredAssemblyCatalog } from '../ProcgenAuthoredAssemblies.js';
import { ProcgenRecipeTerrain } from '../ProcgenRecipeTerrain.js';
import { createSurveyTrial, normalizeSurveyScenario } from './ProcgenSurveyCore.js';
import { canonicalSurveyJson, freezeSurveyData } from './ProcgenSurveyCanonical.js';

const repoUrl = new URL('../../../../', import.meta.url);
const MAX_SOURCE_FILES = 1024, MAX_FILE_BYTES = 16 * 1048576, MAX_SOURCE_BYTES = 64 * 1048576;
const hexSha256 = async bytes => {
  if (!globalThis.crypto?.subtle) throw new Error('Verified replay requires SHA-256 support');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
};
const sourcePath = (name, code) => {
  const valid = typeof name === 'string' && !name.split('/').some(part => !part || part === '.' || part === '..') &&
    (code ? /^(js|scripts|tools)\/[A-Za-z0-9_.\/-]+\.m?js$/.test(name) : name === 'assets/procgen/terrain-recipes.json' || /^[A-Za-z0-9_-]+\/(MAIN|GROUND\d+O|VGAGR\d+)\.DAT$/.test(name));
  if (!valid) throw new Error(`Unsupported replay source path: ${name}`);
  const url = new URL(name, repoUrl);
  if (url.origin !== repoUrl.origin || !url.pathname.startsWith(repoUrl.pathname)) throw new Error('Replay sources must remain in this origin and repository');
  return url;
};
const verifiedBrowserFiles = async (manifest, fetchRef) => {
  canonicalSurveyJson(manifest);
  if (manifest?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.engineCommit || '') || !manifest.codeHashes || !manifest.assetHashes || !/^[a-f0-9]{64}$/.test(manifest.codeDigest || '')) throw new Error('Replay requires the complete original source manifest');
  const code = Object.entries(manifest.codeHashes), assets = Object.entries(manifest.assetHashes), entries = [...code.map(entry => [...entry, true]), ...assets.map(entry => [...entry, false])];
  if (!code.length || entries.length > MAX_SOURCE_FILES) throw new Error('Replay source file limit exceeded');
  for (const [name, expected, isCode] of entries) { sourcePath(name, isCode); if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing SHA-256 identity: ${name}`); }
  for (const required of ['js/app/procgen/survey/ProcgenSurveyBrowserAssets.js', 'js/app/procgen/survey/ProcgenSurveyCore.js', 'js/steelSpritesData.js'])
    if (!Object.hasOwn(manifest.codeHashes, required)) throw new Error(`Replay code is missing from provenance: ${required}`);
  if (await hexSha256(new TextEncoder().encode(JSON.stringify(manifest.codeHashes))) !== manifest.codeDigest) throw new Error('Replay source manifest digest mismatch');
  const bytes = new Map(); let totalBytes = 0, cursor = 0;
  const read = async () => {
    while (cursor < entries.length) {
      const [name, expected, isCode] = entries[cursor++], response = await fetchRef(sourcePath(name, isCode), { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error(`Replay source request failed: ${name} (${response.status})`);
      const data = new Uint8Array(await response.arrayBuffer()); totalBytes += data.byteLength;
      if (data.byteLength > MAX_FILE_BYTES || totalBytes > MAX_SOURCE_BYTES) throw new Error('Replay source byte limit exceeded');
      if (await hexSha256(data) !== expected) throw new Error(`Replay source differs from the saved trial: ${name}`);
      bytes.set(name, data);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, read));
  for (const [name] of code) {
    const text = new TextDecoder().decode(bytes.get(name));
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = new URL(match[1], sourcePath(name, true)), relative = dependency.pathname.slice(repoUrl.pathname.length);
      if (dependency.origin !== repoUrl.origin || !Object.hasOwn(manifest.codeHashes, relative)) throw new Error(`Replay dependency is missing from provenance: ${relative}`);
    }
  }
  return { bytes, verification: freezeSurveyData({ scheme: 'same-origin-file-sha256-v1', codeDigest: manifest.codeDigest, codeFiles: code.length, assetFiles: assets.length, totalBytes }) };
};
const browserTerrain = async (scenario, files) => {
  const pack = scenario.pack, groundName = `GROUND${scenario.groundSet}O.DAT`, vgaName = `VGAGR${scenario.groundSet}.DAT`;
  const required = name => { const bytes = files.get(name); if (!bytes) throw new Error(`Replay asset is missing from provenance: ${name}`); return bytes; };
  const ground = new BinaryReader(required(`${pack}/${groundName}`), 0, undefined, groundName, pack);
  const vga = new FileContainer(new BinaryReader(required(`${pack}/${vgaName}`)));
  const reader = new GroundReader(ground, vga.getPart(0), vga.getPart(1));
  if (!reader.valid) throw new Error('Replay ground data is invalid');
  // Match the headless loader's pinned file-URL fallback without changing its
  // shared steel classification owner in a running browser application.
  const steel = DEFAULT_STEEL_SPRITES[pack]?.[groundName] || [];
  const images = reader.getTerrainImages(); images.forEach((image, index) => { image.isSteel = steel.includes(index); });
  const terrainPieces = images.map((image, id) => ({ id, image, width: image.width, height: image.height, frame: image.frames[0], isSteel: !!image.isSteel,
    solidRatio: image.frames[0].filter(ci => !(ci & 128)).length / (image.width * image.height) }));
  const book = await loadTerrainRecipeBook({ loadString: async name => new TextDecoder().decode(required(name)) });
  const recipe = selectThemeRecipe(book, { packPath: pack, groundSet: scenario.groundSet });
  const objectImages = reader.getObjectImages(), objectPieces = objectImages.map((image, id) => ({ id, image }));
  const assetSha256 = await fingerprintTerrainImages(images), objectSha256 = await fingerprintObjectImages(objectImages);
  const sourceDescriptor = selectTerrainDescriptor(book, { packPath: pack, groundSet: scenario.groundSet, assetSha256 });
  const assemblyCatalog = selectAuthoredAssemblyCatalog(book, { packPath: pack, groundSet: scenario.groundSet, assetSha256, objectSha256 });
  return new ProcgenRecipeTerrain({ recipe, terrainPieces, objectPieces, sourceDescriptor, assemblyCatalog, packWidthLimit: getPackTerrainWidthLimit(book, pack) });
};
const createBrowserSurveyTrial = async ({ scenario: rawScenario, candidate, sourceManifest, fetchFile = globalThis.fetch } = {}) => {
  if (typeof fetchFile !== 'function') throw new Error('Verified replay requires fetch');
  const scenario = normalizeSurveyScenario(rawScenario);
  if (!/^[A-Za-z0-9_-]+$/.test(scenario.pack)) throw new Error('Browser survey supports one local source pack');
  if (scenario.engineCommit !== sourceManifest?.engineCommit || canonicalSurveyJson(scenario.assetHashes) !== canonicalSurveyJson(sourceManifest?.assetHashes)) throw new Error('Scenario source identity differs from its manifest');
  const { bytes, verification } = await verifiedBrowserFiles(sourceManifest, fetchFile);
  const main = bytes.get('lemmings_ohNo/MAIN.DAT'); if (!main) throw new Error('Replay masks are missing from provenance');
  const masks = new MaskProvider(new FileContainer(new BinaryReader(main)).getPart(1));
  const terrain = scenario.mode === 'generated' ? await browserTerrain(scenario, bytes) : null;
  const trial = createSurveyTrial({ scenario, candidate, masks, terrain }); trial.sourceVerification = verification;
  return trial;
};
export { createBrowserSurveyTrial, verifiedBrowserFiles, hexSha256, MAX_SOURCE_FILES, MAX_SOURCE_BYTES };
