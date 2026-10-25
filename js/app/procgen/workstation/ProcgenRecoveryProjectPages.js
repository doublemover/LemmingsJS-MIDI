import { isSealedMidiProjectNode } from '../../../midi/project/MidiProjectSnapshot.js';
const schema = 'procgen-recovery-project/v1';
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const validKey = key => typeof key === 'string' && key.length > 0 && key.length <= 128 && !unsafe.has(key);
const scalar = value => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 4096;
const fail = () => { throw new Error('Invalid paged recovery project.'); };

export async function encodeRecoveryProject(project, encode) {
  if (!project || typeof project !== 'object' || Array.isArray(project) || !Array.isArray(project.procgen?.lanes) || project.procgen.lanes.length > 1024) fail();
  const fields = async (object, excluded) => {
    const keys = Object.keys(object).filter(key => key !== excluded); if (keys.length > 64) fail();
    const result = [];
    for (const key of keys) {
      if (!validKey(key)) fail();
      const descriptor = Object.getOwnPropertyDescriptor(object, key); if (!descriptor || !('value' in descriptor)) fail();
      const value = descriptor.value;
      if (value === undefined) continue;
      if (scalar(value)) result.push({ key, value });
      else if (value && typeof value === 'object' || typeof value === 'string') result.push({ key, page: await encode(value, 'project-field', 16 * 1048576, 129 * 1048576, isSealedMidiProjectNode(value)) });
      else fail();
    }
    return result;
  };
  const top = await fields(project, 'procgen'), procgen = await fields(project.procgen, 'lanes'), lanes = [];
  for (const lane of project.procgen.lanes) {
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) fail();
    lanes.push(await encode(lane, 'project-lane', 1048576, 9 * 1048576, isSealedMidiProjectNode(lane)));
  }
  return { schema, fields: top, procgen: { fields: procgen, lanes } };
}

export async function decodeRecoveryProject(layout, decode) {
  if (layout?.schema !== schema || !Array.isArray(layout.procgen?.lanes) || layout.procgen.lanes.length > 1024) fail();
  const fields = async (entries, excluded) => {
    if (!Array.isArray(entries) || entries.length > 64) fail();
    const result = {};
    for (const entry of entries) {
      if (!entry || !validKey(entry.key) || entry.key === excluded || Object.hasOwn(result, entry.key) || Object.hasOwn(entry, 'page') === Object.hasOwn(entry, 'value')) fail();
      if (!entry.page && !scalar(entry.value)) fail();
      result[entry.key] = entry.page ? await decode(entry.page) : entry.value;
    }
    return result;
  };
  const project = await fields(layout.fields, 'procgen'), procgen = await fields(layout.procgen.fields, 'lanes'), lanes = [];
  for (const ref of layout.procgen.lanes) { const lane = await decode(ref); if (!lane || typeof lane !== 'object' || Array.isArray(lane)) fail(); lanes.push(lane); }
  return { ...project, procgen: { ...procgen, lanes } };
}
