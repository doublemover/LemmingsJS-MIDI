import fs from 'fs';
import path from 'path';
import { parse } from 'acorn';
import { processHtmlFile as extractHtmlSnippets } from './processHtmlFile.js';

const builtinFunctions = new Set([
  'require',
  'String',
  'Number',
  'Boolean',
  'Object',
  'Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Date',
  'RegExp',
  'Error',
  'URL',
  'URLSearchParams',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'queueMicrotask',
  'parseInt',
  'parseFloat',
  'isFinite',
  'isNaN',
  'encodeURIComponent',
  'decodeURIComponent',
  'fetch',
  'btoa',
  'atob',
  'Symbol',
  'describe',
  'it',
  'before',
  'after',
  'expect',
  '$',
  'jQuery'
]);

const builtinObjects = new Set([
  'console',
  'Math',
  'JSON',
  'document',
  'window',
  'globalThis',
  'performance',
  'history',
  'location',
  'navigator',
  'localStorage',
  'sessionStorage',
  'WebMidi',
  'jQuery',
  '$',
  'Array',
  'Object',
  'Promise',
  'Reflect'
]);

const builtinMethods = new Set([
  'apply',
  'bind',
  'call',
  'log',
  'error',
  'warn',
  'info',
  'push',
  'pop',
  'shift',
  'unshift',
  'forEach',
  'map',
  'filter',
  'find',
  'some',
  'every',
  'reduce',
  'addEventListener',
  'removeEventListener',
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'appendChild',
  'replace',
  'split',
  'includes',
  'join',
  'indexOf',
  'slice',
  'substring',
  'createElement',
  'ready',
  'css',
  'addClass',
  'removeClass',
  'preventDefault',
  'getBoundingClientRect',
  'values',
  'keys',
  'entries',
  'catch',
  'then',
  'finally',
  'toString',
  'setItem',
  'getItem',
  'removeItem'
]);

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'test-results'
]);

const defaultHtmlFiles = Object.freeze([
  'index.html',
  'editor.html',
  'procgen.html'
]);

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Set();
    this.objectMethods = new Map();
  }

  declare(name) {
    if (!name) return;
    this.bindings.add(name);
  }

  has(name) {
    if (this.bindings.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }

  setObjectMethods(name, methods) {
    if (!name) return;
    this.objectMethods.set(name, methods);
  }

  getObjectMethods(name) {
    if (this.objectMethods.has(name)) {
      return this.objectMethods.get(name);
    }
    return this.parent ? this.parent.getObjectMethods(name) : null;
  }
}

const parseJS = (code) => {
  try {
    return parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    try {
      return parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    } catch {
      try {
        return parse(`function __snippet__(){\n${code}\n}`, {
          ecmaVersion: 'latest',
          sourceType: 'script',
          locations: true
        });
      } catch {
        return null;
      }
    }
  }
};

const walkAst = (node, visitor) => {
  if (!node || typeof node.type !== 'string') return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        walkAst(child, visitor);
      }
    } else if (value && typeof value.type === 'string') {
      walkAst(value, visitor);
    }
  }
};

const declarePattern = (pattern, scope) => {
  if (!pattern) return;
  if (pattern.type === 'Identifier') {
    scope.declare(pattern.name);
    return;
  }
  if (pattern.type === 'RestElement') {
    declarePattern(pattern.argument, scope);
    return;
  }
  if (pattern.type === 'AssignmentPattern') {
    declarePattern(pattern.left, scope);
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    for (const prop of pattern.properties || []) {
      if (prop.type === 'RestElement') {
        declarePattern(prop.argument, scope);
      } else {
        declarePattern(prop.value, scope);
      }
    }
    return;
  }
  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements || []) {
      declarePattern(element, scope);
    }
  }
};

const predeclareBlock = (body, scope) => {
  for (const node of body || []) {
    if (!node) continue;
    if (node.type === 'FunctionDeclaration' && node.id) {
      scope.declare(node.id.name);
    } else if (node.type === 'ClassDeclaration' && node.id) {
      scope.declare(node.id.name);
    } else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations || []) {
        declarePattern(decl.id, scope);
      }
    } else if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers || []) {
        if (specifier.local?.type === 'Identifier') {
          scope.declare(specifier.local.name);
        }
      }
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      predeclareBlock([node.declaration], scope);
    }
  }
};

const collectGlobalFunctions = (ast, globalFunctions) => {
  walkAst(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      globalFunctions.add(node.id.name);
    } else if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init &&
      (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression')
    ) {
      globalFunctions.add(node.id.name);
    } else if (node.type === 'ClassDeclaration' && node.id?.name) {
      globalFunctions.add(node.id.name);
    }
  });
};

const collectKnownMethods = (ast, knownMethods) => {
  walkAst(ast, (node) => {
    if ((node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && node.key?.type === 'Identifier') {
      knownMethods.add(node.key.name);
    } else if (
      node.type === 'Property' &&
      node.key?.type === 'Identifier' &&
      node.value &&
      (node.value.type === 'FunctionExpression' || node.value.type === 'ArrowFunctionExpression')
    ) {
      knownMethods.add(node.key.name);
    } else if (
      node.type === 'AssignmentExpression' &&
      node.left?.type === 'MemberExpression' &&
      !node.left.computed &&
      node.left.property?.type === 'Identifier' &&
      node.right &&
      (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression')
    ) {
      knownMethods.add(node.left.property.name);
    }
  });
};

const extractObjectMethodNames = (objectExpression) => {
  const methods = new Set();
  for (const prop of objectExpression.properties || []) {
    if (prop.type === 'SpreadElement') continue;
    if (prop.key?.type !== 'Identifier') continue;
    if (
      prop.method ||
      (prop.value && (prop.value.type === 'FunctionExpression' || prop.value.type === 'ArrowFunctionExpression'))
    ) {
      methods.add(prop.key.name);
    }
  }
  return methods;
};

const gatherFiles = (dir, exts, results = []) => {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      gatherFiles(full, exts, results);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      if (entry.name === 'jquery.js') continue;
      results.push(path.resolve(full));
    }
  }
  return results;
};

const resolveModuleSpecifier = (fromFile, specifier) => {
  if (!specifier || (!specifier.startsWith('.') && !specifier.startsWith('/'))) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.js')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }
  return null;
};

const collectImportSpecifiers = (ast) => {
  const specs = [];
  walkAst(ast, (node) => {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) {
      specs.push(String(node.source.value));
    } else if (node.type === 'ExportNamedDeclaration' && node.source?.value) {
      specs.push(String(node.source.value));
    }
  });
  return specs;
};

const collectDependentJsFiles = (seedFiles) => {
  const queue = [...new Set(seedFiles.map((file) => path.resolve(file)))];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    if (!fs.existsSync(current)) continue;
    if (!fs.statSync(current).isFile()) continue;
    if (path.basename(current) === 'jquery.js') continue;

    visited.add(current);
    const code = fs.readFileSync(current, 'utf8');
    const ast = parseJS(code);
    if (!ast) continue;

    const imports = collectImportSpecifiers(ast);
    for (const specifier of imports) {
      const resolved = resolveModuleSpecifier(current, specifier);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return Array.from(visited);
};

const createErrorKey = (error) => `${error.file}:${error.line}:${error.name}`;

const analyzeAst = (ast, file, state, errors) => {
  const pushError = (name, node) => {
    const line = node?.loc?.start?.line || 1;
    errors.push({ file, line, name });
  };

  const visit = (node, scope) => {
    if (!node || typeof node.type !== 'string') return;

    switch (node.type) {
    case 'Program': {
      predeclareBlock(node.body, scope);
      for (const statement of node.body) {
        visit(statement, scope);
      }
      return;
    }
    case 'BlockStatement': {
      const blockScope = new Scope(scope);
      predeclareBlock(node.body, blockScope);
      for (const statement of node.body) {
        visit(statement, blockScope);
      }
      return;
    }
    case 'ImportDeclaration':
      return;
    case 'ExportNamedDeclaration': {
      if (node.declaration) {
        visit(node.declaration, scope);
      }
      return;
    }
    case 'FunctionDeclaration': {
      const fnScope = new Scope(scope);
      if (node.id?.name) {
        fnScope.declare(node.id.name);
      }
      for (const param of node.params || []) {
        declarePattern(param, fnScope);
      }
      visit(node.body, fnScope);
      return;
    }
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const fnScope = new Scope(scope);
      if (node.id?.name) {
        fnScope.declare(node.id.name);
      }
      for (const param of node.params || []) {
        declarePattern(param, fnScope);
      }
      if (node.body?.type === 'BlockStatement') {
        visit(node.body, fnScope);
      } else {
        visit(node.body, fnScope);
      }
      return;
    }
    case 'ClassDeclaration':
    case 'ClassExpression': {
      if (node.superClass) {
        visit(node.superClass, scope);
      }
      for (const item of node.body?.body || []) {
        if (item.type === 'MethodDefinition' || item.type === 'PropertyDefinition') {
          if (item.key?.type === 'Identifier') {
            state.knownMethods.add(item.key.name);
          }
          visit(item.value, scope);
        }
      }
      return;
    }
    case 'VariableDeclaration': {
      for (const decl of node.declarations || []) {
        if (decl.id?.type === 'Identifier' && decl.init?.type === 'ObjectExpression') {
          scope.setObjectMethods(decl.id.name, extractObjectMethodNames(decl.init));
        }
        if (decl.init) {
          visit(decl.init, scope);
        }
      }
      return;
    }
    case 'CatchClause': {
      const catchScope = new Scope(scope);
      declarePattern(node.param, catchScope);
      visit(node.body, catchScope);
      return;
    }
    case 'ForOfStatement':
    case 'ForInStatement': {
      const loopScope = new Scope(scope);
      if (node.left?.type === 'VariableDeclaration') {
        for (const decl of node.left.declarations || []) {
          declarePattern(decl.id, loopScope);
        }
      } else if (node.left) {
        declarePattern(node.left, loopScope);
      }
      visit(node.left, loopScope);
      visit(node.right, loopScope);
      visit(node.body, loopScope);
      return;
    }
    case 'ForStatement': {
      const loopScope = new Scope(scope);
      if (node.init?.type === 'VariableDeclaration') {
        for (const decl of node.init.declarations || []) {
          declarePattern(decl.id, loopScope);
        }
      }
      visit(node.init, loopScope);
      visit(node.test, loopScope);
      visit(node.update, loopScope);
      visit(node.body, loopScope);
      return;
    }
    case 'CallExpression': {
      const callee = node.callee;
      if (callee.type === 'Identifier') {
        const name = callee.name;
        if (!scope.has(name) && !state.globalFunctions.has(name) && !builtinFunctions.has(name)) {
          pushError(name, node);
        }
      } else if (
        callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property?.type === 'Identifier'
      ) {
        const methodName = callee.property.name;
        if (callee.object?.type === 'ObjectExpression') {
          const literalMethods = extractObjectMethodNames(callee.object);
          if (!literalMethods.has(methodName) && !builtinMethods.has(methodName)) {
            pushError(methodName, node);
          }
        } else if (callee.object?.type === 'Identifier') {
          const knownObjectMethods = scope.getObjectMethods(callee.object.name);
          if (
            knownObjectMethods &&
              !knownObjectMethods.has(methodName) &&
              !builtinMethods.has(methodName) &&
              !state.knownMethods.has(methodName)
          ) {
            pushError(methodName, node);
          }
        }
      }

      visit(node.callee, scope);
      for (const arg of node.arguments || []) {
        visit(arg, scope);
      }
      return;
    }
    case 'MemberExpression': {
      visit(node.object, scope);
      if (node.computed) {
        visit(node.property, scope);
      }
      return;
    }
    case 'AssignmentExpression': {
      if (
        node.left?.type === 'Identifier' &&
          node.right?.type === 'ObjectExpression'
      ) {
        scope.setObjectMethods(node.left.name, extractObjectMethodNames(node.right));
      } else if (
        node.left?.type === 'MemberExpression' &&
          !node.left.computed &&
          node.left.object?.type === 'Identifier' &&
          node.left.property?.type === 'Identifier' &&
          (node.right?.type === 'FunctionExpression' || node.right?.type === 'ArrowFunctionExpression')
      ) {
        const existing = scope.getObjectMethods(node.left.object.name);
        if (existing) {
          existing.add(node.left.property.name);
        }
      }
      visit(node.left, scope);
      visit(node.right, scope);
      return;
    }
    case 'Identifier':
    case 'Literal':
    case 'ThisExpression':
    case 'Super':
      return;
    default:
      break;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          visit(child, scope);
        }
      } else if (value && typeof value.type === 'string') {
        visit(value, scope);
      }
    }
  };

  const rootScope = new Scope();
  for (const name of builtinFunctions) {
    rootScope.declare(name);
  }
  for (const name of builtinObjects) {
    rootScope.declare(name);
  }
  for (const name of state.globalFunctions) {
    rootScope.declare(name);
  }

  visit(ast, rootScope);
};

const normalizeCliFiles = (argv) => {
  const jsFiles = [];
  const htmlFiles = [];
  for (const raw of argv) {
    const file = path.resolve(raw);
    if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
      jsFiles.push(file);
    } else if (file.endsWith('.html')) {
      htmlFiles.push(file);
    }
  }
  return { jsFiles, htmlFiles };
};

const main = (argv = process.argv.slice(2)) => {
  const explicit = argv.length > 0;
  const cli = normalizeCliFiles(argv);

  let htmlFiles = cli.htmlFiles;
  if (!explicit) {
    htmlFiles = defaultHtmlFiles
      .map((file) => path.resolve(file))
      .filter((file) => fs.existsSync(file));
  }

  const snippetSources = [];
  const entryScripts = new Set();
  for (const htmlFile of htmlFiles) {
    const extracted = extractHtmlSnippets(htmlFile, { includeExternalScripts: true });
    const snippets = Array.isArray(extracted) ? extracted : extracted.snippets;
    const htmlEntryScripts = Array.isArray(extracted?.entryScripts) ? extracted.entryScripts : [];
    for (const snippet of snippets || []) {
      snippetSources.push({ file: htmlFile, code: snippet.code });
    }
    for (const scriptFile of htmlEntryScripts) {
      entryScripts.add(path.resolve(scriptFile));
    }
  }

  const seedJsFiles = new Set(cli.jsFiles.map((file) => path.resolve(file)));
  for (const entry of entryScripts) {
    seedJsFiles.add(entry);
  }

  if (!explicit && seedJsFiles.size === 0) {
    for (const discovered of gatherFiles('js', ['.js'])) {
      seedJsFiles.add(discovered);
    }
  }

  const jsFiles = collectDependentJsFiles(Array.from(seedJsFiles));

  const astBySource = new Map();
  const snippetAsts = [];
  const state = {
    globalFunctions: new Set(),
    knownMethods: new Set()
  };

  for (const file of jsFiles) {
    const code = fs.readFileSync(file, 'utf8');
    const ast = parseJS(code);
    if (!ast) continue;
    astBySource.set(file, ast);
    collectGlobalFunctions(ast, state.globalFunctions);
    collectKnownMethods(ast, state.knownMethods);
  }

  for (const snippet of snippetSources) {
    const ast = parseJS(snippet.code);
    if (!ast) continue;
    snippetAsts.push({ file: snippet.file, ast });
    collectGlobalFunctions(ast, state.globalFunctions);
    collectKnownMethods(ast, state.knownMethods);
  }

  const errors = [];
  for (const file of jsFiles) {
    const ast = astBySource.get(file);
    if (!ast) continue;
    analyzeAst(ast, file, state, errors);
  }

  for (const snippet of snippetAsts) {
    analyzeAst(snippet.ast, snippet.file, state, errors);
  }

  const deduped = [];
  const seen = new Set();
  for (const error of errors) {
    const key = createErrorKey(error);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(error);
  }
  deduped.sort((a, b) => (
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.name.localeCompare(b.name)
  ));

  if (deduped.length) {
    console.error('Undefined calls found:');
    for (const err of deduped) {
      console.error(`  ${err.file}:${err.line} - ${err.name} is not defined`);
    }
    process.exit(1);
  }

  console.log('No undefined calls detected.');
};

main();
