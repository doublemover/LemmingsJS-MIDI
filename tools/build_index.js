#!/usr/bin/env node
/**
 * scripts/build_index.js
 * ----------------------------------------------------
 * Build a local TF-IDF search index that is **bit-for-bit
 * identical** across Windows, Linux, or macOS.
 *
 * Usage:
 *   node scripts/build_index.js --root . --out embeddings.json --chunk 750
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------- CLI args ----------
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))               // ['root', '.']
);
const ROOT       = args.root  || '.';
const OUT        = args.out   || 'embeddings.json';
const CHUNK_SIZE = Number(args.chunk) || 750;

// ---------- Config ----------
const VALID_EXT = /\.(js|ts|jsx|tsx|mjs|cjs|json|md|txt|html|css)$/i;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.idea', 'dist', 'coverage',
  '.agentInfo', '.github'
]);

// ---------- Data holders ----------
const df       = new Map();      // token → document frequency
const chunks   = [];             // {file,start,end,tokens}
const allWords = new Set();      // collect tokens for deterministic vocab
let chunkId    = 0;

// ---------- Helpers ----------
const tokenize = txt =>
  txt.toLowerCase().split(/[^a-z0-9_]+/u).filter(Boolean);

/** POSIX-style relative path (src/foo.js) regardless of OS */
const relPosix = abs =>
  path.relative(ROOT, abs).split(path.sep).join('/');

/** Recursively walk directory in **sorted** order for determinism */
async function walk(dir) {
  const entries = (await fs.readdir(dir, { withFileTypes: true }))
                      .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full);
      continue;
    }

    if (!VALID_EXT.test(entry.name)) continue;

    const data  = await fs.readFile(full, 'utf8');
    const words = tokenize(data);

    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const slice   = words.slice(i, i + CHUNK_SIZE);
      const tfLocal = new Map();

      slice.forEach(w => tfLocal.set(w, (tfLocal.get(w) || 0) + 1));

      // doc-frequency & global vocab
      new Set(slice).forEach(tok => {
        df.set(tok, (df.get(tok) || 0) + 1);
        allWords.add(tok);
      });

      chunks.push({
        id: chunkId++,
        file: relPosix(full),
        start: i,
        end: Math.min(i + CHUNK_SIZE, words.length),
        tokens: tfLocal            // temp – converted later
      });
    }
  }
}

// ---------- Build deterministic vocab ----------
function buildVocab() {
  return Array.from(allWords).sort();              // α-order
}

// ---------- Vector builder ----------
function vectorise(tfMap, vocab, numDocs) {
  const vec = new Float32Array(vocab.length);
  let norm = 0;

  for (const [tok, tf] of tfMap) {
    const idx = vocab.indexOf(tok);                // O(v) but small tfMap
    if (idx === -1) continue;
    const idf = Math.log((numDocs + 1) / ((df.get(tok) || 0) + 1)) + 1;
    const val = tf * idf;
    vec[idx] = val;
    norm += val * val;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return Array.from(vec);                          // serialisable
}

// ---------- MAIN ----------
(async () => {
  console.time('build-index');
  await walk(path.resolve(ROOT));

  const vocab = buildVocab();
  const numDocs = chunks.length;

  const finished = chunks
    .map(c => ({
      id: c.id,
      file: c.file,
      start: c.start,
      end: c.end,
      vector: vectorise(c.tokens, vocab, numDocs)
    }))
    .sort((a, b) =>
      a.file === b.file ? a.start - b.start
                        : a.file.localeCompare(b.file, 'en')
    );

  const out = {
    numDocs,
    vocab: Object.fromEntries(vocab.map((t, i) => [t, i])),
    chunks: finished
  };

  await fs.writeFile(
    OUT,
    JSON.stringify(out, null, 0) + '\n',          // final \n for git diff
    'utf8'
  );
  console.timeEnd('build-index');
  console.log(`Wrote ${numDocs} chunks → ${OUT}`);
})();
