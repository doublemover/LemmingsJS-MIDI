import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export function discoverRuntimeDependencies(filename, source) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), specifiers = [];
  if (tree.parseDiagnostics.length) throw new Error(`Cannot parse runtime source: ${filename}`);
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifiers.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      if (!ts.isStringLiteralLike(node.arguments[0])) throw new Error(`Computed runtime module import needs an explicit packaging contract: ${filename}`);
      specifiers.push(node.arguments[0].text);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' &&
        ts.isStringLiteralLike(node.arguments?.[0]) && node.arguments[0].text.startsWith('.') && !node.arguments[0].text.endsWith('/')) specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(tree); return specifiers;
}

export async function collectRuntimeSourceClosure({ rootDir, entries, resources = [], fsImpl = fs, maxFiles = 4096, maxBytes = 64 * 1048576 } = {}) {
  if (!Array.isArray(entries) || !entries.length || !Array.isArray(resources) || !Number.isSafeInteger(maxFiles) || maxFiles < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || [...entries, ...resources].some(entry => typeof entry !== 'string' || !entry)) throw new Error('Invalid runtime source closure inputs.');
  const root = path.resolve(rootDir), queue = [...entries, ...resources].map(entry => path.resolve(root, entry)), files = new Map(), dependencies = new Set();
  let sourceBytes = 0;
  const include = (specifier, importer) => {
    if (isBuiltin(specifier)) return;
    if (!specifier.startsWith('.') && !specifier.startsWith('file:')) {
      if (specifier.startsWith('/') || /^[a-z]+:/i.test(specifier) || specifier.startsWith('#')) throw new Error(`Unresolved runtime import ${specifier} in ${importer}`);
      dependencies.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]); return;
    }
    const resolved = fileURLToPath(new URL(specifier, pathToFileURL(importer)));
    const relative = path.relative(root, resolved);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Runtime import escapes the repository: ${specifier}`);
    queue.push(resolved);
  };
  while (queue.length) {
    const filename = queue.pop(); if (files.has(filename)) continue;
    if (files.size >= maxFiles) throw new Error('Runtime source closure exceeds its file budget.');
    const relative = path.relative(root, filename), real = await fsImpl.realpath(filename);
    const realRelative = path.relative(root, real);
    if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) throw new Error(`Runtime source symlink escapes the repository: ${relative}`);
    const source = await fsImpl.readFile(filename); sourceBytes += source.byteLength;
    if (sourceBytes > maxBytes) throw new Error('Runtime source closure exceeds its byte budget.');
    files.set(filename, { path: relative.split(path.sep).join('/'), bytes: source.byteLength, sha256: createHash('sha256').update(source).digest('hex') });
    if (!/\.(?:[cm]?js|json)$/.test(filename)) continue;
    if (filename.endsWith('.json')) continue;
    for (const specifier of discoverRuntimeDependencies(relative, source.toString('utf8'))) include(specifier, filename);
  }
  return { schema: 'lemmings-runtime-source-closure/v1', entries, files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    dependencies: [...dependencies].sort(), sourceBytes, resources };
}
