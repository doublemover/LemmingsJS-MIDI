import fs from 'fs';
import path from 'path';
import { Linter } from 'eslint';
import { processHtmlFile as extractHtmlSnippets } from './processHtmlFile.js';
import { checkUndefinedGlobals } from './lint-globals.js';

const defaultHtmlFiles = Object.freeze([
  'index.html',
  'editor.html',
  'procgen.html'
]);

const ignoredPathParts = Object.freeze(new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'test-results'
]));

const ignoredJsPathParts = Object.freeze(new Set([
  'js/vendor'
]));

const jsExtensions = Object.freeze(new Set([
  '.js',
  '.mjs',
  '.cjs'
]));

const linter = new Linter();

const checkConfig = Object.freeze({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: checkUndefinedGlobals
  },
  rules: {
    'no-undef': ['error', { typeof: true }]
  }
});

const scriptConfig = Object.freeze({
  ...checkConfig,
  languageOptions: Object.freeze({
    ...checkConfig.languageOptions,
    sourceType: 'script'
  })
});

const isIgnoredPath = (filePath, ignoredParts) => {
  const normalized = filePath.replace(/\\/g, '/');
  return Array.from(ignoredParts).some((part) => normalized.includes(`/${part}/`) || normalized.endsWith(`/${part}`));
};

const discoverRootHtmlFiles = () => {
  const discovered = new Set();
  for (const fileName of defaultHtmlFiles) {
    const resolved = path.resolve(fileName);
    if (fs.existsSync(resolved)) discovered.add(resolved);
  }

  const rootEntries = fs.readdirSync(process.cwd(), { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.html')) continue;
    discovered.add(path.resolve(entry.name));
  }
  return Array.from(discovered);
};

const normalizeCliFiles = (argv) => {
  const jsFiles = [];
  const htmlFiles = [];

  for (const raw of argv) {
    const file = path.resolve(raw);
    const ext = path.extname(file).toLowerCase();
    if (jsExtensions.has(ext)) {
      jsFiles.push(file);
    } else if (ext === '.html') {
      htmlFiles.push(file);
    }
  }

  return { jsFiles, htmlFiles };
};

const dedupeFiles = (files) => Array.from(new Set(files.map((file) => path.resolve(file))));

const formatMessage = (file, message) => ({
  file,
  line: message.line || 1,
  column: message.column || 1,
  message: message.message
});

const lintCode = ({ code, file, config }) => (
  linter.verify(code, config)
    .filter((message) => message.severity === 2)
    .map((message) => formatMessage(file, message))
);

const wrapHtmlSnippet = (snippet) => {
  if (snippet.type === 'handler') {
    return `function __html_handler__() {\n${snippet.code}\n}`;
  }
  return snippet.code;
};

const lintHtmlFile = (htmlFile) => {
  const extracted = extractHtmlSnippets(htmlFile, { includeExternalScripts: true });
  const snippets = Array.isArray(extracted) ? extracted : extracted.snippets;
  const entryScripts = Array.isArray(extracted?.entryScripts) ? extracted.entryScripts : [];
  const code = (snippets || []).map(wrapHtmlSnippet).join('\n');
  const errors = code.trim()
    ? lintCode({ code, file: htmlFile, config: scriptConfig })
    : [];

  return {
    errors,
    entryScripts
  };
};

const lintJsFiles = (files) => {
  const errors = [];

  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    if (isIgnoredPath(file, ignoredPathParts) || isIgnoredPath(file, ignoredJsPathParts)) continue;

    const code = fs.readFileSync(file, 'utf8');
    errors.push(...lintCode({ code, file, config: checkConfig }));
  }

  return errors;
};

const compareErrors = (a, b) => (
  a.file.localeCompare(b.file) ||
  a.line - b.line ||
  a.column - b.column ||
  a.message.localeCompare(b.message)
);

const dedupeErrors = (errors) => {
  const deduped = [];
  const seen = new Set();
  for (const error of errors) {
    const key = `${error.file}:${error.line}:${error.column}:${error.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(error);
  }
  return deduped.sort(compareErrors);
};

const main = (argv = process.argv.slice(2)) => {
  const explicit = argv.length > 0;
  const cli = normalizeCliFiles(argv);
  const htmlFiles = explicit ? cli.htmlFiles : discoverRootHtmlFiles();

  const errors = [];
  const jsFiles = new Set(cli.jsFiles.map((file) => path.resolve(file)));

  for (const htmlFile of htmlFiles) {
    if (!fs.existsSync(htmlFile) || !fs.statSync(htmlFile).isFile()) continue;
    if (isIgnoredPath(htmlFile, ignoredPathParts)) continue;

    const result = lintHtmlFile(htmlFile);
    errors.push(...result.errors);
    for (const entryScript of result.entryScripts) {
      jsFiles.add(path.resolve(entryScript));
    }
  }

  errors.push(...lintJsFiles(dedupeFiles(Array.from(jsFiles))));

  const deduped = dedupeErrors(errors);
  if (deduped.length) {
    console.error('Undefined references found:');
    for (const error of deduped) {
      console.error(`  ${error.file}:${error.line}:${error.column} - ${error.message}`);
    }
    process.exit(1);
  }

  console.log('No undefined calls detected.');
};

main();
