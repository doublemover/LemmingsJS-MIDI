import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'mcpb');

const COPY_LIST = [
  { from: 'mcpb/manifest.json', to: 'manifest.json' },
  { from: 'mcpb/server.json', to: 'server.json' },
  { from: 'mcpb/.mcpbignore', to: '.mcpbignore' },
  { from: 'mcpb/package.json', to: 'package.json' },
  { from: 'keybindings.json', to: 'keybindings.json' },
  { from: 'mcp/server.js', to: 'mcp/server.js' },
  { from: 'mcp/spectator.html', to: 'mcp/spectator.html', optional: true }
];

const ensureDir = async (filePath) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
};

const copyFile = async (entry) => {
  const source = path.join(ROOT_DIR, entry.from);
  const destination = path.join(DIST_DIR, entry.to);
  try {
    await ensureDir(destination);
    await fs.copyFile(source, destination);
    return true;
  } catch (err) {
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
  console.log(`MCPB bundle staged at ${relative}`);
};

await buildBundle();
