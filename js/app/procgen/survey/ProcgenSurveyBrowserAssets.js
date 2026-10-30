import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
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
import { readBrowserBuildResponse, awaitBrowserBuildOperation } from '../../../runtime/BrowserGenerationService.js';
import { loadActiveBrowserSurveyBuild, requireIsolatedBrowserSurveyExecution, requireSurveySourceBuild } from './ProcgenSurveyExecution.js';
import { cloneJournalData } from '../workstation/CausalJournalCanonical.js';
import { createResourceBudget } from '../../resources/ResourceBudget.js';

const repoUrl = new URL('../../../../', import.meta.url);
const MAX_SOURCE_FILES = 1024, MAX_FILE_BYTES = 16 * 1048576, MAX_SOURCE_BYTES = 64 * 1048576;
const preparationBudget = createResourceBudget({ limitBytes: 256 * 1048576 });
const hexSha256 = async bytes => {
  if (!globalThis.crypto?.subtle) throw new Error('Verified replay requires SHA-256 support');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
};
const sourcePath = (name, code) => {
  const valid = typeof name === 'string' && !name.split('/').some(part => !part || part === '.' || part === '..') &&
    (code ? /^(js|scripts|tools)\/[A-Za-z0-9_.\/-]+\.(?:[cm]?js|wasm)$/.test(name) || name === 'assets/audio/signalsmith-stretch-core.wasm'
      : name === 'assets/procgen/terrain-recipes.json' || /^[A-Za-z0-9_-]+\/(MAIN|GROUND\d+O|VGAGR\d+)\.DAT$/.test(name));
  if (!valid) throw new Error(`Unsupported replay source path: ${name}`);
  const url = new URL(name, repoUrl);
  if (url.origin !== repoUrl.origin || !url.pathname.startsWith(repoUrl.pathname)) throw new Error('Replay sources must remain in this origin and repository');
  return url;
};
const verifiedBrowserFiles = async (rawManifest, fetchRef, externalSignal, { resourceBudget = preparationBudget, artifactPolicy = 'saved-source-and-assets' } = {}) => {
  externalSignal?.throwIfAborted();
  if (!['saved-source-and-assets', 'saved-assets-only'].includes(artifactPolicy)) throw new Error('Unknown replay artifact policy');
  const verifyCode = artifactPolicy === 'saved-source-and-assets';
  const manifest = cloneJournalData(rawManifest, { maxBytes: 2 * 1048576, maxNodes: 32768 });
  if (![1, 2].includes(manifest?.schemaVersion) || !(manifest.schemaVersion === 2 ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/).test(manifest.engineCommit || '') ||
      !manifest.codeHashes || !manifest.assetHashes || !/^[a-f0-9]{64}$/.test(manifest.codeDigest || '')) throw new Error('Replay requires the complete original source manifest');
  const code = Object.entries(manifest.codeHashes), assets = Object.entries(manifest.assetHashes), declared = [...code.map(entry => [...entry, true]), ...assets.map(entry => [...entry, false])];
  if (!code.length || declared.length > MAX_SOURCE_FILES) throw new Error('Replay source file limit exceeded');
  for (const [name, expected, isCode] of declared) { sourcePath(name, isCode); if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing SHA-256 identity: ${name}`); }
  const entries = verifyCode ? declared : declared.filter(entry => !entry[2]);
  for (const required of ['js/app/procgen/survey/ProcgenSurveyBrowserAssets.js', 'js/app/procgen/survey/ProcgenSurveyCore.js', 'js/steelSpritesData.js'])
    if (!Object.hasOwn(manifest.codeHashes, required)) throw new Error(`Replay code is missing from provenance: ${required}`);
  const savedOrder = JSON.stringify(rawManifest.codeHashes), legacyOrder = JSON.stringify(Object.fromEntries(code.slice().sort(([left], [right]) => left.localeCompare(right))));
  if (await hexSha256(new TextEncoder().encode(savedOrder)) !== manifest.codeDigest && await hexSha256(new TextEncoder().encode(legacyOrder)) !== manifest.codeDigest) throw new Error('Replay source manifest digest mismatch');
  const bytes = new Map(), token = {}, owner = 'browser-survey-source'; let totalBytes = 0, admittedStreamBytes = 0, cursor = 0, released = false;
  const producers = new Set(), retirement = createProcgenRetirementScope();
  resourceBudget.reserve({ token, owner, generation: 0, category: 'asset', bytes: MAX_SOURCE_BYTES * 3 + 8 * 65536, pinned: true, reloadable: false });
  const controller = new AbortController(), signal = controller.signal, cancel = () => controller.abort(externalSignal.reason);
  externalSignal?.addEventListener('abort', cancel, { once: true }); if (externalSignal?.aborted) cancel();
  const deadline = setTimeout(() => controller.abort(new Error('Browser survey source preparation deadline exceeded.')), 120000);
  const release = () => {
    if (retirement.getReceipt()) return retirement.getReceipt(); released = true; bytes.clear();
    return retirement.retire([{ name: 'source-stream-producers', run: () => producers.size ? Promise.all([...producers]) : undefined },
      { name: 'source-storage', run: () => { const finish = () => { if (resourceBudget.release({ token, owner }) === false) throw new Error('Survey source release was not acknowledged.'); }; return producers.size ? Promise.all([...producers]).then(finish) : finish(); } }]);
  };
  const read = async () => {
    try {
      while (cursor < entries.length) {
        signal?.throwIfAborted();
        const [name, expected, isCode] = entries[cursor++], response = await awaitBrowserBuildOperation(() => fetchRef(sourcePath(name, isCode), { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal }), signal);
        if (!response.ok) throw new Error(`Replay source request failed: ${name} (${response.status})`);
        const data = await readBrowserBuildResponse(response, MAX_FILE_BYTES, signal, {
          claimBytes(count) { if (released || signal.aborted || admittedStreamBytes + count > MAX_SOURCE_BYTES) throw new Error('Replay aggregate stream byte budget exceeded before materialization.'); admittedStreamBytes += count; },
          observeProducer(promise) { producers.add(promise); promise.then(() => producers.delete(promise)); }
        }); signal?.throwIfAborted(); totalBytes += data.byteLength;
        if (data.byteLength > MAX_FILE_BYTES || totalBytes > MAX_SOURCE_BYTES) throw new Error('Replay source byte limit exceeded');
        if (await hexSha256(data) !== expected) throw new Error(`Replay source differs from the saved trial: ${name}`);
        bytes.set(name, data);
      }
    } catch (error) { controller.abort(error); throw error; }
  };
  try {
    const reads = await Promise.allSettled(Array.from({ length: Math.min(4, entries.length) }, read));
    const failed = reads.find(value => value.status === 'rejected'); if (failed) throw failed.reason;
    for (const [name] of verifyCode && manifest.schemaVersion === 1 ? code : []) {
      const text = new TextDecoder().decode(bytes.get(name));
      for (const match of text.matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
        const dependency = new URL(match[1], sourcePath(name, true)), relative = dependency.pathname.slice(repoUrl.pathname.length);
        if (dependency.origin !== repoUrl.origin || !Object.hasOwn(manifest.codeHashes, relative)) throw new Error(`Replay dependency is missing from provenance: ${relative}`);
      }
    }
    resourceBudget.reserve({ token, owner, generation: 0, category: 'asset', bytes: Math.max(4096, totalBytes), previousBytes: MAX_SOURCE_BYTES * 3 + 8 * 65536, pinned: true, reloadable: false });
    return { bytes, release, verification: freezeSurveyData({ receiptVersion: 3, scheme: 'same-origin-file-sha256-v1', artifactPolicy,
      artifactIntegrity: verifyCode ? 'verified' : 'assets-verified', codeArtifactIntegrity: verifyCode ? 'verified' : 'not-checked', assetIntegrity: 'verified',
      activeExecution: 'unbound', executionReason: verifyCode ? 'fetched-source-is-not-the-loaded-module-graph' : 'explicit-current-runtime-comparison',
      codeDigest: manifest.codeDigest, codeFiles: verifyCode ? code.length : 0, declaredCodeFiles: code.length, assetFiles: assets.length, totalBytes }) };
  } catch (error) { controller.abort(error); const receipt = release(); if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
  finally { clearTimeout(deadline); externalSignal?.removeEventListener('abort', cancel); }
};
const browserTerrain = async (scenario, files) => {
  const pack = scenario.pack, groundName = `GROUND${scenario.groundSet}O.DAT`, vgaName = `VGAGR${scenario.groundSet}.DAT`;
  const required = name => { const bytes = files.get(name); if (!bytes) throw new Error(`Replay asset is missing from provenance: ${name}`); return bytes; };
  const ground = new BinaryReader(required(`${pack}/${groundName}`), 0, undefined, groundName, pack);
  const rawVga = new BinaryReader(required(`${pack}/${vgaName}`)); let vga, terrainPart, objectPart, reader;
  try { vga = new FileContainer(rawVga); terrainPart = vga.getPart(0); objectPart = vga.getPart(1); reader = new GroundReader(ground, terrainPart, objectPart); }
  finally { terrainPart?.release(); objectPart?.release(); vga?.dispose(); rawVga.release(); ground.release(); }
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
const surveyDecodeBytes = (scenario, files) => {
  const containers = ['lemmings_ohNo/MAIN.DAT', ...(scenario.mode === 'generated' ? [`${scenario.pack}/VGAGR${scenario.groundSet}.DAT`] : [])];
  for (const name of containers) {
    const data = files.get(name); if (!(data instanceof Uint8Array)) throw new Error(`Survey container is missing: ${name}`);
    let at = 0, parts = 0;
    while (at + 10 < data.length) { const size = data[at + 8] * 256 + data[at + 9];
      if (++parts > 64 || size < 10 || at + size > data.length) throw new Error('Survey compressed container exceeds bounded part metadata.'); at += size;
    }
  }
  let pixels = 0;
  if (scenario.mode === 'generated') {
    const ground = files.get(`${scenario.pack}/GROUND${scenario.groundSet}O.DAT`); if (!(ground instanceof Uint8Array) || ground.length !== 1056) throw new Error('Survey ground header is not a bounded classic source.');
    for (let i = 0; i < 16; i++) pixels += ground[i * 28 + 3] * ground[i * 28 + 4] * ground[i * 28 + 5];
    for (let i = 0; i < 64; i++) pixels += ground[448 + i * 8] * ground[449 + i * 8];
  }
  const bytes = 1048576 + pixels * 8;
  if (!Number.isSafeInteger(bytes) || bytes > 64 * 1048576) throw new Error('Survey decoder expansion exceeds the declared pixel workspace.'); return bytes;
};
const createBrowserSurveyTrial = async ({ scenario: rawScenario, candidate: rawCandidate, sourceManifest: rawSourceManifest, fetchFile = globalThis.fetch, signal, mode = 'compatibility', artifactPolicy = 'saved-source-and-assets', executionLease, resourceBudget } = {}) => {
  if (typeof fetchFile !== 'function') throw new Error('Verified replay requires fetch');
  if (!['compatibility', 'exact'].includes(mode)) throw new Error('Unknown replay mode');
  if (mode === 'exact' && artifactPolicy !== 'saved-source-and-assets') throw new Error('Exact replay requires the complete saved source and asset inventory');
  signal?.throwIfAborted();
  const job = cloneJournalData({ scenario: rawScenario, candidate: rawCandidate || {}, sourceManifest: rawSourceManifest }, { maxBytes: 4 * 1048576, maxNodes: 65536 });
  const scenario = normalizeSurveyScenario(job.scenario), candidate = job.candidate, sourceManifest = job.sourceManifest;
  if (!/^[A-Za-z0-9_-]+$/.test(scenario.pack)) throw new Error('Browser survey supports one local source pack');
  if (scenario.engineCommit !== sourceManifest?.engineCommit || canonicalSurveyJson(scenario.assetHashes) !== canonicalSurveyJson(sourceManifest?.assetHashes)) throw new Error('Scenario source identity differs from its manifest');
  let active = null;
  if (mode === 'exact') {
    requireIsolatedBrowserSurveyExecution(executionLease, sourceManifest);
    active = await requireSurveySourceBuild(sourceManifest, await loadActiveBrowserSurveyBuild({ fetchFile, signal }));
    requireIsolatedBrowserSurveyExecution(executionLease, sourceManifest); signal?.throwIfAborted();
  }
  const budget = resourceBudget || preparationBudget;
  const { bytes, verification, release } = await verifiedBrowserFiles(sourceManifest, fetchFile, signal, { resourceBudget: budget, artifactPolicy });
  let decoder = null, candidateReservation = null, trial = null; const retirement = createProcgenRetirementScope();
  const releaseAll = () => retirement.retire([{ name: 'verified-source', run: release }, { name: 'decoded-source', run: () => decoder?.release() }, { name: 'survey-world', run: () => candidateReservation?.release() }]);
  try {
    decoder = createOwnedResourceReservation({ budget, owner: 'browser-survey-decoder', kind: 'classic-palette-and-mask-expansion', category: 'asset', bytes: surveyDecodeBytes(scenario, bytes) });
    const estimatedWorldBytes = 8 * 1048576 + scenario.physicalLaneCount * (65536 + scenario.laneHeight * 128 * 8) + scenario.maxActors * (8192 + scenario.laneHeight * 32) + scenario.actorRecordLimit * 512;
    candidateReservation = createOwnedResourceReservation({ budget, owner: 'browser-survey-world', kind: 'bounded-survey-runtime-estimate', category: 'candidate', bytes: estimatedWorldBytes });
    signal?.throwIfAborted();
    const main = bytes.get('lemmings_ohNo/MAIN.DAT'); if (!main) throw new Error('Replay masks are missing from provenance');
    const rawMain = new BinaryReader(main); let container, part, masks;
    try { container = new FileContainer(rawMain); part = container.getPart(1); masks = new MaskProvider(part); }
    finally { part?.release(); container?.dispose(); rawMain.release(); }
    const terrain = scenario.mode === 'generated' ? await browserTerrain(scenario, bytes) : null;
    signal?.throwIfAborted();
    if (active) requireIsolatedBrowserSurveyExecution(executionLease, sourceManifest);
    trial = createSurveyTrial({ scenario, candidate, masks, terrain }); trial.sourceVerification = active ? freezeSurveyData({ ...verification,
      receiptVersion: 3, activeExecution: 'bound', executionReason: 'owned-immutable-dedicated-worker', executionIdentity: active }) : verification;
    const dispose = trial.dispose.bind(trial);
    trial.dispose = () => { if (!retirement.getReceipt()) { dispose(); trial.releaseStorage(); } const receipt = releaseAll(); if (receipt.outcome !== 'complete') throw Object.assign(new Error('Survey asset/world retirement is unresolved.'), { retirement: receipt }); return receipt; };
    return trial;
  } catch (error) { try { trial?.dispose(); trial?.releaseStorage(); } catch (retirementError) { error.retirementError = retirementError; throw error; } const receipt = releaseAll(); if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
};
export { createBrowserSurveyTrial, verifiedBrowserFiles, hexSha256, MAX_SOURCE_FILES, MAX_SOURCE_BYTES, surveyDecodeBytes };
