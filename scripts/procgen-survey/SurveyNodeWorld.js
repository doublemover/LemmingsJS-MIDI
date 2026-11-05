import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProcgenMasks, loadProcgenTerrain } from '../bench-procgen-lanes.js';
import { createSurveyTrial } from '../../js/app/procgen/survey/ProcgenSurveyCore.js';
import { SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA } from '../../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import ts from 'typescript';
import { surveySourceImports } from '../../js/app/procgen/survey/SurveySourceImports.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const assetPaths = scenario => ['lemmings_ohNo/MAIN.DAT', 'assets/procgen/terrain-recipes.json', ...(scenario.mode === 'generated' ?
  [(scenario.pack || 'lemmings') + '/GROUND' + (scenario.groundSet || 0) + 'O.DAT', (scenario.pack || 'lemmings') + '/VGAGR' + (scenario.groundSet || 0) + '.DAT'] : [])];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const importCache = new Map(), MAX_IMPORT_CACHE_FILES = 1024;
const checkedImports = (name, text, sourceHash) => {
  const cached = importCache.get(name);
  if (cached?.sourceHash === sourceHash) return cached.imports;
  const imports = surveySourceImports(text), actual = [];
  const tree = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length) throw new Error('Cannot parse survey source: ' + name);
  const visit = node => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier :
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null;
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) actual.push(specifier.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (JSON.stringify(imports.slice().sort()) !== JSON.stringify(actual.sort())) throw new Error('Unsupported survey import syntax: ' + name);
  if (!importCache.has(name) && importCache.size >= MAX_IMPORT_CACHE_FILES) importCache.delete(importCache.keys().next().value);
  Object.freeze(imports); importCache.set(name, { sourceHash, imports }); return imports;
};
const createSurveySourceManifest = async scenarios => {
  const engineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const pending = ['scripts/run-procgen-survey.js', 'scripts/procgen-survey/survey-worker.js', 'js/app/procgen/survey/ProcgenSurveyDashboard.js'];
  const codeHashes = {}, visited = new Set();
  while (pending.length) {
    const name = pending.pop(); if (visited.has(name)) continue; visited.add(name);
    const source = await fs.readFile(new URL('../../' + name, import.meta.url)); codeHashes[name] = sha256(source);
    const imports = checkedImports(name, source.toString('utf8'), codeHashes[name]);
    for (const specifier of imports) {
      const dependency = fileURLToPath(new URL(specifier, new URL('../../' + name, import.meta.url)));
      const relative = dependency.slice(repoRoot.length).replaceAll('\\', '/');
      if (!dependency.toLowerCase().startsWith(repoRoot.toLowerCase()) || !relative || relative.startsWith('../') || !/\.m?js$/.test(relative)) throw new Error('Unsupported survey source dependency');
      pending.push(relative);
    }
  }
  const orderedHashes = Object.fromEntries(Object.entries(codeHashes).sort(([a],[b]) => a.localeCompare(b)));
  const assetHashes = {};
  for (const name of [...new Set(scenarios.flatMap(assetPaths))].sort()) assetHashes[name] = sha256(await fs.readFile(new URL('../../' + name, import.meta.url)));
  return { schemaVersion: 1, engineCommit, sourceKind: 'commit-plus-file-sha256', codeHashes: orderedHashes, codeDigest: sha256(JSON.stringify(orderedHashes)), assetHashes, nodeVersion: process.version, v8Version: process.versions.v8,
    harnessVersion: 'procgen-survey-v1', canonicalStateVersion: SURVEY_STATE_SCHEMA, canonicalEncodingVersion: SURVEY_CANONICAL_SCHEMA,
    executionIdentity: { status: 'unbound', reason: 'filesystem-manifest-does-not-attest-loaded-module-instances' } };
};
const createNodeSurveyTrial = async (job, masks) => {
  const scenario = job.scenario;
  const terrain = scenario.mode === 'generated' ? await loadProcgenTerrain(scenario.pack || 'lemmings', scenario.groundSet || 0) : null;
  return createSurveyTrial({ scenario, candidate: job.candidate, masks: masks || await loadProcgenMasks(), terrain, attemptId: job.attemptId });
};
export { repoRoot, createSurveySourceManifest, createNodeSurveyTrial, loadProcgenMasks };
