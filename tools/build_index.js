#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import seedrandom from 'seedrandom';
import { SVD } from 'svd-js';
import strip from 'strip-comments';
const listComments = strip.list;
import { updateUsageCounts } from './updateUsageCounts.js';

/* -------- CLI & constants -------- */
const argv = minimist(process.argv.slice(2), {
  default: { mode: 'all', chunk: 600, dims: 512 }
});
// mode: 'prose', 'code', or 'all'
const MODES = argv.mode === 'all' ? ['prose', 'code'] : [argv.mode];
const CHUNK = +argv.chunk;
const DIMS = +argv.dims;
const ROOT = process.cwd();
const metricsDir = path.join(ROOT, '.repoMetrics');
await fs.mkdir(metricsDir, { recursive: true });
const usagePath = path.join(metricsDir, 'usageCounts.json');
let usage = {};
try {
  usage = JSON.parse(await fs.readFile(usagePath, 'utf8'));
} catch {
  usage = {};
}
usage.build_index = (usage.build_index || 0) + 1;
await fs.writeFile(usagePath, JSON.stringify(usage) + '\n');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'index-code', 'index-prose',
  'lemmings', 'lemmings_all', 'lemmings_ohNo', 'holiday93', 'holiday94',
  'xmas91', 'xmas92', 'img', '.github', '.repoMetrics', 'exports', 'css'
]);


/* -------- text helpers ---------- */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from',
  'into', 'when', 'where', 'which', 'while'
]);
const SYN = { err: 'error', cfg: 'config', msg: 'message', init: 'initialize' };
const snow = Snowball.newStemmer('english');
const stem = (w) => (typeof w === 'string' ? snow.stem(w) : '');
const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const tok = (t) =>
  camel(t.replace(/\./g, ' '))
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter(Boolean);

const rng = seedrandom('42');
const gauss = () => {
  let u, v, s;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (!s || s >= 1);
  return u * Math.sqrt(-2 * Math.log(s));
};
const tri = (w) => {
  const s = `⟬${w}⟭`;
  const g = [];
  for (let i = 0; i < s.length - 2; i++) {
    g.push(s.slice(i, i + 3));
  }
  return g;
};

/* -------- robust comment extractor -------- */
function extractComments(src) {
  try {
    return listComments(src, { keepProtected: true })
      .map((c) => c.value)
      .join('\n');
  } catch {
    return '';
  }
}

/* ╭──────────────────────────────────────────╮
   │       MAIN BUILD FUNCTION (code/prose)   │
   ╰──────────────────────────────────────────╯ */
async function build(mode) {
  const OUT = `index-${mode}`;
  await fs.mkdir(OUT, { recursive: true });
  console.log(`\n📄  Scanning ${mode} …`);

  // DF = document frequency per token
  const df = new Map();
  // wordFreq = total frequency per token (for the final wordInfo.json)
  const wordFreq = new Map();
  // chunks = array of { file, start, len, tf: Map(token→count) }
  const chunks = [];
  // triPost: only used for code mode, char‐trigram postings
  const triPost = new Map();

  let filesAdd = 0,
    filesSkip = 0,
    totalTokens = 0;

  // Lists to log scanned and skipped files
  const scannedPath = path.join(OUT, '.scannedFiles');
  const skippedPath = path.join(OUT, '.skippedFiles');
  await fs.writeFile(scannedPath, ''); // clear or create
  await fs.writeFile(skippedPath, '');

  const SKIP_FILES = new Set([
    'sparse_postings.json',
    'dense_vectors_uint8.json',
    'chunk_meta.json',
    'char3_postings.json',
    'wordInfo.json',
    'package.json',
    'package-lock.json',
    'searchHistory',
    '.gitignore',
    '.gitattributes',
    '.jshintconfig',
    '.jshintignore',
    '.eslint.config.js',
    'site.webmanifest',
    'jquery.js',
    'webmidi.js',
    'noresultqueries',
    'metrics.json',
    'fileformat.txt'
  ]);

  /* -- INGEST A SINGLE FILE: read/normalize/extract text, THEN build chunks -- */
  async function ingest(abs) {
    // Filter by filename substrings
    for (const str of SKIP_FILES) {
      if (abs.includes(str)) {
        filesSkip++;
        await fs.appendFile(skippedPath, JSON.stringify({ file: abs }) + '\n');
        return;
      }
    }
    // Filter by extension
    if (/\.(png|jpg|gif|dat|bmp|zip)$/i.test(abs)) {
      filesSkip++;
      await fs.appendFile(skippedPath, JSON.stringify({ file: abs }) + '\n');
      return;
    }

    let text = (await fs.readFile(abs, 'utf8')).normalize('NFKD');
    const isMd = abs.toLowerCase().endsWith('.md');

    if (mode === 'prose') {
      if (!isMd) {
        text = extractComments(text);
      }
    } else {
      if (isMd) {
        filesSkip++;
        await fs.appendFile(skippedPath, JSON.stringify({ file: abs }) + '\n');
        return;
      }
    }

    if (!text.trim()) {
      filesSkip++;
      await fs.appendFile(skippedPath, JSON.stringify({ file: abs }) + '\n');
      return;
    }

    // Log as scanned
    await fs.appendFile(scannedPath, JSON.stringify({ file: abs }) + '\n');

    // tokenize into words
    let words = tok(text);
    if (mode === 'prose') {
      words = words.filter((w) => !STOP.has(w));
    }

    // synonyms expansion
    const seq = [];
    for (const w of words) {
      seq.push(w);
      if (SYN[w]) seq.push(SYN[w]);
    }

    totalTokens += seq.length;
    filesAdd++;

    // split into CHUNK‐sized chunks
    for (let off = 0; off < seq.length; off += CHUNK) {
      const grams = [];
      for (let i = 0; i < CHUNK && off + i < seq.length; i++) {
        const a = stem(seq[off + i]);
        grams.push(a);
        if (i < CHUNK - 1 && off + i + 1 < seq.length) {
          grams.push(a + '_' + stem(seq[off + i + 1]));
        }
      }

      // build TF for this chunk
      const tf = new Map();
      grams.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      new Set(grams).forEach((t) => df.set(t, (df.get(t) || 0) + 1));

      const id = chunks.push({
        file: abs,
        start: off,
        len: grams.length,
        tf,
      }) - 1;

      if (mode === 'code') {
        // build char-3‐gram postings for code mode
        grams.forEach((g) =>
          tri(g).forEach((tg) => {
            const set = triPost.get(tg) || new Set();
            set.add(id);
            triPost.set(tg, set);
          })
        );
      }

      // accumulate overall word frequency
      seq.forEach((w) => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));
    }
  }

  /* -- RECURSIVE DIRECTORY WALK -- */
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) {
          await walk(p);
        }
      } else {
        await ingest(p);
      }
    }
  }

  await walk(ROOT);

  console.log(
    `   → Added ${filesAdd} files, skipped ${filesSkip} files, total tokens: ${totalTokens.toLocaleString()}`
  );

  /* ---- Build wordInfo.json if needed ---- */
  const WI_PATH = path.join(OUT, 'wordInfo.json');
  let rawWordInfo = {};
  try {
    rawWordInfo = JSON.parse(await fs.readFile(WI_PATH, 'utf8'));
  } catch {
    // Not found yet; we will generate it below once we know wordFreq
  }

  if (!Object.keys(rawWordInfo).length) {
    // Build and write wordInfo.json from wordFreq
    rawWordInfo = Object.fromEntries(
      [...wordFreq.entries()].sort((a, b) => b[1] - a[1])
    );
    await fs.writeFile(WI_PATH, JSON.stringify(rawWordInfo, null, 2) + '\n');
    console.log('📝  Generated wordInfo.json');
  } else {
    console.log('✅  Loaded existing wordInfo.json');
  }

  /* ---- POSTINGS: prune extremely common/rare, no trimming ---- */
  console.log('🔗  Postings …');
  const vocabAll = Array.from(df.keys());
  // Keep all tokens; no trimming by percentage
  const trimmedVocab = vocabAll.slice();
  const vmap = new Map(trimmedVocab.map((t, i) => [t, i]));

  const rows = chunks.length;
  const avgChunkLen =
    chunks.reduce((sum, c) => sum + c.len, 0) / Math.max(rows, 1);

  const COMMON_THRESH = rows * 2; // too common if in ≥97% of chunks
  const RARE_THRESH = 0; // too rare if in ≤1 chunks

  const posts = Array.from({ length: trimmedVocab.length }, () => []);
  const sparse = [];
  const k1 = 1.5,
    b = 0.75,
    N = rows;

  chunks.forEach((c, r) => {
    const row = [];
    c.tf.forEach((freq, tok) => {
      const totalFreq = rawWordInfo[tok] || 0;
      // if (totalFreq >= COMMON_THRESH || totalFreq <= RARE_THRESH) return;
      const col = vmap.get(tok);
      if (col === undefined) return;
      posts[col].push(r);

      const idf = Math.log(
        (N - df.get(tok) + 0.5) / (df.get(tok) + 0.5) + 1
      );
      const bm =
        idf *
        ((freq * (k1 + 1)) /
          (freq + k1 * (1 - b + b * (c.len / avgChunkLen))));
      if (bm) row.push([col, bm]);
    });
    sparse.push(row);
  });

  /* ---- DENSE + SVD (ensure rows ≥ dims) ---- */
  console.log('🎲  Projection + ⚙️  SVD …');
  const dims = Math.min(DIMS, rows);
  const k = dims;

  const proj = Array.from(
    { length: trimmedVocab.length },
    () => Float32Array.from({ length: dims }, gauss)
  );
  const dense = Array.from({ length: rows }, () => new Float32Array(dims));

  sparse.forEach((row, r) => {
    row.forEach(([c, val]) => {
      const v = proj[c];
      for (let d = 0; d < dims; d++) {
        dense[r][d] += val * v[d];
      }
    });
  });

  const mat = dense.map((v) => Array.from(v));
  const { u: U, q: S } = SVD(mat, true, false);

  const vecs = U.map((uRow) => {
    const o = new Array(dims).fill(0);
    for (let i = 0; i < k; i++) {
      o[i] = uRow[i] * S[i];
    }
    return o;
  });

  /* ---- WRITE OUTPUT FILES (in parallel) ---- */
  const SCALE = 32;
  const qVec = vecs.map((r) =>
    r.map((v) => Math.max(0, Math.min(255, Math.round((v + 8) * SCALE))))
  );

  const gap = posts.map((list) => {
    list.sort((a, b) => a - b);
    let prev = 0;
    return list.map((id) => {
      const g = id - prev;
      prev = id;
      return g;
    });
  });

  const chunkMeta = chunks.map((c, i) => ({
    id: i,
    file: path.relative(ROOT, c.file).replace(/\\/g, '/'),
    start: c.start,
    end: c.start + CHUNK,
  }));

  await Promise.all([
    fs.writeFile(
      path.join(OUT, 'sparse_postings.json'),
      JSON.stringify({ vocab: trimmedVocab, postings: gap }) + '\n'
    ),
    fs.writeFile(
      path.join(OUT, 'dense_vectors_uint8.json'),
      JSON.stringify({ dims, scale: SCALE, vectors: qVec }) + '\n'
    ),
    fs.writeFile(
      path.join(OUT, 'chunk_meta.json'),
      JSON.stringify(chunkMeta) + '\n'
    ),
    mode === 'code'
      ? fs.writeFile(
        path.join(OUT, 'char3_postings.json'),
        JSON.stringify(
          {
            vocab: Array.from(triPost.keys()).sort(),
            postings: Array.from(triPost.values()).map((s) => [...s]),
          },
          null,
          0
        ) + '\n'
      )
      : Promise.resolve(),
  ]);

  console.log(
    `📦  ${mode.padEnd(5)}: ${rows.toLocaleString()} chunks, ${trimmedVocab.length.toLocaleString()} tokens kept, dims=${dims}`
  );
}

/* Run both modes */
for (const m of MODES) {
  await build(m);
}

updateUsageCounts('build_index');
