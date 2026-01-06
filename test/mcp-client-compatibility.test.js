import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCompatibilityCheck } from '../scripts/check-mcp-client-compat.js';

const withTempDir = (prefix, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const withTempRoot = (fn) => withTempDir('mcp-compat-', (root) => {
  fs.mkdirSync(path.join(root, 'docs', 'mcp'), { recursive: true });
  return fn(root);
});

const writeJson = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const writeText = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
};
const createConsoleCapture = () => {
  const output = { log: [], warn: [], error: [] };
  return {
    output,
    consoleImpl: {
      log: (msg) => output.log.push(msg),
      warn: (msg) => output.warn.push(msg),
      error: (msg) => output.error.push(msg)
    }
  };
};

describe('MCP client compatibility', () => {
  it('reports a clean run with valid data', () => {
    withTempRoot((root) => {
      writeJson(path.join(root, 'docs', 'mcp', 'client-compatibility.json'), {
        clients: [{
          id: 'ok',
          name: 'Ok Client',
          configFormat: 'toml',
          configExample: 'configs/ok.toml',
          transport: 'stdio',
          lastVerifiedVersion: '1.0.0'
        }]
      });
      writeText(path.join(root, 'configs', 'ok.toml'),
        'mcp_servers = { lemmings = { command = \"node\", args = [] } }');

      const { output, consoleImpl } = createConsoleCapture();
      const result = runCompatibilityCheck({
        rootDir: root,
        consoleImpl,
        processImpl: { exitCode: 0 }
      });

      expect(result.errors).to.eql([]);
      expect(result.warnings).to.eql([]);
      expect(output.log[0]).to.equal('MCP client compatibility check passed.');
    });
  });

  it('captures warnings and errors for invalid inputs', () => {
    withTempRoot((root) => {
      writeJson(path.join(root, 'docs', 'mcp', 'client-compatibility.json'), {
        clients: [
          null,
          { name: 'Missing id' },
          {
            id: 'broken',
            name: '',
            configFormat: '',
            configExample: '',
            transport: '',
            lastVerifiedVersion: '',
            needsReview: true
          },
          {
            id: 'dup',
            name: 'Duplicate One',
            configFormat: 'toml',
            configExample: 'configs/dup.toml',
            transport: 'stdio',
            lastVerifiedVersion: 'unknown'
          },
          {
            id: 'dup',
            name: 'Duplicate Two',
            configFormat: 'toml',
            configExample: 'configs/bad.toml',
            transport: 'stdio',
            lastVerifiedVersion: '1.0.0'
          },
          {
            id: 'jsonbad',
            name: 'Json Bad',
            configFormat: 'json',
            configExample: 'configs/bad.json',
            transport: 'stdio',
            lastVerifiedVersion: '1.0.0'
          },
          {
            id: 'jsonmissing',
            name: 'Json Missing',
            configFormat: 'json',
            configExample: 'configs/missing.json',
            transport: 'stdio',
            lastVerifiedVersion: '1.0.0'
          }
        ]
      });
      writeText(path.join(root, 'configs', 'bad.toml'), 'nope = true');
      writeText(path.join(root, 'configs', 'bad.json'), '{bad');
      writeText(path.join(root, 'configs', 'missing.json'), '{}');

      const { output, consoleImpl } = createConsoleCapture();
      const processState = { exitCode: 0 };
      const result = runCompatibilityCheck({
        rootDir: root,
        consoleImpl,
        processImpl: processState
      });

      expect(result.errors.length).to.be.greaterThan(0);
      expect(result.warnings.length).to.be.greaterThan(0);
      expect(processState.exitCode).to.equal(1);
      expect(output.error.some(msg => msg.includes('Duplicate client id'))).to.equal(true);
      expect(output.warn.some(msg => msg.includes('version is unknown'))).to.equal(true);
    });
  });

  it('runs the compatibility check when executed as a script', () => {
    const result = spawnSync(process.execPath, ['scripts/check-mcp-client-compat.js'], {
      encoding: 'utf8'
    });
    expect(result.status).to.equal(0);
    expect(result.stdout).to.contain('MCP client compatibility check passed.');
  });

  it('reports missing compatibility files', () => {
    withTempDir('mcp-compat-missing-', (root) => {
      const { output, consoleImpl } = createConsoleCapture();
      const processState = { exitCode: 0 };
      const result = runCompatibilityCheck({
        rootDir: root,
        consoleImpl,
        processImpl: processState
      });
      expect(result.errors).to.include('client-compatibility.json is missing or invalid.');
      expect(processState.exitCode).to.equal(1);
    });
  });

  it('treats argv resolution errors as non-main execution', async () => {
    const originalArgv1 = process.argv[1];
    try {
      // Force path.resolve(process.argv[1]) in the module's isMain detection to throw.
      process.argv[1] = {};
      const mod = await import(`../scripts/check-mcp-client-compat.js?argv=${Date.now()}`);
      expect(mod).to.have.property('runCompatibilityCheck');
    } finally {
      process.argv[1] = originalArgv1;
    }
  });

});
