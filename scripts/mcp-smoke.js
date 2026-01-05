import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE_URL = process.env.LEMMINGS_MCP_BASE_URL || 'https://localhost:8080';
const PATH = process.env.LEMMINGS_MCP_PATH || '/?e2e=1';

const run = async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['mcp/server.js'],
    env: {
      LEMMINGS_MCP_BASE_URL: BASE_URL,
      LEMMINGS_MCP_PATH: PATH
    }
  });

  const client = new Client({ name: 'mcp-smoke', version: '0.0.0' });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    if (!Array.isArray(tools.tools) || tools.tools.length === 0) {
      throw new Error('No tools returned from MCP server.');
    }

    const session = await client.callTool({
      name: 'session_create',
      arguments: { headless: true, events: { mode: 'minimal' } }
    });

    const sessionId = session?.structuredContent?.sessionId;
    if (!sessionId) {
      throw new Error('session_create did not return a sessionId.');
    }

    const state = await client.callTool({
      name: 'state_get',
      arguments: {
        sessionId,
        preset: 'compact',
        lemmings: { mode: 'summary', topK: 2, includeSelected: true }
      }
    });

    if (!state?.structuredContent?.snapshot) {
      throw new Error('state_get did not return a snapshot.');
    }

    const delta = await client.callTool({
      name: 'state_delta',
      arguments: { sessionId }
    });

    if (!Array.isArray(delta?.structuredContent?.deltas)) {
      throw new Error('state_delta did not return deltas.');
    }

    const skill = await client.callTool({
      name: 'skill_apply',
      arguments: { sessionId, skill: 'builder', verify: true, requireAvailable: false }
    });

    if (!skill?.structuredContent?.ok) {
      throw new Error('skill_apply did not return ok=true.');
    }

    await client.callTool({ name: 'session_close', arguments: { sessionId } });
    console.log('MCP smoke test passed.');
  } finally {
    await client.close();
  }
};

run().catch((error) => {
  const message = error?.message || String(error);
  console.error(`MCP smoke test failed: ${message}`);
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED|page\.goto/.test(message)) {
    console.error('Ensure the HTTPS game server is running (npm run start-https).');
  }
  process.exit(1);
});
