import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const VALID_SURFACES = new Set(['game', 'editor', 'interact']);

const parseArgs = (argv) => {
  const out = {
    surface: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--surface=')) {
      out.surface = arg.slice('--surface='.length).trim();
      continue;
    }
    if (arg === '--surface') {
      out.surface = String(argv[i + 1] || '').trim();
      i += 1;
    }
  }
  if (out.surface && !VALID_SURFACES.has(out.surface)) {
    throw new Error(`Invalid surface "${out.surface}". Expected one of: ${Array.from(VALID_SURFACES).join(', ')}.`);
  }
  return out;
};

const options = parseArgs(process.argv.slice(2));
const DIST_DIR = options.surface
  ? path.join(ROOT_DIR, 'dist', `mcpb-${options.surface}`)
  : path.join(ROOT_DIR, 'dist', 'mcpb');

const resolveSurfaceFile = (kind, fallbackPath) => {
  if (!options.surface) return fallbackPath;
  const candidate = `mcpb/${kind}.${options.surface}.json`;
  return { candidate, fallbackPath };
};

const manifestPath = resolveSurfaceFile('manifest', 'mcpb/manifest.json');
const packagePath = resolveSurfaceFile('package', 'mcpb/package.json');

const COPY_LIST = [
  {
    from: manifestPath.fallbackPath || manifestPath,
    to: 'manifest.json',
    candidate: manifestPath.candidate || null
  },
  { from: 'mcpb/server.json', to: 'server.json' },
  { from: 'mcpb/.mcpbignore', to: '.mcpbignore' },
  {
    from: packagePath.fallbackPath || packagePath,
    to: 'package.json',
    candidate: packagePath.candidate || null
  },
  { from: 'keybindings.json', to: 'keybindings.json' },
  { from: 'mcp/server.js', to: 'mcp/server.js' },
  { from: 'mcp/spectator.html', to: 'mcp/spectator.html', optional: true }
];

const ensureDir = async (filePath) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
};

const copyFile = async (entry) => {
  const sourcePath = entry.candidate
    ? path.join(ROOT_DIR, entry.candidate)
    : path.join(ROOT_DIR, entry.from);
  const fallbackPath = path.join(ROOT_DIR, entry.from);
  const destination = path.join(DIST_DIR, entry.to);
  try {
    await ensureDir(destination);
    await fs.copyFile(sourcePath, destination);
    return true;
  } catch (err) {
    if (entry.candidate && err && err.code === 'ENOENT') {
      await ensureDir(destination);
      await fs.copyFile(fallbackPath, destination);
      return true;
    }
    if (entry.optional && err && err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
};

const buildBundle = async () => {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });

  for (const entry of COPY_LIST) {
    await copyFile(entry);
  }

  const relative = path.relative(ROOT_DIR, DIST_DIR);
  const suffix = options.surface ? ` (surface: ${options.surface})` : '';
  console.log(`MCPB bundle staged at ${relative}${suffix}`);
};

await buildBundle();
