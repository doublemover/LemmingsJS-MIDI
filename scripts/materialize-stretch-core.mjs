import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OWNED_STRETCH_CORE } from '../js/midi/content/OwnedStretchCoreIdentity.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
export function extractPinnedStretchCore(source) {
  if (!(source instanceof Uint8Array) || source.byteLength !== OWNED_STRETCH_CORE.sourceBytes || sha256(source) !== OWNED_STRETCH_CORE.sourceSha256) throw new Error('The upstream source differs from its exact pinned byte identity.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source), matches = [...text.matchAll(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/g)];
  if (matches.length !== 1) throw new Error('The pinned source does not contain one exact embedded WASM artifact.');
  const bytes = Buffer.from(matches[0][1], 'base64');
  if (bytes.byteLength !== OWNED_STRETCH_CORE.wasmBytes || sha256(bytes) !== OWNED_STRETCH_CORE.wasmSha256 || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('The embedded WASM differs from the pinned compiled artifact.');
  return bytes;
}
export async function materializePinnedStretchCore({ rootDir, output = 'dist/assets/signalsmith-stretch-core.wasm', sourceFile = null, fetchImpl = globalThis.fetch } = {}) {
  const root = await fs.realpath(path.resolve(rootDir)), dist = path.join(root, 'dist'), target = path.resolve(root, output), relative = path.relative(dist, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || path.extname(target) !== '.wasm') throw new Error('The immutable core artifact must be materialized inside this workspace dist directory.');
  const verifyExisting = async () => { try { const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== OWNED_STRETCH_CORE.wasmBytes) throw new Error('An existing output differs from the pinned core; it was preserved.'); const bytes = await fs.readFile(target); if (sha256(bytes) !== OWNED_STRETCH_CORE.wasmSha256) throw new Error('An existing output differs from the pinned core; it was preserved.'); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  let ancestor = path.dirname(target);
  while (true) { try { const resolved = await fs.realpath(ancestor), rel = path.relative(root, resolved); if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('The artifact output ancestor escapes the workspace.'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); } }
  if (!await verifyExisting()) {
    let source;
    if (sourceFile) { const stat = await fs.stat(sourceFile); if (!stat.isFile() || stat.size !== OWNED_STRETCH_CORE.sourceBytes) throw new Error('The local upstream source has a different bounded size.'); source = await fs.readFile(sourceFile); }
    else {
      const response = await fetchImpl(OWNED_STRETCH_CORE.sourceUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('The exact upstream artifact source is unavailable.');
      source = new Uint8Array(OWNED_STRETCH_CORE.sourceBytes); let offset = 0;
      for await (const chunk of response.body) { if (!(chunk instanceof Uint8Array) || offset + chunk.byteLength > source.byteLength) throw new Error('The upstream source exceeds its pinned bounded size.'); source.set(chunk, offset); offset += chunk.byteLength; }
      if (offset !== source.byteLength) throw new Error('The upstream source is truncated.');
    }
    const bytes = extractPinnedStretchCore(source); await fs.mkdir(path.dirname(target), { recursive: true }); const temporary = target + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); if (!await verifyExisting()) await fs.rename(temporary, target); }
    finally { try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  return { path: target, bytes: OWNED_STRETCH_CORE.wasmBytes, sha256: OWNED_STRETCH_CORE.wasmSha256, sourceSha256: OWNED_STRETCH_CORE.sourceSha256, sourceCommit: OWNED_STRETCH_CORE.commit,
    content: 'lossless-static-extraction;no-upstream-JavaScript-or-WASM-executed', qualification: 'not-established-by-materialization' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = { rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') }; let name = 'builder';
  for (const arg of process.argv.slice(2)) { if (arg.startsWith('--name=')) name = arg.slice(7); else if (arg.startsWith('--output=')) options.output = arg.slice(9); else if (arg.startsWith('--source=')) options.sourceFile = path.resolve(arg.slice(9)); else throw new Error('Unknown core preparation option: ' + arg); }
  process.stdout.write(JSON.stringify({ name, ...await materializePinnedStretchCore(options) }) + '\n');
}
