import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildBundle } from './build-mcpb-bundle.js';
import { createFlatWalkFixture } from '../js/solver/SolverFixtures.js';

const install = (directory, env) => new Promise((resolve, reject) => {
  const npm = process.env.npm_execpath;
  if (!npm?.endsWith('.js')) { reject(new Error('Run qualification through npm run mcpb:qualify.')); return; }
  const child = spawn(process.execPath, [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let errorText = '';
  child.stderr.on('data', bytes => { errorText = (errorText + bytes).slice(-4096); });
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Isolated dependency installation exceeded 180 seconds.')); }, 180000);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Isolated dependency installation failed (${code}): ${errorText}`)); });
});

export async function qualifyMcpBundles({ surfaces = [null, 'game', 'editor', 'interact'] } = {}) {
  const receipts = [];
  for (const surface of surfaces) {
    const { distDir, closure } = await buildBundle({ argv: surface ? ['--surface', surface] : [], log: { log: message => process.stderr.write(message + '\n') } });
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-mcpb-'));
    let transport, client;
    try {
      await fs.cp(distDir, temporary, { recursive: true });
      const env = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' };
      delete env.NODE_PATH; delete env.NODE_OPTIONS;
      await install(temporary, env);
      if (surface) env.LEMMINGS_MCP_SURFACES = surface; else delete env.LEMMINGS_MCP_SURFACES;
      transport = new StdioClientTransport({ command: process.execPath, args: [path.join(temporary, 'mcp/server.js')], cwd: temporary, env, stderr: 'pipe' });
      client = new Client({ name: 'isolated-mcpb-qualification', version: '1.0.0' });
      let timer;
      await Promise.race([client.connect(transport), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Isolated MCP initialization timed out.')), 20000); })]).finally(() => clearTimeout(timer));
      const listed = await client.listTools({}, { timeout: 10000 }), names = listed.tools.map(tool => tool.name);
      if (!names.length || surface && names.some(name => name.startsWith('solver_'))) throw new Error('Staged tool catalog does not match its advertised surface.');
      let solver = 'not-advertised';
      if (names.includes('solver_route')) {
        const source = createFlatWalkFixture(); source.groundMask = Array.from(source.groundMask); source.steelMask = Array.from(source.steelMask);
        const result = await client.callTool({ name: 'solver_route', arguments: { source, options: { maxNodes: 50 } } }, undefined, { timeout: 10000 });
        if (result.isError || result.structuredContent?.ok !== true || !result.structuredContent?.routeSkeleton) throw new Error('Staged solver route operation did not return a bounded route.');
        solver = 'route-acknowledged';
      }
      receipts.push({ schema: 'lemmings-mcpb-qualification/v1', surface: surface || 'all', status: 'initialized-tools-listed',
        tools: names, solver, sourceFiles: closure.files.length, sourceBytes: closure.sourceBytes,
        isolation: 'temporary directory outside checkout; installed declared production dependencies; NODE_PATH/NODE_OPTIONS removed' });
    } finally {
      try { await client?.close(); } finally {
        await transport?.close();
        const resolved = path.resolve(temporary), parent = path.resolve(os.tmpdir());
        if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('lemmings-mcpb-')) throw new Error('Refusing unexpected qualification cleanup path.');
        await fs.rm(resolved, { recursive: true, force: true });
      }
    }
  }
  return receipts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  qualifyMcpBundles().then(receipts => process.stdout.write(JSON.stringify({ receipts }, null, 2) + '\n'))
    .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
