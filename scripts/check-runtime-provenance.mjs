import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { verifyRuntimeProvenance } from './RuntimeProvenance.js';
import { normalizeBomDependencies } from './RuntimeBomDependencies.js';

const rootArgument = process.argv.find(argument => argument.startsWith('--root='));
const root = rootArgument ? path.resolve(rootArgument.slice('--root='.length)) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolve = name => path.join(root, name);
const packageInfo = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const fail = message => { throw new Error(`Runtime provenance: ${message}`); };
const { components, manifest } = verifyRuntimeProvenance({ rootDir: root });
if (process.argv.includes('--sbom')) {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const bom = JSON.parse(execFileSync(process.execPath, [npmCli, 'sbom', '--sbom-format=cyclonedx', '--package-lock-only'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1048576 }));
  delete bom.serialNumber; delete bom.metadata.timestamp;
  bom.metadata.component.name = packageInfo.name;
  const inputDigest = createHash('sha256')
    .update(readFileSync(resolve('package.json'))).update('\0')
    .update(readFileSync(resolve('package-lock.json'))).update('\0')
    .update(readFileSync(resolve('provenance/runtime-artifacts.json'))).digest('hex');
  bom.metadata.properties = [
    { name: 'lemmings:inputDigest:sha256', value: inputDigest },
    { name: 'lemmings:sourceRevision', value: process.env.GITHUB_SHA || 'local-unpinned' },
    ...Object.entries(manifest.selectedBackends).map(([name, value]) => ({ name: `lemmings:backend:${name}`, value })),
  ];
  const rootRef = bom.metadata.component['bom-ref'];
  const rootDependency = bom.dependencies.find(entry => entry.ref === rootRef);
  for (const component of components) {
    const ref = `file-bundle:${component.id}@${component.sha256}`;
    bom.components.push({ 'bom-ref': ref, type: 'library', name: component.id, version: component.upstreamVersion || 'unknown',
      scope: component.classification === 'development' ? 'excluded' : component.classification === 'precache' ? 'optional' : 'required',
      hashes: [{ alg: 'SHA-256', content: component.sha256 }],
      licenses: [{ license: component.license === 'NOASSERTION' ? { name: 'NOASSERTION' } : { id: component.license } }],
      externalReferences: [{ type: 'vcs', url: component.upstream }],
      properties: [{ name: 'lemmings:classification', value: component.classification },
        { name: 'lemmings:reproductionStatus', value: component.reproductionStatus },
        { name: 'lemmings:files', value: component.files.join(',') },
        { name: 'lemmings:entryPoints', value: (component.entryPoints || []).join(',') }] });
    if (component.classification !== 'development') rootDependency.dependsOn.push(ref);
    bom.dependencies.push({ ref, dependsOn: [] });
  }
  bom.components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
  bom.dependencies = normalizeBomDependencies(bom.dependencies);
  const schema = JSON.parse(readFileSync(resolve('provenance/schema/bom-1.5.schema.json'), 'utf8'));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  ajv.addFormat('iri-reference', value => typeof value === 'string' && !/[\u0000-\u0020]/.test(value));
  ajv.addFormat('idn-email', value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  for (const dependency of ['spdx', 'jsf-0.82']) {
    ajv.addSchema(JSON.parse(readFileSync(resolve(`provenance/schema/${dependency}.schema.json`), 'utf8')));
  }
  const validate = ajv.compile(schema);
  if (!validate(bom)) fail(`CycloneDX schema validation failed: ${JSON.stringify(validate.errors?.slice(0, 3).map(error => ({ path: error.instancePath, message: error.message })))}`);
  process.stdout.write(JSON.stringify(bom) + '\n');
} else process.stdout.write(`Verified ${components.length} provenance components and ${components.reduce((sum, item) => sum + item.files.length, 0)} files.\n`);
