import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { parse } from 'acorn';

const require = createRequire(import.meta.url);

const definedFunctions = new Set();
const definedMethods = new Set();
const calls = [];

const builtinFunctions = new Set([
  'require',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
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
  'WebMidi',
  'jQuery',
  '$'
]);

const builtinMethods = new Set([
  'log',
  'error',
  'warn',
  'info',
  'push',
  'pop',
  'forEach',
  'map',
  'addEventListener',
  'removeEventListener',
  'querySelector',
  'getElementById',
  'appendChild',
  'replace',
  'split',
  'join',
  'indexOf',
  'slice',
  'substring',
  'createElement',
  'ready',
  'css',
  'addClass',
  'removeClass',
  'values',
  'catch',
  'then'
]);

function walk(node, visitor) {
  if (!node || typeof node.type !== 'string') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const c of value) walk(c, visitor);
    } else if (value && typeof value.type === 'string') {
      walk(value, visitor);
    }
  }
}

function collectFromAst(ast, file, withCalls) {
  walk(ast, node => {
    if (node.type === 'FunctionDeclaration' && node.id) {
      definedFunctions.add(node.id.name);
    } else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression')) {
      definedFunctions.add(node.id.name);
    } else if (node.type === 'ClassDeclaration' && node.body && node.body.body) {
      for (const m of node.body.body) {
        if ((m.type === 'MethodDefinition' || m.type === 'PropertyDefinition') && m.key.type === 'Identifier') {
          definedMethods.add(m.key.name);
        }
      }
    } else if (withCalls && node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier') {
        calls.push({ type: 'function', name: node.callee.name, file, line: node.loc.start.line });
      } else if (node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.property.type === 'Identifier') {
        let objName = null;
        if (node.callee.object.type === 'Identifier') objName = node.callee.object.name;
        else if (node.callee.object.type === 'ThisExpression') objName = 'this';
        calls.push({ type: 'method', name: node.callee.property.name, object: objName, file, line: node.loc.start.line });
      }
    }
  });
}

function parseJS(code, file) {
  try {
    return parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    try {
      return parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    } catch {
      try {
        return parse(`function tmp(){${code}\n}`, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
      } catch {
        return null;
      }
    }
  }
}

function processJSFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  const ast = parseJS(code, file);
  if (ast) collectFromAst(ast, file, false);
}

function processHtmlFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const { parseDocument } = require('htmlparser2');
  const { DomUtils } = require('htmlparser2');
  const document = parseDocument(html);

  // Extract and process <script> tag content
  const scriptTags = DomUtils.findAll(elem => elem.tagName === 'script', document.children);
  for (const scriptTag of scriptTags) {
    const js = DomUtils.textContent(scriptTag);
    const ast = parseJS(js, file);
    if (ast) collectFromAst(ast, file, true);
  }

  // Extract and process inline event handler attributes
  const elementsWithAttributes = DomUtils.findAll(elem => elem.attribs, document.children);
  for (const elem of elementsWithAttributes) {
    for (const [attr, value] of Object.entries(elem.attribs)) {
      if (attr.startsWith('on')) {
        const ast = parseJS(value, file);
        if (ast) collectFromAst(ast, file, true);
      }
    }
  }
}

function gatherFiles(dir, exts, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      gatherFiles(full, exts, results);
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      if (entry.name === 'jquery.js') continue;
      results.push(full);
    }
  }
  return results;
}

let jsFiles = [];
let htmlFiles = [];

const args = process.argv.slice(2);
if (args.length) {
  for (const arg of args) {
    if (arg.endsWith('.js')) jsFiles.push(arg);
    else if (arg.endsWith('.html')) htmlFiles.push(arg);
  }
} else {
  jsFiles = gatherFiles('js', ['.js']);
  htmlFiles = gatherFiles('.', ['.html']);
}

for (const file of jsFiles) processJSFile(file);
for (const file of htmlFiles) processHtmlFile(file);

const errors = [];
for (const call of calls) {
  if (call.type === 'function') {
    if (!definedFunctions.has(call.name) && !builtinFunctions.has(call.name)) {
      errors.push(`${call.file}:${call.line} - Undefined function ${call.name}`);
    }
  } else if (call.type === 'method') {
    if (builtinObjects.has(call.object)) continue;
    if (!definedMethods.has(call.name) && !builtinMethods.has(call.name)) {
      errors.push(`${call.file}:${call.line} - Undefined method ${call.name}`);
    }
  }
}

if (errors.length) {
  console.error('Undefined calls found:');
  for (const err of errors) console.error('  ' + err);
  process.exit(1);
} else {
  console.log('No undefined calls detected.');
}
