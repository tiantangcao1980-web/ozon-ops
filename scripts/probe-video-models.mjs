import fs from 'node:fs';
import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
const client = new RemoteMcpClient({ timeoutMs: 120000 });
function payload(res) { if (res?.structuredContent) return res.structuredContent; const t = res?.content?.[0]?.text; if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } } return res; }
const call = async (n, a) => payload(await client.callTool(n, a || {}));
const credits = await call('get_credits');
console.log('CREDITS ' + JSON.stringify(credits));
const models = await call('list_models', { kind: 'video' });
const text = JSON.stringify(models);
console.log('VIDEO MODELS >>> ' + text.slice(0, 4000));
