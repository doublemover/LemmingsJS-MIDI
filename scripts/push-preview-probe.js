import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PREVIEW_BASE = 'd163d2a2862bd51e6592794e7d2bcea09c41e756';
export const PREVIEW_BRANCH = 'security/preview-probe-20261007';
export const PREVIEW_REMOTE = 'https://github.com/doublemover/LemmingsJS-MIDI.git';
export const PREVIEW_FILES = Object.freeze([
  'preview-probe.html',
  'scripts/push-preview-probe.js',
  'test/preview-probe.test.js'
]);

export function validatePreviewPushSnapshot(snapshot, expectedCommit) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '') || snapshot.head !== expectedCommit) {
    throw new Error('The explicitly reviewed commit must match HEAD.');
  }
  if (snapshot.branch !== PREVIEW_BRANCH || snapshot.remote !== PREVIEW_REMOTE) {
    throw new Error('Unexpected branch or origin; no push attempted.');
  }
  if (snapshot.dirty || snapshot.mergeBase !== PREVIEW_BASE || !/^[1-9][0-9]*$/.test(snapshot.commitCount)) {
    throw new Error('Expected clean isolated commits descended from the verified base.');
  }
  const files = [...snapshot.files].sort();
  if (JSON.stringify(files) !== JSON.stringify([...PREVIEW_FILES].sort())) {
    throw new Error('The commit must contain only the three preview-probe files.');
  }
  return ['push', '--porcelain', 'origin', `${expectedCommit}:refs/heads/${PREVIEW_BRANCH}`];
}

export function preparePreviewPush(runGit, expectedCommit) {
  const args = validatePreviewPushSnapshot({
    head: runGit(['rev-parse', 'HEAD']),
    branch: runGit(['branch', '--show-current']),
    remote: runGit(['remote', 'get-url', '--push', 'origin']),
    dirty: runGit(['status', '--porcelain']),
    mergeBase: runGit(['merge-base', PREVIEW_BASE, 'HEAD']),
    commitCount: runGit(['rev-list', '--count', `${PREVIEW_BASE}..HEAD`]),
    files: runGit(['diff', '--name-only', PREVIEW_BASE, 'HEAD']).split(/\r?\n/).filter(Boolean)
  }, expectedCommit);
  return args;
}

function main() {
  const argumentsList = process.argv.slice(2);
  const expectedCommit = argumentsList.find(argument => argument.startsWith('--expected-commit='))?.slice(18);
  if (argumentsList.some(argument => argument !== '--push' && !argument.startsWith('--expected-commit='))) {
    throw new Error('Use --expected-commit=<reviewed SHA>; add --push only after publication approval.');
  }
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const runGit = args => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
    if (result.error || result.status !== 0) {
      throw new Error(result.error?.message || result.stderr || 'Git failed.');
    }
    return result.stdout.trim();
  };
  const pushArgs = preparePreviewPush(runGit, expectedCommit);
  if (!argumentsList.includes('--push')) {
    console.log(`Validated only. No network request or push performed.\ngit ${pushArgs.join(' ')}`);
    return;
  }
  if (process.env.PREVIEW_PROBE_PUBLICATION_APPROVED !== 'yes') {
    throw new Error('Set PREVIEW_PROBE_PUBLICATION_APPROVED=yes only for the authorized publication.');
  }
  console.log(runGit(pushArgs));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
