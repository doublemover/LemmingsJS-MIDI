import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const VALID_SURFACES = new Set(['game', 'editor', 'interact']);

/**
 * @param {string[]} argv
 * @returns {{surface: string | null}}
 */
const parseArgs = (argv) => {
  const out = {
    surface: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--surface=')) {
      const value = arg.slice('--surface='.length).trim();
      if (!value) {
        throw new Error('Missing value for --surface');
      }
      out.surface = value.toLowerCase();
      continue;
    }
    if (arg === '--surface') {
      const value = String(argv[i + 1] || '').trim();
      if (!value) {
        throw new Error('Missing value for --surface');
      }
      out.surface = value.toLowerCase();
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (out.surface && !VALID_SURFACES.has(out.surface)) {
    throw new Error(`Invalid surface "${out.surface}". Expected one of: ${Array.from(VALID_SURFACES).join(', ')}.`);
  }
  return out;
};

/**
 * @param {string|null} surface
 * @param {string} kind
 * @param {string} fallbackPath
 * @returns {{candidate: string|null, fallbackPath: string}}
 */
const resolveSurfaceFile = (surface, kind, fallbackPath) => {
  if (!surface) return { candidate: null, fallbackPath };
  return {
    candidate: `mcpb/${kind}.${surface}.json`,
    fallbackPath
  };
};

/**
 * @param {string|null} surface
 * @returns {Array<{from: string, to: string, candidate: string|null, optional?: boolean}>}
 */
const createCopyList = (surface) => {
  const manifestPath = resolveSurfaceFile(surface, 'manifest', 'mcpb/manifest.json');
  const packagePath = resolveSurfaceFile(surface, 'package', 'mcpb/package.json');
  const serverPath = resolveSurfaceFile(surface, 'server', 'mcpb/server.json');
  return [
    {
      from: manifestPath.fallbackPath,
      to: 'manifest.json',
      candidate: manifestPath.candidate
    },
    {
      from: serverPath.fallbackPath,
      to: 'server.json',
      candidate: serverPath.candidate
    },
    { from: 'mcpb/.mcpbignore', to: '.mcpbignore', candidate: null },
    {
      from: packagePath.fallbackPath,
      to: 'package.json',
      candidate: packagePath.candidate
    },
    { from: 'keybindings.json', to: 'keybindings.json', candidate: null }
  ];
};

/**
 * @param {string} filePath
 * @param {{mkdir: typeof fs.mkdir}} [fsImpl]
 */
const ensureDir = async (filePath, fsImpl = fs) => {
  const dir = path.dirname(filePath);
  await fsImpl.mkdir(dir, { recursive: true });
};

/**
 * @param {{from: string, to: string, candidate: string|null, optional?: boolean}} entry
 * @param {{
 *   distDir: string,
 *   rootDir?: string,
 *   fsImpl?: Pick<typeof fs, 'copyFile' | 'mkdir'>
 * }} context
 * @returns {Promise<boolean>}
 */
const copyFile = async (entry, { distDir, rootDir = ROOT_DIR, fsImpl = fs }) => {
  const sourcePath = entry.candidate
    ? path.join(rootDir, entry.candidate)
    : path.join(rootDir, entry.from);
  const fallbackPath = path.join(rootDir, entry.from);
  const destination = path.join(distDir, entry.to);
  try {
    await ensureDir(destination, fsImpl);
    await fsImpl.copyFile(sourcePath, destination);
    return true;
  } catch (err) {
    if (entry.candidate && err && err.code === 'ENOENT') {
      await ensureDir(destination, fsImpl);
      await fsImpl.copyFile(fallbackPath, destination);
      return true;
    }
    if (entry.optional && err && err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
};

/**
 * @param {string} fromDir
 * @param {string} toDir
 * @param {Pick<typeof fs, 'copyFile' | 'mkdir' | 'readdir' | 'stat'>} fsImpl
 */
const copyDirectory = async (fromDir, toDir, fsImpl = fs) => {
  await fsImpl.mkdir(toDir, { recursive: true });
  const entries = await fsImpl.readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(fromDir, entry.name);
    const destinationPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, fsImpl);
      continue;
    }
    if (!entry.isFile()) continue;
    await ensureDir(destinationPath, fsImpl);
    await fsImpl.copyFile(sourcePath, destinationPath);
  }
};

/**
 * @param {{
 *   argv?: string[],
 *   rootDir?: string,
 *   fsImpl?: Pick<typeof fs, 'copyFile' | 'mkdir' | 'rm' | 'readdir' | 'stat'>,
 *   log?: Pick<typeof console, 'log'>
 * }} [options]
 * @returns {Promise<{distDir: string, surface: string | null}>}
 */
const buildBundle = async (
  {
    argv = process.argv.slice(2),
    rootDir = ROOT_DIR,
    fsImpl = fs,
    log = console
  } = {}
) => {
  const options = parseArgs(argv);
  const distDir = options.surface
    ? path.join(rootDir, 'dist', `mcpb-${options.surface}`)
    : path.join(rootDir, 'dist', 'mcpb');
  const copyList = createCopyList(options.surface);

  await fsImpl.rm(distDir, { recursive: true, force: true });
  await fsImpl.mkdir(distDir, { recursive: true });
  for (const entry of copyList) {
    await copyFile(entry, { distDir, rootDir, fsImpl });
  }
  await copyDirectory(path.join(rootDir, 'mcp'), path.join(distDir, 'mcp'), fsImpl);

  const relative = path.relative(rootDir, distDir);
  const suffix = options.surface ? ` (surface: ${options.surface})` : '';
  log.log(`MCPB bundle staged at ${relative}${suffix}`);
  return { distDir, surface: options.surface };
};

const isMainModule = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  await buildBundle();
}

export {
  VALID_SURFACES,
  buildBundle,
  createCopyList,
  copyDirectory,
  parseArgs,
  resolveSurfaceFile
};
