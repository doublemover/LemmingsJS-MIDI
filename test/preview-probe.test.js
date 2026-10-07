import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import {
  PREVIEW_BASE,
  PREVIEW_BRANCH,
  PREVIEW_REMOTE,
  PREVIEW_FILES,
  validatePreviewPushSnapshot,
  preparePreviewPush
} from '../scripts/push-preview-probe.js';

const root = new URL('../', import.meta.url);
const marker = 'file:///C:/Users/sneak/OneDrive/Desktop/Ga37xMbWgAA2XY4.jpg';
const publicUrl = 'https://doublemover.github.io/LemmingsJS-MIDI/preview-probe.html';
const html = readFileSync(new URL('preview-probe.html', root), 'utf8');
const $ = load(html);
const reviewedCommit = 'a'.repeat(40);
const cleanSnapshot = () => ({
  head: reviewedCommit,
  branch: PREVIEW_BRANCH,
  remote: PREVIEW_REMOTE,
  dirty: '',
  mergeBase: PREVIEW_BASE,
  commitCount: '1',
  files: [...PREVIEW_FILES]
});

describe('authorized static preview probe', () => {
  it('keeps the marker reference exclusively in the two image metadata fields', () => {
    assert.equal($('meta[property="og:image"]').attr('content'), marker);
    assert.equal($('meta[name="twitter:image"]').attr('content'), marker);
    assert.equal(html.split(marker).length - 1, 2);
    const fileUris = html.match(/file:[^"\s<>]+/g) || [];
    assert.deepEqual(fileUris, [marker, marker]);
  });

  it('uses the normal public page URL for canonical and OpenGraph destinations', () => {
    assert.equal($('link[rel="canonical"]').attr('href'), publicUrl);
    assert.equal($('meta[property="og:url"]').attr('content'), publicUrl);
    assert.match($('title').text(), /authorized.*test/i);
    assert.match($('meta[name="description"]').attr('content'), /test/i);
  });

  it('contains no active resources, redirects, collectors, forms, or event handlers', () => {
    assert.equal($('script,img,iframe,frame,object,embed,form,input,button,audio,video,source,style,base,a').length, 0);
    assert.equal($('meta[http-equiv]').length, 0);
    assert.equal($('[src],[srcset],[action],[ping]').length, 0);
    $('*').each((index, element) => {
      assert.equal(Object.keys(element.attribs || {}).some(name => /^on/i.test(name)), false);
    });
    assert.equal($('link').length, 1);
    assert.deepEqual([...new Set(html.match(/https?:[^"\s<>]+/g))], [publicUrl]);
  });

  it('plans only a normal push of the reviewed commit to the dedicated branch', () => {
    assert.deepEqual(validatePreviewPushSnapshot(cleanSnapshot(), reviewedCommit), [
      'push', '--porcelain', 'origin', `${reviewedCommit}:refs/heads/${PREVIEW_BRANCH}`
    ]);
  });

  it('accepts a normal follow-up commit without allowing other files', () => {
    const snapshot = { ...cleanSnapshot(), commitCount: '2' };
    assert.equal(validatePreviewPushSnapshot(snapshot, reviewedCommit)[0], 'push');
  });

  it('rejects an unexpected commit, branch, remote, dirty state, base, history, or file', () => {
    for (const mutation of [
      { head: 'b'.repeat(40) },
      { branch: 'master' },
      { remote: 'https://example.invalid/repository.git' },
      { dirty: ' M preview-probe.html' },
      { mergeBase: 'b'.repeat(40) },
      { commitCount: '0' },
      { files: [...PREVIEW_FILES, 'index.html'] },
      { files: ['preview-probe.html'] }
    ]) {
      assert.throws(() => validatePreviewPushSnapshot({ ...cleanSnapshot(), ...mutation }, reviewedCommit));
    }
    assert.throws(() => validatePreviewPushSnapshot(cleanSnapshot(), 'HEAD'));
  });

  it('prepares the push using local Git reads without invoking push or a remote lookup', () => {
    const calls = [];
    const values = [reviewedCommit, PREVIEW_BRANCH, PREVIEW_REMOTE, '', PREVIEW_BASE, '1', PREVIEW_FILES.join('\n')];
    const args = preparePreviewPush(command => {
      calls.push(command);
      return values.shift();
    }, reviewedCommit);
    assert.equal(calls.length, 7);
    assert.equal(calls.some(command => ['push', 'fetch', 'pull', 'ls-remote'].includes(command[0])), false);
    assert.equal(args[0], 'push');
  });
});
