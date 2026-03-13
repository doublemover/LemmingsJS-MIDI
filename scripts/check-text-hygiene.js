#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASELINE_PATH = fileURLToPath(new URL('./check-text-hygiene-baseline.txt', import.meta.url));

const normalizeFilePath = (filePath) => String(filePath || '').replace(/\\/g, '/');

const toBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value || ''), 'utf8');
};

const defaultRunGitCommand = (args, { cwd = process.cwd() } = {}) => (
  spawnSync('git', args, { cwd, encoding: 'buffer' })
);

const listTrackedFiles = (
  {
    cwd = process.cwd(),
    runGitCommand = defaultRunGitCommand
  } = {}
) => {
  const result = runGitCommand(['ls-files', '-z'], { cwd });
  if (!result || result.error) {
    const message = result?.error?.message || 'Unknown git failure';
    throw new Error(`Failed to list tracked files: ${message}`);
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    const stderr = toBuffer(result.stderr).toString('utf8').trim();
    throw new Error(`Failed to list tracked files: ${stderr || `git exited with status ${result.status}`}`);
  }

  return toBuffer(result.stdout)
    .toString('utf8')
    .split('\0')
    .map((filePath) => normalizeFilePath(filePath.trim()))
    .filter(Boolean);
};

const isTrackedTextBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

const findTextHygieneIssues = (filePath, text) => {
  const issues = [];
  const lines = String(text).split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/[ \t]+$/);
    if (!match) continue;
    issues.push({
      filePath,
      line: index + 1,
      column: line.length - match[0].length + 1,
      reason: 'trailing whitespace'
    });
  }

  if (/(?:\r?\n){2,}$/.test(text)) {
    issues.push({
      filePath,
      line: lines.length,
      column: 1,
      reason: 'extra blank line at end of file'
    });
  }

  return issues;
};

const checkTextHygieneFiles = (
  filePaths,
  {
    cwd = process.cwd(),
    readFile = fs.readFileSync
  } = {}
) => {
  const issues = [];
  let checkedFiles = 0;

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(cwd, filePath);
    const buffer = readFile(absolutePath);
    if (!isTrackedTextBuffer(buffer)) continue;
    checkedFiles += 1;
    const text = buffer.toString('utf8');
    issues.push(...findTextHygieneIssues(normalizeFilePath(filePath), text));
  }

  return {
    checkedFiles,
    issues
  };
};

const formatIssue = (issue) => (
  `${normalizeFilePath(issue.filePath)}:${issue.line}:${issue.column} ${issue.reason}`
);

const loadBaselineEntries = (
  {
    baselinePath = DEFAULT_BASELINE_PATH,
    readFile = fs.readFileSync
  } = {}
) => {
  const content = readFile(baselinePath, 'utf8');
  return new Set(
    String(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
};

const reconcileIssuesAgainstBaseline = (issues, baselineEntries) => {
  if (!baselineEntries || baselineEntries.size === 0) {
    return {
      remainingIssues: issues,
      staleEntries: [],
      ignoredIssueCount: 0
    };
  }

  const currentEntries = new Set(issues.map(formatIssue));
  const remainingIssues = [];
  let ignoredIssueCount = 0;

  for (const issue of issues) {
    const entry = formatIssue(issue);
    if (baselineEntries.has(entry)) {
      ignoredIssueCount += 1;
      continue;
    }
    remainingIssues.push(issue);
  }

  const staleEntries = Array.from(baselineEntries)
    .filter((entry) => !currentEntries.has(entry))
    .sort((left, right) => left.localeCompare(right));

  return {
    remainingIssues,
    staleEntries,
    ignoredIssueCount
  };
};

const resolveCliFilePaths = (argv, cwd = process.cwd()) => (
  argv.map((filePath) => normalizeFilePath(path.relative(cwd, path.resolve(cwd, filePath))))
);

const main = (
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    runGitCommand = defaultRunGitCommand,
    readFile = fs.readFileSync,
    loadBaseline = loadBaselineEntries,
    baselinePath = DEFAULT_BASELINE_PATH,
    log = console.log,
    error = console.error,
    exit = process.exit
  } = {}
) => {
  const useBaseline = argv.length === 0;
  let filePaths;
  try {
    filePaths = argv.length ? resolveCliFilePaths(argv, cwd) : listTrackedFiles({ cwd, runGitCommand });
  } catch (err) {
    error(err.message);
    exit(1);
    return;
  }

  let result;
  try {
    result = checkTextHygieneFiles(filePaths, { cwd, readFile });
  } catch (err) {
    error(`Failed to check text hygiene: ${err.message}`);
    exit(1);
    return;
  }

  let remainingIssues = result.issues;
  let staleEntries = [];
  let ignoredIssueCount = 0;
  if (useBaseline) {
    try {
      const baselineEntries = loadBaseline({ baselinePath, readFile });
      const reconciled = reconcileIssuesAgainstBaseline(result.issues, baselineEntries);
      remainingIssues = reconciled.remainingIssues;
      staleEntries = reconciled.staleEntries;
      ignoredIssueCount = reconciled.ignoredIssueCount;
    } catch (err) {
      error(`Failed to load text hygiene baseline: ${err.message}`);
      exit(1);
      return;
    }
  }

  if (remainingIssues.length > 0 || staleEntries.length > 0) {
    for (const issue of remainingIssues) {
      error(formatIssue(issue));
    }
    if (staleEntries.length > 0) {
      error('Text hygiene baseline contains stale entries:');
      for (const entry of staleEntries) {
        error(entry);
      }
    }
    exit(1);
    return;
  }

  const baselineSuffix = ignoredIssueCount > 0 ? ` (${ignoredIssueCount} baseline issues ignored)` : '';
  log(`Text hygiene OK: ${result.checkedFiles} text files checked${baselineSuffix}.`);
  exit(0);
};

const isMain = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main();
}

export {
  checkTextHygieneFiles,
  findTextHygieneIssues,
  formatIssue,
  isTrackedTextBuffer,
  listTrackedFiles,
  loadBaselineEntries,
  main,
  reconcileIssuesAgainstBaseline,
  resolveCliFilePaths
};
