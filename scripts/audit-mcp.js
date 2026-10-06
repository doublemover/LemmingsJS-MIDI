import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const transport = new StdioClientTransport({ command: process.execPath, args: ['mcp/server.js'], env: { ...process.env, LEMMINGS_MCP_BASE_URL:'http://127.0.0.1:8096', LEMMINGS_MCP_PATH:'/editor.html?e2e=1' } });
const client = new Client({ name:'editor-audit', version:'1.0.0' });
const results = {};
await client.connect(transport);
try {
  results.tools = await client.listTools();
  results.session = await client.callTool({ name:'session_create', arguments:{headless:true} });
  const sessionId = results.session.structuredContent?.sessionId;
  assert.ok(sessionId, JSON.stringify(results.session));
  const tool = results.tools.tools.find(t=>t.name.replaceAll('_','.').endsWith('editor.apply'))?.name || 'editor_apply';
  results.editor = await client.callTool({name:tool,arguments:{sessionId,ops:[
    {type:'level.loadText',args:{text:await fs.readFile('evidence/levels/orchard-gate.nxlv','utf8')}},
    {type:'entry.add',args:{kind:'terrain',props:{PIECE:9,X:0,Y:136}}},
    {type:'history.undo'}, {type:'history.redo'},
    {type:'validate.run'}, {type:'level.export',args:{format:'nxlv'}}
  ],returnState:'editor'}});
  assert.equal(results.editor.structuredContent?.ok, true);
  assert.ok(results.editor.structuredContent.resources.length);
  results.exported = await client.readResource({uri:results.editor.structuredContent.resources[0].uri});
  assert.ok(results.exported.contents.some(item=>item.text?.includes('The Orchard Gate')));
  results.objects = await client.callTool({name:'objects_list',arguments:{sessionId,kind:'all'}});
  assert.equal(results.objects.structuredContent?.ok,true);
  results.state = await client.callTool({name:'state_get',arguments:{sessionId,preset:'compact'}});
  await client.callTool({name:'session_close',arguments:{sessionId}});
  console.log('MCP tools',results.tools.tools.map(t=>t.name).join(', '));
  console.log('Editor result',JSON.stringify(results.editor.structuredContent).slice(0,500));
} finally {
  await fs.writeFile('evidence/mcp-results.json',JSON.stringify(results,null,2));
  await client.close();
}
