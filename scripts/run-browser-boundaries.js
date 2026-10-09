import httpServer from 'http-server';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');

const withBoundaryServer = async run => {
  const server = httpServer.createServer({ root: repoRoot, cache: -1, showDir: 'false' }).server;
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseURL = 'http://127.0.0.1:' + server.address().port;
  try {
    return await run(baseURL);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      for (const socket of sockets) socket.destroy();
    });
  }
};

const runBrowserBoundaries = (args, { env = process.env, stdio = 'inherit', log = console.log } = {}) => withBoundaryServer(async baseURL => {
  log('Browser boundaries own ' + baseURL);
  const child = spawn(process.execPath, [playwrightCli, 'test', ...args], { cwd: repoRoot, stdio,
    env: { ...env, LEMMINGS_E2E_BASE_URL: baseURL, LEMMINGS_E2E_EXTERNAL_SERVER: '1' } });
  const interrupt = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT'); };
  const terminate = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
});

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runBrowserBoundaries(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}

export { withBoundaryServer, runBrowserBoundaries };
