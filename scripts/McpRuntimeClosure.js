import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export async function collectMcpRuntimeClosure({ rootDir, entry = 'mcp/server.js', fsImpl = fs, maxFiles = 4096, maxBytes = 64 * 1048576 } = {}) {
  const root = path.resolve(rootDir), queue = [path.resolve(root, entry), path.resolve(root, 'mcp/spectator.html'), path.resolve(root, 'keybindings.json')], files = new Map(), dependencies = new Set();
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
    if (files.size >= maxFiles) throw new Error('MCP runtime source closure exceeds its file budget.');
    const relative = path.relative(root, filename), real = await fsImpl.realpath(filename);
    const realRelative = path.relative(root, real);
    if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) throw new Error(`Runtime source symlink escapes the repository: ${relative}`);
    const source = await fsImpl.readFile(filename); sourceBytes += source.byteLength;
    if (sourceBytes > maxBytes) throw new Error('MCP runtime source closure exceeds its byte budget.');
    files.set(filename, { path: relative.split(path.sep).join('/'), bytes: source.byteLength, sha256: createHash('sha256').update(source).digest('hex') });
    if (!/\.(?:[cm]?js|json)$/.test(filename)) continue;
    if (filename.endsWith('.json')) continue;
    const tree = ts.createSourceFile(filename, source.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (tree.parseDiagnostics.length) throw new Error(`Cannot parse MCP runtime source: ${relative}`);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) include(node.moduleSpecifier.text, filename);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        if (!ts.isStringLiteralLike(node.arguments[0])) throw new Error(`Computed runtime module import needs an explicit packaging contract: ${relative}`);
        include(node.arguments[0].text, filename);
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' &&
          ts.isStringLiteralLike(node.arguments?.[0]) && node.arguments[0].text.startsWith('.') && !node.arguments[0].text.endsWith('/')) include(node.arguments[0].text, filename);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return { schema: 'lemmings-mcp-runtime-closure/v1', entry, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    dependencies: [...dependencies].sort(), sourceBytes, resources: ['mcp/spectator.html', 'keybindings.json'] };
}
