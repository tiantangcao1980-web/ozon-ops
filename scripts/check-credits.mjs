import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
const client = new RemoteMcpClient({ timeoutMs: 60000 });
function payload(res) { if (res?.structuredContent) return res.structuredContent; const t = res?.content?.[0]?.text; if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } } return res; }
const c = await client.callTool('get_credits', {});
console.log(JSON.stringify(payload(c)));
