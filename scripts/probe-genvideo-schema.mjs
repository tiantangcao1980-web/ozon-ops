import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
const client = new RemoteMcpClient({ timeoutMs: 120000 });
const tools = await client.listTools();
const v = (tools.tools || tools).find((t) => t.name === 'generate_video');
console.log(JSON.stringify(v, null, 1).slice(0, 4000));
