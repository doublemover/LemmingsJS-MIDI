#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import c from 'ansi-colors';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'human', 'stats'],
  alias: { n: 'top', 'human-json': 'hj' },
  default: { n: 10 }
});

// If no flags, we emit agent‐optimized text by default.
// --json       → agent‐optimized JSON
// --human      → human‐friendly text
// --human-json → human‐friendly JSON
//
// Example:
//   node tools/search.js ants            # agent‐optimized text
//   node tools/search.js ants --json     # agent‐optimized JSON
//   node tools/search.js ants --human    # human‐friendly text
//   node tools/search.js ants --human-json # human‐friendly JSON

const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search "query" [--json|--human|--human-json|--stats]');
  process.exit(1);
}

const t0 = Date.now();
const ROOT = process.cwd();
const metricsDir = path.join(ROOT, '.searchMetrics');

/* --- Tokeniser + regex for highlighting --- */
const stemmer = Snowball.newStemmer('english');
const stem = (w) => stemmer.stem(w);
const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const tok = (t) =>
  camel(t.replace(/\./g, ' '))
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter(Boolean);

const raw = tok(query);                          // e.g. ["lemmings","port"]
const stems = raw.map(stem);                     // e.g. ["lemm","port"]
const bigr = raw.slice(0, -1).map((w, i) =>       // e.g. ["lemm_port"]
  stem(w) + '_' + stem(raw[i + 1])
);
const qTokens = Array.from(new Set([...stems, ...bigr]));
const rx = new RegExp(`(${raw.join('|')})`, 'ig');

/* --- Load both indexes (synchronous JSON reads) --- */
function loadDir(dir) {
  const pPost = path.join(dir, 'sparse_postings.json');
  const pMeta = path.join(dir, 'chunk_meta.json');
  if (!fsSync.existsSync(pPost) || !fsSync.existsSync(pMeta)) {
    console.error(
      `Missing index files in ${dir}. Run \`node tools/build_index.js\` to generate them.`
    );
    process.exit(1);
  }
  return {
    postings: JSON.parse(fsSync.readFileSync(pPost, 'utf8')),
    meta: JSON.parse(fsSync.readFileSync(pMeta, 'utf8')),
  };
}

const prose = loadDir('index-prose');
const code = loadDir('index-code');

/* ---------- ENCAPSULATED HELPER: find enclosing function name ---------- */
function getEnclosingFunction(lines, lineNum) {
  for (let i = lineNum - 1; i >= 0; i--) {
    const L = lines[i].trim();
    // 1) function foo(...) { ... }
    let m = L.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) return m[1];
    // 2) const foo = (...) => { ... }
    m = L.match(
      /^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?\([^\)]*\)\s*=>/
    );
    if (m) return m[1];
    // 3) foo(...) { ... }  (method inside a class or standalone)
    m = L.match(/^\s*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/);
    if (m && !L.startsWith('if') && !L.startsWith('for') && !L.startsWith('while')) {
      return m[1];
    }
  }
  return null;
}

/* ---------- NORMALIZED, COLORIZED SCORE (1–10) ---------- */
function colorScore(score, max) {
  const ratio = max === 0 ? 0 : score / max;
  const level = Math.max(1, Math.ceil(ratio * 10)); // 1..10
  if (level > 7) return c.green(String(score));
  if (level > 3) return c.yellow(String(score));
  return c.red(String(score));
}

/* ---------- BUILD MD INDEX RESULTS ---------- */
const mdScores = new Map(); // file → { chunkScore }
qTokens.forEach((tokStr) => {
  const col = prose.postings.vocab.indexOf(tokStr);
  if (col === -1) return;
  let id = 0;
  for (const gap of prose.postings.postings[col]) {
    id += gap;
    const m = prose.meta[id];
    const entry = mdScores.get(m.file) || { chunkScore: 0 };
    entry.chunkScore++;
    mdScores.set(m.file, entry);
  }
});

let mdHitsAll = [...mdScores.entries()]
  .map(([f, o]) => ({ file: f, chunkScore: o.chunkScore }))
  .sort((a, b) => b.chunkScore - a.chunkScore);

// Recompute “realPos” and “totalMatches” for each MD hit
await Promise.all(
  mdHitsAll.map(async (hit) => {
    hit.realPos = [];
    hit.totalMatches = 0;
    let text;
    try {
      text = await fs.readFile(path.join(ROOT, hit.file), 'utf8');
    } catch {
      return;
    }
    const lines = text.split(/\r?\n/);
    const allMatches = text.match(rx);
    hit.totalMatches = allMatches ? allMatches.length : 0;
    for (let i = 0; i < lines.length && hit.realPos.length < 5; i++) {
      let m;
      while ((m = rx.exec(lines[i])) !== null) {
        hit.realPos.push([i + 1, m.index + 1]);
        if (hit.realPos.length >= 5) break;
      }
      rx.lastIndex = 0;
    }
  })
);

const maxMdMatches = mdHitsAll.reduce((max, h) => Math.max(max, h.totalMatches), 1);

/* ---------- BUILD CODE INDEX RESULTS ---------- */
function chunkCandidates(idx) {
  const cand = new Set();
  qTokens.forEach((tokStr) => {
    const col = idx.postings.vocab.indexOf(tokStr);
    if (col === -1) return;
    let id = 0;
    for (const gap of idx.postings.postings[col]) {
      id += gap;
      cand.add(id);
    }
  });
  return cand;
}

const candChunks = chunkCandidates(code);
const codeScores = new Map(); // file → { chunkScore }
for (const id of candChunks) {
  const m = code.meta[id];
  let sc = codeScores.get(m.file)?.chunkScore || 0;
  qTokens.forEach((tokStr) => {
    const col = code.postings.vocab.indexOf(tokStr);
    if (col === -1) return;
    let cur = 0;
    for (const gap of code.postings.postings[col]) {
      cur += gap;
      if (cur === id) {
        sc++;
        break;
      }
      if (cur > id) break;
    }
  });
  const entry = codeScores.get(m.file) || { chunkScore: 0 };
  entry.chunkScore = Math.max(entry.chunkScore, sc);
  codeScores.set(m.file, entry);
}

let codeHitsAll = [...codeScores.entries()]
  .map(([f, o]) => ({ file: f, chunkScore: o.chunkScore }))
  .sort((a, b) => b.chunkScore - a.chunkScore);

// Recompute “realPos” and “totalMatches” for each Code hit
await Promise.all(
  codeHitsAll.map(async (hit) => {
    hit.realPos = [];
    hit.totalMatches = 0;
    let text;
    try {
      text = await fs.readFile(path.join(ROOT, hit.file), 'utf8');
    } catch {
      return;
    }
    const lines = text.split(/\r?\n/);
    const allMatches = text.match(rx);
    hit.totalMatches = allMatches ? allMatches.length : 0;
    for (let i = 0; i < lines.length && hit.realPos.length < 5; i++) {
      let m;
      while ((m = rx.exec(lines[i])) !== null) {
        hit.realPos.push([i + 1, m.index + 1]);
        if (hit.realPos.length >= 5) break;
      }
      rx.lastIndex = 0;
    }
  })
);

const maxCodeMatches = codeHitsAll.reduce(
  (max, h) => Math.max(max, h.totalMatches),
  1
);

const totalMdFiles = mdHitsAll.length;
const sumMdMatches = mdHitsAll.reduce((sum, h) => sum + h.totalMatches, 0);
const totalCodeFiles = codeHitsAll.length;
const sumCodeMatches = codeHitsAll.reduce((sum, h) => sum + h.totalMatches, 0);

// ─── Compute enclosingFunction synchronously ───
for (const hit of mdHitsAll) {
  hit.enclosingFunction = null;
  if (hit.realPos.length) {
    const text = await fs.readFile(path.join(ROOT, hit.file), 'utf8');
    const lines = text.split(/\r?\n/);
    const [lineNum] = hit.realPos[0];
    hit.enclosingFunction = getEnclosingFunction(lines, lineNum);
  }
}
for (const hit of codeHitsAll) {
  hit.enclosingFunction = null;
  if (hit.realPos.length) {
    const text = await fs.readFile(path.join(ROOT, hit.file), 'utf8');
    const lines = text.split(/\r?\n/);
    const [lineNum] = hit.realPos[0];
    hit.enclosingFunction = getEnclosingFunction(lines, lineNum);
  }
}

/* Determine how many to show in each section */
const SHOW_SNIPPET_MD = Math.min(1, totalMdFiles);
const LIST_MD = Math.min(10, totalMdFiles - SHOW_SNIPPET_MD);
const SHOW_SNIPPET_CODE = Math.min(5, totalCodeFiles);
const LIST_CODE = Math.min(10, totalCodeFiles - SHOW_SNIPPET_CODE);

/* ---------- OUTPUT MODES ---------- */
function agentText() {
  let out = '';

  // Markdown summary
  if (totalMdFiles > 0) {
    out +=
      `${c.gray(sumMdMatches)} matches in ${c.gray(totalMdFiles)} total Markdown files\n` +
      `Summarizing top ${c.white(SHOW_SNIPPET_MD)} → listing next ${c.white(LIST_MD)}\n\n`;

    // Snippet for top MD hit
    if (SHOW_SNIPPET_MD) {
      const md1 = mdHitsAll[0];
      const [l1] = md1.realPos.length ? md1.realPos[0] : [1, 1];
      const textMd = fsSync.readFileSync(path.join(ROOT, md1.file), 'utf8');
      const linesMd = textMd.split(/\r?\n/);
      const z1 = l1 - 1;
      const st1 = Math.max(0, z1 - 2);
      const en1 = Math.min(linesMd.length, z1 + 3);

      const scoreMd1 = colorScore(md1.totalMatches, maxMdMatches).padEnd(4);
      out += `[${scoreMd1}] ` +
        c.magentaBright(path.basename(md1.file)) +
        ` (func: ${md1.enclosingFunction || '‹none›'})\n`;
      for (let i = st1; i < en1; i++) {
        const num = c.green(String(i + 1).padStart(4));
        const hl = linesMd[i].replace(rx, (m) => c.bold.yellowBright(m));
        out += num + ' ' + hl + '\n';
      }
      out += '\n';
    }

    // List next MD hits
    for (let i = SHOW_SNIPPET_MD; i < SHOW_SNIPPET_MD + LIST_MD; i++) {
      const h = mdHitsAll[i];
      const sc = colorScore(h.totalMatches, maxMdMatches).padEnd(4);
      out += `[${sc}] ` +
        c.magentaBright(path.basename(h.file)) +
        ` (func: ${h.enclosingFunction || '‹none›'})\n`;
    }
    out += '\n';
  }

  // Code summary
  if (totalCodeFiles > 0) {
    out +=
      `${c.gray(sumCodeMatches)} matches in ${c.gray(totalCodeFiles)} total code files\n` +
      `Summarizing top ${c.white(SHOW_SNIPPET_CODE)} → listing next ${c.white(LIST_CODE)}\n\n`;

    // Snippets for top code hits
    for (let i = 0; i < SHOW_SNIPPET_CODE; i++) {
      const h = codeHitsAll[i];
      const [lc] = h.realPos.length ? h.realPos[0] : [1, 1];
      const textC = fsSync.readFileSync(path.join(ROOT, h.file), 'utf8');
      const linesC = textC.split(/\r?\n/);
      const zc = lc - 1;
      const stC = Math.max(0, zc - 2);
      const enC = Math.min(linesC.length, zc + 3);

      const sc = colorScore(h.totalMatches, maxCodeMatches).padEnd(4);
      out += `[${sc}] ` +
        c.blueBright(path.basename(h.file)) +
        ` (func: ${h.enclosingFunction || '‹none›'})\n`;
      for (let j = stC; j < enC; j++) {
        const num = c.green(String(j + 1).padStart(4));
        const hl = linesC[j].replace(rx, (m) => c.bold.yellowBright(m));
        out += num + ' ' + hl + '\n';
      }
      out += '\n';
    }

    // List next code hits
    for (let i = SHOW_SNIPPET_CODE; i < SHOW_SNIPPET_CODE + LIST_CODE; i++) {
      const h = codeHitsAll[i];
      const sc = colorScore(h.totalMatches, maxCodeMatches).padEnd(4);
      out += `[${sc}] ` +
        c.blueBright(path.basename(h.file)) +
        ` (func: ${h.enclosingFunction || '‹none›'})\n`;
    }
    out += '\n';
  }

  return out;
}

function agentJSON() {
  // Agent‐optimized JSON: no truncation; top‐to‐bottom order
  return JSON.stringify(
    {
      markdown: mdHitsAll.map((h) => ({
        file: h.file,
        totalMatches: h.totalMatches,
        score: h.totalMatches,
        realPos: h.realPos,
        enclosingFunction: h.enclosingFunction,
      })),
      code: codeHitsAll.map((h) => ({
        file: h.file,
        totalMatches: h.totalMatches,
        score: h.totalMatches,
        realPos: h.realPos,
        enclosingFunction: h.enclosingFunction,
      })),
    },
    null,
    2
  );
}

function humanText() {
  let out = '';

  // Markdown section
  if (totalMdFiles > 0) {
    out += '--- Markdown Results ---\n';
    out += `Found ${sumMdMatches} total matches in ${totalMdFiles} files.\n`;
    const toShow = Math.min(10, mdHitsAll.length);
    for (let i = 0; i < toShow; i++) {
      const h = mdHitsAll[i];
      const sc = colorScore(h.totalMatches, maxMdMatches);
      const pos = h.realPos.length
        ? h.realPos.map((p) => `[${p[0]}:${p[1]}]`).join(', ')
        : '(no matches)';
      out += `${i + 1}. ${c.magentaBright(path.basename(h.file))} ` +
        c.dim(path.dirname(h.file)) +
        ` — hits: ${sc}, lines: ${pos}, func: ${h.enclosingFunction || 'N/A'}\n`;
    }
    if (mdHitsAll.length > 10) {
      out += `... and ${mdHitsAll.length - 10} more Markdown files.\n`;
    }
    out += '\n';
  }

  // Code section
  if (totalCodeFiles > 0) {
    out += '--- Code Results ---\n';
    out += `Found ${sumCodeMatches} total matches in ${totalCodeFiles} files.\n`;
    const toShow = Math.min(10, codeHitsAll.length);
    for (let i = 0; i < toShow; i++) {
      const h = codeHitsAll[i];
      const sc = colorScore(h.totalMatches, maxCodeMatches);
      const pos = h.realPos.length
        ? h.realPos.map((p) => `[${p[0]}:${p[1]}]`).join(', ')
        : '(no matches)';
      out += `${i + 1}. ${c.blueBright(path.basename(h.file))} ` +
        c.dim(path.dirname(h.file)) +
        ` — hits: ${sc}, lines: ${pos}, func: ${h.enclosingFunction || 'N/A'}\n`;
    }
    if (codeHitsAll.length > 10) {
      out += `... and ${codeHitsAll.length - 10} more code files.\n`;
    }
    out += '\n';
  }

  return out;
}

function humanJSON() {
  // Human‐friendly JSON (truncated to top 10 each)
  return JSON.stringify(
    {
      markdown: mdHitsAll.slice(0, 10).map((h) => ({
        file: path.basename(h.file),
        path: path.dirname(h.file),
        hits: h.totalMatches,
        lines: h.realPos,
        function: h.enclosingFunction || null,
      })),
      more_md: Math.max(0, mdHitsAll.length - 10),
      code: codeHitsAll.slice(0, 10).map((h) => ({
        file: path.basename(h.file),
        path: path.dirname(h.file),
        hits: h.totalMatches,
        lines: h.realPos,
        function: h.enclosingFunction || null,
      })),
      more_code: Math.max(0, codeHitsAll.length - 10),
    },
    null,
    2
  );
}

/* Decide which mode to print */
if (argv.json && !argv.human) {
  // agent‐optimized JSON
  console.log(agentJSON());
} else if (argv.human && argv.hj) {
  // human‐friendly JSON (--human-json)
  console.log(humanJSON());
} else if (argv.human) {
  // human‐friendly text
  process.stdout.write(humanText());
} else {
  // default: agent‐optimized text
  process.stdout.write(agentText());
}

/* ---------- Stats ---------- */
if (argv.stats) {
  console.log(
    '--stats--',
    'mdFiles:', totalMdFiles,
    'sumMdMatches:', sumMdMatches,
    'codeFiles:', totalCodeFiles,
    'sumCodeMatches:', sumCodeMatches,
    'candChunks:', candChunks.size,
    'ms:', Date.now() - t0
  );
}

/* ---------- Update .searchMetrics and .searchHistory ---------- */
const metricsPath = path.join(metricsDir, 'metrics.json');
const historyPath = path.join(metricsDir, 'searchHistory');
const noResultPath = path.join(metricsDir, 'noResultQueries');
await fs.mkdir(path.dirname(metricsPath), { recursive: true });

let metrics = {};
try {
  metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
} catch {
  metrics = {};
}
const inc = (f, key) => {
  if (!metrics[f]) metrics[f] = { md: 0, code: 0, terms: [] };
  metrics[f][key]++;
  raw.forEach((t) => {
    if (!metrics[f].terms.includes(t)) metrics[f].terms.push(t);
  });
};
mdHitsAll.forEach((h) => inc(h.file, 'md'));
codeHitsAll.forEach((h) => inc(h.file, 'code'));
await fs.writeFile(metricsPath, JSON.stringify(metrics) + '\n');

await fs.appendFile(
  historyPath,
  JSON.stringify({
    time: new Date().toISOString(),
    query,
    mdFiles: totalMdFiles,
    codeFiles: totalCodeFiles,
    ms: Date.now() - t0,
  }) + '\n'
);

if (totalMdFiles === 0 && totalCodeFiles === 0) {
  await fs.appendFile(
    noResultPath,
    JSON.stringify({ time: new Date().toISOString(), query }) + '\n'
  );
}
