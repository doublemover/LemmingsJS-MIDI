#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DOC_PATH = path.join('docs', 'release-readiness.md');

const REQUIRED_SECTIONS = Object.freeze([
  'Compatibility',
  'Migration',
  'Performance',
  'Accessibility',
  'Rollback Rehearsal'
]);

const parseArgs = (argv = []) => {
  const out = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=', 2);
    out.set(key, value ?? 'true');
  }
  return out;
};

const parseBoolean = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
};

const normalizeSectionName = (value) => String(value || '').trim().toLowerCase();

const parseChecklistBySection = (markdownText) => {
  const sectionMap = new Map();
  const lines = String(markdownText || '').split(/\r?\n/);
  let currentSection = null;
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      if (!sectionMap.has(currentSection)) {
        sectionMap.set(currentSection, []);
      }
      continue;
    }
    const itemMatch = line.match(/^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$/);
    if (!itemMatch || !currentSection) continue;
    sectionMap.get(currentSection).push({
      checked: itemMatch[1].toLowerCase() === 'x',
      text: itemMatch[2]
    });
  }
  return sectionMap;
};

const evaluateReleaseReadiness = (
  markdownText,
  {
    requiredSections = REQUIRED_SECTIONS,
    requireAllChecked = true
  } = {}
) => {
  const sections = parseChecklistBySection(markdownText);
  const normalizedSectionNameToActual = new Map();
  for (const sectionName of sections.keys()) {
    normalizedSectionNameToActual.set(normalizeSectionName(sectionName), sectionName);
  }

  const missingSections = [];
  const emptySections = [];
  const uncheckedItems = [];
  let checkedCount = 0;
  let itemCount = 0;

  for (const requiredSection of requiredSections) {
    const found = normalizedSectionNameToActual.get(normalizeSectionName(requiredSection));
    if (!found) {
      missingSections.push(requiredSection);
      continue;
    }
    const items = sections.get(found) || [];
    if (!items.length) {
      emptySections.push(requiredSection);
      continue;
    }
    for (const item of items) {
      itemCount += 1;
      if (item.checked) {
        checkedCount += 1;
      } else if (requireAllChecked) {
        uncheckedItems.push({ section: requiredSection, text: item.text });
      }
    }
  }

  return {
    ok: missingSections.length === 0 && emptySections.length === 0 && uncheckedItems.length === 0,
    requiredSections: requiredSections.slice(),
    counts: {
      sectionCount: requiredSections.length,
      itemCount,
      checkedCount,
      uncheckedCount: Math.max(0, itemCount - checkedCount)
    },
    missingSections,
    emptySections,
    uncheckedItems
  };
};

const run = (
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    fsImpl = fs,
    log = console,
    exit = process.exit
  } = {}
) => {
  const args = parseArgs(argv);
  const docPath = args.get('file') || process.env.LEMMINGS_RELEASE_READINESS_PATH || DEFAULT_DOC_PATH;
  const requireAllChecked = parseBoolean(
    args.get('strict') || process.env.LEMMINGS_RELEASE_READINESS_STRICT,
    true
  );
  const resolvedDocPath = path.resolve(cwd, docPath);

  let text;
  try {
    text = fsImpl.readFileSync(resolvedDocPath, 'utf8');
  } catch (error) {
    log.error(`Unable to read release-readiness document: ${resolvedDocPath}`);
    log.error(error?.message || String(error));
    exit(1);
    return;
  }

  const summary = evaluateReleaseReadiness(text, { requireAllChecked });
  log.log(JSON.stringify({
    docPath: path.relative(cwd, resolvedDocPath).replace(/\\/g, '/'),
    strict: requireAllChecked,
    ...summary
  }, null, 2));

  if (!summary.ok) {
    exit(1);
  }
};

const isMain = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  run();
}

export {
  DEFAULT_DOC_PATH,
  REQUIRED_SECTIONS,
  evaluateReleaseReadiness,
  parseChecklistBySection,
  run
};
