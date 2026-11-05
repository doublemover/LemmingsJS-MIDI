const tokenPattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;

// Legacy manifests describe literal relative imports, not computed module loaders.
// The Node producer cross-checks this bounded scan against the compiler syntax tree.
export function surveySourceImports(source) {
  const imports = [], tokens = source.matchAll(tokenPattern);
  let declaration = false, previous = '', dynamic = false;
  for (const match of tokens) {
    const token = match[0];
    if (token.startsWith('/*') || token.startsWith('//')) continue;
    const quoted = token[0] === '"' || token[0] === '\'';
    if (quoted) {
      if (declaration && ['from', 'import'].includes(previous) || dynamic) {
        if (token.includes('\\')) throw new Error('Escaped survey module specifiers require an explicit source contract.');
        const specifier = token.slice(1, -1);
        if (specifier.startsWith('.')) imports.push(specifier);
      }
      if (['from', 'import'].includes(previous) || dynamic) declaration = false;
      dynamic = false;
    } else if (token[0] === '`') {
      if (/\$\{[\s\S]*\bimport\s*\(/.test(token)) throw new Error('Template-contained survey imports require an explicit source contract.');
      declaration = false; dynamic = false;
    } else if (token === 'import' && previous !== '.' || token === 'export' && previous !== '.') {
      declaration = true; dynamic = false;
    } else if (declaration && token === '(' && previous === 'import') { dynamic = true; declaration = false; }
    else if ([';', 'const', 'let', 'var', 'function', 'class', 'default'].includes(token) || token === '.' && previous === 'import') { declaration = false; dynamic = false; }
    else if (dynamic) dynamic = false;
    previous = token;
  }
  return imports;
}
