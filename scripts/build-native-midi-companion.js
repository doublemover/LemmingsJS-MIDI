import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export const nativeMidiBuildDirectory = path.join(root, 'node_modules/.cache/lemmings-midi-companion', process.platform + '-' + process.arch);
export const nativeMidiExecutable = path.join(nativeMidiBuildDirectory, 'lemmings-midi-companion' + (process.platform === 'win32' ? '.exe' : ''));
const execute = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, shell: false });
  child.on('error', reject); child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(command + ' failed: ' + (signal || code))));
});
async function sdkArchive() {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'native/midi-companion/sdk-dependencies.json'), 'utf8')).windowsMidiServices;
  const target = path.join(nativeMidiBuildDirectory, 'windows-midi-sdk.nupkg');
  const valid = bytes => bytes.length === lock.bytes && createHash('sha256').update(bytes).digest('hex') === lock.sha256;
  try { if (valid(await fs.readFile(target))) return target; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(lock.url, { signal: globalThis.AbortSignal.timeout(120000) }); if (!response.ok) throw new Error('Pinned SDK download failed: ' + response.status);
  const chunks = []; let count = 0;
  for await (const chunk of response.body) { count += chunk.length; if (count > lock.bytes) throw new Error('Pinned SDK capacity exceeded'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks); if (!valid(bytes)) throw new Error('Pinned SDK digest mismatch');
  const temporary = target + '.' + randomBytes(8).toString('hex');
  try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, target); } finally { await fs.rm(temporary, { force: true }); }
  return target;
}
function windowsCompiler(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true, shell: false });
  const resolved = result.status === 0 && result.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean);
  if (!resolved || !path.isAbsolute(resolved)) throw new Error('Install ' + command + ' on PATH before building the native companion.');
  return path.normalize(resolved).replaceAll('\\', '/');
}
export async function buildNativeMidiCompanion() {
  await fs.mkdir(nativeMidiBuildDirectory, { recursive: true });
  const options = ['-S', path.join(root, 'native/midi-companion'), '-B', nativeMidiBuildDirectory, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release'];
  if (process.env.CXX) options.push('-DCMAKE_CXX_COMPILER=' + process.env.CXX);
  else if (process.platform === 'win32') options.push('-DCMAKE_CXX_COMPILER=' + windowsCompiler('clang++'), '-DCMAKE_C_COMPILER=' + windowsCompiler('clang'));
  if (process.platform === 'win32') options.push('-DLIBREMIDI_WINMIDI_HEADERS_ZIP=' + await sdkArchive());
  await execute('cmake', options); await execute('cmake', ['--build', nativeMidiBuildDirectory, '--target', 'lemmings-midi-companion', '--parallel', '2']);
  console.log('Built ' + nativeMidiExecutable + '. Device and transport qualification remains separate.'); return nativeMidiExecutable;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) buildNativeMidiCompanion().catch(error => { console.error(error.message); process.exitCode = 1; });
