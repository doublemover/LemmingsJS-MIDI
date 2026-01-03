import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, '..', 'scripts', 'check-mcp-client-compat.js');

describe('MCP client compatibility', () => {
  it('validates client config examples', () => {
    execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' });
  });
});
