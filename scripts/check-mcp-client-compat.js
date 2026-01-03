import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const matrixPath = path.join(root, 'docs', 'mcp', 'client-compatibility.json');

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const ensureString = (value) => typeof value === 'string' && value.trim().length > 0;

const checkToml = (content) => {
  return content.includes('mcp_servers') && content.includes('command') && content.includes('args');
};

const checkJsonConfig = (data) => {
  if (!data || typeof data !== 'object') return false;
  const servers = data.mcpServers || data.mcp_servers;
  if (!servers || typeof servers !== 'object') return false;
  const entry = servers.lemmings;
  if (!entry || typeof entry !== 'object') return false;
  return ensureString(entry.command) && Array.isArray(entry.args);
};

const errors = [];
const warnings = [];

const matrix = readJson(matrixPath);
if (!matrix || typeof matrix !== 'object') {
  errors.push('client-compatibility.json is missing or invalid.');
}
const clients = Array.isArray(matrix?.clients) ? matrix.clients : [];
const ids = new Set();
for (const client of clients) {
  if (!client || typeof client !== 'object') {
    errors.push('Client entry is not an object.');
    continue;
  }
  if (!ensureString(client.id)) {
    errors.push('Client entry missing id.');
    continue;
  }
  if (ids.has(client.id)) {
    errors.push(`Duplicate client id: ${client.id}`);
  }
  ids.add(client.id);
  if (!ensureString(client.name)) {
    errors.push(`Client ${client.id} missing name.`);
  }
  if (!ensureString(client.configFormat)) {
    errors.push(`Client ${client.id} missing configFormat.`);
  }
  if (!ensureString(client.configExample)) {
    errors.push(`Client ${client.id} missing configExample.`);
  }
  if (!ensureString(client.transport)) {
    errors.push(`Client ${client.id} missing transport.`);
  }
  if (!ensureString(client.lastVerifiedVersion)) {
    errors.push(`Client ${client.id} missing lastVerifiedVersion.`);
  } else if (client.lastVerifiedVersion === 'unknown') {
    warnings.push(`Client ${client.id} version is unknown.`);
  }
  if (client.needsReview) {
    warnings.push(`Client ${client.id} needs review: ${client.reviewReason || 'no reason provided'}`);
  }

  const examplePath = path.join(root, client.configExample);
  if (!fs.existsSync(examplePath)) {
    errors.push(`Config example not found for ${client.id}: ${client.configExample}`);
    continue;
  }
  const content = fs.readFileSync(examplePath, 'utf8');
  if (client.configFormat === 'toml') {
    if (!checkToml(content)) {
      errors.push(`Config example for ${client.id} does not look like TOML MCP config.`);
    }
  } else if (client.configFormat === 'json') {
    try {
      const json = JSON.parse(content);
      if (!checkJsonConfig(json)) {
        errors.push(`Config example for ${client.id} is missing expected MCP fields.`);
      }
    } catch (error) {
      errors.push(`Config example for ${client.id} is not valid JSON.`);
    }
  }
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

if (errors.length) {
  for (const error of errors) {
    console.error(`Error: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('MCP client compatibility check passed.');
}
