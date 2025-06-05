#!/usr/bin/env node
/**
 * build_index.js
 * Build a local TF-IDF search index 
 *
 * Usage:
 *   node scripts/build_index.js --root . --out embeddings.json --chunk 750
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------- CLI args ----------
const args = Object.fromEntries(
  process.argv.slice(2)
    .map(a => a.startsWith('--') ? a.slice(2).split('=') : [])
    .filter(p => p.length === 2)
);
const ROOT        = args.root  || '.';
const OUT         = args.out   || 'embeddings.json';
const CHUNK_SIZE  = Number(args.chunk) || 750;

// ---------- Config ----------
const VALID_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|json|md|txt|html|css)$/i;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.idea', 'dist', 'coverage', '.agentInfo', '.github'
]);

// ---------- Data holders ----------
const vocab = new Map(); // token → index
const df    = new Map(); // token → doc freq
const chunks = [];
let chunkCounter = 0;

// ---------- Helpers ----------
const tokenize = txt =>
  txt.toLowerCase().split(/[^a-z0-9_]+/u).filter(Boolean);

async function walk(dir) {
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
      continue;
    }
    if (!VALID_EXT.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    const data = await fs.readFile(filePath, 'utf8');
    chunkFile(filePath, data);
  }
}

function chunkFile(filePath, text) {
  const words = tokenize(text);
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const slice = words.slice(i, i + CHUNK_SIZE);
    const localFreq = new Map();
    slice.forEach(w => localFreq.set(w, (localFreq.get(w) || 0) + 1));

    // update vocab & document frequency
    new Set(slice).forEach(tok => {
      if (!vocab.has(tok)) vocab.set(tok, vocab.size);
      df.set(tok, (df.get(tok) || 0) + 1);
    });

    chunks.push({
      id: chunkCounter++,
      file: filePath,
      start: i,
      end: Math.min(i + CHUNK_SIZE, words.length),
      tokens: localFreq                                 // temp
    });
  }
}

function buildVector(freqMap, numDocs) {
  const vec = new Float32Array(vocab.size);
  let norm = 0;
  for (const [tok, tf] of freqMap) {
    const idx = vocab.get(tok);
    const idf = Math.log((numDocs + 1) / ((df.get(tok) || 0) + 1)) + 1;
    const val = tf * idf;
    vec[idx] = val;
    norm += val * val;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return Array.from(vec); // serialise
}

// ---------- Main ----------
(async () => {
  console.time('build-index');
  await walk(path.resolve(ROOT));
  const numDocs = chunks.length;

  const finished = chunks.map(c => ({
    id: c.id,
    file: path.relative(ROOT, c.file),
    start: c.start,
    end: c.end,
    vector: buildVector(c.tokens, numDocs)
  }));

  await fs.writeFile(
    OUT,
    JSON.stringify({numDocs, vocab: Object.fromEntries(vocab), chunks: finished})
  );
  console.timeEnd('build-index');
  console.log(`Wrote ${numDocs} chunks → ${OUT}`);
})();
