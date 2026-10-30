import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { collectRuntimeSourceClosure, discoverRuntimeDependencies } from './RuntimeSourceClosure.js';
import { BROWSER_ENTRY_ROUTES } from '../js/runtime/BrowserBuildManifest.js';

const execute = promisify(execFile), base = new URL('https://build.invalid/');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const localResource = (specifier, importer) => {
  const url = new URL(specifier, new URL(importer, base));
  if (url.origin !== base.origin || url.hash || url.search) throw new Error(`Runtime resource requires an explicit immutable local URL: ${specifier} in ${importer}`);
  const relative = decodeURIComponent(url.pathname.slice(1));
  if (!relative || relative.split('/').some(part => !part || part === '..' || part === '.') || relative.includes('\\')) throw new Error(`Invalid browser runtime resource: ${specifier}`);
  return relative;
};

export async function collectBrowserRuntimeClosure({ rootDir, routes = BROWSER_ENTRY_ROUTES, inventory = null,
  fsImpl = fs, maxFiles = 8192, maxBytes = 256 * 1048576 } = {}) {
  const root = path.resolve(rootDir), resources = new Set(['keybindings.json', 'config.json', 'site.webmanifest', 'provenance/runtime-artifacts.json']);
  const entries = new Set(['js/runtime/ActiveExecutionIdentity.js', 'js/runtime/BrowserBuildManifest.js',
    'js/runtime/BrowserGenerationService.js', 'js/runtime/BrowserGenerationClient.js']);
  for (const route of routes) {
    const relative = localResource(route, 'index.html'); resources.add(relative);
    const $ = load(await fsImpl.readFile(path.join(root, relative), 'utf8'));
    for (const element of $('script[src], link[href], img[src]').toArray()) {
      const node = $(element), tag = element.tagName;
      if (tag === 'link' && !['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'manifest'].includes(node.attr('rel'))) continue;
      const target = localResource(node.attr(tag === 'link' ? 'href' : 'src'), relative);
      if (tag === 'script') entries.add(target); else resources.add(target);
    }
    for (const element of $('script:not([src])').toArray()) {
      const node = $(element), type = node.attr('type') || 'text/javascript';
      if (!['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
      for (const dependency of discoverRuntimeDependencies(relative, node.text())) resources.add(localResource(dependency, relative));
    }
  }
  const packs = JSON.parse(await fsImpl.readFile(path.join(root, 'config.json'), 'utf8')).map(pack => pack.path);
  if (packs.some(pack => typeof pack !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pack))) throw new Error('Offline pack roots require explicit local folder identities.');
  const assetRoots = ['assets', 'img', 'css', ...packs];
  const files = inventory ?? (await execute('git', ['ls-files', '-z', '--', ...assetRoots], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1048576 })).stdout.split('\0').filter(Boolean);
  for (const file of files) {
    if (!assetRoots.some(folder => file.startsWith(folder + '/'))) throw new Error(`Unexpected browser asset inventory path: ${file}`);
    resources.add(file);
  }
  const styles = [...resources].filter(file => file.endsWith('.css')), inspectedStyles = new Set();
  while (styles.length) {
    const stylesheet = styles.pop(); if (inspectedStyles.has(stylesheet)) continue;
    inspectedStyles.add(stylesheet);
    const source = (await fsImpl.readFile(path.join(root, stylesheet), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    const urls = [...source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)].map(match => match[1] ?? match[2] ?? match[3]);
    urls.push(...[...source.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)')/gi)].map(match => match[1] ?? match[2]));
    for (const raw of urls) {
      const specifier = raw.trim(); if (!specifier || specifier.startsWith('data:') || specifier.startsWith('#')) continue;
      if (specifier.includes('\\') || specifier.includes('(')) throw new Error(`CSS resource needs an explicit packaging contract: ${stylesheet}`);
      const target = localResource(specifier, stylesheet); resources.add(target);
      if (target.endsWith('.css')) styles.push(target);
    }
  }
  const closure = await collectRuntimeSourceClosure({ rootDir: root, entries: [...entries].sort(compare), resources: [...resources].sort(compare), fsImpl, maxFiles, maxBytes });
  if (closure.dependencies.length) throw new Error(`Unresolved browser package dependencies: ${closure.dependencies.join(', ')}`);
  const codeFiles = [], assetFiles = [];
  for (const file of closure.files) (/\.(?:[cm]?js|wasm)$/.test(file.path) ? codeFiles : assetFiles).push(file);
  const closureDigest = digest(closure.files), codeDigest = digest(codeFiles), assetDigest = digest(assetFiles);
  return { ...closure, schema: 'lemmings-browser-runtime-closure/v1', routes: [...routes], assetProfile: 'tracked-bundled-packs',
    closureDigest, codeDigest, assetDigest, codeFiles, assetFiles,
    executionQualification: 'artifact-inventory-only-until-generated-immutable-entry-executes' };
}
