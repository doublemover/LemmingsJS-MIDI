import { computeInstrumentArtifacts } from './InstrumentArtifactManifest.js';

export const BROWSER_BUILD_SCHEMA = 'lemmings-browser-build/v1';
export const BROWSER_ENTRY_ROUTES = Object.freeze(['index.html', 'editor.html', 'procgen.html', 'procgen-survey.html']);
const requiredEntryRoutes = ['index.html', 'editor.html', 'procgen.html'];
export const BUILD_IDENTITY_PATH = 'js/runtime/ActiveExecutionIdentity.js';
export const BUILD_IDENTITY_SLOT = 'const APPLICATION_BUILD = null; // IMMUTABLE_APPLICATION_BUILD_SLOT';
export const BUILD_TEMPLATE_PATH = 'runtime-templates/identity.txt';
const hashPattern = /^[a-f0-9]{64}$/;
const recipePaths = ['scripts/BrowserRuntimeBuild.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js', 'scripts/RuntimeProvenance.js', 'scripts/InstrumentArtifactClosure.js'];
const before = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const validBrowserBuildPath = value => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
  /^[A-Za-z0-9_./@-]+$/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
export const hashBrowserBuildBytes = async bytes => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
};
const hashData = value => hashBrowserBuildBytes(new TextEncoder().encode(JSON.stringify(value)));

export const computeBrowserBuildIdentity = async (files, recipe, instrumentProfiles = null) => {
  const instrumentArtifacts = instrumentProfiles == null ? null : await computeInstrumentArtifacts(files, instrumentProfiles);
  const code = [], assets = [];
  for (const file of files) (/\.(?:[cm]?js|wasm)$/.test(file.path) ? code : assets).push(file);
  const [buildId, closureDigest, assetDigest, codeDigest] = await Promise.all([
    hashData(instrumentArtifacts == null ? { schema: 'lemmings-immutable-browser-input/v1', files, recipe } :
      { schema: 'lemmings-immutable-browser-input/v2', files, recipe, instrumentProfiles, instrumentArtifacts }), hashData(files), hashData(assets), hashData(code)
  ]);
  return Object.freeze({ buildId, closureDigest, assetDigest, codeDigest, harnessVersion: 'browser-survey-v1',
    identityRecipe: instrumentArtifacts == null ? 'normalized-data-slot-v1' : 'normalized-data-slot-v2-instruments',
    ...(instrumentArtifacts == null ? {} : { instrumentArtifacts }) });
};

export const renderBrowserBuildIdentity = (template, identity) => {
  if (typeof template !== 'string' || template.split(BUILD_IDENTITY_SLOT).length !== 2) throw new Error('Unsupported browser identity generation slot.');
  const { instrumentArtifacts, ...scalars } = identity;
  const expression = instrumentArtifacts == null ? `Object.freeze(${JSON.stringify(identity)})` :
    `Object.freeze({...${JSON.stringify(scalars)},instrumentArtifacts:Object.freeze([${instrumentArtifacts.map(artifact => `Object.freeze(${JSON.stringify(artifact)})`).join(',')}])})`;
  return template.replace(BUILD_IDENTITY_SLOT, `const APPLICATION_BUILD = ${expression}; // IMMUTABLE_APPLICATION_BUILD_SLOT`);
};

export const verifyBrowserBuildManifest = async (manifest, { expectedBuildId = null, template = null } = {}) => {
  if (!manifest || manifest.schema !== BROWSER_BUILD_SCHEMA || !hashPattern.test(manifest.buildId) ||
      expectedBuildId != null && manifest.buildId !== expectedBuildId || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 8192 ||
      !Array.isArray(manifest.recipe) || ![3, 4, recipePaths.length].includes(manifest.recipe.length) ||
      !Array.isArray(manifest.routes) || manifest.routes.length < requiredEntryRoutes.length || manifest.routes.length > BROWSER_ENTRY_ROUTES.length ||
      new Set(manifest.routes).size !== manifest.routes.length || manifest.routes.some(route => !BROWSER_ENTRY_ROUTES.includes(route)) ||
      requiredEntryRoutes.some(route => !manifest.routes.includes(route))) throw new Error('Unsupported browser build manifest.');
  const files = [], seen = new Set(); let totalBytes = 0;
  for (const file of manifest.files) {
    if (!validBrowserBuildPath(file?.path) || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 16 * 1048576 ||
        !hashPattern.test(file.sha256)) throw new Error('Invalid browser build file inventory.');
    seen.add(file.path); totalBytes += file.bytes;
    if (totalBytes > 256 * 1048576) throw new Error('Browser generation exceeds its declared byte budget.');
    files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  if (totalBytes !== manifest.sourceBytes || manifest.assetProfile !== 'tracked-bundled-packs' || !seen.has(BUILD_IDENTITY_PATH) ||
      BROWSER_ENTRY_ROUTES.some(route => seen.has(route) !== manifest.routes.includes(route))) throw new Error('Browser generation has inconsistent required files.');
  const recipe = manifest.recipe.map((file, index) => {
    if (file?.path !== recipePaths[index] || !hashPattern.test(file.sha256)) throw new Error('Unsupported browser build recipe.');
    return { path: file.path, sha256: file.sha256 };
  });
  const normalization = manifest.sourceNormalization;
  if (normalization?.path !== BUILD_IDENTITY_PATH || !hashPattern.test(normalization.templateSha256) ||
      !Number.isSafeInteger(normalization.templateBytes) || normalization.templateBytes < 1 || normalization.templateBytes > 65536 ||
      normalization.templatePath !== BUILD_TEMPLATE_PATH) throw new Error('Unsupported browser build normalization.');
  if (totalBytes + normalization.templateBytes > 256 * 1048576) throw new Error('Browser generation plus its template exceeds its byte budget.');
  const normalized = files.map(file => file.path === BUILD_IDENTITY_PATH ?
    { path: file.path, bytes: normalization.templateBytes, sha256: normalization.templateSha256 } : file).sort((a, b) => before(a.path, b.path));
  if ((manifest.instrumentArtifactProfiles != null) !== (recipe.length === 5)) throw new Error('Browser instrument inventory requires its pinned build recipe.');
  const identity = await computeBrowserBuildIdentity(normalized, recipe, manifest.instrumentArtifactProfiles ?? null);
  for (const field of Object.keys(identity)) if (JSON.stringify(manifest[field]) !== JSON.stringify(identity[field])) throw new Error('Browser build identity does not bind its complete inventory.');
  if (template != null) {
    const bytes = new TextEncoder().encode(template);
    if (bytes.byteLength !== normalization.templateBytes || await hashBrowserBuildBytes(bytes) !== normalization.templateSha256) throw new Error('Browser build identity template changed.');
    const generated = new TextEncoder().encode(renderBrowserBuildIdentity(template, identity)), carrier = files.find(file => file.path === BUILD_IDENTITY_PATH);
    if (generated.byteLength !== carrier.bytes || await hashBrowserBuildBytes(generated) !== carrier.sha256) throw new Error('Browser build carrier does not follow its bound generation recipe.');
  }
  return Object.freeze({ identity, files: Object.freeze(files.map(Object.freeze)), templateVerified: template != null,
    totalBytes, templatePath: BUILD_TEMPLATE_PATH, templateSha256: normalization.templateSha256, templateBytes: normalization.templateBytes });
};
