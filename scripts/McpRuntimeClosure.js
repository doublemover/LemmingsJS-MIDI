import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';

export async function collectMcpRuntimeClosure({ entry = 'mcp/server.js', ...options } = {}) {
  const resources = ['mcp/spectator.html', 'keybindings.json'];
  const closure = await collectRuntimeSourceClosure({ ...options, entries: [entry], resources });
  const { entries, ...receipt } = closure;
  return { ...receipt, schema: 'lemmings-mcp-runtime-closure/v1', entry };
}
