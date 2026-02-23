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
      out.surface = arg.slice('--surface='.length).trim().toLowerCase();
      continue;
    }
    if (arg === '--surface') {
      out.surface = String(argv[i + 1] || '').trim().toLowerCase();
      i += 1;
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
  return [
    {
      from: manifestPath.fallbackPath,
      to: 'manifest.json',
      candidate: manifestPath.candidate
    },
    { from: 'mcpb/server.json', to: 'server.json', candidate: null },
    { from: 'mcpb/.mcpbignore', to: '.mcpbignore', candidate: null },
    {
      from: packagePath.fallbackPath,
      to: 'package.json',
      candidate: packagePath.candidate
    },
    { from: 'keybindings.json', to: 'keybindings.json', candidate: null },
    { from: 'mcp/server.js', to: 'mcp/server.js', candidate: null },
    { from: 'mcp/spectator.html', to: 'mcp/spectator.html', candidate: null, optional: true }
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
 * @param {{
 *   argv?: string[],
 *   rootDir?: string,
 *   fsImpl?: Pick<typeof fs, 'copyFile' | 'mkdir' | 'rm'>,
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
  parseArgs,
  resolveSurfaceFile
};
